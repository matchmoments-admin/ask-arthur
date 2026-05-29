// Cluster builder — daily at 4am UTC, groups related scam reports into campaigns
// via shared entities using union-find. Reports sharing 2+ entities are clustered.

import { inngest } from "./client";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { withAxiomLogging } from "./with-axiom-logging";

// Page size for the unclustered-links sweep. PostgREST caps a single response
// at ~1000 rows by default, so the old unpaginated fetch SILENTLY clustered on
// only the first page once the unclustered backlog exceeded that — paginating
// restores correctness as well as bounding per-query memory (#523 H1a).
const LINK_PAGE_SIZE = 1000;

// Components larger than this are treated as noise (e.g. a popular
// link-shortener entity unioning thousands of unrelated reports) and skipped
// rather than committed as one giant cluster whose report UPDATE would lock a
// huge slice of the hot scam_reports table (#523 H1b).
const MAX_CLUSTER_SIZE = 5000;

// Union-Find with path compression + union by rank
class UnionFind {
  parent: Map<number, number>;
  rank: Map<number, number>;

  constructor() {
    this.parent = new Map();
    this.rank = new Map();
  }

  makeSet(x: number) {
    if (!this.parent.has(x)) {
      this.parent.set(x, x);
      this.rank.set(x, 0);
    }
  }

  find(x: number): number {
    if (this.parent.get(x) !== x) {
      this.parent.set(x, this.find(this.parent.get(x)!));
    }
    return this.parent.get(x)!;
  }

  union(x: number, y: number) {
    const rx = this.find(x);
    const ry = this.find(y);
    if (rx === ry) return;

    const rankX = this.rank.get(rx)!;
    const rankY = this.rank.get(ry)!;
    if (rankX < rankY) {
      this.parent.set(rx, ry);
    } else if (rankX > rankY) {
      this.parent.set(ry, rx);
    } else {
      this.parent.set(ry, rx);
      this.rank.set(rx, rankX + 1);
    }
  }

  getComponents(): Map<number, number[]> {
    const components = new Map<number, number[]>();
    for (const x of this.parent.keys()) {
      const root = this.find(x);
      const members = components.get(root) || [];
      members.push(x);
      components.set(root, members);
    }
    return components;
  }
}

export const clusterBuilder = inngest.createFunction(
  {
    id: "pipeline-cluster-builder",
    timeouts: { finish: "6m" },
    name: "Pipeline: Build Scam Clusters",
    concurrency: { limit: 1 },
  },
  { cron: "0 4 * * *" }, // Daily at 4am UTC
  withAxiomLogging({ fnId: "pipeline-cluster-builder" }, async ({ step }) => {
    if (!featureFlags.clusterBuilder) {
      return { skipped: true, reason: "clusterBuilder feature flag disabled" };
    }

    // Step 1: Find entities that appear in 2+ unclustered reports.
    // Paginated (#523 H1a) — accumulate ALL unclustered links across pages so
    // the union-find sees the complete graph; the old single unpaginated
    // query silently capped at PostgREST's ~1000-row default.
    const entityReportMap = await step.run(
      "fetch-shared-entities",
      async () => {
        const supabase = createServiceClient();
        if (!supabase) return {};

        const map: Record<number, number[]> = {};
        let from = 0;
        for (;;) {
          const { data, error } = await supabase
            .from("report_entity_links")
            .select("entity_id, report_id, scam_reports!inner(cluster_id)")
            .is("scam_reports.cluster_id", null)
            .order("id", { ascending: true })
            .range(from, from + LINK_PAGE_SIZE - 1);

          if (error) {
            logger.error("Failed to fetch entity links for clustering", {
              error: String(error),
            });
            throw new Error(error.message);
          }

          const rows = data || [];
          for (const row of rows) {
            const entityId = row.entity_id;
            const reportId = row.report_id;
            if (!map[entityId]) map[entityId] = [];
            if (!map[entityId].includes(reportId)) {
              map[entityId].push(reportId);
            }
          }

          if (rows.length < LINK_PAGE_SIZE) break; // last page
          from += LINK_PAGE_SIZE;
        }

        // Only keep entities in 2+ reports (these create cluster links)
        const filtered: Record<number, number[]> = {};
        for (const [entityId, reportIds] of Object.entries(map)) {
          if (reportIds.length >= 2) {
            filtered[Number(entityId)] = reportIds;
          }
        }

        return filtered;
      }
    );

    const entityIds = Object.keys(entityReportMap).map(Number);
    if (entityIds.length === 0) {
      return { clustersCreated: 0, reason: "no shared entities found" };
    }

    // Step 2: Build connected components using union-find
    const components = await step.run("build-components", async () => {
      const uf = new UnionFind();

      // For each entity, union all its report IDs together
      for (const reportIds of Object.values(entityReportMap)) {
        for (const rid of reportIds) {
          uf.makeSet(rid);
        }
        // Union consecutive pairs — this connects all reports sharing an entity
        for (let i = 1; i < reportIds.length; i++) {
          uf.union(reportIds[0], reportIds[i]);
        }
      }

      // Get connected components (clusters) with 2+ members. Skip noise
      // mega-clusters (#523 H1b): a component larger than MAX_CLUSTER_SIZE is
      // almost certainly a shared noise entity (popular shortener / CDN) that
      // unioned unrelated reports — committing it would lock a huge slice of
      // scam_reports. Log and skip rather than create a giant bogus campaign.
      const allComponents = uf.getComponents();
      const clusters: number[][] = [];
      let skippedOversize = 0;
      for (const members of allComponents.values()) {
        if (members.length < 2) continue;
        if (members.length > MAX_CLUSTER_SIZE) {
          skippedOversize++;
          logger.warn("cluster-builder: skipping oversize component", {
            size: members.length,
            max: MAX_CLUSTER_SIZE,
          });
          continue;
        }
        clusters.push(members.sort((a, b) => a - b));
      }
      if (skippedOversize > 0) {
        logger.warn("cluster-builder: oversize components skipped", {
          count: skippedOversize,
        });
      }

      return clusters;
    });

    if (components.length === 0) {
      return { clustersCreated: 0, reason: "no multi-report clusters found" };
    }

    // Step 3: Create clusters and assign members
    const results = await step.run("create-clusters", async () => {
      const supabase = createServiceClient();
      if (!supabase) return { created: 0, membersLinked: 0 };

      let created = 0;
      let membersLinked = 0;

      for (const reportIds of components) {
        // Get the dominant scam_type and brand from these reports
        const { data: reports } = await supabase
          .from("scam_reports")
          .select("scam_type, impersonated_brand")
          .in("id", reportIds);

        const typeCounts: Record<string, number> = {};
        const brandCounts: Record<string, number> = {};
        for (const r of reports || []) {
          if (r.scam_type) {
            typeCounts[r.scam_type] = (typeCounts[r.scam_type] || 0) + 1;
          }
          if (r.impersonated_brand) {
            brandCounts[r.impersonated_brand] =
              (brandCounts[r.impersonated_brand] || 0) + 1;
          }
        }

        const primaryType =
          Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ??
          null;
        const primaryBrand =
          Object.entries(brandCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ??
          null;

        // Count unique entities shared by these reports
        const { count: entityCount } = await supabase
          .from("report_entity_links")
          .select("entity_id", { count: "exact", head: true })
          .in("report_id", reportIds);

        // Commit cluster + members + report-stamp ATOMICALLY in one
        // transaction (#523 H1c). The old 3-call sequence (insert cluster →
        // insert members → update reports) left orphaned state on a crash
        // between calls, causing the next run to re-cluster the same reports.
        const { data: clusterId, error: commitError } = await supabase.rpc(
          "commit_scam_cluster",
          {
            p_report_ids: reportIds,
            p_primary_scam_type: primaryType,
            p_primary_brand: primaryBrand,
            p_entity_count: entityCount ?? 0,
          },
        );

        if (commitError || !clusterId) {
          logger.error("Failed to commit cluster", {
            error: String(commitError),
          });
          continue;
        }

        created++;
        membersLinked += reportIds.length;
      }

      return { created, membersLinked };
    });

    logger.info("Cluster building complete", {
      components: components.length,
      ...results,
    });

    return {
      clustersCreated: results.created,
      membersLinked: results.membersLinked,
      componentsFound: components.length,
    };
  })
);

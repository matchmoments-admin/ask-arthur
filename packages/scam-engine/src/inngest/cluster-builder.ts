// Cluster builder — daily at 4am UTC, groups related scam reports into campaigns
// via shared entities using union-find. Reports sharing 2+ entities are clustered.

import { inngest } from "./client";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { featureFlags } from "@askarthur/utils/feature-flags";

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
    name: "Pipeline: Build Scam Clusters",
    concurrency: { limit: 1 },
  },
  { cron: "0 4 * * *" }, // Daily at 4am UTC
  async ({ step }) => {
    if (!featureFlags.clusterBuilder) {
      return { skipped: true, reason: "clusterBuilder feature flag disabled" };
    }

    // Step 1: Find entities that appear in 2+ unclustered reports
    const entityReportMap = await step.run(
      "fetch-shared-entities",
      async () => {
        const supabase = createServiceClient();
        if (!supabase) return {};

        // Find entities linked to reports that have no cluster_id
        const { data, error } = await supabase
          .from("report_entity_links")
          .select("entity_id, report_id, scam_reports!inner(cluster_id)")
          .is("scam_reports.cluster_id", null);

        if (error) {
          logger.error("Failed to fetch entity links for clustering", {
            error: String(error),
          });
          throw new Error(error.message);
        }

        // Build entity -> report_ids map
        const map: Record<number, number[]> = {};
        for (const row of data || []) {
          const entityId = row.entity_id;
          const reportId = row.report_id;
          if (!map[entityId]) map[entityId] = [];
          if (!map[entityId].includes(reportId)) {
            map[entityId].push(reportId);
          }
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

      // Get connected components (clusters) with 2+ members
      const allComponents = uf.getComponents();
      const clusters: number[][] = [];
      for (const members of allComponents.values()) {
        if (members.length >= 2) {
          clusters.push(members.sort((a, b) => a - b));
        }
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

        // Create cluster
        const { data: cluster, error: clusterError } = await supabase
          .from("scam_clusters")
          .insert({
            cluster_type: "entity_overlap",
            primary_scam_type: primaryType,
            primary_brand: primaryBrand,
            member_count: reportIds.length,
            entity_count: entityCount ?? 0,
            status: "active",
          })
          .select("id")
          .single();

        if (clusterError || !cluster) {
          logger.error("Failed to create cluster", {
            error: String(clusterError),
          });
          continue;
        }

        // Link members
        const memberRows = reportIds.map((reportId) => ({
          cluster_id: cluster.id,
          report_id: reportId,
        }));

        const { error: memberError } = await supabase
          .from("cluster_members")
          .insert(memberRows);

        if (memberError) {
          logger.error("Failed to link cluster members", {
            clusterId: cluster.id,
            error: String(memberError),
          });
          continue;
        }

        // Update reports with cluster_id
        await supabase
          .from("scam_reports")
          .update({ cluster_id: cluster.id })
          .in("id", reportIds);

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
  }
);

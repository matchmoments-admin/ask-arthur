import { describe, expect, it } from "vitest";
import {
  CLUSTERS,
  EDGES,
  NODES,
  NODE_H,
  NODE_W,
  STATS,
  VIEWBOX,
  buildAdjacency,
} from "@/app/admin/showcase/showcase-data";

// showcase-data.ts is hand-edited forever; these checks catch the mistakes a
// visual once-over misses (a renamed node id orphaning edges, a node nudged
// out of the viewBox, a deep link that can only 404 at runtime).

describe("showcase data integrity", () => {
  it("node ids are unique and hash-safe", () => {
    const ids = NODES.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it("every edge endpoint resolves to a node", () => {
    const ids = new Set(NODES.map((n) => n.id));
    for (const edge of EDGES) {
      expect(ids, `edge ${edge.id} from`).toContain(edge.from);
      expect(ids, `edge ${edge.id} to`).toContain(edge.to);
      expect(edge.from).not.toBe(edge.to);
    }
  });

  it("edge ids are unique", () => {
    const ids = EDGES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every node references an existing cluster and fits the viewBox", () => {
    const clusterIds = new Set(CLUSTERS.map((c) => c.id));
    for (const node of NODES) {
      expect(clusterIds, node.id).toContain(node.cluster);
      const w = node.w ?? NODE_W;
      const h = node.h ?? NODE_H;
      expect(node.x, `${node.id} x`).toBeGreaterThanOrEqual(0);
      expect(node.y, `${node.id} y`).toBeGreaterThanOrEqual(0);
      expect(node.x + w, `${node.id} right edge`).toBeLessThanOrEqual(VIEWBOX.w);
      expect(node.y + h, `${node.id} bottom edge`).toBeLessThanOrEqual(VIEWBOX.h);
    }
  });

  it("nodes sit inside their cluster band", () => {
    const byId = new Map(CLUSTERS.map((c) => [c.id, c]));
    for (const node of NODES) {
      const band = byId.get(node.cluster)!;
      expect(node.y, `${node.id} above band`).toBeGreaterThanOrEqual(band.y);
      expect(node.y + (node.h ?? NODE_H), `${node.id} below band`).toBeLessThanOrEqual(band.y + band.h);
    }
  });

  it("nodes within a cluster row do not overlap", () => {
    for (const cluster of CLUSTERS) {
      const row = NODES.filter((n) => n.cluster === cluster.id).sort((a, b) => a.x - b.x);
      for (let i = 1; i < row.length; i++) {
        const prev = row[i - 1];
        expect(
          prev.x + (prev.w ?? NODE_W),
          `${prev.id} overlaps ${row[i].id}`,
        ).toBeLessThanOrEqual(row[i].x);
      }
    }
  });

  it("deep links are absolute in-app paths", () => {
    for (const node of NODES) {
      if (!node.deepLink) continue;
      expect(node.deepLink.href, node.id).toMatch(/^\/[a-z0-9\-/]*$/);
    }
  });

  it("content is present where the panel expects it", () => {
    for (const node of NODES) {
      expect(node.features.length, `${node.id} features`).toBeGreaterThanOrEqual(3);
      expect(node.techStack.length, `${node.id} tech`).toBeGreaterThanOrEqual(2);
      expect(node.engineeringNotes.length, `${node.id} notes`).toBeGreaterThanOrEqual(1);
      expect(node.tagline.length, `${node.id} tagline width`).toBeLessThanOrEqual(28);
    }
    expect(STATS.length).toBe(6);
  });

  it("adjacency covers every node that has edges", () => {
    const adj = buildAdjacency();
    for (const edge of EDGES) {
      expect(adj.get(edge.from)!.edges).toContain(edge.id);
      expect(adj.get(edge.to)!.edges).toContain(edge.id);
    }
  });
});

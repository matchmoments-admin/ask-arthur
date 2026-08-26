"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import NodeDetailPanel from "./NodeDetailPanel";
import SystemDiagram from "./SystemDiagram";
import {
  CLUSTERS,
  NODES,
  STATS,
  TECH_STRIP,
  buildAdjacency,
} from "./showcase-data";
import styles from "./showcase.module.css";

const NODE_IDS = new Set(NODES.map((n) => n.id));

export default function ShowcaseClient() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const adjacency = useMemo(() => buildAdjacency(), []);

  // Deep-linking: /admin/showcase#inngest pre-selects a node so a demo can
  // start anywhere. replaceState (not push) — a click-through shouldn't fill
  // the back stack.
  useEffect(() => {
    const applyHash = () => {
      const hash = window.location.hash.slice(1);
      if (hash && NODE_IDS.has(hash)) setSelectedId(hash);
    };
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedId(null);
        history.replaceState(null, "", window.location.pathname);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const handleSelect = useCallback((id: string) => {
    setSelectedId((current) => {
      const next = current === id ? null : id;
      history.replaceState(null, "", next ? `#${next}` : window.location.pathname);
      return next;
    });
    // Below lg the panel renders under the diagram — bring it into view.
    if (window.matchMedia("(max-width: 1023px)").matches) {
      requestAnimationFrame(() => panelRef.current?.scrollIntoView({ block: "nearest" }));
    }
  }, []);

  const activeId = hoveredId ?? selectedId;
  const connected = activeId ? (adjacency.get(activeId) ?? null) : null;
  const selectedNode = selectedId ? (NODES.find((n) => n.id === selectedId) ?? null) : null;

  return (
    <div className={`${styles.shell} flex flex-col gap-[26px]`}>
      {/* Stats row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {STATS.map((stat) => (
          <div
            key={stat.label}
            style={{
              background: "var(--color-surface)",
              border: "1px solid var(--color-line)",
              borderRadius: 14,
              padding: 14,
              boxShadow: "var(--shadow-card)",
            }}
          >
            <div className="serif" style={{ fontSize: 22, color: "var(--color-ink)", lineHeight: 1 }}>
              {stat.value}
            </div>
            <div
              className="mt-[6px] text-[10px] font-semibold uppercase"
              style={{ letterSpacing: "0.08em", color: "var(--color-muted)" }}
            >
              {stat.label}
            </div>
          </div>
        ))}
      </div>

      {/* Diagram + detail panel */}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div
          className="flex flex-col gap-3"
          style={{
            background: "var(--color-surface)",
            border: "1px solid var(--color-line)",
            borderRadius: 14,
            padding: 20,
            boxShadow: "var(--shadow-card)",
          }}
        >
          <div className="flex items-center justify-between">
            <span
              className="mono text-[10px] font-semibold"
              style={{ letterSpacing: "0.1em", color: "var(--color-muted)" }}
            >
              SYSTEM DIAGRAM
            </span>
            <span style={{ fontSize: 11, color: "var(--color-muted-2)" }}>
              hover to trace · click to inspect · Esc to clear
            </span>
          </div>
          <div className="overflow-x-auto">
            <SystemDiagram
              selectedId={selectedId}
              hoveredId={hoveredId}
              connected={connected}
              onSelect={handleSelect}
              onHover={setHoveredId}
            />
          </div>
        </div>

        <div ref={panelRef} className="lg:sticky lg:top-20">
          <NodeDetailPanel node={selectedNode} />
        </div>
      </div>

      {/* Cluster overview cards — double as the accessible stacked list on mobile */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {CLUSTERS.map((cluster) => (
          <div
            key={cluster.id}
            className="flex flex-col gap-[9px]"
            style={{
              background: "var(--color-surface)",
              border: "1px solid var(--color-line)",
              borderRadius: 14,
              padding: 14,
              boxShadow: "var(--shadow-card)",
            }}
          >
            <div
              className="mono text-[10px] font-semibold"
              style={{ letterSpacing: "0.1em", color: "var(--color-muted)" }}
            >
              {cluster.label}
            </div>
            <div className="flex flex-wrap gap-[6px]">
              {NODES.filter((n) => n.cluster === cluster.id).map((node) => {
                const isSelected = node.id === selectedId;
                return (
                  <button
                    key={node.id}
                    type="button"
                    onClick={() => handleSelect(node.id)}
                    style={{
                      fontSize: 11.5,
                      color: isSelected ? "var(--color-teal)" : "var(--color-ink)",
                      background: isSelected ? "var(--color-teal-soft)" : "var(--color-surface-2)",
                      border: `1px solid ${isSelected ? "#d0e9e6" : "var(--color-line)"}`,
                      borderRadius: 6,
                      padding: "3px 8px",
                      cursor: "pointer",
                    }}
                  >
                    {node.title}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Tech-stack strip */}
      <div
        className="flex flex-col gap-[10px]"
        style={{ borderTop: "1px solid var(--color-line)", paddingTop: 18 }}
      >
        <div
          className="mono text-[10px] font-semibold"
          style={{ letterSpacing: "0.1em", color: "var(--color-muted)" }}
        >
          FULL STACK
        </div>
        <div className="flex flex-wrap gap-[6px]">
          {TECH_STRIP.map((item) => (
            <span
              key={item.name}
              className="mono"
              title={item.category}
              style={{
                fontSize: 11,
                color: "var(--color-ink-2)",
                background: "var(--color-surface)",
                border: "1px solid var(--color-line)",
                borderRadius: 6,
                padding: "3px 9px",
              }}
            >
              {item.name}
            </span>
          ))}
        </div>
        <div style={{ fontSize: 11, color: "var(--color-muted-2)", marginTop: 4 }}>
          Zero idle cost — no fetches after load · CSS-only animation · prefers-reduced-motion
          honoured
        </div>
      </div>
    </div>
  );
}

"use client";

import type { KeyboardEvent } from "react";
import {
  CLUSTERS,
  EDGES,
  NODES,
  NODE_H,
  NODE_W,
  VIEWBOX,
  type EdgeKind,
  type ShowcaseNode,
} from "./showcase-data";
import styles from "./showcase.module.css";

interface SystemDiagramProps {
  selectedId: string | null;
  hoveredId: string | null;
  connected: { edges: Set<string>; nodes: Set<string> } | null;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
}

const EDGE_STYLE: Record<EdgeKind, { stroke: string; width: number; dash?: string; marker: string }> = {
  event: { stroke: "var(--color-teal)", width: 1.6, marker: "url(#arrow-event)" },
  http: { stroke: "var(--color-ink-2)", width: 1.4, marker: "url(#arrow-http)" },
  cron: { stroke: "var(--color-muted)", width: 1.2, dash: "3 5", marker: "url(#arrow-cron)" },
  db: { stroke: "var(--color-ink)", width: 1.2, dash: "1 3", marker: "url(#arrow-db)" },
};

/** Default quadratic between facing box sides — used when an edge has no hand-tuned `d`. */
function edgePath(a: ShowcaseNode, b: ShowcaseNode): string {
  const aw = a.w ?? NODE_W;
  const ah = a.h ?? NODE_H;
  const bw = b.w ?? NODE_W;
  const start = { x: a.x + aw / 2, y: a.y + ah };
  const end = { x: b.x + bw / 2, y: b.y - 2 };
  const cx = (start.x + end.x) / 2 + (start.x < end.x ? 24 : -24);
  const cy = (start.y + end.y) / 2;
  return `M ${start.x} ${start.y} Q ${cx} ${cy} ${end.x} ${end.y}`;
}

function ArrowMarker({ id, stroke }: { id: string; stroke: string }) {
  return (
    <marker id={id} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
      <path d="M 1 1 L 7 4 L 1 7" fill="none" stroke={stroke} strokeWidth={1.3} />
    </marker>
  );
}

export default function SystemDiagram({
  selectedId,
  hoveredId,
  connected,
  onSelect,
  onHover,
}: SystemDiagramProps) {
  const activeId = hoveredId ?? selectedId;
  const nodeById = new Map(NODES.map((n) => [n.id, n]));

  const isNodeDim = (id: string) =>
    activeId !== null && id !== activeId && !(connected?.nodes.has(id) ?? false);
  const isEdgeDim = (id: string) => activeId !== null && !(connected?.edges.has(id) ?? false);
  const isEdgeActive = (id: string) => activeId !== null && (connected?.edges.has(id) ?? false);

  const handleKeyDown = (event: KeyboardEvent<SVGGElement>, id: string) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(id);
    }
  };

  return (
    <svg
      viewBox={`0 0 ${VIEWBOX.w} ${VIEWBOX.h}`}
      width="100%"
      style={{ display: "block", minWidth: 760 }}
      role="group"
      aria-label="Ask Arthur system architecture. Use Tab to move between subsystems, Enter to inspect one."
    >
      <defs>
        <ArrowMarker id="arrow-event" stroke="#1e8c86" />
        <ArrowMarker id="arrow-http" stroke="#1b3257" />
        <ArrowMarker id="arrow-cron" stroke="#6b7280" />
        <ArrowMarker id="arrow-db" stroke="#0b1f3a" />
      </defs>

      {CLUSTERS.map((cluster) => (
        <g key={cluster.id} className={styles.clusterIn}>
          <rect
            x={cluster.x}
            y={cluster.y}
            width={cluster.w}
            height={cluster.h}
            rx={14}
            fill="var(--color-surface-2)"
            stroke="var(--color-line-soft)"
          />
          <text
            x={cluster.x + 16}
            y={cluster.y + 24}
            fontSize={11}
            letterSpacing="0.1em"
            fill="var(--color-muted)"
            style={{ fontFamily: "var(--font-geist-mono)" }}
          >
            {cluster.label}
          </text>
        </g>
      ))}

      <g fill="none">
        {EDGES.map((edge, index) => {
          const style = EDGE_STYLE[edge.kind];
          const d = edge.d ?? edgePath(nodeById.get(edge.from)!, nodeById.get(edge.to)!);
          return (
            <g
              key={edge.id}
              className={styles.dimmable}
              data-dim={isEdgeDim(edge.id) || undefined}
            >
              <path
                d={d}
                pathLength={100}
                stroke={style.stroke}
                strokeWidth={style.width}
                strokeDasharray={style.dash}
                markerEnd={style.marker}
                className={styles.edgeDraw}
                style={{ "--i": index } as React.CSSProperties}
              />
              <path
                d={d}
                pathLength={100}
                stroke="var(--color-teal)"
                strokeWidth={style.width + 0.2}
                className={styles.flowOverlay}
                data-always-flow={edge.alwaysFlow || undefined}
                data-active={isEdgeActive(edge.id) || undefined}
              />
              {edge.label ? (
                <EdgeLabel d={d} label={edge.label} kind={edge.kind} />
              ) : null}
            </g>
          );
        })}
      </g>

      {NODES.map((node, index) => {
        const w = node.w ?? NODE_W;
        const h = node.h ?? NODE_H;
        const selected = node.id === selectedId;
        return (
          <g
            key={node.id}
            transform={`translate(${node.x}, ${node.y})`}
            className={`${styles.nodeIn} ${styles.dimmable} ${styles.nodeGroup}`}
            style={{ "--i": index } as React.CSSProperties}
            data-dim={isNodeDim(node.id) || undefined}
            tabIndex={0}
            role="button"
            aria-pressed={selected}
            aria-label={`${node.title}: ${node.tagline}`}
            onClick={() => onSelect(node.id)}
            onKeyDown={(event) => handleKeyDown(event, node.id)}
            onMouseEnter={() => onHover(node.id)}
            onMouseLeave={() => onHover(null)}
            onFocus={() => onHover(node.id)}
            onBlur={() => onHover(null)}
          >
            <rect
              width={w}
              height={h}
              rx={10}
              fill={selected ? "var(--color-teal-soft)" : "var(--color-surface)"}
              stroke={selected ? "var(--color-teal)" : "var(--color-line)"}
              strokeWidth={selected ? 2 : 1}
            />
            <text x={14} y={22} fontSize={14} fontWeight={selected ? 700 : 600} fill="var(--color-ink)">
              {node.title}
            </text>
            <text x={14} y={39} fontSize={11} fill={selected ? "#42706b" : "var(--color-muted)"}>
              {node.tagline}
            </text>
            {node.status === "live" ? (
              <>
                <rect x={w - 46} y={10} width={34} height={14} rx={7} fill="var(--color-teal-soft)" />
                <text x={w - 29} y={20} fontSize={8} fontWeight={700} fill="var(--color-teal)" textAnchor="middle">
                  LIVE
                </text>
              </>
            ) : null}
          </g>
        );
      })}

      <text
        x={24}
        y={VIEWBOX.h - 26}
        fontSize={10.5}
        fill="var(--color-muted-2)"
        style={{ fontFamily: "var(--font-geist-mono)" }}
      >
        flow animation runs on the teal spine + selected node only — everything else is static after draw-in
      </text>
      <Legend />
    </svg>
  );
}

/** Label placed at the path midpoint with a white halo so it survives crossings. */
function EdgeLabel({ d, label, kind }: { d: string; label: string; kind: EdgeKind }) {
  // Cheap midpoint: average of the numeric coordinates in the path string.
  const nums = d.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
  const xs = nums.filter((_, i) => i % 2 === 0);
  const ys = nums.filter((_, i) => i % 2 === 1);
  const x = xs.reduce((a, b) => a + b, 0) / Math.max(xs.length, 1);
  const y = ys.reduce((a, b) => a + b, 0) / Math.max(ys.length, 1) - 6;
  return (
    <text
      x={x}
      y={y}
      fontSize={10.5}
      fill={kind === "event" ? "var(--color-teal)" : "var(--color-muted)"}
      stroke="#ffffff"
      strokeWidth={3}
      style={{ paintOrder: "stroke", fontFamily: "var(--font-geist-mono)" }}
      textAnchor="middle"
    >
      {label}
    </text>
  );
}

function Legend() {
  const items: Array<{ kind: EdgeKind; label: string; x: number }> = [
    { kind: "event", label: "event", x: 742 },
    { kind: "http", label: "http", x: 826 },
    { kind: "cron", label: "cron", x: 902 },
    { kind: "db", label: "db write", x: 980 },
  ];
  const y = VIEWBOX.h - 30;
  return (
    <g fill="none" aria-hidden="true">
      {items.map((item) => {
        const style = EDGE_STYLE[item.kind];
        return (
          <g key={item.kind}>
            <line
              x1={item.x}
              y1={y}
              x2={item.x + 26}
              y2={y}
              stroke={style.stroke}
              strokeWidth={style.width}
              strokeDasharray={style.dash}
            />
            <text
              x={item.x + 32}
              y={y + 4}
              fontSize={10.5}
              fill="var(--color-muted)"
              style={{ fontFamily: "var(--font-geist-mono)" }}
            >
              {item.label}
            </text>
          </g>
        );
      })}
    </g>
  );
}

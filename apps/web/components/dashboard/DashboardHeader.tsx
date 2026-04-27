"use client";

import { useState } from "react";
import { Search, Bell, Calendar, Download } from "lucide-react";

interface DashboardHeaderProps {
  displayName: string | null;
  email: string;
  orgName?: string | null;
  /** Hide the persona pills (e.g. for org-less consumer accounts). */
  hidePersonas?: boolean;
}

const PERSONAS = ["All", "Compliance", "Fraud Ops", "Investigations", "Executive"];

function firstName(displayName: string | null, email: string) {
  if (displayName && displayName.trim()) {
    return displayName.trim().split(/\s+/)[0];
  }
  const local = email.split("@")[0] ?? "";
  if (!local) return "there";
  return local.charAt(0).toUpperCase() + local.slice(1);
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export default function DashboardHeader({
  displayName,
  email,
  orgName,
  hidePersonas,
}: DashboardHeaderProps) {
  const [activePersona, setActivePersona] = useState("All");
  const name = firstName(displayName, email);

  return (
    <div className="flex flex-col">
      {/* Topbar: search + actions */}
      <header
        className="hidden lg:flex items-center gap-4"
        style={{
          padding: "14px 28px",
          background: "#fff",
          borderBottom: "1px solid #eef0f3",
        }}
      >
        <button
          type="button"
          className="flex items-center gap-2 text-slate-500 flex-1 text-left bg-white"
          style={{
            border: "1px solid #eef0f3",
            borderRadius: 8,
            padding: "7px 10px",
            maxWidth: 480,
          }}
        >
          <Search size={15} strokeWidth={1.6} />
          <span className="text-[13px]">
            Search entities, clusters, evidence…
          </span>
          <span
            className="ml-auto text-[10px] text-slate-400 font-mono"
            style={{
              border: "1px solid #e2e8f0",
              borderRadius: 4,
              padding: "1px 5px",
            }}
          >
            ⌘K
          </span>
        </button>
        <div className="flex items-center gap-2 ml-auto">
          <IconButton ariaLabel="Notifications" badge={2}>
            <Bell size={15} strokeWidth={1.6} />
          </IconButton>
          <IconButton ariaLabel="Date range">
            <Calendar size={15} strokeWidth={1.6} />
          </IconButton>
          <button
            type="button"
            className="text-white text-[12px] font-medium inline-flex items-center gap-1.5"
            style={{
              background: "var(--color-deep-navy)",
              borderRadius: 7,
              padding: "8px 12px",
            }}
          >
            <Download size={13} strokeWidth={2} />
            Export report
          </button>
        </div>
      </header>

      {/* Page header */}
      <div
        style={{
          padding: "28px 28px 4px",
        }}
        className="flex flex-col gap-5 lg:gap-3 lg:flex-row lg:items-end lg:justify-between"
      >
        <div>
          <div className="flex items-center gap-2.5 text-[12px] text-slate-500 mb-2">
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 999,
                  background: "#16a34a",
                  boxShadow: "0 0 0 3px rgba(22,163,74,0.18)",
                }}
              />
              All systems operational
            </span>
            <span className="text-slate-300">·</span>
            <span className="font-mono">Updated just now</span>
          </div>
          <h1
            className="text-deep-navy"
            style={{
              fontSize: 28,
              fontWeight: 500,
              letterSpacing: "-0.02em",
              margin: 0,
              lineHeight: 1.15,
            }}
          >
            {greeting()}, {name}
          </h1>
          <p className="mt-1.5 text-[14px] text-slate-500">
            {orgName
              ? `Here's the scam protection posture for ${orgName} over the last 7 days.`
              : "Here's your scam protection posture for the last 7 days."}
          </p>
        </div>

        {!hidePersonas && (
          <div
            className="inline-flex shrink-0"
            style={{
              background: "#f8fafc",
              border: "1px solid #eef0f3",
              borderRadius: 9,
              padding: 3,
              alignSelf: "flex-start",
            }}
          >
            {PERSONAS.map((p) => {
              const active = activePersona === p;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => setActivePersona(p)}
                  className="font-medium transition-colors"
                  style={{
                    fontSize: 12,
                    padding: "6px 12px",
                    borderRadius: 7,
                    color: active ? "var(--color-deep-navy)" : "#64748b",
                    background: active ? "#fff" : "transparent",
                    boxShadow: active
                      ? "0 1px 2px rgba(15,23,42,0.06), 0 0 0 1px #eef0f3"
                      : "none",
                  }}
                >
                  {p}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function IconButton({
  ariaLabel,
  badge,
  children,
}: {
  ariaLabel: string;
  badge?: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      className="grid place-items-center text-slate-600 bg-white relative"
      style={{
        width: 32,
        height: 32,
        border: "1px solid #eef0f3",
        borderRadius: 7,
      }}
    >
      {children}
      {badge ? (
        <span
          className="absolute grid place-items-center text-white font-semibold"
          style={{
            top: -3,
            right: -3,
            width: 14,
            height: 14,
            borderRadius: 999,
            background: "#dc2626",
            fontSize: 9,
            border: "2px solid #fff",
          }}
        >
          {badge}
        </span>
      ) : null}
    </button>
  );
}

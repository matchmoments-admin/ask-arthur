"use client";

import { useMemo, useState } from "react";
import {
  Phone,
  Mail,
  ExternalLink,
  Copy,
  Check,
  Siren,
  MapPin,
  ShieldQuestion,
} from "lucide-react";
import type { ReportingAction, Verdict } from "@askarthur/types";
import { resolveBestNextStep, type LossState } from "@/lib/nextStep";
import { AU_STATE_MAP } from "@/lib/chart-tokens";

interface PartnerBadge {
  label: string;
}

interface NextStepsCardProps {
  verdict: Verdict;
  scamType?: string;
  impersonatedBrand?: string;
  channel?: string;
  countryCode?: string | null;
  /** Server-derived jurisdiction (from IP). User can override below. */
  initialStateCode?: string | null;
  /** Optional co-branding for a partner deployment (police-controlled). */
  partnerBadge?: PartnerBadge | null;
  /** Injected telemetry hook (Phase 5) — fired on any action tap. */
  onRouteClick?: (action: ReportingAction, jurisdiction: string | null) => void;
}

// Full-name options for the "change location" picker, derived from the shared
// AU_STATE_MAP (single source of truth — no duplicated state list).
const AU_STATE_OPTIONS = Object.entries(AU_STATE_MAP).map(([name, { code }]) => ({
  name,
  code,
}));

const digitsOnly = (v: string) => v.replace(/[^0-9+]/g, "");
const looksLikePhone = (v: string) => /^[0-9()+\s]{3,}$/.test(v);

export default function NextStepsCard({
  verdict,
  scamType,
  impersonatedBrand,
  channel,
  countryCode,
  initialStateCode = null,
  partnerBadge = null,
  onRouteClick,
}: NextStepsCardProps) {
  const [lossState, setLossState] = useState<LossState>(null);
  const [stateCode, setStateCode] = useState<string | null>(initialStateCode);
  const [showLocation, setShowLocation] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const actions = useMemo(
    () =>
      resolveBestNextStep({
        verdict,
        scamType: scamType ?? null,
        impersonatedBrand: impersonatedBrand ?? null,
        channel: channel ?? null,
        countryCode: countryCode ?? null,
        stateCode,
        lossState,
      }),
    [verdict, scamType, impersonatedBrand, channel, countryCode, stateCode, lossState],
  );

  if (verdict === "SAFE" || actions.length === 0) return null;

  const isAU = countryCode == null || countryCode === "AU";
  const stateLabel =
    (stateCode &&
      AU_STATE_OPTIONS.find((o) => o.code === stateCode)?.name) ||
    null;

  async function handleCopy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
      setTimeout(() => setCopied((c) => (c === value ? null : c)), 2000);
    } catch {
      /* clipboard blocked — no-op */
    }
  }

  function fireTelemetry(action: ReportingAction) {
    onRouteClick?.(action, stateCode);
  }

  return (
    <section
      aria-labelledby="next-steps-heading"
      className="mt-5 rounded-lg border-2 border-deep-navy/20 bg-white overflow-hidden"
    >
      <div className="flex items-center justify-between gap-2 bg-deep-navy px-5 py-4">
        <div className="flex items-center gap-2">
          <Siren className="text-white shrink-0" size={20} aria-hidden="true" />
          <h3
            id="next-steps-heading"
            className="text-sm font-bold uppercase tracking-widest text-white"
          >
            What to do now
          </h3>
        </div>
        {partnerBadge && (
          <span className="text-xs text-white/80">{partnerBadge.label}</span>
        )}
      </div>

      <div className="px-5 py-5 space-y-4">
        {/* Loss / PII micro-question — routes to the single best destination. */}
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="flex items-center gap-2 mb-2">
            <ShieldQuestion size={18} className="text-deep-navy shrink-0" aria-hidden="true" />
            <p className="text-sm font-bold text-deep-navy">
              Did you send money or share personal details?
            </p>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="What happened">
            {(
              [
                { key: "money", label: "I sent money" },
                { key: "details", label: "I shared details" },
                { key: "neither", label: "Neither / not sure" },
              ] as { key: LossState; label: string }[]
            ).map((opt) => {
              const active = lossState === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setLossState(active ? null : opt.key)}
                  aria-pressed={active}
                  className={`min-h-[2.75rem] rounded-lg border-2 px-4 py-2 text-sm font-semibold transition ${
                    active
                      ? "border-deep-navy bg-deep-navy text-white"
                      : "border-slate-300 bg-white text-deep-navy hover:border-deep-navy"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Ordered best-report actions. First is the recommended action. */}
        <ul className="space-y-3">
          {actions.map((action, i) => (
            <li key={`${action.kind}:${action.value}`}>
              <ActionRow
                action={action}
                primary={i === 0}
                copied={copied === action.value}
                onCopy={handleCopy}
                onActivate={fireTelemetry}
              />
            </li>
          ))}
        </ul>

        {/* Jurisdiction line + change-location control (AU only). */}
        {isAU && (
          <div className="pt-1 text-xs text-gov-slate">
            <MapPin size={13} className="inline mr-1 -mt-0.5" aria-hidden="true" />
            {stateLabel ? (
              <>Showing options for <strong className="text-deep-navy">{stateLabel}</strong>. </>
            ) : (
              <>Showing national options. </>
            )}
            <button
              type="button"
              onClick={() => setShowLocation((s) => !s)}
              className="underline font-semibold text-deep-navy"
              aria-expanded={showLocation}
            >
              Change location
            </button>
            {showLocation && (
              <div className="mt-2">
                <label htmlFor="next-steps-state" className="sr-only">
                  Your state or territory
                </label>
                <select
                  id="next-steps-state"
                  value={stateCode ?? ""}
                  onChange={(e) => setStateCode(e.target.value || null)}
                  className="min-h-[2.75rem] w-full max-w-xs rounded-lg border-2 border-slate-300 bg-white px-3 py-2 text-sm text-deep-navy"
                >
                  <option value="">Not in Australia / prefer not to say</option>
                  {AU_STATE_OPTIONS.map((o) => (
                    <option key={o.code} value={o.code}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function ActionRow({
  action,
  primary,
  copied,
  onCopy,
  onActivate,
}: {
  action: ReportingAction;
  primary: boolean;
  copied: boolean;
  onCopy: (value: string) => void;
  onActivate: (action: ReportingAction) => void;
}) {
  const urgent = action.urgent;
  const base =
    "flex items-center gap-3 min-h-[3.25rem] w-full rounded-lg border-2 px-4 py-3 text-left transition";
  const tone = urgent
    ? "border-danger-border bg-danger-bg text-danger-text"
    : primary
      ? "border-deep-navy bg-deep-navy/5 text-deep-navy hover:bg-deep-navy/10"
      : "border-slate-200 bg-white text-deep-navy hover:border-deep-navy/40";

  const Body = (
    <>
      <ActionIcon action={action} />
      <span className="min-w-0 flex-1">
        <span className="block text-base font-bold leading-snug">{action.label}</span>
        {action.description && (
          <span className="block text-sm text-gov-slate leading-snug mt-0.5">
            {action.description}
          </span>
        )}
        {(action.kind === "call" ||
          action.kind === "email" ||
          action.kind === "info") && (
          // For call/email/phone-info this is the number/address; for guidance
          // info rows (e.g. "call your bank") it's the critical instruction —
          // always render it, never drop it.
          <span className="block text-sm font-semibold mt-0.5">{action.value}</span>
        )}
      </span>
    </>
  );

  // call → tel:, email → mailto (prefilled), url → new tab, copy → button,
  // info → tel: if it's a number, else static callout.
  if (action.kind === "call") {
    return (
      <a href={`tel:${digitsOnly(action.value)}`} className={`${base} ${tone}`} onClick={() => onActivate(action)}>
        {Body}
      </a>
    );
  }
  if (action.kind === "email") {
    // RFC 6068: mailto queries must be percent-encoded (URLSearchParams would
    // form-encode spaces as "+", which Apple Mail et al. render literally).
    const parts: string[] = [];
    if (action.emailSubject) parts.push(`subject=${encodeURIComponent(action.emailSubject)}`);
    if (action.emailBody) parts.push(`body=${encodeURIComponent(action.emailBody)}`);
    const qs = parts.join("&");
    return (
      <a
        href={`mailto:${action.value}${qs ? `?${qs}` : ""}`}
        className={`${base} ${tone}`}
        onClick={() => onActivate(action)}
      >
        {Body}
      </a>
    );
  }
  if (action.kind === "url") {
    return (
      <a
        href={action.value}
        target="_blank"
        rel="noopener noreferrer"
        className={`${base} ${tone}`}
        onClick={() => onActivate(action)}
      >
        {Body}
      </a>
    );
  }
  if (action.kind === "copy") {
    return (
      <button
        type="button"
        onClick={() => {
          onCopy(action.value);
          onActivate(action);
        }}
        className={`${base} ${tone}`}
      >
        {Body}
        {copied && <Check size={18} className="text-safe-green shrink-0" aria-label="Copied" />}
      </button>
    );
  }
  // info
  if (looksLikePhone(action.value)) {
    return (
      <a href={`tel:${digitsOnly(action.value)}`} className={`${base} ${tone}`} onClick={() => onActivate(action)}>
        {Body}
      </a>
    );
  }
  return (
    <div className={`${base} ${tone}`} role="note">
      {Body}
    </div>
  );
}

function ActionIcon({ action }: { action: ReportingAction }) {
  const size = 22;
  const cls = "shrink-0";
  if (action.urgent) return <Siren size={size} className={cls} aria-hidden="true" />;
  switch (action.kind) {
    case "call":
      return <Phone size={size} className={cls} aria-hidden="true" />;
    case "email":
      return <Mail size={size} className={cls} aria-hidden="true" />;
    case "url":
      return <ExternalLink size={size} className={cls} aria-hidden="true" />;
    case "copy":
      return <Copy size={size} className={cls} aria-hidden="true" />;
    default:
      return <Siren size={size} className={cls} aria-hidden="true" />;
  }
}

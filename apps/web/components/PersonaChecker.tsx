"use client";

import { useState } from "react";
import { Heart, Briefcase, HelpCircle, Loader2, ShieldAlert, ShieldCheck, AlertTriangle, Link, Mail } from "lucide-react";

type PersonaType = "romance" | "employment" | "general" | null;
type Status = "idle" | "selecting" | "input" | "analyzing" | "complete" | "error";

interface PersonaResult {
  verdict: string;
  confidence: number;
  riskLevel: string;
  summary: string;
  redFlags: string[];
  greenFlags: string[];
  recommendations: string[];
  inferredType: string;
}

const TYPE_OPTIONS = [
  {
    type: "romance" as const,
    icon: Heart,
    label: "Romance / Dating",
    desc: "Someone I met on a dating app or social media",
  },
  {
    type: "employment" as const,
    icon: Briefcase,
    label: "Job / Recruiter",
    desc: "A recruiter, employer, or job offer I received",
  },
  {
    type: "general" as const,
    icon: HelpCircle,
    label: "Other / Not Sure",
    desc: "A seller, landlord, or someone I don't fully trust",
  },
];

const VERDICT_STYLES: Record<string, { icon: React.ComponentType<{ size?: number; className?: string }>; bg: string; border: string; text: string }> = {
  "HIGH_RISK": { icon: ShieldAlert, bg: "bg-red-50", border: "border-red-200", text: "text-red-800" },
  "SUSPICIOUS": { icon: AlertTriangle, bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-800" },
  "UNCERTAIN": { icon: AlertTriangle, bg: "bg-slate-50", border: "border-slate-200", text: "text-slate-700" },
  "SAFE": { icon: ShieldCheck, bg: "bg-green-50", border: "border-green-200", text: "text-green-800" },
};

const URL_REGEX = /https?:\/\/[^\s<>"']+/gi;

function extractUrls(text: string): string[] {
  const matches = text.match(URL_REGEX);
  if (!matches) return [];
  // Deduplicate and limit to 3
  return [...new Set(matches)].slice(0, 3);
}

const PLACEHOLDERS: Record<string, string> = {
  romance:
    "Paste their profile URL, messages, bio, or describe the situation...\n\nYou can paste LinkedIn, Instagram, or dating profile URLs — we'll fetch and analyse them.",
  employment:
    "Paste the job listing, recruiter's LinkedIn URL, their message, or company website...\n\nURLs are welcome — we'll fetch the page and check it.",
  general:
    "Paste their profile URL, messages, email, or describe what happened...\n\nYou can include URLs — we'll fetch and analyse the page content.",
};

export default function PersonaChecker() {
  const [status, setStatus] = useState<Status>("idle");
  const [personaType, setPersonaType] = useState<PersonaType>(null);
  const [input, setInput] = useState("");
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<PersonaResult | null>(null);
  const [error, setError] = useState("");

  const handleTypeSelect = (type: PersonaType) => {
    setPersonaType(type);
    setStatus("input");
  };

  const hasInput = input.trim().length >= 5 || extractUrls(input).length > 0 || email.trim().length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasInput || !personaType) return;

    setStatus("analyzing");
    setError("");
    setResult(null);

    const urls = extractUrls(input);

    try {
      const res = await fetch("/api/persona-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: input.trim() || undefined,
          urls: urls.length > 0 ? urls : undefined,
          email: email.trim() || undefined,
          type: personaType,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Analysis failed");
      }

      const data = await res.json();
      setResult(data);
      setStatus("complete");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
      setStatus("error");
    }
  };

  // Type selection
  if (status === "idle" || status === "selecting") {
    return (
      <div className="space-y-3">
        <p className="text-sm text-gov-slate text-center mb-4">
          What type of person are you checking?
        </p>
        {TYPE_OPTIONS.map((opt) => {
          const Icon = opt.icon;
          return (
            <button
              key={opt.type}
              onClick={() => handleTypeSelect(opt.type)}
              className="w-full flex items-center gap-4 p-4 bg-white border border-border-light rounded-xl shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all text-left"
            >
              <Icon size={24} className="text-deep-navy shrink-0" />
              <div>
                <p className="font-semibold text-deep-navy text-sm">{opt.label}</p>
                <p className="text-xs text-gov-slate mt-0.5">{opt.desc}</p>
              </div>
            </button>
          );
        })}
      </div>
    );
  }

  // Input form
  if (status === "input") {
    const typeLabel = TYPE_OPTIONS.find((o) => o.type === personaType)?.label || "Person";
    const detectedUrls = extractUrls(input);

    return (
      <form onSubmit={handleSubmit} className="space-y-4">
        <button
          type="button"
          onClick={() => { setStatus("idle"); setPersonaType(null); }}
          className="text-sm text-gov-slate hover:text-deep-navy transition-colors"
        >
          ← Change type
        </button>

        <p className="text-sm text-gov-slate">
          Checking: <strong className="text-deep-navy">{typeLabel}</strong>
        </p>

        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={PLACEHOLDERS[personaType || "general"]}
          className="w-full min-h-[200px] rounded-xl border border-border-light p-4 text-base text-deep-navy placeholder:text-slate-400 resize-y focus:outline-none focus:border-deep-navy focus:ring-1 focus:ring-deep-navy/10"
          maxLength={10000}
        />

        {/* Detected URLs indicator */}
        {detectedUrls.length > 0 && (
          <div className="flex items-center gap-2 text-xs text-gov-slate">
            <Link size={14} className="text-action-teal shrink-0" />
            <span>
              {detectedUrls.length === 1 ? "1 URL detected" : `${detectedUrls.length} URLs detected`}
              {` — we\u2019ll fetch and analyse ${detectedUrls.length === 1 ? "it" : "them"}`}
            </span>
          </div>
        )}

        {/* Optional email field */}
        <div>
          <label htmlFor="persona-email" className="flex items-center gap-1.5 text-xs font-medium text-gov-slate mb-1.5">
            <Mail size={14} />
            Their email address <span className="text-slate-400 font-normal">(optional)</span>
          </label>
          <input
            id="persona-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="e.g. recruiter@company.com"
            className="w-full rounded-xl border border-border-light px-4 py-2.5 text-sm text-deep-navy placeholder:text-slate-400 focus:outline-none focus:border-deep-navy focus:ring-1 focus:ring-deep-navy/10"
          />
          {email.trim() && (
            <p className="text-xs text-gov-slate mt-1">
              We&apos;ll check domain age, email authentication records, and disposable address databases.
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={!hasInput}
          className="w-full rounded-xl bg-deep-navy text-white font-bold text-sm py-3 hover:bg-navy transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Analyse Person
        </button>
      </form>
    );
  }

  // Analyzing
  if (status === "analyzing") {
    return (
      <div className="flex flex-col items-center gap-4 py-16">
        <Loader2 size={32} className="animate-spin text-deep-navy" />
        <p className="text-sm text-gov-slate">Analysing for red flags...</p>
      </div>
    );
  }

  // Error
  if (status === "error") {
    return (
      <div className="space-y-4">
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          {error}
        </div>
        <button
          onClick={() => setStatus("input")}
          className="text-sm text-gov-slate hover:text-deep-navy"
        >
          ← Try again
        </button>
      </div>
    );
  }

  // Results
  if (status === "complete" && result) {
    const style = VERDICT_STYLES[result.verdict] || VERDICT_STYLES["UNCERTAIN"];
    const VerdictIcon = style.icon;

    return (
      <div className="space-y-4">
        <button
          onClick={() => { setStatus("idle"); setPersonaType(null); setInput(""); setEmail(""); setResult(null); }}
          className="text-sm text-gov-slate hover:text-deep-navy transition-colors"
        >
          ← Check another
        </button>

        {/* Verdict banner */}
        <div className={`flex items-start gap-3 p-4 ${style.bg} border ${style.border} rounded-xl`}>
          <VerdictIcon size={24} className={`${style.text} shrink-0 mt-0.5`} />
          <div>
            <p className={`font-bold text-sm ${style.text}`}>
              {result.riskLevel} — {result.verdict}
            </p>
            <p className="text-sm text-gov-slate mt-1">{result.summary}</p>
            <p className="text-xs text-slate-400 mt-1" style={{ fontVariantNumeric: "tabular-nums" }}>
              {result.confidence >= 0.85 ? "High confidence" : result.confidence >= 0.6 ? "Moderate confidence" : "Low confidence"}
            </p>
          </div>
        </div>

        {/* Red flags */}
        {result.redFlags.length > 0 && (
          <div className="bg-white border border-border-light rounded-xl shadow-sm p-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-red-500 mb-2">Red Flags</h3>
            <ul className="space-y-1.5">
              {result.redFlags.map((flag, i) => (
                <li key={i} className="text-sm text-gov-slate flex items-start gap-2">
                  <span className="text-red-400 shrink-0">•</span>
                  {flag}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Green flags */}
        {result.greenFlags.length > 0 && (
          <div className="bg-white border border-border-light rounded-xl shadow-sm p-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-green-600 mb-2">Positive Signs</h3>
            <ul className="space-y-1.5">
              {result.greenFlags.map((flag, i) => (
                <li key={i} className="text-sm text-gov-slate flex items-start gap-2">
                  <span className="text-green-500 shrink-0">•</span>
                  {flag}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Recommendations */}
        {result.recommendations.length > 0 && (
          <div className="bg-white border border-border-light rounded-xl shadow-sm p-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-deep-navy mb-2">What to Do</h3>
            <ul className="space-y-1.5">
              {result.recommendations.map((rec, i) => (
                <li key={i} className="text-sm text-gov-slate flex items-start gap-2">
                  <span className="text-slate-400 shrink-0">{i + 1}.</span>
                  {rec}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  return null;
}

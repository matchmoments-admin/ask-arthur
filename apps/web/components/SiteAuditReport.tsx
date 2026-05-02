"use client";

import { useState } from "react";
import Link from "next/link";
import { LEARN_MORE_URLS } from "@askarthur/site-audit/learn-more";
import AuditRawHeaders from "./AuditRawHeaders";
import "./site-audit-report.css";

export interface CheckResult {
  id: string;
  category: string;
  label: string;
  status: string;
  score: number;
  maxScore: number;
  details: string;
  evidence?: string;
}

export interface CategoryScore {
  category: string;
  label: string;
  score: number;
  maxScore: number;
  grade: string;
  checks: CheckResult[];
}

interface SSLInfo {
  valid: boolean;
  issuer: string | null;
  daysRemaining: number | null;
  protocol: string | null;
}

interface FetchError {
  type: "timeout" | "blocked" | "dns_error" | "tls_error" | "network_error";
  message: string;
}

interface Recommendation {
  text: string;
  severity: "critical" | "high" | "medium" | "low";
  snippet?: string;
}

export interface SiteAuditResult {
  url: string;
  domain: string;
  scannedAt: string;
  durationMs: number;
  overallScore: number;
  grade: string;
  categories: CategoryScore[];
  checks: CheckResult[];
  recommendations: (string | Recommendation)[];
  ssl: SSLInfo | null;
  rawHeaders: Record<string, string> | null;
  partial?: boolean;
  fetchError?: FetchError | null;
}

interface SiteAuditReportProps {
  result: SiteAuditResult;
  shareUrl?: string;
  previousScan?: { grade: string; score: number } | null;
}

const FETCH_ERROR_MESSAGES: Record<string, string> = {
  blocked: "This site's firewall blocked our scanner, but we still checked what we could.",
  dns_error: "This domain doesn't appear to exist. We checked DNS records anyway.",
  timeout: "The site took too long to respond. Here's what we found via network checks.",
  tls_error: "SSL/TLS connection failed — this site may have a certificate problem. We still ran DNS checks.",
  network_error: "We couldn't connect to this site, but we checked what we could via DNS.",
};

function normalizeRec(rec: string | Recommendation): Recommendation {
  if (typeof rec === "string") return { text: rec, severity: "medium" };
  return rec;
}

function rankLabel(grade: string): string {
  if (grade.startsWith("A")) return "Excellent";
  if (grade.startsWith("B")) return "Above average";
  if (grade.startsWith("C")) return "Needs work";
  if (grade === "D") return "Poor";
  return "Critical";
}

function statusKey(grade: string): "ok" | "warn" | "err" {
  if (grade.startsWith("A") || grade.startsWith("B")) return "ok";
  if (grade.startsWith("C") || grade === "D") return "warn";
  return "err";
}

function sectionStatusKey(score: number, maxScore: number): "ok" | "warn" | "err" {
  if (maxScore === 0) return "ok";
  const pct = score / maxScore;
  if (pct >= 0.8) return "ok";
  if (pct >= 0.5) return "warn";
  return "err";
}

function checkStatusKey(status: string): "ok" | "warn" | "err" | "skipped" {
  if (status === "pass") return "ok";
  if (status === "warn") return "warn";
  if (status === "fail") return "err";
  return "skipped";
}

function summaryTagFor(s: "ok" | "warn" | "err"): { cls: string; label: string } {
  if (s === "ok") return { cls: "ar-tag-ok", label: "All passing" };
  if (s === "warn") return { cls: "ar-tag-warn", label: "Needs work" };
  return { cls: "ar-tag-err", label: "Critical" };
}

function formatScannedDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-AU", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function IconCheck() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
      <circle cx="12" cy="12" r="10" strokeWidth="1.5" />
      <polyline points="8 12 11 15 16 9" />
    </svg>
  );
}
function IconX() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
      <circle cx="12" cy="12" r="10" strokeWidth="1.5" />
      <line x1="9" y1="9" x2="15" y2="15" />
      <line x1="15" y1="9" x2="9" y2="15" />
    </svg>
  );
}
function IconWarn() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}
function IconMinus() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  );
}
function CheckStatusIcon({ k }: { k: "ok" | "warn" | "err" | "skipped" }) {
  if (k === "ok") return <IconCheck />;
  if (k === "warn") return <IconWarn />;
  if (k === "err") return <IconX />;
  return <IconMinus />;
}

const CATEGORY_ICON_PATHS: Record<string, string> = {
  "https-tls": "M3 11h18v11H3zM7 11V7a5 5 0 0110 0v4",
  tls: "M3 11h18v11H3zM7 11V7a5 5 0 0110 0v4",
  "security-headers": "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  headers: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  "content-security": "M12 2L2 7l10 5 10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
  csp: "M12 2L2 7l10 5 10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
  "email-security": "M4 4h16a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2zM22 6L12 13 2 6",
  email: "M4 4h16a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2zM22 6L12 13 2 6",
  dmarc: "M4 4h16a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2zM22 6L12 13 2 6",
  dns: "M2 12h20M12 2a15 15 0 010 20M12 2a15 15 0 000 20",
  domain: "M2 12h20M12 2a15 15 0 010 20M12 2a15 15 0 000 20",
};

function CategoryIcon({ category }: { category: string }) {
  const d = CATEGORY_ICON_PATHS[category] ?? "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z";
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

function ExternalArrow() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
      <path d="M7 17L17 7M7 7h10v10" />
    </svg>
  );
}

function CheckDetails({ details, learnMoreUrl }: { details: string; learnMoreUrl?: string }) {
  // Render `like this` as <code>; everything else as plain text. Simple, no nesting/escapes.
  const parts: Array<{ kind: "text" | "code"; value: string }> = [];
  let i = 0;
  while (i < details.length) {
    const open = details.indexOf("`", i);
    if (open === -1) {
      parts.push({ kind: "text", value: details.slice(i) });
      break;
    }
    if (open > i) parts.push({ kind: "text", value: details.slice(i, open) });
    const close = details.indexOf("`", open + 1);
    if (close === -1) {
      parts.push({ kind: "text", value: details.slice(open) });
      break;
    }
    parts.push({ kind: "code", value: details.slice(open + 1, close) });
    i = close + 1;
  }

  return (
    <div className="ar-check-desc">
      {parts.map((p, idx) =>
        p.kind === "code" ? <code key={idx}>{p.value}</code> : <span key={idx}>{p.value}</span>
      )}
      {learnMoreUrl && (
        <>
          {" "}
          <a href={learnMoreUrl} target="_blank" rel="noopener noreferrer">
            Learn more
            <ExternalArrow />
          </a>
        </>
      )}
    </div>
  );
}

export default function SiteAuditReport({ result, shareUrl, previousScan }: SiteAuditReportProps) {
  const [copied, setCopied] = useState(false);
  const [showBadge, setShowBadge] = useState(false);

  const overall = statusKey(result.grade);
  const reportId = (shareUrl?.split("/").pop() || "").slice(0, 8);

  const reportUrl = `https://askarthur.au/report/${encodeURIComponent(result.domain)}`;
  const badgeUrl = `https://askarthur.au/badge/${encodeURIComponent(result.domain)}`;
  const badgeSnippet = `<a href="${reportUrl}"><img src="${badgeUrl}" alt="${result.domain} safety grade" /></a>`;

  const twitterText = encodeURIComponent(
    `${result.domain} scored ${result.grade} (${result.overallScore}/100) on the Ask Arthur Website Health Check`
  );
  const twitterUrl = shareUrl ? `https://twitter.com/intent/tweet?text=${twitterText}&url=${encodeURIComponent(shareUrl)}` : null;
  const linkedInUrl = shareUrl
    ? `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`
    : null;

  function handleCopyLink() {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const ringRadius = 42;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringOffset =
    ringCircumference - (Math.max(0, Math.min(100, result.overallScore)) / 100) * ringCircumference;
  const ringStroke = `var(--ar-${overall === "ok" ? "ok" : overall === "warn" ? "warn" : "err"})`;

  const categories = result.categories.filter((c) => c.checks.length > 0);
  const summaryColsClass =
    categories.length === 1
      ? "cols-1"
      : categories.length === 2
        ? "cols-2"
        : categories.length === 3
          ? "cols-3"
          : "";

  const recs = result.recommendations.map(normalizeRec);
  const totalChecks = result.checks.length;

  return (
    <div className="audit-report">
      {result.partial && result.fetchError && (
        <div className="ar-banner is-warn" role="status">
          <span className="ar-banner-icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </span>
          <div>
            <div className="ar-banner-title">Partial Scan</div>
            <div>{FETCH_ERROR_MESSAGES[result.fetchError.type] || FETCH_ERROR_MESSAGES.network_error}</div>
          </div>
        </div>
      )}

      <header className="ar-header">
        <div className="ar-eyebrow">
          <span className={`ar-eyebrow-dot${overall === "warn" ? " is-warn" : overall === "err" ? " is-err" : ""}`} />
          <span>Scan complete · {formatScannedDate(result.scannedAt)}</span>
        </div>
        <h1 className="ar-title">Website Health Check</h1>
        <div className="ar-meta-line">
          <span>Comprehensive security &amp; integrity audit</span>
          {reportId && (
            <>
              <span className="ar-dot" aria-hidden="true" />
              <span>
                Report ID <code>{reportId}</code>
              </span>
            </>
          )}
        </div>
      </header>

      <section className="ar-score-card">
        <div className="ar-accent">
          <div
            className="ar-accent-fill"
            style={{
              width: `${Math.max(0, Math.min(100, result.overallScore))}%`,
              background: ringStroke,
            }}
          />
        </div>

        <div className="ar-score-grid">
          <div className="ar-ring-wrap">
            <svg className="ar-ring-svg" width="96" height="96" viewBox="0 0 96 96" aria-hidden="true">
              <circle className="ar-ring-track" cx="48" cy="48" r={ringRadius} strokeWidth="6" fill="none" />
              <circle
                className="ar-ring-fill"
                cx="48"
                cy="48"
                r={ringRadius}
                strokeWidth="6"
                fill="none"
                stroke={ringStroke}
                strokeDasharray={ringCircumference.toFixed(2)}
                strokeDashoffset={ringOffset.toFixed(2)}
                strokeLinecap="round"
              />
            </svg>
            <div className="ar-ring-label">
              <div className="ar-ring-grade">{result.grade}</div>
              <div className="ar-ring-score">{result.overallScore} / 100</div>
            </div>
          </div>

          <div className="ar-site-info">
            <div className="ar-site-name">{result.domain}</div>
            <div className="ar-site-url">{result.url}</div>
            <div className="ar-site-stats">
              <div className="ar-stat">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 2" />
                </svg>
                <span>
                  <span className="ar-stat-value">{(result.durationMs / 1000).toFixed(1)}s</span> scan time
                </span>
              </div>
              <div className="ar-stat">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M9 11l3 3L22 4" />
                  <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
                </svg>
                <span>
                  <span className="ar-stat-value">{totalChecks}</span> checks performed
                </span>
              </div>
              {result.ssl?.valid && (
                <div className="ar-stat">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <rect x="3" y="11" width="18" height="11" rx="2" />
                    <path d="M7 11V7a5 5 0 0110 0v4" />
                  </svg>
                  <span>
                    <span className="ar-stat-value">{result.ssl.protocol || "TLS"}</span>
                    {result.ssl.daysRemaining != null && ` · ${result.ssl.daysRemaining}d`}
                  </span>
                </div>
              )}
              {previousScan && (
                <div className="ar-stat">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
                    <polyline points="17 6 23 6 23 12" />
                  </svg>
                  <span>
                    Previous{" "}
                    <span className="ar-stat-value">
                      {previousScan.grade} ({previousScan.score})
                    </span>
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="ar-score-rank">
            <div className="ar-rank-num">{result.grade}</div>
            <div className="ar-rank-label">{rankLabel(result.grade)}</div>
          </div>
        </div>

        {shareUrl && (
          <>
            <div className="ar-share-row">
              <button type="button" className="ar-btn is-primary" onClick={handleCopyLink}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
                </svg>
                {copied ? "Copied" : "Copy link"}
              </button>
              {twitterUrl && (
                <a href={twitterUrl} target="_blank" rel="noopener noreferrer" className="ar-btn">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                  </svg>
                  Share on X
                </a>
              )}
              {linkedInUrl && (
                <a href={linkedInUrl} target="_blank" rel="noopener noreferrer" className="ar-btn">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.36V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 11.0-4.13 2.06 2.06 0 010 4.13zM7.12 20.45H3.56V9h3.56v11.45zM22.23 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.46c.98 0 1.77-.77 1.77-1.72V1.72C24 .77 23.21 0 22.23 0z" />
                  </svg>
                  LinkedIn
                </a>
              )}
              <button type="button" className="ar-btn" onClick={() => setShowBadge((b) => !b)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <polyline points="16 18 22 12 16 6" />
                  <polyline points="8 6 2 12 8 18" />
                </svg>
                Embed badge
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  style={{ transform: showBadge ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}
                  aria-hidden="true"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              <div className="ar-share-trail">
                <Link className="ar-btn" href="/scan">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <polyline points="23 4 23 10 17 10" />
                    <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
                  </svg>
                  Re-scan
                </Link>
              </div>
            </div>
            {showBadge && (
              <div className="ar-badge-popover">
                <div className="ar-badge-popover-label">Embed this badge</div>
                <code>{badgeSnippet}</code>
              </div>
            )}
          </>
        )}
      </section>

      {categories.length > 0 && (
        <section className={`ar-summary-strip ${summaryColsClass}`}>
          {categories.map((cat) => {
            const s = sectionStatusKey(cat.score, cat.maxScore);
            const tag = summaryTagFor(s);
            const pct = cat.maxScore > 0 ? Math.round((cat.score / cat.maxScore) * 100) : 0;
            return (
              <div key={cat.category} className="ar-summary-cell">
                <div className="ar-summary-cell-label">{cat.label}</div>
                <div className="ar-summary-cell-row">
                  <span className="ar-summary-cell-value">{cat.grade}</span>
                  <span className="ar-summary-cell-suffix">{pct}%</span>
                </div>
                <span className={`ar-summary-cell-tag ${tag.cls}`}>{tag.label}</span>
              </div>
            );
          })}
        </section>
      )}

      {categories.map((cat) => {
        const s = sectionStatusKey(cat.score, cat.maxScore);
        const pct = cat.maxScore > 0 ? Math.round((cat.score / cat.maxScore) * 100) : 0;
        return (
          <section key={cat.category} className="ar-section">
            <div className="ar-section-head">
              <div className="ar-section-head-row">
                <div className="ar-section-title">
                  <span className="ar-section-title-icon">
                    <CategoryIcon category={cat.category} />
                  </span>
                  {cat.label}
                </div>
                <div className="ar-section-grade">
                  <span className={`ar-grade-letter${s === "warn" ? " is-warn" : s === "err" ? " is-err" : ""}`}>
                    {cat.grade}
                  </span>
                  <span className="ar-grade-pct">{pct}%</span>
                </div>
              </div>
              <div className="ar-progress-bar">
                <div className={`ar-progress-fill is-${s}`} style={{ width: `${pct}%` }} />
              </div>
            </div>

            <div className="ar-checks">
              {cat.checks.map((check) => {
                const ck = checkStatusKey(check.status);
                const rowCls = ck === "warn" ? " is-warn" : ck === "err" ? " is-err" : "";
                return (
                  <div key={check.id} className={`ar-check${rowCls}`}>
                    <div className={`ar-check-icon is-${ck}`}>
                      <CheckStatusIcon k={ck} />
                    </div>
                    <div className="ar-check-body">
                      <div className="ar-check-name">{check.label}</div>
                      <CheckDetails details={check.details} learnMoreUrl={LEARN_MORE_URLS[check.id]} />
                      {check.evidence && (
                        <details className="ar-check-evidence">
                          <summary>View evidence</summary>
                          <pre>{check.evidence}</pre>
                        </details>
                      )}
                    </div>
                    <div className="ar-check-score">
                      <span className="ar-num">{check.score}</span>/{check.maxScore}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      <AuditRawHeaders rawHeaders={result.rawHeaders} />

      {recs.length > 0 && (
        <section className="ar-recs">
          <div className="ar-recs-head">Recommendations</div>
          <ol className="ar-recs-list">
            {recs.map((rec, i) => (
              <li key={i} className={`ar-rec is-${rec.severity}`}>
                <span className="ar-rec-num">{i + 1}</span>
                <div className="ar-rec-body">
                  <span className={`ar-rec-severity is-${rec.severity}`}>{rec.severity}</span>
                  <span>{rec.text}</span>
                  {rec.snippet && (
                    <details className="ar-rec-snippet">
                      <summary>Show fix</summary>
                      <pre>{rec.snippet}</pre>
                    </details>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      <p className="ar-disclaimer">
        This scan checks publicly observable security configuration. It does not test for application-level
        vulnerabilities, perform penetration testing, or access any private data. Results are informational only.
      </p>
    </div>
  );
}

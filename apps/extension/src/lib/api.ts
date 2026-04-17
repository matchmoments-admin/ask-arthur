import type {
  AnalysisResult,
  ExtensionURLCheckResponse,
  ExtensionAnalyzeRequest,
  ExtensionAnalyzeResponse,
} from "@askarthur/types";
import { getInstallId } from "./storage";
import { signRequest } from "./sign";
import { ensureRegistered } from "./register";

const API_BASE = "https://askarthur.au/api/extension";

// Kick off registration once per service-worker lifetime. Requests made before
// registration completes will 401 ("Unknown install id") and the caller
// retries; this is rare and acceptable — the popup does nothing on the very
// first frame anyway.
let registrationKick: Promise<boolean> | null = null;
function kickRegistration(): Promise<boolean> {
  if (!registrationKick) {
    registrationKick = ensureRegistered().catch(() => false);
  }
  return registrationKick;
}

interface ApiError {
  error: string;
  message?: string;
  retryAfter?: string;
}

class ExtensionApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public retryAfter?: string
  ) {
    super(message);
    this.name = "ExtensionApiError";
  }
}

async function getHeaders(
  method: string,
  path: string,
  body: string
): Promise<Record<string, string>> {
  kickRegistration();

  const installId = await getInstallId();
  if (!installId) {
    throw new ExtensionApiError("Extension not initialized", 0);
  }

  const signed = await signRequest(installId, method, path, body);
  return {
    "Content-Type": "application/json",
    "X-Request-ID": crypto.randomUUID(),
    ...signed,
  };
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<{ data: T; remaining: number | null }> {
  const method = (options.method ?? "GET").toUpperCase();
  const body = typeof options.body === "string" ? options.body : "";
  // The signature is over the pathname only (no query string), matching the
  // server's URL parsing.
  const pathname = `/api/extension${path.split("?")[0] ?? ""}`;
  const headers = await getHeaders(method, pathname, body);
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { ...headers, ...options.headers },
  });

  const remaining = res.headers.get("X-RateLimit-Remaining");

  if (!res.ok) {
    const body: ApiError = await res.json().catch(() => ({
      error: "Unknown error",
    }));
    throw new ExtensionApiError(
      body.message || body.error,
      res.status,
      res.headers.get("Retry-After") ?? undefined
    );
  }

  const data = (await res.json()) as T;
  return { data, remaining: remaining ? parseInt(remaining) : null };
}

export async function checkURL(
  url: string
): Promise<{ data: ExtensionURLCheckResponse; remaining: number | null }> {
  return request<ExtensionURLCheckResponse>("/url-check", {
    method: "POST",
    body: JSON.stringify({ url }),
  });
}

export async function analyzeText(
  text: string,
  source?: string
): Promise<{ data: AnalysisResult; remaining: number | null }> {
  return request<AnalysisResult>("/analyze", {
    method: "POST",
    body: JSON.stringify({ text }),
    ...(source && { headers: { "X-Scan-Source": source } }),
  });
}

export async function reportScamEmail(report: {
  senderEmail: string;
  subject: string;
  urls: string[];
  verdict: string;
  confidence: number;
}): Promise<{ data: { success: boolean }; remaining: number | null }> {
  return request<{ success: boolean }>("/report-email", {
    method: "POST",
    body: JSON.stringify(report),
  });
}

export async function heartbeat(): Promise<{ ok: boolean; version: string }> {
  const res = await fetch(`${API_BASE}/heartbeat`);
  return res.json();
}

export async function analyzeExtensionsCRX(
  extensions: ExtensionAnalyzeRequest["extensions"]
): Promise<{ data: ExtensionAnalyzeResponse; remaining: number | null }> {
  return request<ExtensionAnalyzeResponse>("/extension-security/analyze", {
    method: "POST",
    body: JSON.stringify({ extensions }),
  });
}

export async function fetchThreatDBUpdate(
  since?: string
): Promise<{
  ids: Record<string, { name: string; campaign: string; source: string }>;
  updatedAt: string;
} | null> {
  try {
    const params = since ? `?since=${encodeURIComponent(since)}` : "";
    const headers = await getHeaders(
      "GET",
      "/api/extension/extension-security/threat-db",
      ""
    );
    const res = await fetch(
      `${API_BASE}/extension-security/threat-db${params}`,
      { headers }
    );
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function checkAdCommunityFlags(
  adTextHash: string,
  landingUrl: string | null
): Promise<{ flagCount: number; verdict: string | null }> {
  const params = new URLSearchParams({ hash: adTextHash });
  if (landingUrl) params.set("url", landingUrl);
  const { data } = await request<{ flagCount: number; verdict: string | null }>(
    `/check-ad?${params.toString()}`
  );
  return data;
}

export async function flagAd(
  advertiserName: string,
  landingUrl: string | null,
  adTextHash: string
): Promise<void> {
  await request("/flag-ad", {
    method: "POST",
    body: JSON.stringify({ advertiserName, landingUrl, adTextHash }),
  });
}

export interface AdAnalysisResult {
  verdict: "SAFE" | "SUSPICIOUS" | "HIGH_RISK";
  confidence: number;
  summary: string;
  redFlags: string[];
  urlMalicious: boolean;
  communityFlagCount: number;
  aiGeneratedImage?: boolean;
  deepfakeDetected?: boolean;
  impersonatedCelebrity?: string | null;
  generatorSource?: string | null;
}

export async function analyzeAd(payload: {
  adText: string;
  landingUrl: string | null;
  imageUrl: string | null;
  advertiserName: string;
  adTextHash: string;
}): Promise<{ data: AdAnalysisResult; remaining: number | null }> {
  return request<AdAnalysisResult>("/analyze-ad", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export { ExtensionApiError };

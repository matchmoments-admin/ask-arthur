import { API_URL } from "@/constants/config";
import type { AnalysisResult, AnalysisMode } from "@askarthur/types";

interface AnalyzeRequest {
  text?: string;
  images?: string[];
  mode?: AnalysisMode;
}

interface AnalyzeResponse extends AnalysisResult {
  urlsChecked?: number;
  maliciousURLs?: number;
}

interface AnalyzeError {
  error: string;
  message: string;
  resetAt?: string;
}

/**
 * Validate the API URL before making requests.
 * In production, only allow HTTPS to askarthur.au.
 */
function validateApiUrl(url: string): void {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") {
    throw new Error("API URL must use HTTPS");
  }
  if (!parsed.hostname.endsWith("askarthur.au")) {
    throw new Error("API URL must be on askarthur.au domain");
  }
}

function generateRequestId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 10);
  return `mob-${timestamp}-${random}`;
}

/**
 * Call the /api/analyze endpoint on the web app.
 */
export async function analyzeMessage(params: AnalyzeRequest): Promise<AnalyzeResponse> {
  validateApiUrl(API_URL);

  let response: Response;

  try {
    response = await fetch(`${API_URL}/api/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Request-ID": generateRequestId(),
      },
      body: JSON.stringify(params),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Unable to reach the server. Check your internet connection and try again. (${message})`,
    );
  }

  if (!response.ok) {
    const err: AnalyzeError = await response.json().catch(() => ({
      error: "unknown",
      message: `Server error (${response.status}). Please try again.`,
    }));

    if (response.status === 429) {
      throw new Error(err.message ?? "Rate limited. Please try again later.");
    }
    throw new Error(err.message ?? `Analysis failed (${response.status})`);
  }

  return response.json();
}

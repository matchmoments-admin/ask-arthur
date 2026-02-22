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
 * Call the /api/analyze endpoint on the web app.
 */
export async function analyzeMessage(params: AnalyzeRequest): Promise<AnalyzeResponse> {
  const response = await fetch(`${API_URL}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const err: AnalyzeError = await response.json().catch(() => ({
      error: "unknown",
      message: "Something went wrong. Please try again.",
    }));

    if (response.status === 429) {
      throw new Error(err.message ?? "Rate limited. Please try again later.");
    }
    throw new Error(err.message ?? "Analysis failed");
  }

  return response.json();
}

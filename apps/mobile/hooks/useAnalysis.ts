import { useState, useCallback } from "react";
import { analyzeMessage } from "@/lib/api";
import { addToScanHistory } from "@/lib/storage";
import { verdictHaptic } from "@/lib/haptics";
import type { AnalysisResult, AnalysisMode } from "@askarthur/types";

interface UseAnalysisReturn {
  result: AnalysisResult | null;
  loading: boolean;
  error: string | null;
  analyze: (text: string, mode?: AnalysisMode) => Promise<void>;
  reset: () => void;
}

export function useAnalysis(): UseAnalysisReturn {
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyze = useCallback(async (text: string, mode: AnalysisMode = "text") => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await analyzeMessage({ text, mode });
      setResult(response);
      verdictHaptic(response.verdict);

      // Save to history (fire-and-forget)
      addToScanHistory({
        id: Date.now().toString(),
        text: text.slice(0, 200),
        verdict: response.verdict,
        confidence: response.confidence,
        summary: response.summary,
        timestamp: Date.now(),
        mode,
      }).catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
    setLoading(false);
  }, []);

  return { result, loading, error, analyze, reset };
}

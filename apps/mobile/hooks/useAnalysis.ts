import { useState, useCallback, useRef } from "react";
import { AppState } from "react-native";
import { analyzeMessage } from "@/lib/api";
import { addToScanHistory } from "@/lib/storage";
import { verdictHaptic } from "@/lib/haptics";
import { showAnalysisNotification, requestNotificationPermission } from "@/lib/notifications";
import type { AnalysisResult, AnalysisMode } from "@askarthur/types";

interface UseAnalysisReturn {
  result: AnalysisResult | null;
  loading: boolean;
  error: string | null;
  analyze: (text: string, mode?: AnalysisMode, images?: string[]) => Promise<void>;
  reset: () => void;
}

export function useAnalysis(): UseAnalysisReturn {
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notificationPermissionAsked = useRef(false);

  const analyze = useCallback(async (text: string, mode: AnalysisMode = "text", images?: string[]) => {
    setLoading(true);
    setError(null);
    setResult(null);

    // Request notification permission on first analysis
    if (!notificationPermissionAsked.current) {
      notificationPermissionAsked.current = true;
      requestNotificationPermission().catch(() => {});
    }

    try {
      const response = await analyzeMessage({
        text: text || undefined,
        images,
        mode: images?.length ? "image" : mode,
      });
      setResult(response);
      verdictHaptic(response.verdict);

      // Show notification if app is backgrounded (e.g. share intent triggered)
      if (AppState.currentState !== "active") {
        showAnalysisNotification(response).catch(() => {});
      }

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

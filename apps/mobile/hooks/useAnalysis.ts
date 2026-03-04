import { useState, useCallback, useRef } from "react";
import { AppState } from "react-native";
import { analyzeMessage } from "@/lib/api";
import { addToScanHistory } from "@/lib/storage";
import { verdictHaptic } from "@/lib/haptics";
import { showAnalysisNotification, requestNotificationPermission } from "@/lib/notifications";
import { checkDomainOffline } from "@/lib/offline-db";
import type { AnalysisResult, AnalysisMode } from "@askarthur/types";

const URL_REGEX = /^https?:\/\/[^\s/$.?#].[^\s]*$/i;

/**
 * Extract the domain (hostname) from a URL string.
 * Returns null if the string is not a valid URL.
 */
function extractDomain(text: string): string | null {
  try {
    const url = new URL(text.trim());
    return url.hostname;
  } catch {
    return null;
  }
}

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

    // Detect if the input looks like a URL and extract its domain
    const trimmedText = text.trim();
    const isUrl = URL_REGEX.test(trimmedText);
    const domain = isUrl ? extractDomain(trimmedText) : null;

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
      // If the API call failed and the input is a URL, try the offline DB as fallback
      if (domain) {
        try {
          const offlineHit = await checkDomainOffline(domain);
          if (offlineHit) {
            const offlineResult: AnalysisResult = {
              verdict: offlineHit.threatLevel === "HIGH" ? "HIGH_RISK" : "SUSPICIOUS",
              confidence: 0.7,
              summary: `Offline detection: this domain (${domain}) is in our known threat database.`,
              redFlags: [`Domain "${domain}" found in offline threat database`],
              nextSteps: [
                "Do not enter any personal information on this site",
                "Re-check when you have internet for a full analysis",
              ],
              scamType: offlineHit.scamType ?? undefined,
            };
            setResult(offlineResult);
            verdictHaptic(offlineResult.verdict);

            // Save offline result to history
            addToScanHistory({
              id: Date.now().toString(),
              text: text.slice(0, 200),
              verdict: offlineResult.verdict,
              confidence: offlineResult.confidence,
              summary: offlineResult.summary,
              timestamp: Date.now(),
              mode,
            }).catch(() => {});
            return;
          }
        } catch {
          // Offline DB also failed — fall through to show the original error
        }
      }
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

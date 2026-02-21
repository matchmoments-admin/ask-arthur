"use client";

import { useState, useCallback, useRef, useEffect } from "react";

export type MediaStatus =
  | "idle"
  | "uploading"
  | "transcribing"
  | "analyzing"
  | "complete"
  | "error";

export interface MediaResult {
  jobId: string;
  verdict: string;
  confidence: number;
  summary: string;
  redFlags: string[];
  nextSteps: string[];
  deepfakeScore?: number;
  deepfakeProvider?: string;
  phoneRiskFlags?: string[];
}

interface UploadResponse {
  jobId: string;
  uploadUrl: string;
  error?: string;
  message?: string;
}

interface AnalyzeResponse {
  jobId: string;
  status: string;
  verdict?: string;
  confidence?: number;
  summary?: string;
  redFlags?: string[];
  nextSteps?: string[];
  deepfakeScore?: number;
  deepfakeProvider?: string;
  phoneRiskFlags?: string[];
  errorMessage?: string;
  error?: string;
  message?: string;
}

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 60;

export function useMediaAnalysis() {
  const [status, setStatus] = useState<MediaStatus>("idle");
  const [result, setResult] = useState<MediaResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const handleComplete = useCallback(
    (data: AnalyzeResponse) => {
      stopPolling();
      setStatus("complete");
      setResult({
        jobId: data.jobId,
        verdict: data.verdict || "SUSPICIOUS",
        confidence: data.confidence || 0,
        summary: data.summary || "",
        redFlags: data.redFlags || [],
        nextSteps: data.nextSteps || [],
        deepfakeScore: data.deepfakeScore,
        deepfakeProvider: data.deepfakeProvider,
        phoneRiskFlags: data.phoneRiskFlags,
      });
      window.dispatchEvent(new Event("safeverify:check-complete"));
    },
    [stopPolling]
  );

  const startPolling = useCallback(
    (jobId: string) => {
      let attempts = 0;

      pollRef.current = setInterval(async () => {
        attempts++;
        if (attempts > MAX_POLL_ATTEMPTS) {
          stopPolling();
          setStatus("error");
          setError("Analysis timed out. Please try again.");
          return;
        }

        try {
          const res = await fetch(`/api/media/status?jobId=${jobId}`);
          if (!res.ok) return; // Retry on next interval

          const data: AnalyzeResponse = await res.json();

          if (data.status === "complete") {
            handleComplete(data);
          } else if (data.status === "error") {
            stopPolling();
            setStatus("error");
            setError(data.errorMessage || "Analysis failed. Please try again.");
          } else if (data.status === "transcribing") {
            setStatus("transcribing");
          } else if (data.status === "analyzing") {
            setStatus("analyzing");
          }
        } catch {
          // Silently retry on network errors
        }
      }, POLL_INTERVAL_MS);
    },
    [stopPolling, handleComplete]
  );

  const analyze = useCallback(
    async (file: File) => {
      // Reset state
      abortRef.current?.abort();
      stopPolling();
      setResult(null);
      setError(null);
      setStatus("uploading");

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        // Step 1: Get presigned URL
        const uploadRes = await fetch("/api/media/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contentType: file.type,
            fileSize: file.size,
          }),
          signal: controller.signal,
        });

        if (uploadRes.status === 429) {
          const data = await uploadRes.json();
          setStatus("error");
          setError(data.message || "Too many requests. Please try again later.");
          return;
        }

        if (!uploadRes.ok) {
          const data: UploadResponse = await uploadRes.json();
          throw new Error(data.message || "Failed to prepare upload");
        }

        const { jobId, uploadUrl }: UploadResponse = await uploadRes.json();

        // Step 2: Upload file directly to R2
        const putRes = await fetch(uploadUrl, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": file.type },
          signal: controller.signal,
        });

        if (!putRes.ok) {
          throw new Error("Failed to upload audio file");
        }

        setStatus("transcribing");

        // Step 3: Start polling as safety net (before analyze returns)
        startPolling(jobId);

        // Step 4: Trigger analysis (synchronous — may complete before polling catches it)
        const analyzeRes = await fetch("/api/media/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId }),
          signal: controller.signal,
        });

        if (!analyzeRes.ok) {
          const data: AnalyzeResponse = await analyzeRes.json();
          stopPolling();
          setStatus("error");
          setError(data.message || "Analysis failed. Please try again.");
          return;
        }

        const analyzeData: AnalyzeResponse = await analyzeRes.json();

        // If analyze returned complete, stop polling and use the result directly
        if (analyzeData.status === "complete") {
          handleComplete(analyzeData);
        }
        // Otherwise polling will pick up the result
      } catch (err) {
        if (controller.signal.aborted) return; // Intentional abort
        stopPolling();
        setStatus("error");
        setError(
          err instanceof Error ? err.message : "Something went wrong. Please try again."
        );
      }
    },
    [startPolling, stopPolling, handleComplete]
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    stopPolling();
    setStatus("idle");
    setResult(null);
    setError(null);
  }, [stopPolling]);

  return { status, result, error, analyze, reset };
}

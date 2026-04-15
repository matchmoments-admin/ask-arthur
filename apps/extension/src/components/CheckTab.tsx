import { useState, useEffect, useCallback } from "react";
import type { AnalysisResult, ExtensionURLCheckResponse } from "@askarthur/types";
import type { MessageResponse } from "@/lib/types";
import { getContextMenuText, setContextMenuText } from "@/lib/storage";
import { ResultDisplay } from "@/components/ResultDisplay";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { ErrorState } from "@/components/ErrorState";

type CheckMode = "url" | "message";

export function CheckTab() {
  const [mode, setMode] = useState<CheckMode>("url");
  const [urlInput, setUrlInput] = useState("");
  const [textInput, setTextInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("Checking...");
  const [error, setError] = useState<string | null>(null);
  const [isRateLimit, setIsRateLimit] = useState(false);
  const [urlResult, setUrlResult] = useState<ExtensionURLCheckResponse | null>(null);
  const [textResult, setTextResult] = useState<AnalysisResult | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [shareLabel, setShareLabel] = useState("Share result");

  // On mount: get current tab URL + check for context menu text
  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const url = tabs[0]?.url;
      if (url && (url.startsWith("http://") || url.startsWith("https://"))) {
        setUrlInput(url);
      }
    });

    getContextMenuText().then((text) => {
      if (text) {
        setTextInput(text);
        setMode("message");
        setContextMenuText(null);
      }
    });
  }, []);

  const handleReset = () => {
    setError(null);
    setIsRateLimit(false);
    setUrlResult(null);
    setTextResult(null);
  };

  const handleCheckURL = useCallback(async () => {
    if (!urlInput.trim()) return;
    setLoading(true);
    setLoadingMessage("Checking URL...");
    setError(null);
    setIsRateLimit(false);
    setUrlResult(null);
    setTextResult(null);

    try {
      const response: MessageResponse = await chrome.runtime.sendMessage({
        type: "CHECK_URL",
        url: urlInput.trim(),
      });

      if (response.success && response.data) {
        const data = response.data as ExtensionURLCheckResponse & { remaining?: number };
        if (data.remaining !== undefined) setRemaining(data.remaining);
        setUrlResult(data);
      } else {
        const msg = response.error || "Check failed";
        if (msg.includes("limit") || msg.includes("Too many")) {
          setIsRateLimit(true);
        }
        setError(msg);
      }
    } catch {
      setError("Could not connect to Ask Arthur. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [urlInput]);

  const handleAnalyzeText = useCallback(async () => {
    if (!textInput.trim()) return;
    setLoading(true);
    setLoadingMessage("Analyzing message...");
    setError(null);
    setIsRateLimit(false);
    setUrlResult(null);
    setTextResult(null);

    try {
      const response: MessageResponse = await chrome.runtime.sendMessage({
        type: "CHECK_TEXT",
        text: textInput.trim(),
      });

      if (response.success && response.data) {
        const data = response.data as AnalysisResult & { remaining?: number };
        if (data.remaining !== undefined) setRemaining(data.remaining);
        setTextResult(data);
      } else {
        const msg = response.error || "Analysis failed";
        if (msg.includes("limit") || msg.includes("Too many")) {
          setIsRateLimit(true);
        }
        setError(msg);
      }
    } catch {
      setError("Could not connect to Ask Arthur. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [textInput]);

  const hasResult = urlResult || textResult;

  return (
    <div className="p-4 space-y-3">
      {/* Pill toggle */}
      <div className="flex bg-surface rounded-[20px] p-0.5 border border-border">
        <button
          onClick={() => { setMode("url"); handleReset(); }}
          className={`flex-1 py-1.5 text-[11px] font-semibold rounded-[20px] transition-colors duration-150 ${
            mode === "url"
              ? "bg-primary text-white shadow-sm"
              : "text-text-secondary hover:text-text-primary"
          }`}
        >
          URL
        </button>
        <button
          onClick={() => { setMode("message"); handleReset(); }}
          className={`flex-1 py-1.5 text-[11px] font-semibold rounded-[20px] transition-colors duration-150 ${
            mode === "message"
              ? "bg-primary text-white shadow-sm"
              : "text-text-secondary hover:text-text-primary"
          }`}
        >
          Message
        </button>
      </div>

      {/* Input area */}
      {mode === "url" ? (
        <>
          <div>
            <label htmlFor="url-input" className="block text-[11px] font-medium text-text-secondary mb-1.5">
              Website URL
            </label>
            <input
              id="url-input"
              type="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://example.com"
              disabled={loading}
              className="w-full rounded-[8px] border border-border bg-surface px-3 py-2.5 text-[13px] text-text-primary placeholder:text-text-muted focus:bg-background transition-colors duration-150 disabled:opacity-60"
              onKeyDown={(e) => e.key === "Enter" && handleCheckURL()}
            />
          </div>
          {hasResult ? (
            <button
              type="button"
              onClick={handleReset}
              className="w-full h-11 px-6 bg-background border border-border text-text-primary font-semibold rounded-[8px] hover:bg-surface transition-colors duration-150 text-[13px]"
            >
              Check Another
            </button>
          ) : (
            <button
              onClick={handleCheckURL}
              disabled={loading || !urlInput.trim()}
              className="w-full h-11 px-6 bg-primary text-white font-semibold rounded-[8px] cta-glow hover:bg-primary-hover transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed text-[13px]"
            >
              {loading ? "Checking..." : "Check"}
            </button>
          )}
        </>
      ) : (
        <>
          <div>
            <label htmlFor="text-input" className="block text-[11px] font-medium text-text-secondary mb-1.5">
              Suspicious message
            </label>
            <textarea
              id="text-input"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder="Paste the suspicious message, email, or URL here..."
              rows={5}
              maxLength={10000}
              disabled={loading}
              className="w-full rounded-[8px] border border-border bg-surface px-3 py-2.5 text-[13px] text-text-primary placeholder:text-text-muted focus:bg-background transition-colors duration-150 resize-none disabled:opacity-60"
            />
            <p className="mt-0.5 text-[11px] text-text-muted">
              {textInput.length.toLocaleString()}/10,000 characters
            </p>
          </div>
          {hasResult ? (
            <button
              type="button"
              onClick={handleReset}
              className="w-full h-11 px-6 bg-background border border-border text-text-primary font-semibold rounded-[8px] hover:bg-surface transition-colors duration-150 text-[13px]"
            >
              Check Another
            </button>
          ) : (
            <button
              onClick={handleAnalyzeText}
              disabled={loading || !textInput.trim() || textInput.length > 10000}
              className="w-full h-11 px-6 bg-primary text-white font-semibold rounded-[8px] cta-glow hover:bg-primary-hover transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed text-[13px]"
            >
              {loading ? "Analyzing..." : "Analyze"}
            </button>
          )}
        </>
      )}

      {/* Loading */}
      {loading && <LoadingSpinner message={loadingMessage} />}

      {/* Upgrade prompt when rate-limited */}
      {isRateLimit && (
        <div className="bg-primary-light border border-primary/20 rounded-[10px] p-4 text-center space-y-2 mt-3">
          <p className="text-[13px] font-semibold text-text-primary">
            You've used your free checks for today
          </p>
          <p className="text-[11px] text-text-secondary">
            Upgrade to Ask Arthur Pro for unlimited protection
          </p>
          <a
            href="https://askarthur.au/pricing?ref=extension_limit"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block w-full py-2.5 bg-primary text-white font-semibold rounded-[8px] text-[13px] hover:bg-primary-hover transition-colors duration-150"
          >
            Upgrade to Pro
          </a>
        </div>
      )}

      {/* Error */}
      {error && !isRateLimit && (
        <ErrorState
          message={error}
          isRateLimit={false}
          onRetry={mode === "url" ? handleCheckURL : handleAnalyzeText}
        />
      )}

      {/* Results */}
      <div className="animate-fade-in">
        {urlResult && <ResultDisplay type="url" result={urlResult} />}
        {textResult && (
          <>
            <ResultDisplay type="text" result={textResult} />
            <button
              onClick={async () => {
                const text = `Ask Arthur verdict: ${textResult.verdict}\n\n${textResult.summary}\n\nCheck it yourself: https://askarthur.au`;
                await navigator.clipboard.writeText(text);
                setShareLabel("Copied!");
                setTimeout(() => setShareLabel("Share result"), 2000);
              }}
              className="w-full mt-2 py-2 text-[11px] font-medium text-text-secondary border border-border rounded-[8px] hover:bg-surface transition-colors duration-150"
            >
              {shareLabel}
            </button>
          </>
        )}
      </div>

      {/* Remaining count */}
      {remaining !== null && remaining <= 10 && (
        <p className="text-[11px] text-text-muted text-center mt-2">
          {remaining > 0
            ? `${remaining} free checks remaining today`
            : "Daily limit reached"}
        </p>
      )}
    </div>
  );
}

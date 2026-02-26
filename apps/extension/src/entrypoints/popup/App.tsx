import { useState, useEffect, useCallback } from "react";
import type { AnalysisResult, ExtensionURLCheckResponse } from "@askarthur/types";
import type { MessageResponse } from "@/lib/types";
import { getContextMenuText, setContextMenuText } from "@/lib/storage";
import { ResultDisplay } from "@/components/ResultDisplay";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { ErrorState } from "@/components/ErrorState";

type Tab = "url" | "text";

export default function App() {
  const [tab, setTab] = useState<Tab>("url");
  const [urlInput, setUrlInput] = useState("");
  const [textInput, setTextInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("Checking...");
  const [error, setError] = useState<string | null>(null);
  const [isRateLimit, setIsRateLimit] = useState(false);
  const [urlResult, setUrlResult] = useState<ExtensionURLCheckResponse | null>(null);
  const [textResult, setTextResult] = useState<AnalysisResult | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);

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
        setTab("text");
        setContextMenuText(null);
      }
    });
  }, []);

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

  const handleReset = () => {
    setError(null);
    setIsRateLimit(false);
    setUrlResult(null);
    setTextResult(null);
  };

  return (
    <div className="w-[380px] bg-background text-gov-slate animate-slide-up">
      {/* Header */}
      <div className="bg-deep-navy px-4 py-3">
        <div className="flex items-center gap-2.5">
          <img src="/icon/48.png" alt="" className="h-7 w-7" />
          <h1 className="text-base font-semibold text-white">Ask Arthur</h1>
        </div>
      </div>

      {/* Segmented tab control */}
      <div className="px-4 pt-3">
        <div className="flex bg-surface rounded-lg p-1">
          <button
            onClick={() => { setTab("url"); handleReset(); }}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-all ${
              tab === "url"
                ? "bg-white text-deep-navy shadow-sm"
                : "text-slate-400 hover:text-gov-slate"
            }`}
          >
            <span className="material-symbols-outlined text-base">link</span>
            URL
          </button>
          <button
            onClick={() => { setTab("text"); handleReset(); }}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-all ${
              tab === "text"
                ? "bg-white text-deep-navy shadow-sm"
                : "text-slate-400 hover:text-gov-slate"
            }`}
          >
            <span className="material-symbols-outlined text-base">chat_bubble_outline</span>
            Text
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 space-y-3">
        {tab === "url" ? (
          <>
            <div>
              <label htmlFor="url-input" className="block text-xs font-medium text-deep-navy mb-1.5">
                Website URL
              </label>
              <input
                id="url-input"
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://example.com"
                disabled={loading}
                className="w-full rounded-xl border border-border-default bg-surface px-3 py-2.5 text-sm text-deep-navy placeholder:text-slate-400 focus:bg-white transition-colors disabled:opacity-60"
                onKeyDown={(e) => e.key === "Enter" && handleCheckURL()}
              />
            </div>
            {hasResult ? (
              <button
                type="button"
                onClick={handleReset}
                className="w-full h-11 px-6 bg-white border border-border-default text-deep-navy font-semibold rounded-xl hover:bg-surface transition-colors text-sm"
              >
                Check Another
              </button>
            ) : (
              <button
                onClick={handleCheckURL}
                disabled={loading || !urlInput.trim()}
                className="w-full h-11 px-6 bg-deep-navy text-white font-semibold rounded-xl cta-glow hover:bg-navy transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
              >
                {loading ? "Checking..." : "Check Now"}
              </button>
            )}
          </>
        ) : (
          <>
            <div>
              <label htmlFor="text-input" className="block text-xs font-medium text-deep-navy mb-1.5">
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
                className="w-full rounded-xl border border-border-default bg-surface px-3 py-2.5 text-sm text-deep-navy placeholder:text-slate-400 focus:bg-white transition-colors resize-none disabled:opacity-60"
              />
              <p className="mt-0.5 text-xs text-slate-400">
                {textInput.length.toLocaleString()}/10,000 characters
              </p>
            </div>
            {hasResult ? (
              <button
                type="button"
                onClick={handleReset}
                className="w-full h-11 px-6 bg-white border border-border-default text-deep-navy font-semibold rounded-xl hover:bg-surface transition-colors text-sm"
              >
                Check Another
              </button>
            ) : (
              <button
                onClick={handleAnalyzeText}
                disabled={loading || !textInput.trim() || textInput.length > 10000}
                className="w-full h-11 px-6 bg-deep-navy text-white font-semibold rounded-xl cta-glow hover:bg-navy transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
              >
                {loading ? "Analyzing..." : "Check Now"}
              </button>
            )}
          </>
        )}

        {/* Loading */}
        {loading && <LoadingSpinner message={loadingMessage} />}

        {/* Error */}
        {error && (
          <ErrorState
            message={error}
            isRateLimit={isRateLimit}
            onRetry={tab === "url" ? handleCheckURL : handleAnalyzeText}
          />
        )}

        {/* Results */}
        <div className="animate-fade-in">
          {urlResult && <ResultDisplay type="url" result={urlResult} />}
          {textResult && <ResultDisplay type="text" result={textResult} />}
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-border-default px-4 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs text-slate-400">
          <span className="material-symbols-outlined text-sm">shield</span>
          <span>Private &amp; secure</span>
          <span className="mx-1">·</span>
          <a
            href="https://askarthur.au"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-action-teal-text transition-colors"
          >
            askarthur.au
          </a>
        </div>
        {remaining !== null && (
          <span className="text-xs text-slate-400">
            {remaining} left
          </span>
        )}
      </div>
    </div>
  );
}

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
    <div className="w-[400px] bg-background text-gov-slate">
      {/* Header */}
      <div className="bg-deep-navy px-5 py-4">
        <div className="flex items-center gap-2.5">
          <img src="/icon/48.png" alt="" className="h-7 w-7" />
          <h1 className="text-lg font-bold text-white">Ask Arthur</h1>
        </div>
        <p className="mt-1 text-xs text-slate-400">
          AI-powered scam detection
        </p>
      </div>

      {/* Tab switcher */}
      <div className="flex border-b border-border-light">
        <button
          onClick={() => { setTab("url"); handleReset(); }}
          className={`flex-1 px-4 py-2.5 text-xs font-bold uppercase tracking-widest transition-colors ${
            tab === "url"
              ? "border-b-2 border-action-teal text-action-teal-text"
              : "text-slate-400 hover:text-gov-slate"
          }`}
        >
          Check URL
        </button>
        <button
          onClick={() => { setTab("text"); handleReset(); }}
          className={`flex-1 px-4 py-2.5 text-xs font-bold uppercase tracking-widest transition-colors ${
            tab === "text"
              ? "border-b-2 border-action-teal text-action-teal-text"
              : "text-slate-400 hover:text-gov-slate"
          }`}
        >
          Check Text
        </button>
      </div>

      {/* Content */}
      <div className="p-4 space-y-3">
        {tab === "url" ? (
          <>
            <div>
              <label htmlFor="url-input" className="block text-xs font-bold uppercase tracking-widest text-deep-navy mb-1.5">
                Website URL
              </label>
              <input
                id="url-input"
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://example.com"
                disabled={loading}
                className="w-full rounded-sm border-2 border-gray-200 bg-white px-3 py-2.5 text-sm text-deep-navy placeholder:text-slate-400 focus:border-deep-navy transition-colors disabled:opacity-60"
                onKeyDown={(e) => e.key === "Enter" && handleCheckURL()}
              />
            </div>
            {hasResult ? (
              <button
                type="button"
                onClick={handleReset}
                className="w-full h-11 px-6 bg-deep-navy text-white font-bold uppercase tracking-widest rounded-full hover:bg-navy transition-colors text-sm"
              >
                Check Another
              </button>
            ) : (
              <button
                onClick={handleCheckURL}
                disabled={loading || !urlInput.trim()}
                className="w-full h-11 px-6 bg-deep-navy text-white font-bold uppercase tracking-widest rounded-full hover:bg-navy transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
              >
                {loading ? "Checking..." : "Check Now"}
              </button>
            )}
          </>
        ) : (
          <>
            <div>
              <label htmlFor="text-input" className="block text-xs font-bold uppercase tracking-widest text-deep-navy mb-1.5">
                Suspicious Message
              </label>
              <textarea
                id="text-input"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder="Paste the suspicious message, email, or URL here..."
                rows={5}
                maxLength={10000}
                disabled={loading}
                className="w-full rounded-sm border-2 border-gray-200 bg-white px-3 py-2.5 text-sm text-deep-navy placeholder:text-slate-400 focus:border-deep-navy transition-colors resize-none disabled:opacity-60"
              />
              <p className="mt-0.5 text-xs text-slate-400">
                {textInput.length.toLocaleString()}/10,000 characters
              </p>
            </div>
            {hasResult ? (
              <button
                type="button"
                onClick={handleReset}
                className="w-full h-11 px-6 bg-deep-navy text-white font-bold uppercase tracking-widest rounded-full hover:bg-navy transition-colors text-sm"
              >
                Check Another
              </button>
            ) : (
              <button
                onClick={handleAnalyzeText}
                disabled={loading || !textInput.trim() || textInput.length > 10000}
                className="w-full h-11 px-6 bg-deep-navy text-white font-bold uppercase tracking-widest rounded-full hover:bg-navy transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
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
        {urlResult && <ResultDisplay type="url" result={urlResult} />}
        {textResult && <ResultDisplay type="text" result={textResult} />}
      </div>

      {/* Footer — privacy + remaining checks */}
      <div className="border-t border-border-light px-4 py-3">
        <div className="flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-widest text-gov-slate">
          <span className="material-symbols-outlined text-sm">lock</span>
          <span className="material-symbols-outlined text-sm">visibility_off</span>
          We never store your data
        </div>
        <div className="flex items-center justify-between mt-2">
          <a
            href="https://askarthur.au"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-slate-400 hover:text-action-teal-text transition-colors"
          >
            askarthur.au
          </a>
          {remaining !== null && (
            <span className="text-[11px] text-slate-400">
              {remaining} checks remaining
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

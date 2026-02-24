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
        setContextMenuText(null); // Clear after reading
      }
    });
  }, []);

  const handleCheckURL = useCallback(async () => {
    if (!urlInput.trim()) return;
    setLoading(true);
    setLoadingMessage("Checking URL...");
    setError(null);
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
        setError(response.error || "Check failed");
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
        setError(response.error || "Analysis failed");
      }
    } catch {
      setError("Could not connect to Ask Arthur. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [textInput]);

  const handleReset = () => {
    setError(null);
    setUrlResult(null);
    setTextResult(null);
  };

  return (
    <div className="w-[400px] bg-background text-foreground">
      {/* Header */}
      <div className="bg-deep-navy px-4 py-3">
        <div className="flex items-center gap-2">
          <img src="/icon/48.png" alt="" className="h-6 w-6" />
          <h1 className="text-base font-bold text-white">Ask Arthur</h1>
        </div>
        <p className="mt-0.5 text-xs text-slate-400">
          AI-powered scam detection
        </p>
      </div>

      {/* Tab switcher */}
      <div className="flex border-b border-border-light">
        <button
          onClick={() => { setTab("url"); handleReset(); }}
          className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
            tab === "url"
              ? "border-b-2 border-action-teal text-action-teal-text"
              : "text-slate-400 hover:text-gov-slate"
          }`}
        >
          Check URL
        </button>
        <button
          onClick={() => { setTab("text"); handleReset(); }}
          className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
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
              <label htmlFor="url-input" className="block text-xs font-medium text-gov-slate mb-1">
                Website URL
              </label>
              <input
                id="url-input"
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://example.com"
                className="w-full rounded-md border border-border-light bg-background px-3 py-2 text-sm text-foreground placeholder:text-slate-400 focus:border-action-teal focus:outline-none focus:ring-1 focus:ring-action-teal"
                onKeyDown={(e) => e.key === "Enter" && handleCheckURL()}
              />
            </div>
            <button
              onClick={handleCheckURL}
              disabled={loading || !urlInput.trim()}
              className="w-full rounded-md bg-action-teal px-4 py-2 text-sm font-medium text-white hover:bg-action-teal-text transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Check URL
            </button>
          </>
        ) : (
          <>
            <div>
              <label htmlFor="text-input" className="block text-xs font-medium text-gov-slate mb-1">
                Suspicious message
              </label>
              <textarea
                id="text-input"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder="Paste a suspicious email, SMS, or message here..."
                rows={5}
                className="w-full rounded-md border border-border-light bg-background px-3 py-2 text-sm text-foreground placeholder:text-slate-400 focus:border-action-teal focus:outline-none focus:ring-1 focus:ring-action-teal resize-none"
              />
              <p className="mt-0.5 text-xs text-slate-400">
                {textInput.length}/10,000 characters
              </p>
            </div>
            <button
              onClick={handleAnalyzeText}
              disabled={loading || !textInput.trim() || textInput.length > 10000}
              className="w-full rounded-md bg-action-teal px-4 py-2 text-sm font-medium text-white hover:bg-action-teal-text transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Analyze
            </button>
          </>
        )}

        {/* Loading */}
        {loading && <LoadingSpinner message={loadingMessage} />}

        {/* Error */}
        {error && (
          <ErrorState
            message={error}
            onRetry={tab === "url" ? handleCheckURL : handleAnalyzeText}
          />
        )}

        {/* Results */}
        {urlResult && <ResultDisplay type="url" result={urlResult} />}
        {textResult && <ResultDisplay type="text" result={textResult} />}
      </div>

      {/* Footer */}
      <div className="border-t border-border-light px-4 py-2 flex items-center justify-between">
        <a
          href="https://askarthur.au"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-slate-400 hover:text-action-teal-text transition-colors"
        >
          Powered by Ask Arthur
        </a>
        {remaining !== null && (
          <span className="text-xs text-slate-400">
            {remaining} checks left
          </span>
        )}
      </div>
    </div>
  );
}

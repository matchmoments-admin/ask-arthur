"use client";

import { useState } from "react";
import {
  IMAGE_CHECK_ORIGIN_COPY,
  type WebImageCheckResponse,
} from "@askarthur/types";

// Client half of /image-check: URL check (Hive + provenance) or file upload
// (provenance only — deterministic, free). All AI-origin strings come from
// IMAGE_CHECK_ORIGIN_COPY so the asymmetry test covers this surface too.

type Mode = "url" | "upload";

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

// Tier selection lives in the shared IMAGE_CHECK_ORIGIN_COPY selectors
// (ccLine / originLine) so the asymmetry test covers this surface's
// selection paths too.
const { ccLine, originLine } = IMAGE_CHECK_ORIGIN_COPY;

export default function ImageCheckClient() {
  const [mode, setMode] = useState<Mode>("url");
  const [imageUrl, setImageUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WebImageCheckResponse | null>(null);

  async function runCheck() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      let res: Response;
      if (mode === "url") {
        res = await fetch("/api/image-check", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ imageUrl: imageUrl.trim() }),
        });
      } else {
        if (!file) {
          setError("Choose an image file first.");
          return;
        }
        const form = new FormData();
        form.append("file", file);
        res = await fetch("/api/image-check", { method: "POST", body: form });
      }
      const data = (await res.json()) as WebImageCheckResponse & {
        error?: string;
        message?: string;
      };
      if (!res.ok) {
        setError(data.message ?? "Couldn't check this image. Try again later.");
        return;
      }
      if (!data.checked) {
        setError("Image scanning is briefly unavailable. Try again later.");
        return;
      }
      setResult(data);
    } catch {
      setError("Couldn't check this image. Try again later.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-6 space-y-4">
      <div className="flex gap-2" role="tablist" aria-label="Check mode">
        <button
          role="tab"
          aria-selected={mode === "url"}
          className={`rounded-full border px-3 py-1 text-sm ${
            mode === "url"
              ? "border-gray-900 bg-gray-900 text-white"
              : "border-gray-300 text-gray-700"
          }`}
          onClick={() => setMode("url")}
        >
          Check an image link
        </button>
        <button
          role="tab"
          aria-selected={mode === "upload"}
          className={`rounded-full border px-3 py-1 text-sm ${
            mode === "upload"
              ? "border-gray-900 bg-gray-900 text-white"
              : "border-gray-300 text-gray-700"
          }`}
          onClick={() => setMode("upload")}
        >
          Upload a file
        </button>
      </div>

      {mode === "url" ? (
        <div className="space-y-1">
          <label htmlFor="image-url" className="text-sm font-medium text-gray-900">
            Direct image link
          </label>
          <input
            id="image-url"
            type="url"
            inputMode="url"
            placeholder="https://example.com/photo.jpg"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <p className="text-xs text-gray-500">
            Runs the AI/deepfake classifier plus a provenance read. Right-click
            an image → &ldquo;Copy image address&rdquo; to get the link.
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          <label htmlFor="image-file" className="text-sm font-medium text-gray-900">
            Image file (JPEG, PNG, GIF, or WebP — up to 5 MB)
          </label>
          <input
            id="image-file"
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="w-full text-sm"
          />
          <p className="text-xs text-gray-500">
            Reads provenance data only (Content Credentials + metadata tags) —
            the AI classifier doesn&rsquo;t run on uploads. Your image is
            checked in memory and never stored.
          </p>
        </div>
      )}

      <button
        onClick={runCheck}
        disabled={busy || (mode === "url" ? imageUrl.trim().length === 0 : !file)}
        className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
      >
        {busy ? "Checking…" : "Check image"}
      </button>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      {result ? (
        <dl className="space-y-3 border-t border-gray-100 pt-4 text-sm">
          {result.aiGenerated ? (
            <div className="flex justify-between gap-4">
              <dt className="text-gray-500">AI-generation score</dt>
              <dd className="font-medium text-gray-900">
                {pct(result.aiGenerated.confidence)}
              </dd>
            </div>
          ) : (
            <div className="flex justify-between gap-4">
              <dt className="text-gray-500">AI-generation classifier</dt>
              <dd className="text-gray-700">
                {result.mode === "upload"
                  ? "not run on uploads — link mode runs it"
                  : "did not run"}
              </dd>
            </div>
          )}
          {result.deepfake ? (
            <div className="flex justify-between gap-4">
              <dt className="text-gray-500">Deepfake score</dt>
              <dd className="font-medium text-gray-900">
                {pct(result.deepfake.confidence)}
              </dd>
            </div>
          ) : null}
          {result.generatorBreakdown && result.generatorBreakdown.length > 0 ? (
            <div>
              <dt className="text-gray-500">Generator attribution</dt>
              <dd className="text-gray-800">
                {result.generatorBreakdown
                  .map((g) => `${g.class} (${pct(g.score)})`)
                  .join(", ")}
              </dd>
            </div>
          ) : null}
          <div>
            <dt className="text-gray-500">Content Credentials (C2PA)</dt>
            <dd className="text-gray-800">{ccLine(result.contentCredentials)}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Metadata origin tag</dt>
            <dd className="text-gray-800">{originLine(result.metadataOrigin)}</dd>
          </div>
          {result.imageSha256 ? (
            <div>
              <dt className="text-gray-500">Image SHA-256</dt>
              <dd className="break-all font-mono text-xs text-gray-700">
                {result.imageSha256}
              </dd>
            </div>
          ) : null}
          <p className="text-xs text-gray-500">{result.disclaimer}</p>
        </dl>
      ) : null}
    </section>
  );
}

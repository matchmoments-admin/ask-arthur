"use client";

import { useEffect, useState } from "react";
import {
  Loader2,
  Search,
  Hash,
  CreditCard,
} from "lucide-react";

import CharityVerdict, { type CharityCheckResult } from "@/components/CharityVerdict";

type Status = "idle" | "checking" | "complete" | "error";
type InputMode = "name" | "abn";
type PaymentMethod = "card" | "regular_debit" | "cash" | "gift_card" | "crypto" | "bank_transfer" | "";

interface AutocompleteRow {
  abn: string;
  charity_legal_name: string;
  town_city: string | null;
  state: string | null;
  charity_website: string | null;
  similarity_score: number;
}

const ABN_REGEX_DIGITS = /^\d{0,11}$/;

export default function CharityChecker() {
  const [mode, setMode] = useState<InputMode>("name");
  const [name, setName] = useState("");
  const [abn, setAbn] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("");
  const [autocomplete, setAutocomplete] = useState<AutocompleteRow[]>([]);
  const [acIndex, setAcIndex] = useState<number | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<CharityCheckResult | null>(null);
  const [error, setError] = useState("");

  // Debounced autocomplete fetch on name input. The "clear when too short"
  // path lives in the onChange handler (not in this effect) so we don't
  // call setState synchronously in the effect body — react-you-might-not
  // -need-an-effect rule. The effect only fires the network request after
  // the debounce window when there's something to fetch.
  useEffect(() => {
    if (mode !== "name") return;
    const q = name.trim();
    if (q.length < 2) return;
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/charity-check/autocomplete?q=${encodeURIComponent(q)}`);
        if (!res.ok) {
          setAutocomplete([]);
          return;
        }
        const body = (await res.json()) as { results: AutocompleteRow[] };
        setAutocomplete(body.results ?? []);
      } catch {
        setAutocomplete([]);
      }
    }, 220);
    return () => clearTimeout(handle);
  }, [name, mode]);

  const formattedAbn = abn.replace(/\D/g, "");
  const abnIsValid = formattedAbn.length === 11;
  const nameIsValid = name.trim().length >= 2;
  const canSubmit =
    (mode === "abn" && abnIsValid) || (mode === "name" && nameIsValid);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setStatus("checking");
    setError("");
    setResult(null);

    const body: Record<string, string> = {};
    if (mode === "abn") body.abn = formattedAbn;
    if (mode === "name") body.name = name.trim();
    if (paymentMethod) body.paymentMethod = paymentMethod;

    try {
      const res = await fetch("/api/charity-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(
          (json?.error?.message as string | undefined) ??
            "Something went wrong. Please try again.",
        );
        setStatus("error");
        return;
      }
      setResult(json as CharityCheckResult);
      setStatus("complete");
    } catch (err) {
      setError(`Network error — ${String(err)}`);
      setStatus("error");
    }
  };

  const handleAutocompleteSelect = (row: AutocompleteRow) => {
    setName(row.charity_legal_name);
    setAutocomplete([]);
    setAcIndex(null);
  };

  const handleNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (autocomplete.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setAcIndex((idx) => Math.min((idx ?? -1) + 1, autocomplete.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setAcIndex((idx) => Math.max((idx ?? autocomplete.length) - 1, 0));
    } else if (e.key === "Enter" && acIndex !== null) {
      e.preventDefault();
      const row = autocomplete[acIndex];
      if (row) handleAutocompleteSelect(row);
    } else if (e.key === "Escape") {
      setAutocomplete([]);
      setAcIndex(null);
    }
  };

  const reset = () => {
    setStatus("idle");
    setResult(null);
    setError("");
    setName("");
    setAbn("");
    setPaymentMethod("");
    setAutocomplete([]);
  };

  if (status === "complete" && result) {
    return <CharityVerdict result={result} onCheckAnother={reset} />;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6" aria-label="Charity check form">
      {/* Mode toggle */}
      <div
        className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1"
        role="tablist"
        aria-label="Choose input method"
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === "name"}
          className={`px-4 py-2 text-sm font-semibold rounded-md inline-flex items-center gap-1.5 ${
            mode === "name"
              ? "bg-white text-deep-navy shadow-sm"
              : "text-gov-slate hover:text-deep-navy"
          }`}
          onClick={() => setMode("name")}
        >
          <Search size={16} aria-hidden /> Charity name
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "abn"}
          className={`px-4 py-2 text-sm font-semibold rounded-md inline-flex items-center gap-1.5 ${
            mode === "abn"
              ? "bg-white text-deep-navy shadow-sm"
              : "text-gov-slate hover:text-deep-navy"
          }`}
          onClick={() => setMode("abn")}
        >
          <Hash size={16} aria-hidden /> ABN
        </button>
      </div>

      {/* Input — name with autocomplete */}
      {mode === "name" && (
        <div className="relative">
          <label htmlFor="cc-name" className="block text-sm font-medium text-deep-navy mb-2">
            Charity name
          </label>
          <input
            id="cc-name"
            type="text"
            value={name}
            onChange={(e) => {
              const v = e.target.value;
              setName(v);
              setAcIndex(null);
              // Clear autocomplete eagerly when the input drops below the
              // 2-char minimum, so the listbox doesn't linger from a
              // previous fetch.
              if (v.trim().length < 2) setAutocomplete([]);
            }}
            onKeyDown={handleNameKeyDown}
            placeholder="e.g. Australian Red Cross"
            className="w-full px-4 py-3 border border-slate-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-deep-navy"
            autoComplete="off"
            aria-autocomplete="list"
            aria-controls="cc-name-listbox"
            aria-activedescendant={acIndex !== null ? `cc-ac-${acIndex}` : undefined}
          />
          {autocomplete.length > 0 && (
            <ul
              id="cc-name-listbox"
              role="listbox"
              className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-72 overflow-y-auto"
            >
              {autocomplete.map((row, i) => (
                <li
                  key={row.abn}
                  id={`cc-ac-${i}`}
                  role="option"
                  aria-selected={acIndex === i}
                  className={`px-4 py-2 cursor-pointer text-sm ${
                    acIndex === i ? "bg-slate-100" : "hover:bg-slate-50"
                  }`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleAutocompleteSelect(row)}
                >
                  <div className="font-medium text-deep-navy">{row.charity_legal_name}</div>
                  <div className="text-xs text-gov-slate">
                    {[row.town_city, row.state].filter(Boolean).join(", ") || "—"}
                    {" · ABN "}
                    {row.abn}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Input — ABN */}
      {mode === "abn" && (
        <div>
          <label htmlFor="cc-abn" className="block text-sm font-medium text-deep-navy mb-2">
            ABN (11 digits)
          </label>
          <input
            id="cc-abn"
            type="text"
            inputMode="numeric"
            value={abn}
            onChange={(e) => {
              const cleaned = e.target.value.replace(/[^\d\s-]/g, "");
              if (ABN_REGEX_DIGITS.test(cleaned.replace(/\D/g, ""))) setAbn(cleaned);
            }}
            placeholder="e.g. 11 005 357 522"
            className="w-full px-4 py-3 border border-slate-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-deep-navy font-mono"
            autoComplete="off"
            aria-describedby="cc-abn-hint"
          />
          <p id="cc-abn-hint" className="mt-1 text-xs text-gov-slate">
            Spaces and dashes are fine — we&rsquo;ll strip them.
          </p>
        </div>
      )}

      {/* Optional behavioural micro-flow — payment method.
          Cash / gift cards / crypto / bank-transfer trigger the HIGH_RISK
          hard-floor regardless of registration result. */}
      <div>
        <label htmlFor="cc-payment" className="block text-sm font-medium text-deep-navy mb-2 inline-flex items-center gap-1.5">
          <CreditCard size={16} aria-hidden /> How are they asking you to pay? <span className="text-gov-slate font-normal">(optional)</span>
        </label>
        <select
          id="cc-payment"
          value={paymentMethod}
          onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
          className="w-full px-4 py-3 border border-slate-300 rounded-lg text-base bg-white focus:outline-none focus:ring-2 focus:ring-deep-navy"
        >
          <option value="">— Skip / not applicable —</option>
          <option value="card">Card (tap or insert)</option>
          <option value="regular_debit">Regular monthly direct debit</option>
          <option value="cash">Cash</option>
          <option value="gift_card">Gift card / iTunes / Steam</option>
          <option value="crypto">Cryptocurrency</option>
          <option value="bank_transfer">Bank transfer to a personal account</option>
        </select>
      </div>

      <button
        type="submit"
        disabled={!canSubmit || status === "checking"}
        className="w-full bg-deep-navy text-white font-semibold py-3 px-6 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
      >
        {status === "checking" ? (
          <>
            <Loader2 size={18} className="animate-spin" aria-hidden /> Checking…
          </>
        ) : (
          "Check this charity"
        )}
      </button>

      {error && (
        <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
          {error}
        </div>
      )}

      <p className="text-xs text-gov-slate text-center">
        We can&rsquo;t verify ≠ this is a scam. Arthur is a quiet second opinion, not a regulator.
      </p>
    </form>
  );
}

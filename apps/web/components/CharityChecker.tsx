"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Loader2,
  Search,
  Hash,
  CreditCard,
  Link as LinkIcon,
  Camera,
  X as XIcon,
} from "lucide-react";

import CharityVerdict, { type CharityCheckResult } from "@/components/CharityVerdict";

type Status = "idle" | "checking" | "complete" | "error";
type InputMode = "name" | "abn" | "image";
type PaymentMethod = "card" | "regular_debit" | "cash" | "gift_card" | "crypto" | "bank_transfer" | "";
type IdShown = "yes" | "no" | "refused" | "skipped" | "";

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
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<InputMode>(() => {
    const m = searchParams?.get("mode");
    return m === "abn" || m === "image" || m === "name" ? m : "name";
  });
  const [name, setName] = useState(() => searchParams?.get("name") ?? "");
  const [abn, setAbn] = useState(() => {
    const raw = searchParams?.get("abn") ?? "";
    return raw.replace(/\D/g, "").slice(0, 11);
  });
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("");
  const [donationUrl, setDonationUrl] = useState("");
  // v0.2b — uploaded photo of a fundraiser lanyard / badge / flyer.
  // Stored as a base64 string (without the data: prefix) when set.
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  // v0.2d behavioural micro-flow.
  const [inPersonContext, setInPersonContext] = useState(false);
  const [idShown, setIdShown] = useState<IdShown>("");
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
    (mode === "abn" && abnIsValid) ||
    (mode === "name" && nameIsValid) ||
    (mode === "image" && Boolean(imageBase64));

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5_000_000) {
      setError("Image too large — please upload under 5 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      // Strip the "data:image/...;base64," prefix — backend expects raw.
      const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1]! : dataUrl;
      setImageBase64(base64);
      setImagePreview(dataUrl);
      setError("");
    };
    reader.readAsDataURL(file);
  };

  const clearImage = () => {
    setImageBase64(null);
    setImagePreview(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setStatus("checking");
    setError("");
    setResult(null);

    const body: Record<string, string | boolean> = {};
    if (mode === "abn") body.abn = formattedAbn;
    if (mode === "name") body.name = name.trim();
    if (mode === "image" && imageBase64) body.image = imageBase64;
    if (paymentMethod) body.paymentMethod = paymentMethod;
    if (donationUrl.trim()) body.donationUrl = donationUrl.trim();
    if (inPersonContext) body.inPersonContext = true;
    if (idShown) body.idShown = idShown;

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
    setDonationUrl("");
    setImageBase64(null);
    setImagePreview(null);
    setInPersonContext(false);
    setIdShown("");
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
        <button
          type="button"
          role="tab"
          aria-selected={mode === "image"}
          className={`px-4 py-2 text-sm font-semibold rounded-md inline-flex items-center gap-1.5 ${
            mode === "image"
              ? "bg-white text-deep-navy shadow-sm"
              : "text-gov-slate hover:text-deep-navy"
          }`}
          onClick={() => setMode("image")}
        >
          <Camera size={16} aria-hidden /> Photo
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

      {/* Input — photo (v0.2b). Snap a fundraiser lanyard / badge / flyer;
          we OCR the visible text via Claude Vision and pre-fill the ABN
          and charity name from whatever's printed. */}
      {mode === "image" && (
        <div>
          <label htmlFor="cc-image" className="block text-sm font-medium text-deep-navy mb-2 inline-flex items-center gap-1.5">
            <Camera size={16} aria-hidden /> Photo of the lanyard, badge, or flyer
          </label>
          {imagePreview ? (
            <div className="relative inline-block">
              <img
                src={imagePreview}
                alt="Uploaded lanyard or badge"
                className="max-h-64 rounded-lg border border-slate-300"
              />
              <button
                type="button"
                onClick={clearImage}
                aria-label="Remove image"
                className="absolute top-1 right-1 bg-white/90 hover:bg-white text-deep-navy rounded-full p-1 shadow"
              >
                <XIcon size={16} aria-hidden />
              </button>
            </div>
          ) : (
            <input
              id="cc-image"
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              onChange={handleImageChange}
              className="block w-full text-sm text-gov-slate file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border file:border-slate-300 file:text-sm file:font-semibold file:bg-white file:text-deep-navy hover:file:bg-slate-50"
              aria-describedby="cc-image-hint"
            />
          )}
          <p id="cc-image-hint" className="mt-1 text-xs text-gov-slate">
            JPEG / PNG / GIF / WebP, under 5 MB. We&rsquo;ll read what&rsquo;s printed
            and check it for you.
          </p>
        </div>
      )}

      {/* Optional donation-URL field — when provided, the engine runs the
          donation_url pillar (Safe Browsing + WHOIS domain age) on it.
          Often the URL on a fundraiser's flyer or QR is the easiest thing
          to copy-paste, and a brand-new domain on a "bushfire appeal" is
          one of the highest-fidelity scam signals available. */}
      <div>
        <label
          htmlFor="cc-donation-url"
          className="block text-sm font-medium text-deep-navy mb-2 inline-flex items-center gap-1.5"
        >
          <LinkIcon size={16} aria-hidden /> Donation URL{" "}
          <span className="text-gov-slate font-normal">(optional)</span>
        </label>
        <input
          id="cc-donation-url"
          type="url"
          inputMode="url"
          value={donationUrl}
          onChange={(e) => setDonationUrl(e.target.value)}
          placeholder="https://example.org.au/donate"
          className="w-full px-4 py-3 border border-slate-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-deep-navy"
          autoComplete="off"
          aria-describedby="cc-donation-url-hint"
        />
        <p id="cc-donation-url-hint" className="mt-1 text-xs text-gov-slate">
          The page they want you to visit. We&rsquo;ll check it for safety
          warnings and how recently the domain was registered.
        </p>
      </div>

      {/* Behavioural micro-flow (v0.2d). Three questions designed for the
          street-fundraiser use case: in-person? ID shown? payment method?
          Questions 2-3 only matter for in-person; otherwise we still ask
          payment but skip the ID prompt. */}
      <fieldset className="border border-slate-200 rounded-lg p-4 space-y-4">
        <legend className="text-sm font-semibold text-deep-navy px-1">
          Are they in front of you right now? <span className="text-gov-slate font-normal">(optional)</span>
        </legend>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={inPersonContext}
            onChange={(e) => setInPersonContext(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          <span>
            Yes — street fundraiser, door-knock, or kiosk.{" "}
            <span className="text-gov-slate">(Otherwise we&rsquo;ll skip the ID question.)</span>
          </span>
        </label>

        {inPersonContext && (
          <div>
            <label htmlFor="cc-id" className="block text-sm font-medium text-deep-navy mb-2">
              Did they show ID when asked?
            </label>
            <select
              id="cc-id"
              value={idShown}
              onChange={(e) => setIdShown(e.target.value as IdShown)}
              className="w-full px-4 py-3 border border-slate-300 rounded-lg text-base bg-white focus:outline-none focus:ring-2 focus:ring-deep-navy"
            >
              <option value="">— Skip —</option>
              <option value="yes">Yes — clearly visible numbered ID badge</option>
              <option value="no">No — they didn&rsquo;t show one (didn&rsquo;t ask)</option>
              <option value="refused">Refused when I asked</option>
              <option value="skipped">I didn&rsquo;t ask</option>
            </select>
          </div>
        )}

        <div>
          <label htmlFor="cc-payment" className="block text-sm font-medium text-deep-navy mb-2 inline-flex items-center gap-1.5">
            <CreditCard size={16} aria-hidden /> How are they asking you to pay?
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
          <p className="mt-1 text-xs text-gov-slate">
            Cash, gift cards, crypto, or transfers to a personal account
            from a street fundraiser are scam red flags regardless of how
            the registration check turns out.
          </p>
        </div>
      </fieldset>

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

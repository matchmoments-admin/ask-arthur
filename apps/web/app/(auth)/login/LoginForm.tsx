"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@askarthur/supabase/browser";

export default function LoginForm({ redirectTo }: { redirectTo?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [useMagicLink, setUseMagicLink] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [magicLinkSent, setMagicLinkSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const supabase = createBrowserClient();

      if (useMagicLink) {
        const { error: otpError } = await supabase.auth.signInWithOtp({
          email,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback`,
          },
        });
        if (otpError) {
          setError(otpError.message);
        } else {
          setMagicLinkSent(true);
        }
      } else {
        const { error: signInError } =
          await supabase.auth.signInWithPassword({ email, password });
        if (signInError) {
          setError(signInError.message);
        } else {
          router.push(redirectTo ?? "/app");
          router.refresh();
        }
      }
    } catch {
      setError("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  }

  if (magicLinkSent) {
    return (
      <div
        className="text-center"
        style={{
          background: "#f8fafc",
          border: "1px solid #eef0f3",
          borderRadius: 10,
          padding: "20px 18px",
        }}
      >
        <div
          className="mx-auto mb-3 grid place-items-center"
          style={{
            width: 36,
            height: 36,
            borderRadius: 999,
            background: "#ecfdf5",
            color: "#16a34a",
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>
        <h2 className="text-deep-navy font-semibold text-base mb-1">
          Check your email
        </h2>
        <p className="text-slate-500 text-sm">
          We sent a magic link to <strong className="text-deep-navy font-medium">{email}</strong>.
          <br />
          Click it to sign in.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div
          className="text-sm"
          style={{
            background: "#fef2f2",
            border: "1px solid #fecaca",
            color: "#991b1b",
            borderRadius: 8,
            padding: "10px 12px",
          }}
        >
          {error}
        </div>
      )}

      <div>
        <label
          htmlFor="email"
          className="block text-[13px] font-medium text-deep-navy mb-1.5"
        >
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full text-sm text-deep-navy bg-white"
          style={{
            border: "1px solid #e2e8f0",
            borderRadius: 8,
            padding: "10px 12px",
          }}
          placeholder="you@example.com"
        />
      </div>

      {!useMagicLink && (
        <div>
          <div className="flex items-baseline justify-between mb-1.5">
            <label
              htmlFor="password"
              className="block text-[13px] font-medium text-deep-navy"
            >
              Password
            </label>
            <a
              href="#"
              className="text-[12px] text-slate-500 hover:text-deep-navy"
              tabIndex={-1}
              onClick={(e) => e.preventDefault()}
            >
              Forgot?
            </a>
          </div>
          <input
            id="password"
            type="password"
            required={!useMagicLink}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full text-sm text-deep-navy bg-white"
            style={{
              border: "1px solid #e2e8f0",
              borderRadius: 8,
              padding: "10px 12px",
            }}
            placeholder="Your password"
          />
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full text-white font-medium text-sm transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
        style={{
          background: "var(--color-deep-navy)",
          borderRadius: 8,
          padding: "10px 14px",
          boxShadow: "0 1px 2px rgba(0,31,63,0.18)",
        }}
      >
        {loading
          ? "Signing in…"
          : useMagicLink
            ? "Send magic link"
            : "Sign in"}
      </button>

      <div className="flex items-center gap-3 text-[11px] text-slate-400 uppercase tracking-wider">
        <span className="flex-1 h-px" style={{ background: "#eef0f3" }} />
        <span>or</span>
        <span className="flex-1 h-px" style={{ background: "#eef0f3" }} />
      </div>

      <button
        type="button"
        onClick={() => {
          setUseMagicLink(!useMagicLink);
          setError(null);
        }}
        className="w-full text-sm text-deep-navy font-medium bg-white hover:bg-slate-50 transition-colors"
        style={{
          border: "1px solid #e2e8f0",
          borderRadius: 8,
          padding: "10px 14px",
        }}
      >
        {useMagicLink ? "Sign in with password" : "Email me a magic link"}
      </button>
    </form>
  );
}

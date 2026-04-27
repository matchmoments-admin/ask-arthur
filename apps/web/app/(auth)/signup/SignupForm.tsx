"use client";

import { useState } from "react";
import { createBrowserClient } from "@askarthur/supabase/browser";

export default function SignupForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const supabase = createBrowserClient();

      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { display_name: displayName },
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (signUpError) {
        setError(signUpError.message);
      } else {
        setSuccess(true);
      }
    } catch {
      setError("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  }

  if (success) {
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
          We sent a confirmation link to{" "}
          <strong className="text-deep-navy font-medium">{email}</strong>.
          <br />
          Click it to activate your account.
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
          htmlFor="displayName"
          className="block text-[13px] font-medium text-deep-navy mb-1.5"
        >
          Display name <span className="text-slate-400 font-normal">(optional)</span>
        </label>
        <input
          id="displayName"
          type="text"
          autoComplete="name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className="w-full text-sm text-deep-navy bg-white"
          style={{
            border: "1px solid #e2e8f0",
            borderRadius: 8,
            padding: "10px 12px",
          }}
          placeholder="Your name"
        />
      </div>

      <div>
        <label
          htmlFor="email"
          className="block text-[13px] font-medium text-deep-navy mb-1.5"
        >
          Work email
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
          placeholder="you@company.com"
        />
      </div>

      <div>
        <label
          htmlFor="password"
          className="block text-[13px] font-medium text-deep-navy mb-1.5"
        >
          Password
        </label>
        <input
          id="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full text-sm text-deep-navy bg-white"
          style={{
            border: "1px solid #e2e8f0",
            borderRadius: 8,
            padding: "10px 12px",
          }}
          placeholder="At least 8 characters"
        />
        <p className="text-[11px] text-slate-400 mt-1.5">
          Use at least 8 characters with a mix of letters and numbers.
        </p>
      </div>

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
        {loading ? "Creating account…" : "Create account"}
      </button>
    </form>
  );
}

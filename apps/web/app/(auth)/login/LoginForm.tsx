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
      <div className="rounded-xl border border-border-light bg-white p-6 text-center">
        <h2 className="text-deep-navy font-extrabold text-lg mb-2">
          Check your email
        </h2>
        <p className="text-gov-slate text-sm">
          We sent a magic link to <strong>{email}</strong>. Click it to sign in.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div>
        <label
          htmlFor="email"
          className="block text-sm font-bold text-deep-navy mb-1"
        >
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg border border-border-light px-3 py-2.5 text-sm text-deep-navy focus:outline-none focus:ring-2 focus:ring-action-teal focus:border-transparent"
          placeholder="you@example.com"
        />
      </div>

      {!useMagicLink && (
        <div>
          <label
            htmlFor="password"
            className="block text-sm font-bold text-deep-navy mb-1"
          >
            Password
          </label>
          <input
            id="password"
            type="password"
            required={!useMagicLink}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-border-light px-3 py-2.5 text-sm text-deep-navy focus:outline-none focus:ring-2 focus:ring-action-teal focus:border-transparent"
            placeholder="Your password"
          />
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-action-teal text-white font-bold text-sm py-2.5 hover:bg-action-teal/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading
          ? "Signing in..."
          : useMagicLink
            ? "Send magic link"
            : "Sign in"}
      </button>

      <button
        type="button"
        onClick={() => {
          setUseMagicLink(!useMagicLink);
          setError(null);
        }}
        className="w-full text-center text-sm text-gov-slate hover:text-action-teal transition-colors"
      >
        {useMagicLink ? "Use password instead" : "Use magic link instead"}
      </button>
    </form>
  );
}

"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { Loader2, CheckCircle, AlertTriangle } from "lucide-react";

const HEAR_ABOUT_OPTIONS = [
  "",
  "Search engine",
  "Social media",
  "Industry event",
  "Colleague or referral",
  "News article",
  "Other",
];

interface FormState {
  name: string;
  email: string;
  company: string;
  challenge: string;
  hearAbout: string;
}

export default function ContactForm() {
  const [form, setForm] = useState<FormState>({
    name: "",
    email: "",
    company: "",
    challenge: "",
    hearAbout: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateField(field: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (error) setError(null);
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim(),
          company_name: form.company.trim(),
          source: "referral" as const,
          assessment_data: {
            challenge: form.challenge.trim(),
            hear_about: form.hearAbout || undefined,
          },
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(
          body?.error ?? "Something went wrong. Please try again."
        );
      }

      setSuccess(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Something went wrong."
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className="flex flex-col items-center py-8 text-center">
        <CheckCircle size={40} className="text-safe-green mb-3" />
        <h3 className="text-base font-semibold text-deep-navy mb-1">
          We&apos;ll be in touch
        </h3>
        <p className="text-sm text-slate-500 max-w-xs">
          Thank you for your interest. A member of our team will contact you
          within 24 hours to schedule a call.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Name */}
      <div>
        <label
          htmlFor="contact-name"
          className="block text-xs font-medium text-gov-slate mb-1"
        >
          Name <span className="text-danger-red">*</span>
        </label>
        <input
          id="contact-name"
          type="text"
          required
          value={form.name}
          onChange={(e) => updateField("name", e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-border-light bg-white text-sm text-deep-navy placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-action-teal/30 focus:border-action-teal transition"
          placeholder="Your full name"
        />
      </div>

      {/* Work email */}
      <div>
        <label
          htmlFor="contact-email"
          className="block text-xs font-medium text-gov-slate mb-1"
        >
          Work email <span className="text-danger-red">*</span>
        </label>
        <input
          id="contact-email"
          type="email"
          required
          value={form.email}
          onChange={(e) => updateField("email", e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-border-light bg-white text-sm text-deep-navy placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-action-teal/30 focus:border-action-teal transition"
          placeholder="you@company.com.au"
        />
      </div>

      {/* Company */}
      <div>
        <label
          htmlFor="contact-company"
          className="block text-xs font-medium text-gov-slate mb-1"
        >
          Company <span className="text-danger-red">*</span>
        </label>
        <input
          id="contact-company"
          type="text"
          required
          value={form.company}
          onChange={(e) => updateField("company", e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-border-light bg-white text-sm text-deep-navy placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-action-teal/30 focus:border-action-teal transition"
          placeholder="Your company name"
        />
      </div>

      {/* Challenge */}
      <div>
        <label
          htmlFor="contact-challenge"
          className="block text-xs font-medium text-gov-slate mb-1"
        >
          What&apos;s your biggest scam challenge?{" "}
          <span className="text-danger-red">*</span>
        </label>
        <textarea
          id="contact-challenge"
          required
          rows={3}
          value={form.challenge}
          onChange={(e) => updateField("challenge", e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-border-light bg-white text-sm text-deep-navy placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-action-teal/30 focus:border-action-teal transition resize-none"
          placeholder="Tell us about the scam threats your organisation faces..."
        />
      </div>

      {/* How did you hear about us */}
      <div>
        <label
          htmlFor="contact-hear"
          className="block text-xs font-medium text-gov-slate mb-1"
        >
          How did you hear about us?
        </label>
        <select
          id="contact-hear"
          value={form.hearAbout}
          onChange={(e) => updateField("hearAbout", e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-border-light bg-white text-sm text-deep-navy focus:outline-none focus:ring-2 focus:ring-action-teal/30 focus:border-action-teal transition"
        >
          {HEAR_ABOUT_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {opt || "Select an option"}
            </option>
          ))}
        </select>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertTriangle size={14} className="text-red-500 flex-shrink-0" />
          <p className="text-xs text-red-700">{error}</p>
        </div>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={submitting}
        className="w-full py-2.5 rounded-lg bg-deep-navy text-white text-sm font-medium hover:bg-deep-navy/90 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
      >
        {submitting ? (
          <>
            <Loader2 size={14} className="animate-spin" />
            Submitting...
          </>
        ) : (
          "Book a call \u2192"
        )}
      </button>
    </form>
  );
}

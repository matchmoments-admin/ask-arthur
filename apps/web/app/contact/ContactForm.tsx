"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { Loader2, CheckCircle, AlertTriangle, MessageSquare, Bug, TrendingUp, Sparkles } from "lucide-react";

const HEAR_ABOUT_OPTIONS = [
  "",
  "Search engine",
  "Social media",
  "Industry event",
  "Colleague or referral",
  "News article",
  "Other",
];

type FeedbackType = "general" | "bug" | "improvement" | "feature";

const TYPE_OPTIONS: Array<{
  value: FeedbackType;
  label: string;
  description: string;
  icon: typeof MessageSquare;
}> = [
  {
    value: "general",
    label: "General enquiry",
    description: "Sales, partnerships, or anything else",
    icon: MessageSquare,
  },
  {
    value: "bug",
    label: "Bug report",
    description: "Something isn't working",
    icon: Bug,
  },
  {
    value: "improvement",
    label: "Improvement",
    description: "How an existing feature could be better",
    icon: TrendingUp,
  },
  {
    value: "feature",
    label: "Feature request",
    description: "Something new you'd like Arthur to do",
    icon: Sparkles,
  },
];

const SEVERITY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "Blocker", label: "Blocker — can't use the product" },
  { value: "Critical", label: "Critical — major flow broken" },
  { value: "Major", label: "Major — feature broken with workaround" },
  { value: "Minor", label: "Minor — cosmetic or edge case" },
];

interface FormState {
  type: FeedbackType;
  name: string;
  email: string;
  company: string;
  // Shared / general
  challenge: string;
  hearAbout: string;
  // Typed-feedback fields
  title: string;
  description: string;
  steps: string;
  severity: string;
  current: string;
  desired: string;
  problem: string;
  useCase: string;
}

const EMPTY_FORM: FormState = {
  type: "general",
  name: "",
  email: "",
  company: "",
  challenge: "",
  hearAbout: "",
  title: "",
  description: "",
  steps: "",
  severity: "Major",
  current: "",
  desired: "",
  problem: "",
  useCase: "",
};

export default function ContactForm() {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateField<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (error) setError(null);
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      // Auto-attached metadata — collected silently. Users won't supply this
      // reliably and it's load-bearing for triage. See research block §A.1.
      const meta =
        typeof window !== "undefined"
          ? {
              url: window.location.href,
              user_agent: navigator.userAgent,
              viewport: `${window.innerWidth}x${window.innerHeight}`,
              app_version: process.env.NEXT_PUBLIC_GIT_SHA ?? null,
              locale:
                typeof navigator !== "undefined" ? navigator.language : "en-AU",
            }
          : {};

      const isTyped = form.type !== "general";
      const assessment_data: Record<string, unknown> = {
        feedback_type: form.type,
        ...meta,
      };

      if (form.type === "general") {
        assessment_data.challenge = form.challenge.trim();
        assessment_data.hear_about = form.hearAbout || undefined;
      } else {
        assessment_data.title = form.title.trim();
        assessment_data.description = form.description.trim();
        if (form.type === "bug") {
          assessment_data.steps = form.steps.trim() || null;
          assessment_data.severity = form.severity;
        } else if (form.type === "improvement") {
          assessment_data.current = form.current.trim() || null;
          assessment_data.desired = form.desired.trim() || null;
        } else if (form.type === "feature") {
          assessment_data.problem = form.problem.trim() || null;
          assessment_data.use_case = form.useCase.trim() || null;
        }
      }

      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim(),
          company_name: form.company.trim(),
          source: isTyped ? ("website" as const) : ("referral" as const),
          assessment_data,
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
    const isTyped = form.type !== "general";
    return (
      <div className="flex flex-col items-center py-8 text-center">
        <CheckCircle size={40} className="text-safe-green mb-3" />
        <h3 className="text-base font-semibold text-deep-navy mb-1">
          {isTyped ? "Thanks — we've logged that" : "We'll be in touch"}
        </h3>
        <p className="text-sm text-slate-500 max-w-xs">
          {isTyped
            ? "Your feedback is in our triage queue. If we need more info we'll email you."
            : "Thank you for your interest. A member of our team will contact you within 24 hours to schedule a call."}
        </p>
      </div>
    );
  }

  const isBug = form.type === "bug";
  const isImprovement = form.type === "improvement";
  const isFeature = form.type === "feature";
  const isGeneral = form.type === "general";

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Type selector — drives conditional fields below */}
      <fieldset>
        <legend className="block text-xs font-medium text-gov-slate mb-2">
          What&apos;s this about? <span className="text-danger-red">*</span>
        </legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {TYPE_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const checked = form.type === opt.value;
            return (
              <label
                key={opt.value}
                className={`flex items-start gap-2 cursor-pointer rounded-lg border px-3 py-2 transition ${
                  checked
                    ? "border-action-teal bg-action-teal/5"
                    : "border-border-light bg-white hover:border-slate-300"
                }`}
              >
                <input
                  type="radio"
                  name="feedback_type"
                  value={opt.value}
                  checked={checked}
                  onChange={() => updateField("type", opt.value)}
                  className="sr-only"
                />
                <Icon size={16} className={`mt-0.5 ${checked ? "text-action-teal" : "text-gov-slate"}`} aria-hidden="true" />
                <div>
                  <div className="text-sm font-semibold text-deep-navy">{opt.label}</div>
                  <div className="text-xs text-gov-slate">{opt.description}</div>
                </div>
              </label>
            );
          })}
        </div>
      </fieldset>

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

      {/* Email */}
      <div>
        <label
          htmlFor="contact-email"
          className="block text-xs font-medium text-gov-slate mb-1"
        >
          {isGeneral ? "Work email" : "Email"} <span className="text-danger-red">*</span>
        </label>
        <input
          id="contact-email"
          type="email"
          required
          value={form.email}
          onChange={(e) => updateField("email", e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-border-light bg-white text-sm text-deep-navy placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-action-teal/30 focus:border-action-teal transition"
          placeholder={isGeneral ? "you@company.com.au" : "you@example.com"}
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

      {/* GENERAL — challenge + hearAbout */}
      {isGeneral && (
        <>
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
        </>
      )}

      {/* TYPED FEEDBACK — title + description always */}
      {!isGeneral && (
        <>
          <div>
            <label
              htmlFor="contact-title"
              className="block text-xs font-medium text-gov-slate mb-1"
            >
              {isBug
                ? "Summary"
                : isImprovement
                  ? "What could be better?"
                  : "What new thing?"}{" "}
              <span className="text-danger-red">*</span>
            </label>
            <input
              id="contact-title"
              type="text"
              required
              maxLength={120}
              value={form.title}
              onChange={(e) => updateField("title", e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-border-light bg-white text-sm text-deep-navy placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-action-teal/30 focus:border-action-teal transition"
              placeholder={
                isBug
                  ? "e.g. Charity Check returns 500 on long names"
                  : isImprovement
                    ? "e.g. Verdict copy is hard to read on mobile"
                    : "e.g. Add a Telegram alert for new scam types"
              }
            />
          </div>

          <div>
            <label
              htmlFor="contact-description"
              className="block text-xs font-medium text-gov-slate mb-1"
            >
              Description <span className="text-danger-red">*</span>
            </label>
            <textarea
              id="contact-description"
              required
              rows={4}
              value={form.description}
              onChange={(e) => updateField("description", e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-border-light bg-white text-sm text-deep-navy placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-action-teal/30 focus:border-action-teal transition resize-none"
              placeholder={
                isBug
                  ? "What happened, where in the product, when?"
                  : isImprovement
                    ? "Tell us more about the friction you're hitting."
                    : "What problem would this feature solve?"
              }
            />
          </div>

          {isBug && (
            <>
              <div>
                <label
                  htmlFor="contact-steps"
                  className="block text-xs font-medium text-gov-slate mb-1"
                >
                  Steps to reproduce
                </label>
                <textarea
                  id="contact-steps"
                  rows={3}
                  value={form.steps}
                  onChange={(e) => updateField("steps", e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-border-light bg-white text-sm text-deep-navy placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-action-teal/30 focus:border-action-teal transition resize-none"
                  placeholder="1. Go to ...&#10;2. Click ...&#10;3. See error"
                />
              </div>
              <div>
                <label
                  htmlFor="contact-severity"
                  className="block text-xs font-medium text-gov-slate mb-1"
                >
                  Severity
                </label>
                <select
                  id="contact-severity"
                  value={form.severity}
                  onChange={(e) => updateField("severity", e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-border-light bg-white text-sm text-deep-navy focus:outline-none focus:ring-2 focus:ring-action-teal/30 focus:border-action-teal transition"
                >
                  {SEVERITY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          {isImprovement && (
            <>
              <div>
                <label
                  htmlFor="contact-current"
                  className="block text-xs font-medium text-gov-slate mb-1"
                >
                  How does it work today?
                </label>
                <textarea
                  id="contact-current"
                  rows={2}
                  value={form.current}
                  onChange={(e) => updateField("current", e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-border-light bg-white text-sm text-deep-navy placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-action-teal/30 focus:border-action-teal transition resize-none"
                  placeholder="Current behaviour or experience"
                />
              </div>
              <div>
                <label
                  htmlFor="contact-desired"
                  className="block text-xs font-medium text-gov-slate mb-1"
                >
                  How would you like it to work?
                </label>
                <textarea
                  id="contact-desired"
                  rows={2}
                  value={form.desired}
                  onChange={(e) => updateField("desired", e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-border-light bg-white text-sm text-deep-navy placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-action-teal/30 focus:border-action-teal transition resize-none"
                  placeholder="Desired behaviour"
                />
              </div>
            </>
          )}

          {isFeature && (
            <>
              <div>
                <label
                  htmlFor="contact-problem"
                  className="block text-xs font-medium text-gov-slate mb-1"
                >
                  What problem does it solve?
                </label>
                <textarea
                  id="contact-problem"
                  rows={2}
                  value={form.problem}
                  onChange={(e) => updateField("problem", e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-border-light bg-white text-sm text-deep-navy placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-action-teal/30 focus:border-action-teal transition resize-none"
                />
              </div>
              <div>
                <label
                  htmlFor="contact-usecase"
                  className="block text-xs font-medium text-gov-slate mb-1"
                >
                  When would you use it?
                </label>
                <textarea
                  id="contact-usecase"
                  rows={2}
                  value={form.useCase}
                  onChange={(e) => updateField("useCase", e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-border-light bg-white text-sm text-deep-navy placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-action-teal/30 focus:border-action-teal transition resize-none"
                  placeholder="Concrete use case or scenario"
                />
              </div>
            </>
          )}
        </>
      )}

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertTriangle size={14} className="text-red-500 flex-shrink-0" />
          <p className="text-xs text-red-700">{error}</p>
        </div>
      )}

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
        ) : isGeneral ? (
          "Book a call →"
        ) : (
          "Send"
        )}
      </button>
    </form>
  );
}

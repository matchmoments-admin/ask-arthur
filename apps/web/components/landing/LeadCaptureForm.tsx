"use client";

import { useState } from "react";
import { Loader2, CheckCircle, AlertCircle } from "lucide-react";

interface LeadCaptureFormProps {
  source: string;
  heading?: string;
  description?: string;
}

interface FormData {
  name: string;
  email: string;
  company_name: string;
  abn: string;
  sector: string;
  role_title: string;
  phone: string;
}

export default function LeadCaptureForm({
  source,
  heading = "Get in touch",
  description = "Leave your details and our team will be in touch within 24 hours.",
}: LeadCaptureFormProps) {
  const [form, setForm] = useState<FormData>({
    name: "",
    email: "",
    company_name: "",
    abn: "",
    sector: sectorFromSource(source),
    role_title: "",
    phone: "",
  });
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  function sectorFromSource(src: string): string {
    if (src.startsWith("banking")) return "banking";
    if (src.startsWith("telco")) return "telco";
    if (src.startsWith("digital_platforms")) return "digital_platform";
    return "";
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setErrorMsg("");

    try {
      const payload: Record<string, string | undefined> = {
        name: form.name,
        email: form.email,
        company_name: form.company_name,
        source,
      };
      if (form.abn) payload.abn = form.abn;
      if (form.sector) payload.sector = form.sector;
      if (form.role_title) payload.role_title = form.role_title;
      if (form.phone) payload.phone = form.phone;

      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.status === 201) {
        setStatus("success");
      } else {
        const data = await res.json();
        setErrorMsg(data.error ?? "Something went wrong. Please try again.");
        setStatus("error");
      }
    } catch {
      setErrorMsg("Network error. Please check your connection and try again.");
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <section id="lead-form" className="mb-16">
        <div className="bg-white border border-border-light rounded-2xl shadow-sm p-8 text-center">
          <CheckCircle size={40} className="text-safe-green mx-auto mb-4" />
          <h3 className="text-deep-navy text-xl font-bold mb-2">
            Thank you for your interest
          </h3>
          <p className="text-gov-slate">
            Our team will be in touch within 24 hours to discuss your
            requirements.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section id="lead-form" className="mb-16">
      <div className="bg-white border border-border-light rounded-2xl shadow-sm p-8">
        <h2 className="text-deep-navy text-2xl font-extrabold mb-2">
          {heading}
        </h2>
        <p className="text-gov-slate text-base mb-6">{description}</p>

        <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
          {/* Full Name */}
          <div className="sm:col-span-2">
            <label
              htmlFor="lead-name"
              className="block text-sm font-semibold text-deep-navy mb-1"
            >
              Full Name <span className="text-danger-text">*</span>
            </label>
            <input
              id="lead-name"
              name="name"
              type="text"
              required
              value={form.name}
              onChange={handleChange}
              className="w-full border border-border-light rounded-xl px-4 py-2.5 text-sm text-deep-navy placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-trust-teal/30 focus:border-trust-teal transition-colors"
              placeholder="Jane Smith"
            />
          </div>

          {/* Work Email */}
          <div>
            <label
              htmlFor="lead-email"
              className="block text-sm font-semibold text-deep-navy mb-1"
            >
              Work Email <span className="text-danger-text">*</span>
            </label>
            <input
              id="lead-email"
              name="email"
              type="email"
              required
              value={form.email}
              onChange={handleChange}
              className="w-full border border-border-light rounded-xl px-4 py-2.5 text-sm text-deep-navy placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-trust-teal/30 focus:border-trust-teal transition-colors"
              placeholder="jane@company.com.au"
            />
          </div>

          {/* Company Name */}
          <div>
            <label
              htmlFor="lead-company"
              className="block text-sm font-semibold text-deep-navy mb-1"
            >
              Company Name <span className="text-danger-text">*</span>
            </label>
            <input
              id="lead-company"
              name="company_name"
              type="text"
              required
              value={form.company_name}
              onChange={handleChange}
              className="w-full border border-border-light rounded-xl px-4 py-2.5 text-sm text-deep-navy placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-trust-teal/30 focus:border-trust-teal transition-colors"
              placeholder="Acme Financial Services"
            />
          </div>

          {/* ABN */}
          <div>
            <label
              htmlFor="lead-abn"
              className="block text-sm font-semibold text-deep-navy mb-1"
            >
              ABN <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <input
              id="lead-abn"
              name="abn"
              type="text"
              value={form.abn}
              onChange={handleChange}
              maxLength={11}
              pattern="\d{11}"
              className="w-full border border-border-light rounded-xl px-4 py-2.5 text-sm text-deep-navy placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-trust-teal/30 focus:border-trust-teal transition-colors"
              placeholder="12345678901"
            />
          </div>

          {/* Role */}
          <div>
            <label
              htmlFor="lead-role"
              className="block text-sm font-semibold text-deep-navy mb-1"
            >
              Role{" "}
              <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <input
              id="lead-role"
              name="role_title"
              type="text"
              value={form.role_title}
              onChange={handleChange}
              className="w-full border border-border-light rounded-xl px-4 py-2.5 text-sm text-deep-navy placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-trust-teal/30 focus:border-trust-teal transition-colors"
              placeholder="Head of Compliance"
            />
          </div>

          {/* Phone */}
          <div>
            <label
              htmlFor="lead-phone"
              className="block text-sm font-semibold text-deep-navy mb-1"
            >
              Phone{" "}
              <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <input
              id="lead-phone"
              name="phone"
              type="tel"
              value={form.phone}
              onChange={handleChange}
              className="w-full border border-border-light rounded-xl px-4 py-2.5 text-sm text-deep-navy placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-trust-teal/30 focus:border-trust-teal transition-colors"
              placeholder="+61 400 000 000"
            />
          </div>

          {/* Hidden sector field */}
          <input type="hidden" name="sector" value={form.sector} />

          {/* Error message */}
          {status === "error" && (
            <div className="sm:col-span-2 flex items-center gap-2 text-sm text-danger-text bg-danger-bg border border-danger-border rounded-xl px-4 py-3">
              <AlertCircle size={16} className="shrink-0" />
              {errorMsg}
            </div>
          )}

          {/* Submit */}
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={status === "loading"}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-3 bg-trust-teal text-white font-semibold rounded-xl hover:bg-trust-teal/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {status === "loading" ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Submitting...
                </>
              ) : (
                "Submit"
              )}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

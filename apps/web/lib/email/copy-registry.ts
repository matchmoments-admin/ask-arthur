// Email "copy slots" registry — the editable-prose surface for the admin
// Email Studio (/admin/email-studio).
//
// Each template exposes named slots whose DEFAULT is the prose currently
// hardcoded in the React Email component. An admin can override a slot's
// markdown from the studio; resolveEmailCopy() (resolve-copy.ts) merges the
// override over the default, so a missing override always falls back here and
// a template never breaks. Slot markdown may contain {{var}} placeholders
// listed in `vars` — these are interpolated (HTML-escaped) at render time.
//
// Only PROSE lives here. Layout, branding, stat blocks, loops, footers, and
// legal disclaimers stay in code. Adding a new editable slot = add an entry
// here + read it in the template via `copy?.<slot> ?? SLOT.default`.

export interface SlotDef {
  /** Human label shown in the studio editor. */
  label: string;
  /** Default markdown (the prose currently hardcoded in the template). */
  default: string;
}

export interface EmailTemplateDef {
  key: string;
  /** Human label shown in the studio. */
  label: string;
  /** {{var}} placeholders available to this template's slots. */
  vars: string[];
  /** Editable prose slots. Empty for preview-only templates. */
  slots: Record<string, SlotDef>;
  /** Whether this template has editable slots yet (vs preview-only). */
  editable: boolean;
}

export const BRAND_STEWARDSHIP_SLOTS = {
  greeting: {
    label: "Greeting",
    default:
      "Hello **{{brandName}}** team — here's what Ask Arthur, an Australian scam-detection service, detected and reported on your behalf in **{{periodLabel}}**.",
  },
  what_we_do: {
    label: "What we do",
    default:
      "**Ask Arthur** aims to protect Australians from scams in every way we can — ideally through prevention, like our free [scam checker](https://askarthur.au/?utm_source=email&utm_campaign=brand-stewardship), and by reporting potential brand impersonation, like the lookalike domains in this email.",
  },
  working_together: {
    label: "Working together",
    default:
      "We keep a full evidence record for every domain above. Reply to this email if you'd like the underlying evidence pack, a different report format, or to discuss working together more closely.",
  },
  partnership: {
    label: "CTA lead-in (feedback / partnership)",
    default:
      "If this summary helped your team, a quick review or shout-out helps a small Australian service reach more brands — and we'd love to explore protecting **{{brandName}}** more deeply together.",
  },
} satisfies Record<string, SlotDef>;

export const BRAND_ABUSE_SLOTS = {
  greeting: {
    label: "Greeting",
    default: "Hello {{brandName}} security team,",
  },
  intro: {
    label: "Intro paragraph",
    default:
      "A member of the Australian public reported a communication impersonating {{brandName}} via Ask Arthur (askarthur.au), an Australian scam-detection service. We're forwarding the evidence so you can action takedowns or customer alerts as appropriate. The reporter has consented to this forward; their personal details have been removed.",
  },
} satisfies Record<string, SlotDef>;

export const CLONE_WATCH_SLOTS = {
  what_you_might_do: {
    label: "What you might do",
    default:
      "If this matches your fraud-monitoring criteria, common next steps are filing an abuse report with the registrar, requesting browser-vendor blocking, or escalating to your trademark counsel. Reply to this email if you'd like the underlying evidence pack in a different format.",
  },
} satisfies Record<string, SlotDef>;

export const WEAPONISED_CLONE_SLOTS = {
  what_you_can_do: {
    label: "What you can do now",
    default:
      "Time matters here — the site is live now. The fastest lever is usually an abuse report to the domain's registrar (contact above, when we could identify it), citing trademark impersonation and phishing content. Your trademark counsel can also pursue auDRP/UDRP if the domain warrants recovering. Reply to this email if you'd like the underlying evidence pack.",
  },
} satisfies Record<string, SlotDef>;

export const EMAIL_TEMPLATES: Record<string, EmailTemplateDef> = {
  brand_stewardship: {
    key: "brand_stewardship",
    label: "Brand Stewardship Report (monthly)",
    vars: ["brandName", "periodLabel"],
    slots: BRAND_STEWARDSHIP_SLOTS,
    editable: true,
  },
  brand_abuse: {
    key: "brand_abuse",
    label: "Brand Abuse Report",
    vars: ["brandName"],
    slots: BRAND_ABUSE_SLOTS,
    editable: true,
  },
  clone_watch_brand_alert: {
    key: "clone_watch_brand_alert",
    label: "Clone-Watch Brand Alert",
    vars: ["brandName", "legitimateDomain"],
    slots: CLONE_WATCH_SLOTS,
    editable: true,
  },
  weaponised_clone_alert: {
    key: "weaponised_clone_alert",
    label: "Clone-Watch Weaponisation Alert (urgent)",
    vars: ["brandName", "legitimateDomain"],
    slots: WEAPONISED_CLONE_SLOTS,
    editable: true,
  },
  // Preview-only (no editable slots yet — mechanical follow-up via this registry).
  welcome: { key: "welcome", label: "Welcome", vars: [], slots: {}, editable: false },
  weekly_digest: { key: "weekly_digest", label: "Weekly Digest", vars: [], slots: {}, editable: false },
  weekly_intel_digest: { key: "weekly_intel_digest", label: "Weekly Intel Digest", vars: [], slots: {}, editable: false },
  inbound_scan_result: { key: "inbound_scan_result", label: "Inbound Scan Result", vars: [], slots: {}, editable: false },
  nurture_1_spf_intro: { key: "nurture_1_spf_intro", label: "Nurture 1 — SPF Intro", vars: [], slots: {}, editable: false },
  nurture_2_reasonable_steps: { key: "nurture_2_reasonable_steps", label: "Nurture 2 — Reasonable Steps", vars: [], slots: {}, editable: false },
  nurture_3_collective_intelligence: { key: "nurture_3_collective_intelligence", label: "Nurture 3 — Collective Intelligence", vars: [], slots: {}, editable: false },
  nurture_4_case_study: { key: "nurture_4_case_study", label: "Nurture 4 — Case Study", vars: [], slots: {}, editable: false },
  nurture_5_technical_overview: { key: "nurture_5_technical_overview", label: "Nurture 5 — Technical Overview", vars: [], slots: {}, editable: false },
  nurture_6_deadline: { key: "nurture_6_deadline", label: "Nurture 6 — Deadline", vars: [], slots: {}, editable: false },
};

export type EmailTemplateKey = keyof typeof EMAIL_TEMPLATES;

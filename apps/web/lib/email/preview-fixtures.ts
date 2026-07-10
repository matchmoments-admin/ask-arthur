import type { ReactElement } from "react";
import BrandStewardshipReport from "@/emails/BrandStewardshipReport";
import BrandAbuseReport from "@/emails/BrandAbuseReport";
import CloneWatchBrandAlert from "@/emails/CloneWatchBrandAlert";
import WeaponisedCloneAlert from "@/emails/WeaponisedCloneAlert";
import Welcome from "@/emails/Welcome";
import WeeklyDigest from "@/emails/WeeklyDigest";
import WeeklyIntelDigest from "@/emails/WeeklyIntelDigest";
import InboundScanResult from "@/emails/InboundScanResult";
import SPFIntro from "@/emails/nurture/SPFIntro";
import ReasonableSteps from "@/emails/nurture/ReasonableSteps";
import CollectiveIntelligence from "@/emails/nurture/CollectiveIntelligence";
import CaseStudy from "@/emails/nurture/CaseStudy";
import TechnicalOverview from "@/emails/nurture/TechnicalOverview";
import Deadline from "@/emails/nurture/Deadline";

// Sample props per template, used by the Email Studio preview route + the
// render smoke test. Centralised so the preview, gallery, and tests share one
// fixture set. `copy` (editable templates only) is layered on by the caller.

const NURTURE = {
  name: "Acme Bank",
  unsubscribeUrl: "https://askarthur.au/unsubscribe?email=preview&token=demo",
};

/**
 * Build the React element for a template preview. `copy` overrides editable
 * prose slots (defaults apply when omitted). Returns null for unknown keys.
 */
export function buildPreviewElement(
  templateKey: string,
  copy?: Record<string, string>,
): ReactElement | null {
  switch (templateKey) {
    case "brand_stewardship":
      return BrandStewardshipReport({
        brandName: "Kmart",
        periodLabel: "May 2026",
        detected: 4,
        reportedByDestination: { openphish: 4, apwg: 4 },
        reportsSent: 8,
        sampleDomains: ["frostwickmart.shop", "cedarwickmart.shop", "gorsewickmart.shop"],
        reportRef: "BSR-kmart-2026-05",
        copy,
      });
    case "brand_abuse":
      return BrandAbuseReport({
        brandName: "Bunnings",
        scamType: "phishing",
        channel: "email",
        scammerUrls: ["https://bunnings-rewards.shop/login"],
        scammerPhones: [],
        scammerEmails: [],
        redactedContent: "Your Bunnings rewards are expiring. Verify at the link to keep [EMAIL].",
        redFlags: ["urgency / expiry pressure", "lookalike domain"],
        receivedAt: "2026-05-29",
        reportRef: "ASK-001234",
        copy,
      });
    case "clone_watch_brand_alert":
      return CloneWatchBrandAlert({
        brandName: "Kmart",
        legitimateDomain: "kmart.com.au",
        candidates: [
          {
            candidateDomain: "frostwickmart.shop",
            candidateUrl: "https://frostwickmart.shop",
            signalType: "substring",
            score: 0.85,
            firstSeenAt: "2026-05-29T08:30:00.000Z",
            evidenceSummary: "Brand-string substring on a .shop TLD.",
          },
        ],
        reportRef: "CW-frostwickmart.shop",
        copy,
      });
    case "weaponised_clone_alert":
      return WeaponisedCloneAlert({
        brandName: "Kmart",
        legitimateDomain: "kmart.com.au",
        candidateDomain: "frostwickmart.shop",
        candidateUrl: "https://frostwickmart.shop/login",
        weaponisedAt: "2026-07-09T22:14:00.000Z",
        urlscanResultUrl: "https://urlscan.io/result/00000000-demo/",
        urlscanScreenshotUrl: "https://urlscan.io/screenshots/00000000-demo.png",
        registrar: "NameCheap, Inc.",
        registrarAbuseEmail: "abuse@namecheap.com",
        hostingIp: "203.0.113.7",
        hostingCountry: "US",
        hostingAsn: "AS13335",
        netcraftDeclinedAt: "2026-06-01T00:00:00.000Z",
        reportRef: "CW-weaponised-preview",
        copy,
      });
    case "welcome":
      return Welcome({ email: "preview@example.com" });
    case "weekly_digest":
      return WeeklyDigest({
        scams: [
          { brand: "Australia Post", summary: "Parcel-redelivery SMS asking for a card fee." },
          { brand: "ATO", summary: "Fake tax-refund email linking to a credential page." },
        ],
        blogUrl: "https://askarthur.au/blog",
      });
    case "weekly_intel_digest":
      return WeeklyIntelDigest({
        weekStart: "2026-05-04",
        weekEnd: "2026-05-11",
        totalPostsClassified: 412,
        emergingThemes: [
          {
            id: "story-1",
            slug: null,
            href: null,
            signalLabel: "New this week",
            title: "Fake debt collector calls escalate",
            narrative: "AU callers report aggressive collection scripts referencing real legal-firm names.",
            memberCount: 32,
            representativeBrands: ["Telstra", "ATO"],
          },
        ],
        topBrands: [{ brand: "Instagram", mentionCount: 14 }],
        topCategories: [{ label: "phishing", count: 88 }],
        scamOfTheWeekQuote: { text: "I clicked the parcel link before I even thought about it.", speakerRole: "victim" },
        modelVersion: "claude-sonnet-4-6",
        promptVersion: "reddit-intel-v1@2026-05-11",
      });
    case "inbound_scan_result":
      return InboundScanResult({
        verdict: "HIGH_RISK",
        confidence: 0.92,
        summary: "This message impersonates Australia Post and links to a credential-harvesting page.",
        redFlags: ["Lookalike domain", "Urgency / fee pressure", "Mismatched sender"],
        nextSteps: ["Do not click the link", "Delete the message", "Report to Scamwatch"],
        forwardedSubject: "Your parcel is held — pay $1.99 redelivery",
        displayName: "Brendan",
        feedbackUpUrl: "https://askarthur.au/feedback?v=up&t=demo",
        feedbackDownUrl: "https://askarthur.au/feedback?v=down&t=demo",
      });
    case "nurture_1_spf_intro":
      return SPFIntro(NURTURE);
    case "nurture_2_reasonable_steps":
      return ReasonableSteps(NURTURE);
    case "nurture_3_collective_intelligence":
      return CollectiveIntelligence(NURTURE);
    case "nurture_4_case_study":
      return CaseStudy(NURTURE);
    case "nurture_5_technical_overview":
      return TechnicalOverview(NURTURE);
    case "nurture_6_deadline":
      return Deadline(NURTURE);
    default:
      return null;
  }
}

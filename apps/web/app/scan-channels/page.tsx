// Public discovery page — every channel a user can submit a suspicious
// message through. Created in PR F1 (audit-followup) when we noticed
// users didn't know about the Telegram/WhatsApp/Slack/Messenger bots that
// already exist.
//
// One source of truth: edit this file when a new channel ships. The
// equivalent system-map entry lives at docs/system-map/data-flows.md.

import type { Metadata } from "next";
import Link from "next/link";
import {
  Globe,
  MessageSquare,
  Send,
  Mail,
  Smartphone,
  Chrome,
  Slack,
  Facebook,
} from "lucide-react";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: "Send Arthur a scam — every way to ask | Ask Arthur",
  description:
    "Forward suspicious emails to scan@askarthur.au, paste a message at askarthur.au, talk to the bot on WhatsApp/Telegram/Slack/Messenger, or use the Chrome extension and mobile app. Every channel returns the same scam verdict.",
  alternates: { canonical: "https://askarthur.au/scan-channels" },
  openGraph: {
    title: "Send Arthur a scam — every way to ask",
    description:
      "Forward, paste, or chat — Arthur scans suspicious messages across web, email, bots, extension, and mobile.",
    url: "https://askarthur.au/scan-channels",
    type: "website",
  },
};

interface Channel {
  icon: typeof Globe;
  name: string;
  description: string;
  href?: string;
  cta?: string;
  badge?: "Live" | "Beta" | "Coming soon";
}

// Order: most discoverable first, then bots by typical user volume.
const CHANNELS: Channel[] = [
  {
    icon: Globe,
    name: "askarthur.au",
    description:
      "Paste a suspicious message, link, or screenshot. Drag and drop a photo of a flyer, lanyard, or QR code. Verdict in seconds.",
    href: "/",
    cta: "Open scanner",
    badge: "Live",
  },
  {
    icon: Mail,
    name: "scan@askarthur.au",
    description:
      "Forward any suspicious email to scan@askarthur.au and Arthur replies with a verdict, plus what to do next. Works from any inbox.",
    href: "mailto:scan@askarthur.au?subject=Is%20this%20a%20scam%3F",
    cta: "Compose email",
    badge: "Beta",
  },
  {
    icon: Chrome,
    name: "Browser extension",
    description:
      "Chrome and Firefox. Right-click any page, message, or selected text to scan it. Includes a security scanner for the page itself.",
    href: "https://chromewebstore.google.com/search/ask%20arthur",
    cta: "Install for Chrome",
    badge: "Live",
  },
  {
    icon: Smartphone,
    name: "iOS + Android app",
    description:
      "Share suspicious content from any app via the system share sheet. The mobile app runs the same scan as the website.",
    href: "/about#mobile",
    cta: "See app links",
    badge: "Live",
  },
  {
    icon: MessageSquare,
    name: "WhatsApp bot",
    description:
      "Send the bot a screenshot or message. It replies with a verdict. Useful for grandparents, parents, or anyone who already lives in WhatsApp.",
    href: "/about#bots",
    cta: "Add to WhatsApp",
    badge: "Live",
  },
  {
    icon: Send,
    name: "Telegram bot",
    description:
      "Same as WhatsApp — paste text or forward a screenshot. Replies with the verdict and red flags.",
    href: "/about#bots",
    cta: "Open Telegram",
    badge: "Live",
  },
  {
    icon: Slack,
    name: "Slack",
    description:
      "Install in your workspace. Use the /askarthur slash command on any message, or the message shortcut. Useful for IT and HR teams triaging phishing reports.",
    href: "/about#bots",
    cta: "Add to Slack",
    badge: "Live",
  },
  {
    icon: Facebook,
    name: "Facebook Messenger",
    description:
      "Message the Ask Arthur page on Facebook with the suspicious text or screenshot. Same scan, same verdict.",
    href: "/about#bots",
    cta: "Open Messenger",
    badge: "Live",
  },
];

const VERDICTS: Array<{ label: string; tone: string; colour: string }> = [
  { label: "Safe", tone: "Looks legitimate", colour: "#16a34a" },
  { label: "Caution", tone: "Worth a second look", colour: "#d97706" },
  { label: "High risk", tone: "Likely a scam — don't engage", colour: "#dc2626" },
];

export default function ScanChannelsPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main
        id="main-content"
        className="flex-1 w-full max-w-[720px] mx-auto px-5 pt-12 pb-16"
      >
        <h1 className="text-deep-navy text-4xl md:text-5xl font-extrabold mb-4 leading-tight">
          Every way to ask Arthur
        </h1>
        <p className="text-lg text-gov-slate mb-12 leading-relaxed">
          The same scam-detection engine sits behind eight different
          channels. Pick whichever fits where you are when the suspicious
          message lands — paste it on the web, forward an email, snap a
          photo from your phone, or message the bot you already use.
        </p>

        <ul className="space-y-4 mb-16">
          {CHANNELS.map((c) => (
            <li
              key={c.name}
              className="flex gap-4 p-5 rounded-2xl border border-slate-200 hover:border-action-teal/40 hover:shadow-sm transition-all"
            >
              <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-action-teal/10 flex items-center justify-center text-action-teal">
                <c.icon size={24} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-3 mb-1 flex-wrap">
                  <h2 className="text-deep-navy text-lg font-bold">
                    {c.name}
                  </h2>
                  {c.badge && (
                    <span
                      className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full ${
                        c.badge === "Live"
                          ? "bg-green-50 text-green-700"
                          : c.badge === "Beta"
                          ? "bg-amber-50 text-amber-700"
                          : "bg-slate-100 text-gov-slate"
                      }`}
                    >
                      {c.badge}
                    </span>
                  )}
                </div>
                <p className="text-sm text-gov-slate leading-relaxed mb-3">
                  {c.description}
                </p>
                {c.href && c.cta && (
                  <Link
                    href={c.href}
                    className="inline-flex items-center text-sm font-bold text-action-teal hover:text-deep-navy transition-colors"
                  >
                    {c.cta} →
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>

        <section className="mb-12">
          <h2 className="text-deep-navy text-2xl font-extrabold mb-3">
            What you get back
          </h2>
          <p className="text-base text-gov-slate leading-relaxed mb-6">
            Same verdict on every channel. Arthur doesn&rsquo;t store the
            content of what you send — analysis runs in memory, then the
            raw text is discarded. We keep an anonymous summary so we can
            warn other Australians about the same scam.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {VERDICTS.map((v) => (
              <div
                key={v.label}
                className="p-4 rounded-xl border-l-4"
                style={{ borderLeftColor: v.colour, background: `${v.colour}0a` }}
              >
                <div
                  className="text-sm font-bold uppercase tracking-wider"
                  style={{ color: v.colour }}
                >
                  {v.label}
                </div>
                <div className="text-sm text-deep-navy mt-1">{v.tone}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="p-6 rounded-2xl bg-slate-50 border border-slate-200">
          <h2 className="text-deep-navy text-lg font-bold mb-2">
            Anonymous reporting
          </h2>
          <p className="text-sm text-gov-slate leading-relaxed">
            We never ask for your name. Forwarding from a personal email
            address means we can email the verdict back, but the address
            stays out of public datasets. See{" "}
            <Link href="/privacy" className="text-action-teal underline">
              privacy
            </Link>{" "}
            and{" "}
            <Link href="/trust" className="text-action-teal underline">
              trust
            </Link>{" "}
            for the detail.
          </p>
        </section>
      </main>
      <Footer />
    </div>
  );
}

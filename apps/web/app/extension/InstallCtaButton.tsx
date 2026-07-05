"use client";

import { track } from "@/lib/track";

// The "Add to Chrome" CTA. The actual Web Store install is invisible to us (and
// the extension's register call carries no first-party cookie), so this click
// is the last attributable first-party touch — captured as extension_install
// INTENT so a LinkedIn-sourced visitor's install journey stays attributable.
export default function InstallCtaButton({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => track("extension_install", { stage: "cta_click" })}
      className="inline-flex items-center justify-center h-14 px-10 bg-deep-navy text-white font-semibold rounded-full hover:bg-navy transition-colors text-lg"
    >
      Add to Chrome — It&apos;s Free
    </a>
  );
}

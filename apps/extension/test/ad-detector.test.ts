import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  detectSponsoredPost,
  extractAdContent,
  hashAdText,
} from "@/lib/ad-detector";

function loadFixture(name: string): HTMLElement {
  const html = readFileSync(
    path.resolve(__dirname, "fixtures", "facebook", name),
    "utf8",
  );
  document.body.innerHTML = html;
  const unit = document.querySelector<HTMLElement>('[role="article"]');
  if (!unit) throw new Error(`fixture ${name} has no [role="article"] root`);
  return unit;
}

describe("detectSponsoredPost", () => {
  it("detects a plain sponsored unit (aria-label + /ads/about link)", () => {
    const unit = loadFixture("feed-sponsored-2026-07.html");
    expect(detectSponsoredPost(unit)).toBe(true);
  });

  it("detects the fragmented-span obfuscation with hidden decoys", () => {
    // This fixture deliberately contains NO aria-label and NO /ads/about
    // link, so a hit proves the method-5 reconstruction path specifically.
    const unit = loadFixture("feed-sponsored-fragmented-span-2026-07.html");
    expect(unit.querySelector("a[aria-label='Sponsored']")).toBeNull();
    expect(detectSponsoredPost(unit)).toBe(true);
  });

  it("ignores hidden decoy fragments when reconstructing", () => {
    const unit = loadFixture("feed-sponsored-fragmented-span-2026-07.html");
    // Flip every visible fragment to hidden — reconstruction must now fail.
    unit
      .querySelectorAll<HTMLElement>(
        'a[href="#"] > span[aria-labelledby] > span > span',
      )
      .forEach((span) => {
        span.style.display = "none";
      });
    expect(detectSponsoredPost(unit)).toBe(false);
  });

  it("does not flag an organic post (negative fixture)", () => {
    const unit = loadFixture("feed-organic-2026-07.html");
    expect(detectSponsoredPost(unit)).toBe(false);
  });

  it("detects via data attributes (method 2) without any text label", () => {
    document.body.innerHTML =
      '<div role="article"><div data-ad-preview="message">buy stuff</div></div>';
    const unit = document.querySelector<HTMLElement>('[role="article"]')!;
    expect(detectSponsoredPost(unit)).toBe(true);
  });
});

describe("extractAdContent", () => {
  it("extracts advertiser, ad text, decoded landing URL, and image", () => {
    const unit = loadFixture("feed-sponsored-2026-07.html");
    const content = extractAdContent(unit);
    expect(content).not.toBeNull();
    expect(content!.advertiserName).toBe("Totally Real Finance");
    expect(content!.adText).toContain("investment loophole");
    expect(content!.adText).toContain("Limited places available");
    // l.facebook.com?u= redirect is decoded to the real landing URL.
    expect(content!.landingUrl).toBe(
      "https://dodgy-invest.example.com/landing?utm=fb",
    );
    expect(content!.imageUrl).toBe(
      "https://scontent.xx.fbcdn.net/v/t45.1600-4/ad_creative_0001.jpg",
    );
    expect(content!.feedUnitElement).toBe(unit);
  });

  it("extracts a direct (non-redirect) landing URL", () => {
    const unit = loadFixture("feed-sponsored-fragmented-span-2026-07.html");
    const content = extractAdContent(unit);
    expect(content).not.toBeNull();
    expect(content!.advertiserName).toBe("Mega Gadget Deals");
    expect(content!.landingUrl).toBe(
      "https://mega-gadget-clearance.example.shop/sale",
    );
  });

  it("returns null when there is no advertiser-shaped header link", () => {
    document.body.innerHTML = '<div role="article"><div dir="auto">text only, no links</div></div>';
    const unit = document.querySelector<HTMLElement>('[role="article"]')!;
    expect(extractAdContent(unit)).toBeNull();
  });

  it("ignores images below the 100px real-image threshold", () => {
    const unit = loadFixture("feed-sponsored-2026-07.html");
    const img = unit.querySelector("img")!;
    img.setAttribute("width", "40");
    img.setAttribute("height", "40");
    const content = extractAdContent(unit);
    expect(content).not.toBeNull();
    expect(content!.imageUrl).toBeNull();
  });
});

describe("hashAdText", () => {
  it("is whitespace/case normalized and hex-encoded", async () => {
    const a = await hashAdText("Massive   Clearance\n Sale");
    const b = await hashAdText("massive clearance sale");
    const c = await hashAdText("different ad text");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

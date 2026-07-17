import { describe, it, expect, beforeEach } from "vitest";
import { classifyImageSrc, describeConfidence } from "@/lib/image-check-routing";
import { renderImageCheckCard } from "@/lib/image-check-card";

describe("classifyImageSrc", () => {
  it.each([
    ["https://images.example.com/a.jpg", "ok"],
    ["http://images.example.com/a.jpg", "ok"],
    ["data:image/png;base64,iVBOR=", "unsupported"],
    ["blob:https://example.com/uuid", "unsupported"],
    ["filesystem:https://example.com/temp/a.png", "unsupported"],
  ])("%s → %s", (src, expected) => {
    expect(classifyImageSrc(src)).toBe(expected);
  });
});

describe("describeConfidence (honesty guardrail)", () => {
  it("high confidence says 'likely', never a binary FAKE", () => {
    const line = describeConfidence("ai", 0.97);
    expect(line).toBe("97% likely AI-generated");
    expect(line.toLowerCase()).not.toContain("fake");
  });

  it("mid confidence hedges", () => {
    expect(describeConfidence("deepfake", 0.6)).toBe("60% — possibly a deepfake");
  });

  it("low confidence is explicitly non-alarming", () => {
    expect(describeConfidence("ai", 0.12)).toBe(
      "12% — no strong signs it's AI-generated",
    );
  });
});

describe("renderImageCheckCard", () => {
  const IMG = "https://images.example.com/feed/1.jpg";

  function card(): HTMLElement | null {
    return document.querySelector<HTMLElement>(".arthur-image-check-card");
  }

  beforeEach(() => {
    document.documentElement
      .querySelectorAll(".arthur-image-check-card")
      .forEach((n) => n.remove());
  });

  it("renders a pending card in an open shadow root", () => {
    renderImageCheckCard({ state: "pending", imageUrl: IMG });
    const host = card();
    expect(host).not.toBeNull();
    expect(host!.dataset.arthurImageUrl).toBe(IMG);
    expect(host!.shadowRoot!.innerHTML).toContain("Checking this image");
  });

  it("updates the SAME card from pending to result (no duplicate hosts)", () => {
    renderImageCheckCard({ state: "pending", imageUrl: IMG });
    renderImageCheckCard({
      state: "result",
      imageUrl: IMG,
      aiLine: "97% likely AI-generated",
      deepfakeLine: "12% — no strong signs it's a deepfake",
      generatorSource: "midjourney",
      checksRemaining: 2,
      disclaimer: "AI-detection classifiers are probabilistic.",
    });
    const hosts = document.querySelectorAll(".arthur-image-check-card");
    expect(hosts).toHaveLength(1);
    const html = (hosts[0] as HTMLElement).shadowRoot!.innerHTML;
    expect(html).toContain("97% likely AI-generated");
    expect(html).toContain("midjourney");
    expect(html).toContain("2 image checks left today");
    expect(html).not.toContain("Checking this image");
  });

  it("keeps separate cards for separate images", () => {
    renderImageCheckCard({ state: "pending", imageUrl: IMG });
    renderImageCheckCard({ state: "pending", imageUrl: "https://other.example.com/2.jpg" });
    expect(document.querySelectorAll(".arthur-image-check-card")).toHaveLength(2);
  });

  it("escapes error copy (no HTML injection from server messages)", () => {
    renderImageCheckCard({
      state: "error",
      imageUrl: IMG,
      errorMessage: '<img src=x onerror=alert(1)> failed',
    });
    const html = card()!.shadowRoot!.innerHTML;
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt; failed");
    expect(card()!.shadowRoot!.querySelector("img")).toBeNull();
  });

  it("dismiss button removes the host", () => {
    renderImageCheckCard({ state: "pending", imageUrl: IMG });
    const host = card()!;
    (host.shadowRoot!.querySelector(".close") as HTMLElement).click();
    expect(card()).toBeNull();
  });
});

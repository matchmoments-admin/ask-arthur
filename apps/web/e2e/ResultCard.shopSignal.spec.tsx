import { expect, test } from "@playwright/test";

function renderAccordionFixture(providerLabel: string): string {
  return `<!doctype html>
    <body>
      <main role="alert">
        <section aria-label="shop signal">
          <span>Shop signals</span>
          <span>Online shop detected</span>
        </section>
        <details>
          <summary>
            <span>Paid shop check</span>
            <span>${providerLabel}</span>
          </summary>
          <div>
            <p>Trust score</p>
            <p>41/100</p>
            <p>Blacklist hits</p>
            <p>0</p>
            <p>Checked</p>
            <p>2026-05-20T06:01:00.000Z</p>
          </div>
        </details>
      </main>
    </body>`;
}

const verdictCases = [
  ["SAFE", "safe", "No paid-feed risk found"],
  ["UNCERTAIN", "suspicious", "Paid feed found warning signs"],
  ["SUSPICIOUS", "suspicious", "Paid feed found warning signs"],
  ["HIGH_RISK", "risky", "Paid feed found high risk"],
] as const;

test.describe("ResultCard Shop Signal paid-provider accordion", () => {
  for (const [verdict, providerVerdict, providerLabel] of verdictCases) {
    test(`renders enriched accordion for ${verdict}`, async ({ page }) => {
      await page.setContent(renderAccordionFixture(providerLabel));

      await expect(page.getByText("Shop signals")).toBeVisible();
      await expect(page.getByText("Paid shop check")).toBeVisible();
      await expect(page.getByText(providerLabel)).toBeVisible();
      await expect(page.getByText("Trust score")).toBeHidden();

      await page.getByText("Paid shop check").click();

      await expect(page.getByText("Trust score")).toBeVisible();
      await expect(page.getByText("Blacklist hits")).toBeVisible();
      expect(providerVerdict).toMatch(/^(safe|suspicious|risky)$/);
    });
  }
});

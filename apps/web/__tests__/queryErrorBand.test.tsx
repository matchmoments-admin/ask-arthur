import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import QueryErrorBand from "@/components/admin/QueryErrorBand";

// #945: the console's most systemic defect was a failed query rendering
// identically to a healthy-empty one. The band must be invisible when nothing
// failed (so it never becomes wallpaper) and unmissable when something did.
describe("QueryErrorBand", () => {
  it("renders nothing when no query failed", () => {
    expect(renderToStaticMarkup(<QueryErrorBand errors={[]} />)).toBe("");
  });

  it("names every failed query and warns the zeros are not measurements", () => {
    const html = renderToStaticMarkup(
      <QueryErrorBand errors={["today's spend", "check stats"]} />,
    );
    expect(html).toContain("today&#x27;s spend");
    expect(html).toContain("check stats");
    expect(html).toMatch(/NOT measurements/);
    expect(html).toContain('role="alert"');
  });
});

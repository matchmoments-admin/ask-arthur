import { describe, it, expect } from "vitest";
import { checkMixedContent } from "../checks/mixed-content";

describe("checkMixedContent", () => {
  it("passes when all resources use HTTPS", () => {
    const html = `
      <html>
        <head><link rel="stylesheet" href="https://cdn.example.com/style.css"></head>
        <body>
          <img src="https://cdn.example.com/image.png">
          <script src="https://cdn.example.com/app.js"></script>
        </body>
      </html>
    `;
    const result = checkMixedContent(html, "https://example.com");
    expect(result.status).toBe("pass");
    expect(result.score).toBe(5);
  });

  it("fails when HTTP resources found on HTTPS page", () => {
    const html = `
      <html>
        <body>
          <img src="http://insecure.example.com/image.png">
          <script src="http://insecure.example.com/app.js"></script>
        </body>
      </html>
    `;
    const result = checkMixedContent(html, "https://example.com");
    expect(result.status).toBe("fail");
    expect(result.score).toBe(0);
    expect(result.details).toContain("2 insecure resource");
  });

  it("skips for HTTP pages", () => {
    const html = '<html><body><img src="http://example.com/img.png"></body></html>';
    const result = checkMixedContent(html, "http://example.com");
    expect(result.status).toBe("skipped");
  });

  it("detects mixed content in iframes", () => {
    const html = '<html><body><iframe src="http://evil.com/page"></iframe></body></html>';
    const result = checkMixedContent(html, "https://example.com");
    expect(result.status).toBe("fail");
  });

  it("detects mixed content in form actions", () => {
    const html = '<html><body><form action="http://example.com/submit"></form></body></html>';
    const result = checkMixedContent(html, "https://example.com");
    expect(result.status).toBe("fail");
  });

  it("passes with empty HTML", () => {
    const result = checkMixedContent("", "https://example.com");
    expect(result.status).toBe("pass");
  });
});

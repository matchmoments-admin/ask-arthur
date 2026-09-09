import { afterEach, expect, it, vi } from "vitest";
import { createTextPost } from "../lib/linkedin/client";
const options = { commentary: "Saved text", accessToken: "test", authorUrn: "urn:li:organization:114874091" };
afterEach(() => vi.unstubAllGlobals());
it("uses the versioned Posts API and requires a receipt", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 201, headers: { "x-restli-id": "urn:li:share:123" } }));
  vi.stubGlobal("fetch", fetcher);
  expect(await createTextPost(options)).toBe("urn:li:share:123");
  const [url, init] = fetcher.mock.calls[0];
  expect(url).toBe("https://api.linkedin.com/rest/posts");
  expect(init.signal).toBeInstanceOf(AbortSignal);
  expect(JSON.parse(init.body)).toMatchObject({ author: options.authorUrn, commentary: options.commentary, lifecycleState: "PUBLISHED", visibility: "PUBLIC" });
});
it.each([201, 403, 429, 500])("does not retry or expose provider details on unconfirmed status %s", async status => {
  const fetcher = vi.fn().mockResolvedValue(new Response("private provider details", { status }));
  vi.stubGlobal("fetch", fetcher);
  await expect(createTextPost(options)).rejects.toThrow("linkedin_publish_unconfirmed");
  expect(fetcher).toHaveBeenCalledTimes(1);
});

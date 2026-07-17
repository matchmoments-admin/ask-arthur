/**
 * Extension API dev client — exercise the signed /api/extension/* surface
 * from the terminal, with no Chrome and no unpacked extension.
 *
 * Why this exists: every extension route is gated by a per-install ECDSA
 * signature (apps/web/app/api/extension/_lib/signature.ts), so you cannot
 * curl them. This mirrors the extension's identity + signing logic
 * (src/lib/identity.ts + src/lib/sign.ts) against a local dev server, which
 * makes the whole server path testable in seconds. Chrome is then only
 * needed to verify the CARD UI, not the API.
 *
 * Usage (from repo root):
 *   pnpm --filter @askarthur/web ext:dev register
 *   pnpm --filter @askarthur/web ext:dev POST /api/extension/analyze-image '{"imageUrl":"https://example.com/a.jpg"}'
 *   pnpm --filter @askarthur/web ext:dev POST /api/extension/link-token '{}'
 *   pnpm --filter @askarthur/web ext:dev GET  /api/extension/subscription
 *
 * Target defaults to http://localhost:3000; override with EXT_DEV_BASE
 * (e.g. a Vercel preview URL for the pre-prod rehearsal).
 *
 * The keypair + install id persist in apps/web/.dev-extension-identity.json
 * (gitignored) so repeat runs reuse one registered install — the same way a
 * real browser profile would. Delete that file to simulate a fresh install.
 */
import "dotenv/config";
import { webcrypto } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const BASE = (process.env.EXT_DEV_BASE ?? "http://localhost:3000").replace(/\/+$/, "");
const IDENTITY_FILE = path.resolve(process.cwd(), ".dev-extension-identity.json");

interface Identity {
  installId: string;
  privateKeyJwk: JsonWebKey;
  publicKeyJwk: JsonWebKey;
}

async function loadOrCreateIdentity(): Promise<{ identity: Identity; created: boolean }> {
  if (existsSync(IDENTITY_FILE)) {
    return {
      identity: JSON.parse(readFileSync(IDENTITY_FILE, "utf8")) as Identity,
      created: false,
    };
  }
  const kp = (await webcrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true, // extractable — unlike the real extension, we must persist it to a file
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const identity: Identity = {
    installId: webcrypto.randomUUID(),
    privateKeyJwk: await webcrypto.subtle.exportKey("jwk", kp.privateKey),
    publicKeyJwk: await webcrypto.subtle.exportKey("jwk", kp.publicKey),
  };
  writeFileSync(IDENTITY_FILE, JSON.stringify(identity, null, 2));
  console.log(`🔑 New identity → ${IDENTITY_FILE}`);
  return { identity, created: true };
}

async function register(identity: Identity): Promise<void> {
  const res = await fetch(`${BASE}/api/extension/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      installId: identity.installId,
      publicKeyJwk: identity.publicKeyJwk,
      // Turnstile fail-opens when TURNSTILE_SECRET_KEY is unset (dev only —
      // it hard-fails in production), so any ≥10-char placeholder passes the
      // Zod shape check locally.
      turnstileToken: "dev-placeholder-token",
    }),
  });
  const body = await res.text();
  if (!res.ok) {
    console.error(`❌ register → ${res.status}: ${body}`);
    process.exit(1);
  }
  console.log(`✅ registered install ${identity.installId}`);
}

/**
 * Mirrors apps/extension/src/lib/sign.ts exactly. Exported so
 * __tests__/extensionDevClient.test.ts can prove the signature this
 * produces is accepted by the real server verifier — if these two ever
 * drift, every local test session dies on an opaque 401.
 */
export async function signHeaders(
  identity: Identity,
  method: string,
  pathname: string,
  body: string,
): Promise<Record<string, string>> {
  const key = await webcrypto.subtle.importKey(
    "jwk",
    identity.privateKeyJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = webcrypto.randomUUID();
  const bodyHash = Buffer.from(
    await webcrypto.subtle.digest("SHA-256", Buffer.from(body, "utf8")),
  ).toString("base64");
  // Canonical string: METHOD\npath\ntimestamp\nnonce\nbase64(sha256(body)).
  // The path is the PATHNAME ONLY — no query string (server parses it the
  // same way); getting this wrong is the classic 401 here.
  const canonical = `${method.toUpperCase()}\n${pathname}\n${timestamp}\n${nonce}\n${bodyHash}`;
  const sig = await webcrypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    Buffer.from(canonical, "utf8"),
  );
  return {
    "Content-Type": "application/json",
    "X-Extension-Install-Id": identity.installId,
    "X-Extension-Timestamp": timestamp,
    "X-Extension-Nonce": nonce,
    "X-Extension-Signature": Buffer.from(sig).toString("base64"),
  };
}

async function send(
  identity: Identity,
  method: string,
  rawPath: string,
  body: string,
): Promise<void> {
  const pathname = rawPath.split("?")[0]!;
  const headers = await signHeaders(identity, method, pathname, body);
  const res = await fetch(`${BASE}${rawPath}`, {
    method: method.toUpperCase(),
    headers,
    ...(method.toUpperCase() === "GET" ? {} : { body }),
  });

  const remaining = res.headers.get("X-RateLimit-Remaining");
  const retryAfter = res.headers.get("Retry-After");
  console.log(
    `\n${res.ok ? "✅" : "❌"} ${method.toUpperCase()} ${rawPath} → ${res.status}` +
      (remaining ? `  (rate-limit remaining: ${remaining})` : "") +
      (retryAfter ? `  (retry after: ${retryAfter}s)` : ""),
  );
  const text = await res.text();
  try {
    console.dir(JSON.parse(text), { depth: null, colors: true });
  } catch {
    console.log(text);
  }
}

async function main(): Promise<void> {
  const [cmd, maybePath, maybeBody] = process.argv.slice(2);
  if (!cmd) {
    console.error(
      "Usage:\n" +
        "  ext:dev register\n" +
        '  ext:dev POST /api/extension/analyze-image \'{"imageUrl":"https://…"}\'\n' +
        "  ext:dev GET  /api/extension/subscription",
    );
    process.exit(1);
  }

  console.log(`🎯 target: ${BASE}`);
  const { identity, created } = await loadOrCreateIdentity();

  if (cmd.toLowerCase() === "register") {
    await register(identity);
    return;
  }

  // A brand-new identity is unknown to the server — register it first so the
  // first real call doesn't 401 on "Unknown install id".
  if (created) await register(identity);

  if (!maybePath) {
    console.error("Missing path (e.g. /api/extension/analyze-image)");
    process.exit(1);
  }
  await send(identity, cmd, maybePath, maybeBody ?? "{}");
}

// Only run the CLI when invoked directly — the test imports signHeaders.
if (process.argv[1]?.includes("extension-dev-client")) {
  main().catch((err) => {
    console.error("dev client error:", err);
    process.exit(1);
  });
}

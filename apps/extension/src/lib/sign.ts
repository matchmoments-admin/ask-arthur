import { getOrCreateKeypair } from "./identity";

export interface SignedHeaders {
  "X-Extension-Install-Id": string;
  "X-Extension-Timestamp": string;
  "X-Extension-Nonce": string;
  "X-Extension-Signature": string;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

async function sha256Base64(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return bytesToBase64(new Uint8Array(buf));
}

export async function signRequest(
  installId: string,
  method: string,
  path: string,
  body: string
): Promise<SignedHeaders> {
  const { privateKey } = await getOrCreateKeypair();
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomUUID();
  const bodyHash = await sha256Base64(body);
  const canonical = `${method.toUpperCase()}\n${path}\n${timestamp}\n${nonce}\n${bodyHash}`;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    new TextEncoder().encode(canonical)
  );
  return {
    "X-Extension-Install-Id": installId,
    "X-Extension-Timestamp": timestamp,
    "X-Extension-Nonce": nonce,
    "X-Extension-Signature": bytesToBase64(new Uint8Array(signature)),
  };
}

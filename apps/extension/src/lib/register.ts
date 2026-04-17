import { getOrCreateKeypair } from "./identity";
import { getInstallId, setInstallId, getRegistered, setRegistered } from "./storage";

const API_BASE = "https://askarthur.au/api/extension";
const OFFSCREEN_PATH = "offscreen.html";
const TOKEN_TIMEOUT_MS = 120_000;

interface TurnstileTokenMessage {
  type: "askarthur-turnstile-token";
  token: string;
}

interface TurnstileErrorMessage {
  type: "askarthur-turnstile-error";
  reason: string;
}

type TurnstileMessage = TurnstileTokenMessage | TurnstileErrorMessage;

let inFlight: Promise<void> | null = null;

async function ensureInstallId(): Promise<string> {
  const existing = await getInstallId();
  if (existing) return existing;
  const id = crypto.randomUUID();
  await setInstallId(id);
  return id;
}

async function hasOffscreen(): Promise<boolean> {
  // chrome.offscreen.hasDocument was added in Chrome 116. Fall back to a probe
  // on chrome.runtime.getContexts if needed.
  const off = (chrome as unknown as {
    offscreen?: { hasDocument?: () => Promise<boolean> };
  }).offscreen;
  if (!off?.hasDocument) return false;
  try {
    return await off.hasDocument();
  } catch {
    return false;
  }
}

async function openOffscreen(): Promise<void> {
  const off = (chrome as unknown as {
    offscreen?: {
      createDocument: (args: {
        url: string;
        reasons: string[];
        justification: string;
      }) => Promise<void>;
      closeDocument?: () => Promise<void>;
    };
  }).offscreen;
  if (!off) throw new Error("chrome.offscreen unavailable");
  if (await hasOffscreen()) return;
  await off.createDocument({
    url: OFFSCREEN_PATH,
    reasons: ["IFRAME_SCRIPTING"],
    justification:
      "Load Cloudflare Turnstile on askarthur.au to obtain a one-time bot-check token for extension registration.",
  });
}

async function closeOffscreen(): Promise<void> {
  const off = (chrome as unknown as {
    offscreen?: { closeDocument?: () => Promise<void> };
  }).offscreen;
  try {
    await off?.closeDocument?.();
  } catch {
    // Ignore — closing is best-effort.
  }
}

async function fetchTurnstileToken(): Promise<string> {
  await openOffscreen();

  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener);
      reject(new Error("Turnstile timeout"));
    }, TOKEN_TIMEOUT_MS);

    const listener = (msg: TurnstileMessage) => {
      if (msg?.type === "askarthur-turnstile-token") {
        clearTimeout(timer);
        chrome.runtime.onMessage.removeListener(listener);
        resolve(msg.token);
      } else if (msg?.type === "askarthur-turnstile-error") {
        clearTimeout(timer);
        chrome.runtime.onMessage.removeListener(listener);
        reject(new Error(`Turnstile error: ${msg.reason}`));
      }
    };
    chrome.runtime.onMessage.addListener(listener);
  });
}

async function runRegistration(): Promise<void> {
  const installId = await ensureInstallId();
  const { publicKeyJwk } = await getOrCreateKeypair();

  const token = await fetchTurnstileToken();

  try {
    const res = await fetch(`${API_BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        installId,
        publicKeyJwk,
        turnstileToken: token,
      }),
    });
    if (!res.ok) {
      throw new Error(`Register failed: ${res.status}`);
    }
    await setRegistered(true);
  } finally {
    await closeOffscreen();
  }
}

export async function ensureRegistered(): Promise<boolean> {
  if (await getRegistered()) return true;

  if (!inFlight) {
    inFlight = runRegistration().catch((err) => {
      console.warn("[askarthur] registration failed", err);
    });
  }
  try {
    await inFlight;
  } finally {
    inFlight = null;
  }
  return (await getRegistered()) === true;
}


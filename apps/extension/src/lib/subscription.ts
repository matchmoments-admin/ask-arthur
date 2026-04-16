const STORAGE_KEY = "arthur_subscription";

interface SubscriptionState {
  tier: "free" | "pro";
  installId: string;
  checkedAt: number;
}

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Get current subscription state from local storage.
 */
export async function getSubscription(): Promise<SubscriptionState | null> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as SubscriptionState | undefined) ?? null;
}

/**
 * Save subscription state to local storage.
 */
export async function setSubscription(
  state: SubscriptionState
): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

/**
 * Check subscription status from the server.
 * Caches result for CHECK_INTERVAL_MS.
 */
export async function checkSubscription(
  installId: string,
  apiBase: string,
  secret: string
): Promise<SubscriptionState> {
  const cached = await getSubscription();

  // Return cached if fresh enough
  if (cached && Date.now() - cached.checkedAt < CHECK_INTERVAL_MS) {
    return cached;
  }

  try {
    const res = await fetch(
      `${apiBase}/api/extension/subscription?installId=${encodeURIComponent(installId)}`,
      {
        headers: {
          "X-Extension-Secret": secret,
          "X-Extension-Id": installId,
        },
      }
    );

    if (res.ok) {
      const data = await res.json();
      const state: SubscriptionState = {
        tier: data.tier ?? "free",
        installId,
        checkedAt: Date.now(),
      };
      await setSubscription(state);
      return state;
    }
  } catch {
    // Network error — return cached or default to free
  }

  const fallback: SubscriptionState = {
    tier: cached?.tier ?? "free",
    installId,
    checkedAt: Date.now(),
  };
  await setSubscription(fallback);
  return fallback;
}

/**
 * Check if the current user has pro tier.
 */
export async function isPro(): Promise<boolean> {
  const sub = await getSubscription();
  return sub?.tier === "pro";
}

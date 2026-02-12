// URL reputation checks via Google Safe Browsing + VirusTotal
// Uses Promise.allSettled so failures don't block each other

export interface URLCheckResult {
  url: string;
  isMalicious: boolean;
  sources: string[];
}

// Extract URLs from text
export function extractURLs(text: string): string[] {
  const urlRegex = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;
  const matches = text.match(urlRegex) || [];
  return [...new Set(matches)]; // dedupe
}

async function checkGoogleSafeBrowsing(urls: string[]): Promise<Set<string>> {
  const apiKey = process.env.GOOGLE_SAFE_BROWSING_API_KEY;
  if (!apiKey || urls.length === 0) return new Set();

  const malicious = new Set<string>();

  try {
    const res = await fetch(
      `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client: { clientId: "askarthur", clientVersion: "1.0" },
          threatInfo: {
            threatTypes: [
              "MALWARE",
              "SOCIAL_ENGINEERING",
              "UNWANTED_SOFTWARE",
              "POTENTIALLY_HARMFUL_APPLICATION",
            ],
            platformTypes: ["ANY_PLATFORM"],
            threatEntryTypes: ["URL"],
            threatEntries: urls.map((url) => ({ url })),
          },
        }),
        signal: AbortSignal.timeout(5000),
      }
    );

    if (res.ok) {
      const data = await res.json();
      if (data.matches) {
        for (const match of data.matches) {
          malicious.add(match.threat.url);
        }
      }
    }
  } catch {
    // Non-blocking: log but don't fail
    console.warn("Google Safe Browsing check failed");
  }

  return malicious;
}

async function checkVirusTotal(urls: string[]): Promise<Set<string>> {
  const apiKey = process.env.VIRUSTOTAL_API_KEY;
  if (!apiKey || urls.length === 0) return new Set();

  const malicious = new Set<string>();

  // VirusTotal has rate limits, check up to 4 URLs
  const urlsToCheck = urls.slice(0, 4);

  await Promise.allSettled(
    urlsToCheck.map(async (url) => {
      try {
        // URL must be base64url-encoded without padding
        const urlId = btoa(url).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
        const res = await fetch(
          `https://www.virustotal.com/api/v3/urls/${urlId}`,
          {
            headers: { "x-apikey": apiKey },
            signal: AbortSignal.timeout(5000),
          }
        );

        if (res.ok) {
          const data = await res.json();
          const stats = data.data?.attributes?.last_analysis_stats;
          if (stats && stats.malicious + stats.suspicious > 2) {
            malicious.add(url);
          }
        }
      } catch {
        // Non-blocking
      }
    })
  );

  return malicious;
}

export async function checkURLReputation(
  urls: string[]
): Promise<URLCheckResult[]> {
  if (urls.length === 0) return [];

  // Run both checks in parallel — failures don't block each other
  const [googleResult, vtResult] = await Promise.allSettled([
    checkGoogleSafeBrowsing(urls),
    checkVirusTotal(urls),
  ]);

  const googleMalicious =
    googleResult.status === "fulfilled" ? googleResult.value : new Set<string>();
  const vtMalicious =
    vtResult.status === "fulfilled" ? vtResult.value : new Set<string>();

  return urls.map((url) => {
    const sources: string[] = [];
    if (googleMalicious.has(url)) sources.push("Google Safe Browsing");
    if (vtMalicious.has(url)) sources.push("VirusTotal");
    return {
      url,
      isMalicious: sources.length > 0,
      sources,
    };
  });
}

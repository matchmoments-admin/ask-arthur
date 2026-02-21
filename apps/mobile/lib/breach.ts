import { API_URL } from "@/constants/config";

export interface BreachResult {
  breached: boolean;
  breachCount: number;
  breaches: Array<{
    name: string;
    title: string;
    domain: string;
    date: string;
    dataTypes: string[];
  }>;
}

/**
 * Check if an email has been in data breaches via /api/breach-check.
 */
export async function checkBreach(email: string): Promise<BreachResult> {
  const response = await fetch(`${API_URL}/api/breach-check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ message: "Breach check failed" }));
    throw new Error(err.message ?? "Breach check failed");
  }

  return response.json();
}

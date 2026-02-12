import { NextRequest } from "next/server";
import { createServiceClient } from "./supabase";

export interface ApiKeyValidation {
  valid: boolean;
  orgName?: string;
  tier?: string;
}

async function hashKey(key: string): Promise<string> {
  const data = new TextEncoder().encode(key);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function validateApiKey(
  req: NextRequest
): Promise<ApiKeyValidation> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { valid: false };
  }

  const key = authHeader.slice(7);
  if (!key) return { valid: false };

  const supabase = createServiceClient();
  if (!supabase) return { valid: false };

  const keyHash = await hashKey(key);

  const { data, error } = await supabase
    .from("api_keys")
    .select("org_name, tier, is_active, daily_limit")
    .eq("key_hash", keyHash)
    .single();

  if (error || !data || !data.is_active) {
    return { valid: false };
  }

  // Update last_used_at (fire-and-forget)
  supabase
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("key_hash", keyHash)
    .then(() => {});

  return {
    valid: true,
    orgName: data.org_name,
    tier: data.tier,
  };
}

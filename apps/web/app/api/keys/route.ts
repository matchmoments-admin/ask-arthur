import { NextRequest, NextResponse } from "next/server";
import { createAuthServerClient } from "@askarthur/supabase/server-auth";
import { createServiceClient } from "@askarthur/supabase/server";
import crypto from "crypto";

async function hashKey(key: string): Promise<string> {
  const data = new TextEncoder().encode(key);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function generateRawKey(): string {
  // Generate 32 bytes of randomness, base62 encode for URL-safe keys
  const bytes = crypto.randomBytes(32);
  const chars =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let result = "aa_";
  for (const byte of bytes) {
    result += chars[byte % chars.length];
  }
  return result;
}

export async function POST(req: NextRequest) {
  const supabase = await createAuthServerClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Auth not configured" },
      { status: 500 }
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let orgName = "Personal";
  try {
    const body = await req.json();
    if (typeof body.orgName === "string" && body.orgName.trim()) {
      orgName = body.orgName.trim().slice(0, 100);
    }
  } catch {
    // Use default org name
  }

  const rawKey = generateRawKey();
  const keyHash = await hashKey(rawKey);

  // Use service client for the RPC (SECURITY DEFINER enforces 5 key limit)
  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 500 }
    );
  }

  const { data, error } = await serviceClient.rpc("generate_api_key_record", {
    p_user_id: user.id,
    p_key_hash: keyHash,
    p_org_name: orgName,
  });

  if (error) {
    const isMaxKeys = error.message?.includes("Maximum 5 active API keys");
    return NextResponse.json(
      {
        error: isMaxKeys
          ? "Maximum 5 active API keys per account"
          : "Failed to create API key",
      },
      { status: isMaxKeys ? 409 : 500 }
    );
  }

  const record = Array.isArray(data) ? data[0] : data;

  return NextResponse.json({
    key: rawKey,
    record,
    warning: "Store this key securely. It will not be shown again.",
  });
}

export async function GET() {
  const supabase = await createAuthServerClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Auth not configured" },
      { status: 500 }
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // RLS enforced — only returns user's own keys
  const { data, error } = await supabase
    .from("api_keys")
    .select(
      "id, org_name, tier, daily_limit, is_active, last_used_at, created_at"
    )
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: "Failed to fetch keys" },
      { status: 500 }
    );
  }

  return NextResponse.json({ keys: data });
}

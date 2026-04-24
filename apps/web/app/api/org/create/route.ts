import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { createAuthServerClient } from "@askarthur/supabase/server-auth";
import { createServiceClient } from "@askarthur/supabase/server";

const CreateOrgSchema = z.object({
  name: z.string().min(1).max(200),
  abn: z.string().regex(/^\d{11}$/).optional(),
  sector: z.string().max(100).optional(),
  roleTitle: z.string().max(100).optional(),
  abnVerified: z.boolean().optional(),
  abnEntityName: z.string().max(300).optional(),
  invites: z
    .array(z.object({ email: z.string().email(), role: z.string().max(50) }))
    .max(10)
    .optional(),
});

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

async function hashKey(key: string): Promise<string> {
  const data = new TextEncoder().encode(key);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function generateRawKey(): string {
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = CreateOrgSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const { name, abn, sector, roleTitle, abnVerified, abnEntityName, invites } =
    parsed.data;
  const slug = generateSlug(name);

  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 500 }
    );
  }

  const { data: orgData, error: orgError } = await serviceClient.rpc(
    "create_organization",
    {
      p_name: name,
      p_slug: slug,
      p_owner_id: user.id,
      p_abn: abn ?? null,
      p_sector: sector ?? null,
      p_role_title: roleTitle ?? null,
      p_abn_verified: abnVerified ?? false,
      p_abn_entity_name: abnEntityName ?? null,
    }
  );

  if (orgError) {
    return NextResponse.json(
      { error: orgError.message || "Failed to create organization" },
      { status: 500 }
    );
  }

  const org = Array.isArray(orgData) ? orgData[0] : orgData;
  const orgId = org?.id ?? org;

  const rawKey = generateRawKey();
  const keyHash = await hashKey(rawKey);

  const { error: keyError } = await serviceClient.rpc(
    "generate_org_api_key",
    {
      p_org_id: orgId,
      p_user_id: user.id,
      p_key_hash: keyHash,
      p_org_name: name,
    }
  );

  if (keyError) {
    return NextResponse.json(
      { error: "Organization created but API key generation failed" },
      { status: 500 }
    );
  }

  return NextResponse.json(
    { orgId, orgSlug: slug, apiKey: rawKey, invites: invites ?? [] },
    { status: 201 }
  );
}

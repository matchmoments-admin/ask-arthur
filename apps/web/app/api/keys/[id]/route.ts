import { NextRequest, NextResponse } from "next/server";
import { createAuthServerClient } from "@askarthur/supabase/server-auth";
import { getUser, AuthUnavailableError } from "@/lib/auth";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Auth check via lib/auth (5s timeout + AuthUnavailableError) — incident 2026-05-09.
  let user;
  try {
    user = await getUser();
  } catch (err) {
    if (err instanceof AuthUnavailableError) {
      return NextResponse.json(
        { error: "Authentication temporarily unavailable" },
        { status: 503, headers: { "Retry-After": "30" } },
      );
    }
    throw err;
  }
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const keyId = parseInt(id, 10);
  if (isNaN(keyId)) {
    return NextResponse.json({ error: "Invalid key ID" }, { status: 400 });
  }

  // Auth-bound client for the RLS-enforced UPDATE below.
  const supabase = await createAuthServerClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Auth not configured" },
      { status: 500 }
    );
  }

  // RLS enforced — user can only update their own keys
  const { error } = await supabase
    .from("api_keys")
    .update({ is_active: false })
    .eq("id", keyId);

  if (error) {
    return NextResponse.json(
      { error: "Failed to revoke key" },
      { status: 500 }
    );
  }

  return NextResponse.json({ revoked: true });
}

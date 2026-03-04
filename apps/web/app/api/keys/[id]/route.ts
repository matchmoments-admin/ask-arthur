import { NextRequest, NextResponse } from "next/server";
import { createAuthServerClient } from "@askarthur/supabase/server-auth";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

  const { id } = await params;
  const keyId = parseInt(id, 10);
  if (isNaN(keyId)) {
    return NextResponse.json({ error: "Invalid key ID" }, { status: 400 });
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

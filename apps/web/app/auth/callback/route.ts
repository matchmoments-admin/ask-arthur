import { NextRequest, NextResponse } from "next/server";
import { createAuthServerClient } from "@askarthur/supabase/server-auth";
import { safeNextPath } from "@/lib/safe-redirect";

export async function GET(req: NextRequest) {
  const { searchParams, origin } = req.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next");

  if (code) {
    const supabase = await createAuthServerClient();
    if (supabase) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) {
        return NextResponse.redirect(new URL(safeNextPath(next), origin));
      }
    }
  }

  // Redirect to login on error
  return NextResponse.redirect(`${origin}/login`);
}

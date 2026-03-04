import { NextRequest, NextResponse } from "next/server";
import { createAuthServerClient } from "@askarthur/supabase/server-auth";

export async function GET(req: NextRequest) {
  const { searchParams, origin } = req.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/app";

  if (code) {
    const supabase = await createAuthServerClient();
    if (supabase) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) {
        return NextResponse.redirect(`${origin}${next}`);
      }
    }
  }

  // Redirect to login on error
  return NextResponse.redirect(`${origin}/login`);
}

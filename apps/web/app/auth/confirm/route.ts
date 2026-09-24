import { NextRequest, NextResponse } from "next/server";
import { createAuthServerClient } from "@askarthur/supabase/server-auth";
import { safeNextPath } from "@/lib/safe-redirect";
import type { EmailOtpType } from "@supabase/supabase-js";

export async function GET(req: NextRequest) {
  const { searchParams, origin } = req.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next");

  if (tokenHash && type) {
    const supabase = await createAuthServerClient();
    if (supabase) {
      const { error } = await supabase.auth.verifyOtp({
        type,
        token_hash: tokenHash,
      });
      if (!error) {
        return NextResponse.redirect(new URL(safeNextPath(next), origin));
      }
    }
  }

  return NextResponse.redirect(`${origin}/login`);
}

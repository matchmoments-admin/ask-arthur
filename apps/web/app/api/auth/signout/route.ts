import { NextResponse } from "next/server";
import { createAuthServerClient } from "@askarthur/supabase/server-auth";

export async function POST() {
  const supabase = await createAuthServerClient();

  if (supabase) {
    await supabase.auth.signOut();
  }

  return NextResponse.redirect(new URL("/", process.env.NEXT_PUBLIC_SITE_URL ?? "https://askarthur.au"), {
    status: 302,
  });
}

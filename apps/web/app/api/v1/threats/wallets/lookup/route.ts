import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@askarthur/supabase/server";
import { validateApiKey } from "@/lib/apiAuth";
import { jsonV1 } from "@/app/api/v1/_lib/json-response";

export async function GET(req: NextRequest) {
  const authResult = await validateApiKey(req, "threats.read");
  if (!authResult.valid) {
    return NextResponse.json(
      { error: authResult.rateLimited ? "Rate limited" : "Invalid API key" },
      { status: authResult.rateLimited ? 429 : 401 }
    );
  }

  const address = req.nextUrl.searchParams.get("address");
  if (!address || address.length < 10) {
    return NextResponse.json({ error: "Provide a crypto wallet address (min 10 chars)." }, { status: 400 });
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Service unavailable." }, { status: 503 });
  }

  const { data, error } = await supabase
    .from("scam_crypto_wallets")
    .select("address, chain, report_count, confidence_score, confidence_level, first_reported_at, last_reported_at, country_code")
    .eq("address", address.trim())
    .single();

  if (error || !data) {
    return jsonV1({ found: false, address: address.trim() });
  }

  return jsonV1({
    found: true,
    wallet: data,
  }, {
    headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60" },
  });
}

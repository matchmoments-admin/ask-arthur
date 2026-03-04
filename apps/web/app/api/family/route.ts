import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@askarthur/supabase/server";
import { createAuthServerClient } from "@askarthur/supabase/server-auth";
import { logger } from "@askarthur/utils/logger";
import { featureFlags } from "@askarthur/utils/feature-flags";

export async function GET(req: NextRequest) {
  if (!featureFlags.familyPlan) {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }

  const authClient = await createAuthServerClient();
  if (!authClient) {
    return NextResponse.json({ error: "Auth not configured" }, { status: 503 });
  }

  const { data: { user } } = await authClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  const { data, error } = await supabase
    .from("family_groups")
    .select(`
      *,
      family_members (id, email, role, joined_at)
    `)
    .eq("owner_id", user.id);

  if (error) {
    logger.error("Failed to fetch family groups", { error });
    return NextResponse.json({ error: "Failed to fetch" }, { status: 500 });
  }

  return NextResponse.json({ groups: data ?? [] });
}

export async function POST(req: NextRequest) {
  if (!featureFlags.familyPlan) {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }

  const authClient = await createAuthServerClient();
  if (!authClient) {
    return NextResponse.json({ error: "Auth not configured" }, { status: 503 });
  }

  const { data: { user } } = await authClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { name: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.name || body.name.length < 1 || body.name.length > 50) {
    return NextResponse.json({ error: "Invalid name" }, { status: 400 });
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  const { data, error } = await supabase
    .from("family_groups")
    .insert({ name: body.name, owner_id: user.id })
    .select()
    .single();

  if (error) {
    logger.error("Failed to create family group", { error });
    return NextResponse.json({ error: "Creation failed" }, { status: 500 });
  }

  return NextResponse.json({ group: data }, { status: 201 });
}

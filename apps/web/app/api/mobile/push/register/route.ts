import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { z } from "zod";

const RegisterSchema = z.object({
  expoToken: z.string().startsWith("ExponentPushToken[").or(z.string().startsWith("ExpoPushToken[")),
  platform: z.enum(["ios", "android"]),
  deviceId: z.string().min(10).max(100),
  region: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Service unavailable" },
      { status: 503 }
    );
  }

  let body: z.infer<typeof RegisterSchema>;
  try {
    body = RegisterSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }

  // Extract user_id from auth header if present (Security Fix #6: device binding)
  let userId: string | null = null;
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    try {
      const { data: { user } } = await supabase.auth.getUser(authHeader.slice(7));
      userId = user?.id ?? null;
    } catch {
      // Anonymous registration — continue without user binding
    }
  }

  try {
    const { error } = await supabase.rpc("upsert_push_token", {
      p_expo_token: body.expoToken,
      p_platform: body.platform,
      p_device_id: body.deviceId,
      p_region: body.region ?? null,
      ...(userId ? { p_user_id: userId } : {}),
    });

    if (error) {
      logger.error("Failed to register push token", { error });
      return NextResponse.json(
        { error: "Registration failed" },
        { status: 500 }
      );
    }

    return NextResponse.json({ registered: true });
  } catch (err) {
    logger.error("Push token registration error", { error: err });
    return NextResponse.json(
      { error: "Internal error" },
      { status: 500 }
    );
  }
}

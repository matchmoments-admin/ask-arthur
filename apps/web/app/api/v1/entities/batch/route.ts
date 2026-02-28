import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/apiAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import type { EntityType } from "@askarthur/types";
import { logger } from "@askarthur/utils/logger";

const VALID_ENTITY_TYPES: Set<string> = new Set([
  "phone",
  "email",
  "url",
  "domain",
  "ip",
  "crypto_wallet",
  "bank_account",
]);

const MAX_BATCH_SIZE = 100;

interface BatchItem {
  type: EntityType;
  value: string;
}

export async function POST(req: NextRequest) {
  const auth = await validateApiKey(req);
  if (!auth.valid) {
    return NextResponse.json(
      { error: "Invalid or missing API key" },
      { status: 401 }
    );
  }
  if (auth.rateLimited) {
    return NextResponse.json(
      { error: "Daily API limit exceeded. Resets at midnight UTC." },
      { status: 429, headers: { "Retry-After": "3600" } }
    );
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  let body: { entities?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  if (!Array.isArray(body.entities) || body.entities.length === 0) {
    return NextResponse.json(
      { error: "Request body must contain a non-empty 'entities' array" },
      { status: 400 }
    );
  }

  if (body.entities.length > MAX_BATCH_SIZE) {
    return NextResponse.json(
      { error: `Maximum batch size is ${MAX_BATCH_SIZE}` },
      { status: 400 }
    );
  }

  // Validate each item
  const items: BatchItem[] = [];
  for (let i = 0; i < body.entities.length; i++) {
    const item = body.entities[i] as Record<string, unknown>;
    if (
      !item ||
      typeof item.type !== "string" ||
      !VALID_ENTITY_TYPES.has(item.type) ||
      typeof item.value !== "string" ||
      !item.value.trim()
    ) {
      return NextResponse.json(
        {
          error: `Invalid entity at index ${i}. Each item must have a valid 'type' and non-empty 'value'.`,
        },
        { status: 400 }
      );
    }
    items.push({ type: item.type as EntityType, value: item.value.trim() });
  }

  try {
    // Build OR filter for all entities
    // Supabase doesn't support multi-column IN, so we query per type
    const byType = new Map<string, string[]>();
    for (const item of items) {
      const values = byType.get(item.type) || [];
      values.push(item.value);
      byType.set(item.type, values);
    }

    const allEntities: Record<
      string,
      {
        id: number;
        reportCount: number;
        firstSeen: string;
        lastSeen: string;
        riskScore: number;
        riskLevel: string;
      }
    > = {};

    // Query each entity type (typically 1-3 types in a batch)
    await Promise.all(
      Array.from(byType.entries()).map(async ([entityType, values]) => {
        const { data, error } = await supabase
          .from("scam_entities")
          .select(
            "id, entity_type, normalized_value, report_count, first_seen, last_seen, risk_score, risk_level"
          )
          .eq("entity_type", entityType)
          .in("normalized_value", values);

        if (error) {
          logger.error("Batch lookup query failed", {
            entityType,
            error: String(error),
          });
          return;
        }

        for (const row of data || []) {
          const key = `${row.entity_type}:${row.normalized_value}`;
          allEntities[key] = {
            id: row.id,
            reportCount: row.report_count,
            firstSeen: row.first_seen,
            lastSeen: row.last_seen,
            riskScore: row.risk_score,
            riskLevel: row.risk_level,
          };
        }
      })
    );

    // Map results back to input order
    const results = items.map((item) => {
      const key = `${item.type}:${item.value}`;
      const match = allEntities[key];
      if (match) {
        return {
          type: item.type,
          value: item.value,
          found: true,
          entityId: match.id,
          reportCount: match.reportCount,
          firstSeen: match.firstSeen,
          lastSeen: match.lastSeen,
          riskScore: match.riskScore,
          riskLevel: match.riskLevel,
        };
      }
      return { type: item.type, value: item.value, found: false };
    });

    const foundCount = results.filter((r) => r.found).length;

    return NextResponse.json({
      total: items.length,
      found: foundCount,
      results,
    });
  } catch (err) {
    logger.error("Batch entity lookup error", { error: String(err) });
    return NextResponse.json(
      { error: "Failed to perform batch lookup" },
      { status: 500 }
    );
  }
}

// Shared-scan-by-token lookup, extracted from
// apps/web/app/scan/result/[token]/page.tsx.
//
// React.cache wrap is at this definition site — generateMetadata + the
// default export share one scan_results lookup per request. The wrap
// MUST stay here; recreating cache(...) at the callsite would break
// request-scope dedup.

import "server-only";

import { cache } from "react";
import { createServiceClient } from "@askarthur/supabase/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const getScanByToken = cache(async (token: string) => {
  if (!UUID_RE.test(token)) return null;
  const supabase = createServiceClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("scan_results")
    .select("*")
    .eq("share_token", token)
    .single();

  if (error || !data) return null;
  return data;
});

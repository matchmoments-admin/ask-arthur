// Pure helper: build the /charity-check deep-link from charity-intent
// detection output (v0.2e). Extracted from ResultCard so the mode logic is
// unit-testable — the mode=abn rule exists because CharityChecker reads its
// active tab from ?mode= alone: without it an ABN-only deep-link opened the
// Name tab with the prefilled ABN invisible and submit disabled (dead end).
export function buildCharityCheckHref(intent: {
  extractedAbn?: string;
  extractedName?: string;
}): string {
  const params = new URLSearchParams();
  if (intent.extractedAbn) params.set("abn", intent.extractedAbn);
  if (intent.extractedName) params.set("name", intent.extractedName);
  if (intent.extractedAbn && !intent.extractedName) params.set("mode", "abn");
  const qs = params.toString();
  return qs ? `/charity-check?${qs}` : "/charity-check";
}

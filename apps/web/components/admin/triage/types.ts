// Shared types for the clone-watch triage row primitives. The verdict
// kind → backend status string mapping is the critical contract: a wrong
// mapping here triggers the wrong downstream fanout (TP fires brand
// notification; FP terminates the chain).
//
// Unit-tested in __tests__/verdictKindToStatus.test.ts. Do not change
// the mapping without also updating /api/admin/clone-watch/triage and
// the downstream Inngest functions.

export type VerdictKind = "tp" | "inv" | "fp";

export type TriageStatus = "tp_confirmed" | "needs_investigation" | "fp";

export function verdictKindToStatus(kind: VerdictKind): TriageStatus {
  switch (kind) {
    case "tp":
      return "tp_confirmed";
    case "inv":
      return "needs_investigation";
    case "fp":
      return "fp";
  }
}

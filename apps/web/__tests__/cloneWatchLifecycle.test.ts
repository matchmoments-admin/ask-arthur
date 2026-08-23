import { describe, expect, it } from "vitest";

import {
  CLONE_LIFECYCLE_STATES,
  LIFECYCLE_EDGES,
  TERMINAL_STATES,
  canTransition,
  isTerminal,
  nextStates,
  terminalAlertState,
} from "@/lib/clone-watch/lifecycle";

/**
 * Property tests over the Clone Lifecycle spec. Before this file, NOTHING
 * tested the enforcement state machine: rpcs.smoke.test.ts covers 11 RPCs of
 * which one is clone-watch (a stats read), and the only lifecycle-adjacent
 * test asserted a TS mirror of a SQL guard — which proves the mirror is
 * self-consistent, not that the SQL still agrees with it.
 */
describe("clone lifecycle spec", () => {
  it("every edge names states that exist", () => {
    for (const e of LIFECYCLE_EDGES) {
      expect(CLONE_LIFECYCLE_STATES, `from: ${e.from}`).toContain(e.from);
      expect(CLONE_LIFECYCLE_STATES, `to: ${e.to}`).toContain(e.to);
    }
  });

  it("terminal states have no way out", () => {
    // taken_down and dormant are where alerts go to stop moving. An outbound
    // edge here would mean a resolved clone could silently re-enter the
    // enforcement lanes.
    for (const t of TERMINAL_STATES) {
      expect(nextStates(t), `${t} should be terminal`).toEqual([]);
    }
  });

  it("weaponised only ever moves forward, never back to a benign state", () => {
    // The no-downgrade rule apply_netcraft_reconcile (v249) spends most of its
    // complexity on, and that classifyByUrlState mirrors. A weaponised clone
    // that a later vendor pass grades benign must NOT become `declined` again
    // — that would erase the observation the escalation lane is built on.
    expect(nextStates("weaponised")).toEqual(["taken_down"]);
    expect(canTransition("weaponised", "declined")).toBe(false);
    expect(canTransition("weaponised", "monitoring")).toBe(false);
    expect(canTransition("weaponised", "detected")).toBe(false);
  });

  it("keeps the declined -> weaponised flip legal", () => {
    // The money transition: the vendor graded it "no threat" and it later
    // served phishing. The recheck loop and the whole false-negative
    // escalation lane exist for this edge.
    expect(canTransition("declined", "weaponised")).toBe(true);
  });

  it("maps exactly the two terminal states to a coarse disposition", () => {
    // This is the rule v285 omitted, costing 2 rows that would have inflated
    // the brand-register open-count indefinitely. v288's CHECK now enforces
    // it in the database; this asserts the spec agrees with the constraint.
    expect(terminalAlertState("taken_down")).toBe("taken_down");
    expect(terminalAlertState("dormant")).toBe("expired");
    for (const s of CLONE_LIFECYCLE_STATES) {
      if (isTerminal(s)) continue;
      expect(terminalAlertState(s), `${s} is live, must not force alert_state`).toBeNull();
    }
  });

  it("leaves no state stranded — every non-initial state is reachable", () => {
    // A state with no inbound edge is dead vocabulary: it renders in badges
    // and appears in CHECK constraints while nothing can ever produce it.
    for (const s of CLONE_LIFECYCLE_STATES) {
      if (s === "detected") continue; // the entry state, set by the table default
      const inbound = LIFECYCLE_EDGES.filter((e) => e.to === s);
      expect(inbound.length, `${s} has no inbound edge`).toBeGreaterThan(0);
    }
  });

  it("has no duplicate edges", () => {
    const keys = LIFECYCLE_EDGES.map((e) => `${e.from}->${e.to}`);
    expect(new Set(keys).size, "duplicate (from,to) pair").toBe(keys.length);
  });

  it("treats a no-op write as legal", () => {
    // Writers re-assert the current state (mark_clone_alert_rechecked's
    // predecessor did exactly this), so same-state must not read as illegal.
    for (const s of CLONE_LIFECYCLE_STATES) {
      expect(canTransition(s, s)).toBe(true);
    }
  });
});

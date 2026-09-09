import { describe, expect, it } from "vitest";

import { cosineSimilarity, parsePgVector, vectorToPgString } from "../pgvector";

/**
 * Behavioural tests for the pgvector Module. The parsePgVector cases moved
 * here from reddit-intel-cluster.persist.test.ts with the function (#1132);
 * vectorToPgString and cosineSimilarity had never been tested at all — they
 * were reachable only through a `__testing` export nobody imported.
 *
 * Go-red: reinstate `inner.split(",").map(Number)` without the finite check
 * → the NaN and "[]" cases fail.
 */
describe("parsePgVector rejects rather than propagates", () => {
  it("parses a well-formed vector", () => {
    expect(parsePgVector("[1.5,2.5,3]")).toEqual([1.5, 2.5, 3]);
    expect(parsePgVector("1,2")).toEqual([1, 2]);
  });

  it("returns null for a vector that parses to NaN", () => {
    // Previously `[abc,def]` became [NaN, NaN] — length 2, so it survived the
    // caller's `.length > 0` filter. NaN compares false against everything, so
    // the post matched no theme, seeded, and wrote an all-NaN centroid that
    // pgvector rejects; the insert error was warned and skipped. The cause was
    // three steps from the symptom.
    expect(parsePgVector("[abc,def]")).toBeNull();
    expect(parsePgVector("[1,NaN,3]")).toBeNull();
    expect(parsePgVector("[1,Infinity]")).toBeNull();
  });

  it("returns null for an empty vector rather than the number zero", () => {
    // Number("") is 0, not NaN, so "[]" used to parse to [0] — a length-1
    // vector that silently fails every dimension check downstream.
    expect(parsePgVector("[]")).toBeNull();
    expect(parsePgVector("[ ]")).toBeNull();
    expect(parsePgVector("")).toBeNull();
    expect(parsePgVector(null)).toBeNull();
    expect(parsePgVector(undefined)).toBeNull();
  });
});

describe("vectorToPgString", () => {
  it("emits the bracketed text form pgvector accepts, and round-trips", () => {
    expect(vectorToPgString([1, 2.5, -3])).toBe("[1,2.5,-3]");
    expect(vectorToPgString([])).toBe("[]");
    const v = [0.1, 0.2, 0.3];
    expect(parsePgVector(vectorToPgString(v))).toEqual(v);
  });
});

describe("cosineSimilarity", () => {
  it("is 1 for identical direction, 0 for orthogonal, -1 for opposite", () => {
    expect(cosineSimilarity([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 12);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBe(-1);
  });

  it("returns 0, not NaN, for a length mismatch or a zero vector", () => {
    // NaN would compare false against every threshold and route the post to
    // the seed branch without a trace.
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
    expect(cosineSimilarity([0, 0], [1, 2])).toBe(0);
    expect(cosineSimilarity([], [])).toBe(0);
  });
});

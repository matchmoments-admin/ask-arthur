import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readNumberEnv } from "../lib/env-coerce";

const ENV_NAME = "__ENV_COERCE_TEST__";

describe("readNumberEnv", () => {
  beforeEach(() => {
    delete process.env[ENV_NAME];
  });
  afterEach(() => {
    delete process.env[ENV_NAME];
  });

  it("returns default when env var is undefined (not flagged invalid)", () => {
    expect(readNumberEnv(ENV_NAME, 5)).toEqual({ value: 5, invalid: false });
  });

  it("returns default when env var is empty string", () => {
    process.env[ENV_NAME] = "";
    expect(readNumberEnv(ENV_NAME, 5)).toEqual({ value: 5, invalid: false });
  });

  it("returns default when env var is whitespace only", () => {
    process.env[ENV_NAME] = "   ";
    expect(readNumberEnv(ENV_NAME, 5)).toEqual({ value: 5, invalid: false });
  });

  it("parses a valid integer string", () => {
    process.env[ENV_NAME] = "10";
    expect(readNumberEnv(ENV_NAME, 5)).toEqual({ value: 10, invalid: false });
  });

  it("parses a valid float string", () => {
    process.env[ENV_NAME] = "10.5";
    expect(readNumberEnv(ENV_NAME, 5)).toEqual({ value: 10.5, invalid: false });
  });

  it("trims surrounding whitespace", () => {
    process.env[ENV_NAME] = "  10  ";
    expect(readNumberEnv(ENV_NAME, 5)).toEqual({ value: 10, invalid: false });
  });

  it("flags '$10' as invalid and returns default", () => {
    // This is the exact footgun from CLAUDE.md — parseFloat("$10") === NaN
    // would have silently disabled the brake.
    process.env[ENV_NAME] = "$10";
    expect(readNumberEnv(ENV_NAME, 5)).toEqual({
      value: 5,
      rawValue: "$10",
      invalid: true,
    });
  });

  it("flags '10 USD' as invalid and returns default", () => {
    process.env[ENV_NAME] = "10 USD";
    expect(readNumberEnv(ENV_NAME, 5)).toEqual({
      value: 5,
      rawValue: "10 USD",
      invalid: true,
    });
  });

  it("flags 'banana' as invalid and returns default", () => {
    process.env[ENV_NAME] = "banana";
    expect(readNumberEnv(ENV_NAME, 5)).toEqual({
      value: 5,
      rawValue: "banana",
      invalid: true,
    });
  });

  it("flags negative numbers as invalid (caps must be ≥ 0)", () => {
    process.env[ENV_NAME] = "-5";
    expect(readNumberEnv(ENV_NAME, 5)).toEqual({
      value: 5,
      rawValue: "-5",
      invalid: true,
    });
  });

  it("flags Infinity as invalid", () => {
    process.env[ENV_NAME] = "Infinity";
    expect(readNumberEnv(ENV_NAME, 5)).toEqual({
      value: 5,
      rawValue: "Infinity",
      invalid: true,
    });
  });

  it("flags 'NaN' literal as invalid", () => {
    process.env[ENV_NAME] = "NaN";
    expect(readNumberEnv(ENV_NAME, 5)).toEqual({
      value: 5,
      rawValue: "NaN",
      invalid: true,
    });
  });

  it("rejects parseFloat's partial-parse trick ('10abc')", () => {
    // parseFloat("10abc") === 10 — exact-string parsing via Number() avoids
    // this silent acceptance of typos.
    process.env[ENV_NAME] = "10abc";
    expect(readNumberEnv(ENV_NAME, 5)).toEqual({
      value: 5,
      rawValue: "10abc",
      invalid: true,
    });
  });

  it("accepts 0 as a valid value (caps can be zero to disable a feature)", () => {
    process.env[ENV_NAME] = "0";
    expect(readNumberEnv(ENV_NAME, 5)).toEqual({ value: 0, invalid: false });
  });
});

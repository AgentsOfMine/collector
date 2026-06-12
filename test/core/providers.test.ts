import { describe, it, expect } from "vitest";
import { KNOWN_PROVIDERS, isKnownProvider } from "../../src/core/providers.js";

describe("provider registry", () => {
  it("loads the shipped provider ids from providers.json", () => {
    expect([...KNOWN_PROVIDERS].sort()).toEqual(["claude-code", "codex", "opencode", "pi"]);
  });

  it("is frozen so callers cannot mutate the allowlist", () => {
    expect(Object.isFrozen(KNOWN_PROVIDERS)).toBe(true);
  });

  it("accepts every registered provider", () => {
    for (const provider of KNOWN_PROVIDERS) {
      expect(isKnownProvider(provider)).toBe(true);
    }
  });

  it("rejects unknown providers", () => {
    expect(isKnownProvider("cursor")).toBe(false);
    expect(isKnownProvider("copilot")).toBe(false);
  });

  it("rejects non-string and empty values", () => {
    expect(isKnownProvider("")).toBe(false);
    expect(isKnownProvider(null)).toBe(false);
    expect(isKnownProvider(undefined)).toBe(false);
    expect(isKnownProvider(42)).toBe(false);
  });
});

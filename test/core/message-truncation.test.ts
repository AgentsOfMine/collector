import { describe, it, expect } from "vitest";
import { truncateMessages, MAX_MESSAGES_PER_SESSION } from "../../src/core/message-truncation.js";
import type { CanonicalMessage } from "../../src/core/canonical.js";

function msg(id: string): CanonicalMessage {
  return { messageId: id, sessionId: "s", role: "user", createdAt: "2026-01-01T00:00:00Z", parts: [] };
}

describe("truncateMessages", () => {
  it("returns the same array when at or below the cap", () => {
    const m = Array.from({ length: MAX_MESSAGES_PER_SESSION }, (_, i) => msg(`m${i}`));
    expect(truncateMessages(m)).toBe(m);
  });

  it("returns the same array for a small list", () => {
    const m = [msg("a"), msg("b")];
    expect(truncateMessages(m)).toBe(m);
  });

  it("keeps the first message plus the last (cap-1) when over the cap", () => {
    const total = MAX_MESSAGES_PER_SESSION + 50;
    const m = Array.from({ length: total }, (_, i) => msg(`m${i}`));
    const out = truncateMessages(m);
    expect(out).toHaveLength(MAX_MESSAGES_PER_SESSION);
    expect(out[0].messageId).toBe("m0");
    expect(out[out.length - 1].messageId).toBe(`m${total - 1}`);
  });

  it("does not include the dropped middle messages", () => {
    const total = MAX_MESSAGES_PER_SESSION + 10;
    const m = Array.from({ length: total }, (_, i) => msg(`m${i}`));
    const out = truncateMessages(m);
    const ids = new Set(out.map((x) => x.messageId));
    expect(ids.has("m0")).toBe(true);
    expect(ids.has("m1")).toBe(false);
  });
});

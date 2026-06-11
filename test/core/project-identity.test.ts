import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { resolveProjectIdentity, legacyProjectId } from "../../src/core/project-identity.js";

function stubRunner(responses: Record<string, string | null>): (cmd: string, args: string[]) => string | null {
  return (_cmd, args) => {
    const key = args.join(" ");
    if (key in responses) return responses[key];
    return null;
  };
}

describe("legacyProjectId", () => {
  it("equals the historical sha256 hex slice(0, 16)", () => {
    const path = "/home/user/project";
    const expected = createHash("sha256").update(path).digest("hex").slice(0, 16);
    expect(legacyProjectId(path)).toBe(expected);
  });

  it("is deterministic for the same input", () => {
    const path = "/Users/dev/Projects/agentsofmine";
    expect(legacyProjectId(path)).toBe(legacyProjectId(path));
  });

  it("differs for different inputs", () => {
    expect(legacyProjectId("/a")).not.toBe(legacyProjectId("/b"));
  });
});

describe("resolveProjectIdentity", () => {
  const path = "/Users/dev/Projects/agentsofmine";
  const root = "/Users/dev/Projects/agentsofmine";

  it("returns a git identity when a git remote is present", () => {
    const run = stubRunner({
      [`-C ${path} rev-parse --show-toplevel`]: root,
      [`-C ${root} remote get-url origin`]: "git@github.com:Kifah/agentsofmine.git",
      [`-C ${root} rev-parse --abbrev-ref HEAD`]: "main",
      [`-C ${root} rev-parse HEAD`]: "deadbeef",
    });

    const identity = resolveProjectIdentity(path, run);
    expect(identity.kind).toBe("git");
    expect(identity.canonical).toBe("git:github.com/Kifah/agentsofmine");
    expect(identity.displayName).toBe("agentsofmine");
    expect(identity.git?.remoteName).toBe("origin");
    expect(identity.git?.branch).toBe("main");
    expect(identity.local.basename).toBe("agentsofmine");
  });

  it("falls back to path-legacy when no git remote exists", () => {
    const run = stubRunner({});
    const identity = resolveProjectIdentity(path, run);
    expect(identity.kind).toBe("path-legacy");
    expect(identity.canonical).toBe(`path:${legacyProjectId(path)}`);
    expect(identity.displayName).toBe("agentsofmine");
    expect(identity.git).toBeUndefined();
  });

  it("never throws on a nonexistent path", () => {
    const run = stubRunner({});
    expect(() => resolveProjectIdentity("/nonexistent/path/xyz", run)).not.toThrow();
    const identity = resolveProjectIdentity("/nonexistent/path/xyz", run);
    expect(identity.kind).toBe("path-legacy");
  });

  it("does not leak credentials into a git identity remoteUrl", () => {
    const run = stubRunner({
      [`-C ${path} rev-parse --show-toplevel`]: root,
      [`-C ${root} remote get-url origin`]: "https://token@github.com/Kifah/agentsofmine.git",
    });

    const identity = resolveProjectIdentity(path, run);
    expect(identity.canonical).not.toContain("token");
    expect(identity.git?.remoteUrl).not.toContain("token");
    expect(identity.git?.remoteUrl).not.toContain("@");
  });
});

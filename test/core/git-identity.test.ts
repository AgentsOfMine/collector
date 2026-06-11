import { describe, it, expect } from "vitest";
import { normalizeGitRemote, discoverGitIdentity } from "../../src/core/git-identity.js";

describe("normalizeGitRemote", () => {
  it("normalizes SSH scp-like remotes", () => {
    expect(normalizeGitRemote("git@github.com:Kifah/agentsofmine.git")).toBe(
      "git:github.com/Kifah/agentsofmine",
    );
  });

  it("normalizes ssh:// remotes", () => {
    expect(normalizeGitRemote("ssh://git@github.com/Kifah/agentsofmine.git")).toBe(
      "git:github.com/Kifah/agentsofmine",
    );
  });

  it("normalizes HTTPS remotes with .git", () => {
    expect(normalizeGitRemote("https://github.com/Kifah/agentsofmine.git")).toBe(
      "git:github.com/Kifah/agentsofmine",
    );
  });

  it("normalizes HTTPS remotes without .git", () => {
    expect(normalizeGitRemote("https://github.com/Kifah/agentsofmine")).toBe(
      "git:github.com/Kifah/agentsofmine",
    );
  });

  it("strips a token credential and never leaks it", () => {
    const result = normalizeGitRemote("https://token@github.com/Kifah/agentsofmine.git");
    expect(result).toBe("git:github.com/Kifah/agentsofmine");
    expect(result).not.toContain("token");
    expect(result).not.toContain("@");
  });

  it("strips user:pass credentials and never leaks them", () => {
    const result = normalizeGitRemote("https://user:pass@github.com/Kifah/agentsofmine.git");
    expect(result).toBe("git:github.com/Kifah/agentsofmine");
    expect(result).not.toContain("user");
    expect(result).not.toContain("pass");
    expect(result).not.toContain("@");
  });

  it("lowercases the host but preserves owner/repo casing", () => {
    expect(normalizeGitRemote("git@GitHub.com:Kifah/AgentsOfMine.git")).toBe(
      "git:github.com/Kifah/AgentsOfMine",
    );
  });

  it("strips trailing slashes", () => {
    expect(normalizeGitRemote("https://github.com/Kifah/agentsofmine/")).toBe(
      "git:github.com/Kifah/agentsofmine",
    );
  });

  it("returns null on empty input", () => {
    expect(normalizeGitRemote("")).toBeNull();
    expect(normalizeGitRemote("   ")).toBeNull();
  });

  it("returns null on garbage input and never throws", () => {
    expect(normalizeGitRemote("not a url at all")).toBeNull();
    expect(normalizeGitRemote("::::")).toBeNull();
  });
});

function stubRunner(responses: Record<string, string | null>): (cmd: string, args: string[]) => string | null {
  return (_cmd, args) => {
    const key = args.join(" ");
    if (key in responses) return responses[key];
    return null;
  };
}

describe("discoverGitIdentity", () => {
  const path = "/Users/dev/Projects/agentsofmine";
  const root = "/Users/dev/Projects/agentsofmine";

  it("returns null when the runner always returns null", () => {
    const run = stubRunner({});
    expect(discoverGitIdentity(path, run)).toBeNull();
  });

  it("returns null when the runner throws", () => {
    const run = (): string | null => {
      throw new Error("git not found");
    };
    expect(discoverGitIdentity(path, run)).toBeNull();
  });

  it("returns the canonical identity from toplevel + origin remote", () => {
    const run = stubRunner({
      [`-C ${path} rev-parse --show-toplevel`]: root,
      [`-C ${root} remote get-url origin`]: "git@github.com:Kifah/agentsofmine.git",
      [`-C ${root} rev-parse --abbrev-ref HEAD`]: "main",
      [`-C ${root} rev-parse HEAD`]: "6e81b7cdc2d371c317429469c6450fc9fac57ecc",
    });

    const identity = discoverGitIdentity(path, run);
    expect(identity).not.toBeNull();
    expect(identity?.canonical).toBe("git:github.com/Kifah/agentsofmine");
    expect(identity?.remoteName).toBe("origin");
    expect(identity?.branch).toBe("main");
    expect(identity?.headCommit).toBe("6e81b7cdc2d371c317429469c6450fc9fac57ecc");
    expect(identity?.root).toBe(root);
  });

  it("falls back to the first sorted remote when origin is missing", () => {
    const run = stubRunner({
      [`-C ${path} rev-parse --show-toplevel`]: root,
      [`-C ${root} remote get-url origin`]: null,
      [`-C ${root} remote`]: "zeta\nalpha",
      [`-C ${root} remote get-url alpha`]: "https://github.com/Kifah/agentsofmine.git",
    });

    const identity = discoverGitIdentity(path, run);
    expect(identity?.remoteName).toBe("alpha");
    expect(identity?.canonical).toBe("git:github.com/Kifah/agentsofmine");
  });

  it("does not leak credentials into the stored remoteUrl", () => {
    const run = stubRunner({
      [`-C ${path} rev-parse --show-toplevel`]: root,
      [`-C ${root} remote get-url origin`]: "https://token@github.com/Kifah/agentsofmine.git",
    });

    const identity = discoverGitIdentity(path, run);
    expect(identity?.canonical).toBe("git:github.com/Kifah/agentsofmine");
    expect(identity?.remoteUrl).not.toContain("token");
    expect(identity?.remoteUrl).not.toContain("@");
  });

  it("does not break when branch and commit lookups fail", () => {
    const run = stubRunner({
      [`-C ${path} rev-parse --show-toplevel`]: root,
      [`-C ${root} remote get-url origin`]: "git@github.com:Kifah/agentsofmine.git",
    });

    const identity = discoverGitIdentity(path, run);
    expect(identity?.canonical).toBe("git:github.com/Kifah/agentsofmine");
    expect(identity?.branch).toBeNull();
    expect(identity?.headCommit).toBeNull();
  });

  it("returns null when there is no remote at all", () => {
    const run = stubRunner({
      [`-C ${path} rev-parse --show-toplevel`]: root,
      [`-C ${root} remote get-url origin`]: null,
      [`-C ${root} remote`]: "",
    });

    expect(discoverGitIdentity(path, run)).toBeNull();
  });
});

import { execFileSync } from "node:child_process";

export interface GitIdentity {
  canonical: string;
  remoteUrl: string;
  remoteName: string;
  root: string;
  branch: string | null;
  headCommit: string | null;
}

type GitRunner = (cmd: string, args: string[]) => string | null;

const defaultRun: GitRunner = (cmd, args) => {
  try {
    const out = execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const trimmed = out.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
};

/**
 * Strip userinfo (credentials) from a URL-like remote without throwing.
 * Returns the input unchanged when there is no userinfo to strip.
 */
function stripUserinfo(remoteUrl: string): string {
  // Matches scheme://userinfo@rest — drop the userinfo segment.
  return remoteUrl.replace(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^/@]*@/, "$1");
}

/**
 * Canonicalize a git remote to the form `git:<host>/<owner>/<repo>`.
 * Host is lowercased; owner/repo casing is preserved. Credentials are
 * always stripped. Returns null for empty or unparseable input. Never throws.
 */
export function normalizeGitRemote(remoteUrl: string): string | null {
  if (typeof remoteUrl !== "string") return null;
  const raw = remoteUrl.trim();
  if (raw.length === 0) return null;

  let host: string | null = null;
  let path: string | null = null;

  // SCP-like SSH syntax: git@github.com:Owner/Repo.git
  const scpMatch = raw.match(/^(?:[^@/]+@)?([^/:]+):(.+)$/);
  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw);

  if (!hasScheme && scpMatch) {
    host = scpMatch[1] ?? null;
    path = scpMatch[2] ?? null;
  } else {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      return null;
    }
    host = parsed.hostname;
    path = parsed.pathname;
  }

  if (!host || !path) return null;

  // Normalize the path portion: strip leading slashes, trailing slashes, trailing .git
  let normalizedPath = path.replace(/^\/+/, "").replace(/\/+$/, "");
  normalizedPath = normalizedPath.replace(/\.git$/, "");
  normalizedPath = normalizedPath.replace(/\/+$/, "");

  if (normalizedPath.length === 0) return null;

  const normalizedHost = host.toLowerCase();
  if (normalizedHost.length === 0) return null;

  return `git:${normalizedHost}/${normalizedPath}`;
}

/**
 * Discover the git identity for a local path using injectable git commands.
 * Never throws — any git failure degrades to null. The returned remoteUrl is
 * always credential-stripped so a token can never leak into stored data.
 */
export function discoverGitIdentity(path: string, run: GitRunner = defaultRun): GitIdentity | null {
  if (typeof path !== "string" || path.length === 0) return null;

  const root = safeRun(run, "git", ["-C", path, "rev-parse", "--show-toplevel"]);
  if (root === null) return null;

  const remote = resolveRemote(run, root);
  if (remote === null) return null;

  const canonical = normalizeGitRemote(remote.url);
  if (canonical === null) return null;

  const branch = safeRun(run, "git", ["-C", root, "rev-parse", "--abbrev-ref", "HEAD"]);
  const headCommit = safeRun(run, "git", ["-C", root, "rev-parse", "HEAD"]);

  return {
    canonical,
    remoteUrl: stripUserinfo(remote.url),
    remoteName: remote.name,
    root,
    branch,
    headCommit,
  };
}

function resolveRemote(run: GitRunner, root: string): { name: string; url: string } | null {
  const originUrl = safeRun(run, "git", ["-C", root, "remote", "get-url", "origin"]);
  if (originUrl !== null) {
    return { name: "origin", url: originUrl };
  }

  const remoteList = safeRun(run, "git", ["-C", root, "remote"]);
  if (remoteList === null) return null;

  const names = remoteList
    .split("\n")
    .map((n) => n.trim())
    .filter((n) => n.length > 0)
    .sort();
  if (names.length === 0) return null;

  const firstName = names[0];
  if (firstName === undefined) return null;
  const url = safeRun(run, "git", ["-C", root, "remote", "get-url", firstName]);
  if (url === null) return null;

  return { name: firstName, url };
}

function safeRun(run: GitRunner, cmd: string, args: string[]): string | null {
  try {
    const out = run(cmd, args);
    if (out === null) return null;
    const trimmed = out.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

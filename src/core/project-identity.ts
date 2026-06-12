import { createHash } from "node:crypto";
import { basename } from "node:path";
import { discoverGitIdentity } from "./git-identity.js";

type GitRunner = (cmd: string, args: string[]) => string | null;

export interface ProjectIdentity {
  kind: "git" | "path-legacy";
  canonical: string;
  displayName: string;
  git?: {
    root: string;
    remoteName: string;
    remoteUrl: string;
    branch: string | null;
    headCommit: string | null;
  };
  local: {
    path: string;
    basename: string;
  };
}

/**
 * The historical path-derived project id: first 16 hex chars of the SHA-256 of
 * the path. Shared by all adapters so the legacy `projectId` stays stable.
 */
export function legacyProjectId(path: string): string {
  return createHash("sha256").update(path).digest("hex").slice(0, 16);
}

/**
 * Resolve a logical project identity for a local path. Tries Git remote
 * identity first; falls back to a path-legacy identity when no Git remote is
 * available. Never throws — failures degrade to path-legacy.
 */
export function resolveProjectIdentity(projectPath: string, run?: GitRunner): ProjectIdentity {
  const local = { path: projectPath, basename: basename(projectPath) };

  const git = discoverGitIdentity(projectPath, run);
  if (git !== null) {
    return {
      kind: "git",
      canonical: git.canonical,
      displayName: repoNameFromCanonical(git.canonical) ?? displayNameForPath(projectPath, local.basename),
      git: {
        root: git.root,
        remoteName: git.remoteName,
        remoteUrl: git.remoteUrl,
        branch: git.branch,
        headCommit: git.headCommit,
      },
      local,
    };
  }

  return {
    kind: "path-legacy",
    canonical: `path:${legacyProjectId(projectPath)}`,
    displayName: displayNameForPath(projectPath, local.basename),
    local,
  };
}

/**
 * basename("/") is "" — an empty name surfaces as a raw hash in the UI.
 * OpenCode records `/` for sessions run outside any project, so label it "Global".
 */
function displayNameForPath(projectPath: string, base: string): string {
  if (base.length > 0) return base;
  return projectPath === "/" ? "Global" : projectPath;
}

/**
 * The project-scoped fields every adapter attaches to a CanonicalSession.
 * `projectId` stays the legacy path hash; `projectIdentity` is the richer
 * resolution. Centralizes the pairing so adapters do not repeat it.
 */
export function projectFields(projectPath: string): {
  projectId: string;
  projectPath: string;
  projectIdentity: ProjectIdentity;
} {
  return {
    projectId: legacyProjectId(projectPath),
    projectPath,
    projectIdentity: resolveProjectIdentity(projectPath),
  };
}

function repoNameFromCanonical(canonical: string): string | null {
  const segments = canonical.split("/");
  const last = segments[segments.length - 1];
  return last !== undefined && last.length > 0 ? last : null;
}

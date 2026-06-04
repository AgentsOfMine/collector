import { createHash } from "node:crypto";
import { basename } from "node:path";
import type { CanonicalSession } from "../../core/canonical.js";
import type { OpenCodeRow } from "./sqlite-reader.js";

interface PatchFile {
  path?: string;
  [key: string]: unknown;
}

interface Patch {
  files?: PatchFile[];
  [key: string]: unknown;
}

interface ModelJson {
  id?: string;
  providerID?: string;
  variant?: string;
  [key: string]: unknown;
}

function parsePatch(raw: string | null): string[] | null {
  if (raw === null || raw === "") return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const patch = parsed as Patch;
    const files = patch.files;
    if (!Array.isArray(files)) return null;
    return files
      .filter((f): f is PatchFile => typeof f === "object" && f !== null)
      .map((f) => (typeof f.path === "string" ? f.path : ""))
      .filter((p) => p.length > 0)
      .slice(0, 200);
  } catch {
    return null;
  }
}

function parseModelLine(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const m = JSON.parse(raw) as ModelJson;
    const parts = [m.id, m.variant].filter(Boolean);
    return parts.length > 0 ? parts.join(" · ") : raw;
  } catch {
    return raw;
  }
}

function projectId(path: string): string {
  return createHash("sha256").update(path).digest("hex").slice(0, 16);
}

function projectName(worktree: string | null, id: string | null): string {
  if (worktree) return basename(worktree);
  if (id) return id.slice(0, 12);
  return "unknown";
}

export function mapRow(row: OpenCodeRow, projectPath: string): CanonicalSession {
  const filesChanged = parsePatch(row.summary_diffs);
  const resolvedProjectPath = row.project_worktree ?? projectPath;
  const resolvedProjectId = projectId(resolvedProjectPath);

  return {
    sessionId: row.id,
    provider: "opencode",
    projectId: resolvedProjectId,
    projectPath: resolvedProjectPath,
    agentName: "OpenCode",
    title: row.title ?? null,
    modelLine: parseModelLine(row.model),
    startedAt: new Date(row.time_created).toISOString(),
    endedAt: new Date(row.time_updated).toISOString(),
    messageCount: null,
    fileCount: row.summary_files ?? null,
    linesAdded: row.summary_additions ?? null,
    linesRemoved: row.summary_deletions ?? null,
    filesChanged,
    filesChangedApproximate: false,
    extensions: {},
  };
}

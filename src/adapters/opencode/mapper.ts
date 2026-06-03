import { createHash } from "node:crypto";
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

function projectId(path: string): string {
  return createHash("sha256").update(path).digest("hex").slice(0, 16);
}

export function mapRow(row: OpenCodeRow, projectPath: string): CanonicalSession {
  const filesChanged = parsePatch(row.patch);

  return {
    sessionId: row.id,
    provider: "opencode",
    projectId: projectId(projectPath),
    projectPath,
    agentName: "OpenCode",
    title: row.title ?? null,
    modelLine: row.model ?? null,
    startedAt: row.created_at,
    endedAt: row.updated_at,
    messageCount: null,
    fileCount: row.summary_files ?? null,
    linesAdded: row.summary_additions ?? null,
    linesRemoved: row.summary_deletions ?? null,
    filesChanged,
    filesChangedApproximate: false,
    extensions: {},
  };
}

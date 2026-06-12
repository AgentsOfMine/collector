import type { CanonicalSession } from "../../core/canonical.js";
import { projectFields } from "../../core/project-identity.js";
import type { SessionAccumulator } from "./accumulator.js";

export type { SessionAccumulator } from "./accumulator.js";
export { createAccumulator, processEvent } from "./accumulator.js";

export function finalizeSession(acc: SessionAccumulator): CanonicalSession {
  const filesChanged = acc.filesChanged.size > 0 ? Array.from(acc.filesChanged) : null;
  return {
    sessionId: acc.sessionId,
    provider: "claude-code",
    ...projectFields(acc.projectPath),
    agentName: "Claude Code",
    title: acc.title,
    modelLine: acc.modelLine,
    startedAt: acc.startedAt ?? new Date(0).toISOString(),
    endedAt: acc.endedAt,
    messageCount: acc.messageCount > 0 ? acc.messageCount : null,
    fileCount: acc.filesChanged.size > 0 ? acc.filesChanged.size : null,
    linesAdded: acc.linesAdded > 0 ? acc.linesAdded : null,
    linesRemoved: acc.linesRemoved > 0 ? acc.linesRemoved : null,
    filesChanged,
    filesChangedApproximate: false,
    extensions: {},
  };
}

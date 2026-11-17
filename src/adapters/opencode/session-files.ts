import type { CanonicalMessage, CanonicalSession } from "../../core/canonical.js";
import { deriveFileChanges } from "./file-changes.js";

/**
 * OpenCode leaves the `summary_*` columns unpopulated, so when the session row
 * has no file list, derive it from the `edit` / `write` tool parts of the
 * session's messages. Mutates and returns `session`.
 */
export function applyDerivedFileChanges(session: CanonicalSession, messages: CanonicalMessage[]): CanonicalSession {
  if (session.filesChanged !== null && session.filesChanged.length > 0) return session;

  const derived = deriveFileChanges(messages);
  if (derived.filesChanged.length > 0) {
    session.filesChanged = derived.filesChanged;
    session.fileCount = derived.filesChanged.length;
    session.linesAdded = derived.linesAdded;
    session.linesRemoved = derived.linesRemoved;
  }
  return session;
}

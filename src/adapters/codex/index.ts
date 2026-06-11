import type { Adapter, Cursor, SyncItem } from "../adapter.js";
import { projectFields } from "../../core/project-identity.js";
import { readCodexSessions } from "./log-reader.js";
import { extractFiles } from "./shell-parser.js";
import { join } from "node:path";
import { homedir } from "node:os";

export class CodexAdapter implements Adapter {
  readonly name = "codex";

  constructor(
    private readonly sessionsDir: string = join(homedir(), ".codex", "sessions"),
  ) {}

  async *listNewSessions(cursor: Cursor): AsyncIterable<SyncItem> {
    const since = cursor.value;
    const sessions = readCodexSessions(this.sessionsDir).sort((a, b) =>
      a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0,
    );

    for (const s of sessions) {
      if (since !== null && s.startedAt <= since) continue;

      const { paths } = extractFiles(s.commands);
      const filesChanged = paths.length > 0 ? paths : null;

      const session = {
        sessionId: s.sessionId,
        provider: "codex" as const,
        ...projectFields(s.projectPath),
        agentName: "Codex",
        title: s.title,
        modelLine: null,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        messageCount: s.messageCount > 0 ? s.messageCount : null,
        fileCount: filesChanged ? filesChanged.length : null,
        linesAdded: null,
        linesRemoved: null,
        filesChanged,
        filesChangedApproximate: true,
        extensions: {},
        messages: s.messages,
      };

      yield { session, cursor: s.startedAt };
    }
  }
}

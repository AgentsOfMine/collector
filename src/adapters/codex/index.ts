import { createHash } from "node:crypto";
import type { Adapter, Cursor } from "../adapter.js";
import type { SessionWithMessages } from "../../core/canonical.js";
import { readCodexSessions } from "./log-reader.js";
import { extractFiles } from "./shell-parser.js";
import { join } from "node:path";
import { homedir } from "node:os";

function projectId(path: string): string {
  return createHash("sha256").update(path).digest("hex").slice(0, 16);
}

export class CodexAdapter implements Adapter {
  readonly name = "codex";

  constructor(
    private readonly sessionsDir: string = join(homedir(), ".codex", "sessions"),
  ) {}

  async *listNewSessions(cursor: Cursor): AsyncIterable<SessionWithMessages> {
    const since = cursor.value;
    const sessions = readCodexSessions(this.sessionsDir);

    for (const s of sessions) {
      if (since !== null && s.startedAt <= since) continue;

      const { paths } = extractFiles(s.commands);
      const filesChanged = paths.length > 0 ? paths : null;

      yield {
        sessionId: s.sessionId,
        provider: "codex",
        projectId: projectId(s.projectPath),
        projectPath: s.projectPath,
        agentName: "Codex",
        title: null,
        modelLine: null,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        messageCount: null,
        fileCount: filesChanged ? filesChanged.length : null,
        linesAdded: null,
        linesRemoved: null,
        filesChanged,
        filesChangedApproximate: true,
        extensions: {},
        messages: [],
      };
    }
  }
}

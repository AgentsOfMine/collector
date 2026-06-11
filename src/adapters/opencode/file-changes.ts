import type { CanonicalMessage } from "../../core/canonical.js";

export interface FileChangeSummary {
  filesChanged: string[];
  linesAdded: number;
  linesRemoved: number;
}

interface EditInput {
  filePath?: string;
  oldString?: string;
  newString?: string;
  content?: string;
}

function lineCount(s: string): number {
  if (s === "") return 0;
  return s.split("\n").length;
}

export function deriveFileChanges(messages: CanonicalMessage[]): FileChangeSummary {
  const files = new Set<string>();
  let linesAdded = 0;
  let linesRemoved = 0;

  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== "tool") continue;
      if (part.tool !== "edit" && part.tool !== "write") continue;

      const input = part.input as EditInput | undefined;
      const filePath = input?.filePath;
      if (typeof filePath !== "string" || filePath === "") continue;

      files.add(filePath);

      if (part.tool === "write" && typeof input?.content === "string") {
        linesAdded += lineCount(input.content);
      } else if (part.tool === "edit") {
        if (typeof input?.newString === "string") linesAdded += lineCount(input.newString);
        if (typeof input?.oldString === "string") linesRemoved += lineCount(input.oldString);
      }
    }
  }

  return {
    filesChanged: Array.from(files),
    linesAdded,
    linesRemoved,
  };
}

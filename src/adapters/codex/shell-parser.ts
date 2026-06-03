// Redirects always indicate a file write, regardless of the leading command
const REDIRECT_PATTERN = />{1,2}\s*(\S+)/g;
// File ops that take one or more file args; capture all space-separated non-flag args
const FILE_OP_SINGLE_PATTERN = /(?:vim|nano|touch|rm)\s+(\S+)/g;
const FILE_OP_MULTI_PATTERN = /(?:mv|cp)\s+((?:\S+\s+)*\S+)$/g;
// git ops — skip flags like `--` before the path
const GIT_PATTERN = /git\s+(?:add|checkout|restore)\s+(?:--\s+)?(\S+)/g;
const SED_AWK_PATTERN = /(?:sed|awk)\s+(?:-i\S*\s+)?(?:'[^']*'\s+)?(\S+)/g;

// Commands that are read/navigate only and produce no file writes on their own
const DENYLIST_COMMANDS = new Set(["ls", "pwd", "echo", "which", "cd", "cat"]);

function isDenylisted(command: string): boolean {
  const first = command.trim().split(/\s+/)[0] ?? "";
  return DENYLIST_COMMANDS.has(first);
}

function extractFromPattern(command: string, pattern: RegExp): string[] {
  const results: string[] = [];
  const re = new RegExp(pattern.source, pattern.flags);
  let match: RegExpExecArray | null;
  while ((match = re.exec(command)) !== null) {
    const path = match[1];
    if (path && !path.startsWith("-")) {
      results.push(path);
    }
  }
  return results;
}

function extractMultiArgs(command: string, pattern: RegExp): string[] {
  const results: string[] = [];
  const re = new RegExp(pattern.source, pattern.flags);
  let match: RegExpExecArray | null;
  while ((match = re.exec(command)) !== null) {
    const argsStr = match[1];
    if (argsStr) {
      for (const arg of argsStr.trim().split(/\s+/)) {
        if (arg && !arg.startsWith("-")) {
          results.push(arg);
        }
      }
    }
  }
  return results;
}

export interface ExtractFilesResult {
  paths: string[];
  approximate: true;
}

export function extractFiles(commands: string[]): ExtractFilesResult {
  const seen = new Set<string>();
  const paths: string[] = [];

  function addPaths(found: string[]): void {
    for (const p of found) {
      if (!seen.has(p)) {
        seen.add(p);
        paths.push(p);
      }
      if (paths.length >= 50) return;
    }
  }

  for (const cmd of commands) {
    // Redirects are extracted even from denylisted commands (echo > file IS a write)
    addPaths(extractFromPattern(cmd, REDIRECT_PATTERN));
    if (paths.length >= 50) break;

    if (isDenylisted(cmd)) continue;

    addPaths(extractFromPattern(cmd, FILE_OP_SINGLE_PATTERN));
    addPaths(extractMultiArgs(cmd, FILE_OP_MULTI_PATTERN));
    addPaths(extractFromPattern(cmd, GIT_PATTERN));
    addPaths(extractFromPattern(cmd, SED_AWK_PATTERN));

    if (paths.length >= 50) break;
  }

  return { paths: paths.slice(0, 50), approximate: true };
}

import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Every filesystem location the collector reads or writes, in one place.
 *
 * These are functions, not constants: `homedir()` is read on each call so a
 * test (or a user) that changes `HOME` is respected, and so every caller
 * agrees on the same directory.
 */

/** Collector state: config, cursors, device id, last-sync timestamps. */
export function stateDir(): string {
  return join(homedir(), ".agentsofmine");
}

export function configFile(baseDir: string = stateDir()): string {
  return join(baseDir, "config.json");
}

export function deviceIdFile(baseDir: string = stateDir()): string {
  return join(baseDir, "device-id");
}

export function cursorsFile(baseDir: string = stateDir()): string {
  return join(baseDir, "cursors.json");
}

export function lastSyncFile(baseDir: string = stateDir()): string {
  return join(baseDir, "last-sync.json");
}

/** Where each agent keeps the sessions the adapters read. */
export function opencodeDbPath(): string {
  return join(homedir(), ".local", "share", "opencode", "opencode.db");
}

export function claudeProjectsGlob(): string {
  return join(homedir(), ".claude", "projects", "*", "*.jsonl");
}

export function codexSessionsDir(): string {
  return join(homedir(), ".codex", "sessions");
}

export function piSessionsDir(): string {
  return join(homedir(), ".pi", "agent", "sessions");
}

/**
 * The directory a Claude Code glob such as `~/.claude/projects/*\/*.jsonl`
 * points into: the glob with its trailing `*\/*.jsonl` (or `*.jsonl`) removed.
 */
export function claudeProjectsDirFromGlob(glob: string): string {
  return glob.replace(/[/\\]\*[/\\]\*\.jsonl$/, "").replace(/[/\\]\*\.jsonl$/, "");
}

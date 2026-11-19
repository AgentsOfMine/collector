---
title: Add support for a new AI coding agent
description: The four steps, the adapter interface, how to choose a cursor, and the checklist an adapter has to pass to be accepted into the AgentsOfMine collector.
slug: add-an-agent
order: 3
verified: 2026-11-19
checkedAgainst: "Collector 0.1.3, commit abe3f56: the adapter interface, the provider registry and the existing adapters read on 19 November 2026. The steps were not exercised by building a new adapter for this page."
kind: guide
---

**Why this matters.** If you use a coding agent that the AgentsOfMine collector does not read yet, its sessions never reach your account. The collector is the open-source program that reads your agents' session files and uploads a copy to your private workspace. An adapter fixes that for you and for everyone else who uses the same agent, and it is about one file plus a test.

The most useful contribution to the collector is an adapter for an agent it does not read yet. This is the whole job.

## Who needs this

**Possible scenario.** Your team uses a coding agent the collector does not read. Its sessions are on disk but never reach your account, so the picture has a hole exactly where that agent is used. Someone writes an adapter once, and everyone who uses that agent benefits.

| Role | What changes for them |
|---|---|
| Senior software engineer | Gets a bounded job: one adapter folder, one test and an existing adapter to copy the shape from. |
| Junior software engineer | Gets a contribution with a clear end and a model to follow, which is a way into an open-source project. |
| DevOps or platform engineer | Can read the adapter's code before rolling it out, because it is one folder. |

Table: who gains what, **my reasoning, not measured.** I did not measure time saved for any role.

## The four steps

These are the steps in the header of [`src/core/providers.ts`](https://github.com/AgentsOfMine/collector/blob/abe3f56017b9dd488e8a9f6b309bdc813e7c6ff9/src/core/providers.ts):

1. Add the agent's id to `src/core/providers.json`.
2. Write `src/adapters/<id>/` implementing the `Adapter` interface below. `src/adapters/opencode/` is the reference.
3. Create it in `src/core/perform-sync.ts`.
4. Add a watcher for it in `src/cli/start.ts`.

The server stores the provider id as it is, so no change on our side is needed to accept a new one.

## The interface

```ts
export interface Cursor { value: string | null }
export interface SyncItem {
  session: SessionWithMessages;
  /** Opaque cursor value, valid to save after this session is accepted. */
  cursor: string;
}
export interface Adapter {
  readonly name: string;
  listNewSessions(cursor: Cursor): AsyncIterable<SyncItem>;
}
```

That is all: a name, and one method that streams sessions. The cursor is a string only your adapter understands; the collector saves it per adapter name in `~/.agentsofmine/cursors.json`.

## Find out where the agent keeps sessions first

Answer these before you write code, ideally with a source for each:

1. Where are sessions stored on macOS, Linux and Windows?
2. What format: JSON files, SQLite, JSONL, or only on a remote server?
3. What are the field names and content types?
4. How is a session tied to a project: a working directory, a repository URL?
5. How are tool calls recorded: inline, as separate events, or in another file?
6. Are files appended to or rewritten? This decides your cursor.
7. Is the format documented, or did you work it out from files?

## Choose a cursor

The three adapters that exist show the options:

| Cursor | Used by | Good | Cost |
|---|---|---|---|
| Start time of the last session | Codex | simple | a session is never sent again after its first upload |
| Time watermark | OpenCode (2.x tables) | picks up new messages in known sessions | needs records that are never edited and carry a creation time |
| Byte offset per file | Claude Code, Pi | picks up appended lines | needs append-only files |

Whatever you choose, send the session's **real** start time on every pass: it is part of the key the server stores the session under, and a wrong one creates a second row.

## The checklist

An adapter is ready when:

- it opens the agent's storage read-only and writes nothing outside `~/.agentsofmine/`;
- it returns quietly, without throwing, when the agent is not installed;
- `listNewSessions` streams, rather than loading everything into an array;
- it sets `filesChanged` honestly, and `null` instead of a guess for line counts;
- it applies `truncateMessages` and the 500-character tool-output limit;
- it sends part types it does not know as `{ type }` instead of dropping them;
- it has tests under `test/adapters/<id>/`, building their folders in code (there are no shared fixture files).

Redaction does not belong in the adapter: the sync engine applies it to every session. See [what the collector sends](/what-the-collector-sends/).

## How to check your work

```sh
npm install
npm run check
```

`npm run check` builds, lints and runs the tests. Then run `aom sync` against your own sessions and look at the result in the app before you open a pull request. Describe in the pull request which agent version you tested against; the formats move.

---
title: Where AI coding agents keep their sessions
description: Paths, file formats and the fields the collector reads for OpenCode, Claude Code, Codex and Pi, with the version each was checked against.
slug: session-formats
order: 1
verified: 2026-11-19
checkedAgainst: "OpenCode 2.3.0, Codex rollout files written by 0.169.0-alpha.11.1 and Pi 0.79.1, read on one macOS machine; Claude Code from the vendor's documentation (not verifiable on that machine); collector 0.1.3, commit abe3f56."
kind: reference
---

The collector reads files your agents already write. This page says where they are, what shape they have, and which fields the collector uses. Paths are for **macOS**; I did not check Windows or Linux.

| | OpenCode | Claude Code | Codex | Pi |
|---|---|---|---|---|
| Format | SQLite (WAL mode) | JSONL | JSONL | JSONL |
| One file per | one database for all sessions | session | session, in a folder per day | session, in a folder per project |
| Checked here against | 2.3.0 (read) | not on this machine | rollouts from 0.169.0-alpha.11.1 (read) | 0.79.1 (read) |

Table: the shape of each agent's storage. "Read" means I opened the files on a real install and looked at their structure on 19 November 2026; I looked at key names and counts, not at message content.

Where the collector looks, on macOS:

- **OpenCode:** `~/.local/share/opencode/opencode.db`, opened read-only.
- **Claude Code:** `~/.claude/projects/<project>/<session>.jsonl`, one directory deep.
- **Codex:** every `rollout-*.jsonl` below `~/.codex/sessions/`, which is organised as `YYYY/MM/DD/rollout-<timestamp>-<uuid>.jsonl`. Files ending in `.jsonl.zst` are not read.
- **Pi:** every `*.jsonl` below `~/.pi/agent/sessions/`, organised as `--<project>--/<timestamp>_<uuid>.jsonl`.

## OpenCode

OpenCode keeps everything in one SQLite database. The collector opens it read-only. OpenCode 2.x moved sessions to new tables and stopped writing the old ones; on the database I checked, the old tables were last written on 5 October 2026. The collector uses `session_v2` and `session_message` when `session_v2` exists, and the older `session`, `message` and `part` tables otherwise. The full evidence, with the queries, is in [the blog post on the move](https://blog.agentsofmine.io/posts/opencode-moved-sessions-to-session-v2/).

| Table | What the collector takes from it |
|---|---|
| `session_v2` | One row per session: id, project, directory, title, version, creation time, model |
| `session_message` | One row per turn, with the content in a JSON `data` column. The collector reads the `user` and `assistant` types |
| `project` | The project's working directory |

The vendor says `OPENCODE_DB` can move the database. The collector does not read that variable: it opens the default path only.

## Claude Code

Claude Code writes one JSONL file per session under `~/.claude/projects/<project>/`, where `<project>` is the working directory with each character that is not a letter or digit replaced by `-` (the vendor's description). The vendor also says the line format is internal and changes between versions, so a reader can break on any release.

**Not checked here.** On the machine used for this page, `~/.claude/projects/` was empty, so I could not open a real Claude Code session file. What follows is what the collector's code and tests read:

- Lines whose `message.role` is `user` or `assistant`.
- Content blocks of type `text`, `thinking`, `tool_use`, `tool_result` and `image`. A tool result arrives in a later `user` line and is matched to its call by `tool_use_id`.
- The working directory from a line's `cwd`, and the model from the first `message.model`.

Subagent transcripts are written under `<session>/subagents/` and are **not** read: the collector looks one directory deep only. Sessions are also deleted after 30 days by default; see [Claude Code deletes sessions after 30 days](/claude-code-deletes-sessions-after-30-days/).

## Codex

Codex writes one rollout file per session into a folder per day. Each line has a top-level `type`, and most of the content sits in a `payload`. On the files I opened, the top-level types were `session_meta`, `event_msg`, `response_item`, `turn_context`, `token_usage_record` and `world_state`.

| Line type | Inside it | Used by the collector |
|---|---|---|
| `session_meta` | session id, start time, working directory, `cli_version` | yes: id, start time and project |
| `turn_context` | working directory | only when `session_meta` had none |
| `response_item` | `payload.type` is `message`, `reasoning`, `function_call`, `function_call_output` or `additional_tools` | `message` with role user or assistant, as text only; `function_call` named `exec_command`, to estimate changed files |
| `event_msg`, `token_usage_record`, `world_state` | progress, token counts, state | no |

Codex also keeps a SQLite index, `~/.codex/state_5.sqlite`, with a `threads` table. The collector does not read it. Codex compresses older rollout files with zstd and renames them to `rollout-….jsonl.zst`, and the index keeps the old `.jsonl` path. On my machine the index listed 199 threads. The stored path existed for 10 of them; for the other 189 the same path with `.zst` added existed, and none was missing. The collector accepts only file names ending in `.jsonl`, so it does not read the compressed ones, and it does not look in `archived_sessions/` at all. I did not check when or why Codex compresses a file.

## Pi

Pi writes one JSONL file per session into a folder named after the working directory, wrapped in `--`. The folder name replaces `/` with `-`, which cannot be reversed when a path itself contains `-`, so the collector prefers the `cwd` in the file's first line when it has read it.

On the file I opened, the line types were `session` (first line: `version`, `id`, `timestamp`, `cwd`), `model_change`, `thinking_level_change` and `message`. Messages carry a role of `user`, `assistant` or `toolResult`, and content blocks of type `text`, `toolCall` or `image`. A tool result is a separate message, matched to its call by id. `pi --session-dir` can move the storage; the collector does not read that option.

## What this page does not tell you

- **Formats change.** None of these is a published, versioned contract for readers; the Claude Code vendor says so explicitly. If a field here no longer matches, [open an issue](https://github.com/AgentsOfMine/collector/issues).
- **Only what exists on disk.** If an agent or you deleted a session file, there is nothing to read.
- **One machine.** The key names and counts above come from one person's install.

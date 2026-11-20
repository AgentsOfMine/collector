---
title: Where AI coding agents keep their sessions
description: Paths, file formats and the fields the AgentsOfMine collector reads for OpenCode, Claude Code, Codex and Pi, with the version each was checked against.
slug: session-formats
order: 1
verified: 2026-11-20
checkedAgainst: "OpenCode 2.3.0, Codex rollout files written by 0.169.0-alpha.11.1 and Pi 0.79.1, read on one macOS machine; Claude Code from the vendor's documentation (not verifiable on that machine); collector 0.1.3, commit abe3f56. Windows and Linux paths from the vendors' documentation and issue trackers and from the collector's source, read on 20 November 2026 and not run."
kind: reference
---

**Why this matters.** If you write a tool that reads your own sessions (a backup, an export, a viewer), or you wonder why one stopped showing new ones, you need to know where each agent keeps them and in what shape. This page gives you that for four agents, with the version each was checked against.

The AgentsOfMine collector, an open-source program that uploads a copy of your coding sessions to your private workspace, reads files your agents already write. This page says where they are, what shape they have, and which fields the collector uses. Paths in the lists are for **macOS**, the only system I ran anything on. [Windows and Linux](#windows-and-linux) has what the vendors document for them, which I did not run.

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

## Who needs this

**Possible scenario.** You want a nightly copy of everyone's agent sessions in one folder, to search later. The four agents keep them in different shapes: one SQLite database, and JSONL files per session, per day or per project. A script that assumes one shape silently skips the others.

| Role | What changes for them |
|---|---|
| DevOps or platform engineer | Gets the path and the shape per agent for one backup job, with the version each was read at. |
| Senior software engineer | Knows which fields the collector uses, so their own tool can read the same ones. |
| Architect | Treats each format as an interface that can change, and sees which versions this page was checked against. |

Table: who gains what, **my reasoning, not measured.** I did not measure time saved for any role.

## OpenCode

OpenCode keeps everything in one SQLite database. The collector opens it read-only. OpenCode 2.x moved sessions to new tables and stopped writing the old ones; on the database I checked, the old tables were last written on 5 October 2026. The collector uses `session_v2` and `session_message` when `session_v2` exists, and the older `session`, `message` and `part` tables otherwise. The full evidence, with the queries, is in [the blog post on the move](https://blog.agentsofmine.io/posts/opencode-moved-sessions-to-session-v2/).

| Table | What the collector takes from it |
|---|---|
| `session_v2` | One row per session: id, project, directory, title, version, creation time, model |
| `session_message` | One row per turn, with the content in a JSON `data` column. The collector reads the `user` and `assistant` types |
| `project` | The project's working directory |

The vendor says `OPENCODE_DB` can move the database. The collector does not read that variable: it opens the default path only.

## Claude Code

Claude Code writes one JSONL file per session under `~/.claude/projects/<project>/`, where `<project>` is the working directory with each character that is not a letter or digit replaced by `-` (the vendor's description). The vendor also says the line format is internal and changes between versions, so a reader can break on any release. Because the folder name comes from the working directory, a session started in another folder is stored under another name; [how to resume one from a different folder](/resume-claude-code-session-from-another-folder/) was tested on two Claude Code versions.

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

For turning a session into a readable file, see [Export OpenCode, Codex and Claude sessions to Markdown](https://blog.agentsofmine.io/posts/export-ai-coding-sessions-to-markdown/).

## Windows and Linux

**Assumed, not tested.** I ran nothing on Windows or Linux. This section comes from each vendor's documentation and issue tracker and from the collector's source, read on 20 November 2026. Each line says where it comes from: *documented* is the vendor's own page, *reported* is somebody's issue or article, *assumed* is my reading of a rule. The only lines I ran are the OpenCode override commands, on macOS.

**The short version.** On Linux, expect every path above unchanged. On Windows, the vendors put the same folders under the user profile (`%USERPROFILE%`, for example `C:\Users\<you>`) with the same names. Two things differ: the project folder names also replace `\` and `:`, and a tool run inside WSL keeps its data in the Linux home of its distribution.

- **OpenCode.** Linux: the same as macOS (documented: the vendor's troubleshooting text lists `~/.local/share/opencode/` for "macOS/Linux"). Windows: `%USERPROFILE%\.local\share\opencode\opencode.db`, which the same text tells you to open (documented, in the V1 docs source). Two reports agree: an issue in another tool's tracker (July 2026) puts the database at `C:\Users\<name>\.local\share\opencode\` on OpenCode 1.17.13, and a forensics write-up confirms it on Windows Server 2025 with 1.18.26. Both are OpenCode 1.x; I tested 2.3.2. A January 2026 request that OpenCode follow Windows folder conventions was closed, and I did not find out whether it changed anything. Two settings move the database. On macOS with 2.3.2, `opencode debug paths db` printed the default path, then `<XDG_DATA_HOME>/opencode/opencode.db` with that variable set, then the exact file given in `OPENCODE_DB` (tested). The `opencode db path` command from the V1 docs does not exist in 2.3.2: it printed the general help.
- **Claude Code.** Linux: `~/.claude/projects/<project>/<session>.jsonl`, as on macOS (documented). Windows: `~/.claude` resolves to `%USERPROFILE%\.claude` (documented, the vendor's `.claude` directory page). `CLAUDE_CONFIG_DIR` moves the whole folder (documented). The project folder name replaces every character that is not a letter or a digit with `-` (documented), so `C:\Users\me\proj` should become `C--Users-me-proj` (assumed: I applied the rule by hand). The vendor lists Windows 10 1809 or later, Ubuntu 20.04 or later, Debian 10 or later and Alpine 3.19 or later, and says the installer also covers WSL (documented).
- **Codex.** `CODEX_HOME`, default `~/.codex` (documented), so Linux matches macOS. On Windows that is `%USERPROFILE%\.codex`: the vendor's Windows setup page uses `C:\Users\alice\.codex` as its example `CODEX_HOME` (documented as an example), and an open report from July 2026 says the Windows desktop app keeps its data there and ignores `CODEX_HOME`, while the command-line tool honours it (reported). If that is still true, the app and the command line can end up in different folders once you set the variable (assumed). The `sessions/YYYY/MM/DD/` layout is not documented per system; I assume it is the same.
- **Pi.** `~/.pi/agent/sessions/`, grouped by working directory (documented). On Windows, `%USERPROFILE%\.pi\agent\` comes from a third-party install guide (reported); I did not find the path on the vendor's own Windows page. The vendor's session-format page says the folder name is the working directory with the leading separator removed and `/`, `\` and `:` replaced by `-` (documented), so `C:\Users\me\proj` should become `--C--Users-me-proj--` (assumed: rule applied by hand). `PI_CODING_AGENT_SESSION_DIR`, `--session-dir` and the `sessionDir` setting move the sessions, and `PI_CODING_AGENT_DIR` moves the configuration folder (documented). Pi runs natively on Windows or inside WSL (documented).
- **WSL.** A tool installed inside WSL uses the Linux environment of that distribution (documented for Pi, assumed for the others), so its sessions sit in that distribution's Linux home, not under `%USERPROFILE%`. A Windows program that only looks under `%USERPROFILE%` will not see them (assumed).
- **The collector.** In its source, each path is the home directory plus the Unix-style names above, and it reads none of `XDG_DATA_HOME`, `OPENCODE_DB`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME` or `PI_CODING_AGENT_SESSION_DIR` (searched at commit 897f7db; the path code is unchanged since abe3f56). Its README lists macOS and Linux as supported, says Windows is not supported, and says Linux has not been run end to end. So on Linux with default settings it should read the paths above (assumed). On Windows the folders the vendors document match the ones its path code would build (assumed), so paths are not what blocks it; the project's [cross-platform note](https://github.com/AgentsOfMine/collector/blob/main/docs/CROSS_PLATFORM.md) lists other open items, such as secret storage and shutdown signals. If you move a folder with one of the variables above, it will not see it.

## What this page does not tell you

- **Formats change.** None of these is a published, versioned contract for readers; the Claude Code vendor says so explicitly. If a field here no longer matches, [open an issue](https://github.com/AgentsOfMine/collector/issues).
- **Only what exists on disk.** If an agent or you deleted a session file, there is nothing to read.
- **One machine.** The key names and counts above come from one person's install.
- **Windows and Linux.** Nothing was run there. The section above is documentation and reports, with the version each one was about. A Windows report from OpenCode 1.x does not prove 2.x.

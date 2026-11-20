---
title: Compact a coding session without losing the thread
description: What /compact keeps in Claude Code, OpenCode and Codex, which can compact part of a session, what to set, and what the open-source AgentsOfMine collector reads.
slug: compaction-in-claude-code-opencode-codex
order: 6
verified: 2026-11-20
checkedAgainst: "OpenCode 2.3.0 run on copies and a private server; Codex source at commit 6eea328 and rollouts written by 0.153 to 0.169, read; Claude Code from the vendor's documentation fetched 19 November 2026, not run (installed 2.1.173, newest 2.1.328); collector 0.1.3, commit cfb2507; the `jq` filter in step 4 run on a made-up export in an Ubuntu 24.04 container on 20 November 2026; Windows from Microsoft's documentation, not run."
kind: guide
---

**Why this matters.** A long session fills the model's context, and the agent gets slower, costs more per message and loses track of earlier decisions. Compaction keeps a session usable by replacing the older part with a summary. This page tells you what each of three agents keeps and drops, which one can compact only part of a session, and what to set so it happens at a moment you choose.

Compaction replaces the older part of a session with a summary so the session can go on past the model's context limit. All three agents do it, on a command and automatically near the limit. They differ in what they keep, in whether you can limit it to one part of the session, and in what they leave on disk. Paths and file formats are on [the session formats page](/session-formats/); this page covers only compaction. What to do about it comes right after the table.

| | Claude Code | OpenCode | Codex |
|---|---|---|---|
| Manual command | `/compact [instructions]` | an API request (`POST /api/session/{id}/compact`) and a keybind | `/compact` |
| Focus the summary | yes, with instructions | no field for it | no argument |
| Compact only part of a session | yes: `/rewind`, then **Summarize from here** or **Summarize up to here** | no; the nearest is a fork before a chosen message | no |
| Automatic | yes, near the limit; `/autocompact <tokens>` sets the point | yes, on by default; `compaction.buffer` sets the free share | yes; `model_auto_compact_token_limit` sets the point |
| Recent turns kept as they were | the messages after the last compaction | about the last 15,000 tokens (`compaction.keep.tokens`) | a replacement history plus the summary |
| Original messages afterwards | stay in the transcript (the vendor says so for rewind-summarize; not stated for `/compact`) | stay in the database (tested) | stay in the rollout file (tested) |

Table: what each agent documents or does, checked on 19 November 2026. OpenCode's API and database were run (its keybind and settings are from its documentation); Claude Code is from its documentation and was not run; Codex is from its source and from rollout files on one machine.

## Who needs this

**Possible scenario.** Your team uses Claude Code and Codex side by side. A developer who learned to compact only part of a session in one expects the same in the other, and finds there is no such command. They either lose the thread or start again. The table on this page tells them before they try.

| Role | What changes for them |
|---|---|
| Senior software engineer | Knows which agent can limit compaction to part of a session and which cannot, and can choose per task. |
| Architect | Knows what each agent keeps after a compaction, so the decisions that matter go in files that reload and not only in the chat. |
| DevOps or platform engineer | Knows the one setting per agent that moves the point where automatic compaction starts. |

Table: who gains what, **my reasoning, not measured.** I did not measure time saved for any role.

## What to do about it

1. **Look at the size first.** Claude Code: `/context` shows what fills the window (documented, not run). OpenCode: the export's `info.tokens` holds the session's token totals (the key exists, tested; I did not compare it with what the model sees). Codex: `/status` is described as showing "current session configuration and token usage" (from the source, not run).
2. **Compact when a task ends, not at the limit.** The automatic pass guesses what matters; you know what you need next. In Claude Code, `/compact focus on the auth bug fix` says what to keep, and `/autocompact <tokens>` moves the point earlier. In OpenCode, raise `compaction.buffer` to compact earlier and `compaction.keep.tokens` to keep more recent detail exact. In Codex, lower `model_auto_compact_token_limit`.
3. **Put what must survive in a file that reloads.** Claude Code re-reads the project-root `CLAUDE.md` from disk, and a skill that is too long is cut to its start, so put the important instructions at the top. OpenCode takes the current instruction files as the new baseline after a compaction. Anything said only in the chat is summarized. (Both from the vendors' documentation, not run.)
4. **Drop an irrelevant stretch.** Claude Code: `/rewind`, pick the message, **Summarize from here** or **Summarize up to here**. OpenCode and Codex have no command for it. For OpenCode there is a workaround, tested on a copy of my database (45 messages became 24 and the session kept its id): export, remove a range with `jq`, delete the original, import the edited file.

   ```sh
   # keep full.json: it is your undo
   opencode session export "$ID" > full.json
   jq '.messages |= (to_entries | map(select(.key < 10 or .key > 30))
       | map(.value))' full.json > edited.json
   opencode session delete "$ID" && opencode session import edited.json
   ```

   Import refuses an id that exists ("Session already exists", tested), which is why the delete comes first. **Not tested:** whether the agent carries on sensibly from the edited session, and whether cutting between a tool call and its result breaks it. Cut at message boundaries you have read, and try it on a session you can lose. For a smaller version of the same idea, a fork before a chosen message keeps the original: `POST /api/session/{id}/fork` with `{"before": "<message id>"}`.
5. **Do not rely on the summary for exact text.** Compaction is lossy in all three. Anything you need word for word (an error message, a command, a path) should be in a file or in the last turns.

I did not test any of these on Claude Code or Codex.

## Claude Code

- **What it does.** `/compact` summarizes the conversation so far; optional instructions, such as `/compact focus on the auth bug fix`, steer what the summary keeps. The vendor lists what comes back after it: the system prompt, `CLAUDE.md` files at the project root, auto memory, the plan from plan mode, and up to five recently read files (a file over 5,000 tokens comes back as a path only). Invoked skills are re-injected up to 5,000 tokens each and 25,000 in total, oldest dropped first.
- **What does not come back.** Rules with a `paths:` filter, nested `CLAUDE.md` files and context that hooks added are summarized with the rest and reload only when their trigger file is touched again.
- **Part of a session.** The rewind menu (`/rewind`, or Esc twice) offers **Summarize from here**, which compresses everything after the chosen message, and **Summarize up to here**, which compresses everything before it and keeps what follows. You can type instructions for either. The vendor says summarizing does not change files on disk and the original messages stay in the transcript.
- **Automatic.** Claude Code compacts before the window fills. `/autocompact 500k` sets how full the window gets first.
- **Not run.** The Claude Code CLI is installed here (2.1.173) but a headless run failed on this machine, so none of this was observed. The newest published version is 2.1.328. The vendor's command list says `/autocompact` requires 2.1.221 or later, yet the text `/autocompact to configure` is in the installed 2.1.173 binary (found with `strings`, not run), so the version note and the installed program disagree; I did not find out why.

## OpenCode

- **What it does.** The whole current conversation is summarized, and about the last 15,000 tokens are kept beside the summary, so recent detail stays exact. The summary is structured (objective, decisions, active work, next moves, files). Long tool output in the kept part is shortened. A later compaction updates the earlier summary.
- **Settings** (`opencode.jsonc`): `compaction.auto` (default true), `compaction.keep.tokens` (default 15,000), `compaction.buffer` (default 15 percent of the window, at least 16k), `compaction.background` (default true: the summary is written ahead of time). `agents.compaction.model` picks another model for summaries. Native provider compaction is opt-in per provider or model.
- **Manual.** `opencode api post /api/session/<id>/compact --data '{}'`. The reply says the request was accepted; it does not wait for the summary. A request made while one is pending merges into it. It works when `auto` is false.
- **Part of a session.** There is no way to compact a range. `POST /api/session/{id}/fork` accepts a `before` message id and creates a child with the history before it. Tested on a copy: a fork before message 11 of a 22-message session gave a child with 10 messages and left the parent at 22.
- **On disk.** A compaction is one `compaction` row in `session_message`, with `summary`, `recent`, `reason` (`auto` or `manual`) and `status`. The earlier messages stay in the table. On my database, 100 compaction rows (63 automatic, 37 manual) belong to 45 sessions, and 9,030 earlier messages are still stored. The summary alone is a median of 0.78 percent of the stored message data it replaces (10th to 90th percentile 0.20 to 3.04, over 92 compactions).
- **Limits.** Compaction cannot create room when a request is mostly fixed instructions and tool schemas. It is lossy; raise `keep.tokens` when exact recent details matter.

## Codex

- **What it does.** `/compact` is described as "summarize conversation to prevent hitting the context limit". The summary is written from a fixed prompt that asks for a handoff: progress and key decisions, constraints and preferences, what remains, and any critical data. It takes no arguments in the command list, and `compact_prompt` in the config changes the prompt.
- **Settings:** `model_auto_compact_token_limit` (the threshold), `model_auto_compact_token_limit_scope`, `model_context_window`, `tool_output_token_limit`. A background mode (`async_compaction`) starts compaction at a percentage of the window, default 65, and is off unless configured.
- **Part of a session.** None found. Esc, Esc opens backtracking, which reverts to before a chosen turn and puts its prompt back in the composer; that rewinds rather than compacts.
- **On disk.** A compaction is a `compacted` line in the rollout file with a `message` (the summary) and a `replacement_history` (the items that stand in for the older ones). Three of my 201 rollout files contain one each: summaries of 2,406 to 4,236 characters and replacement histories of 10 to 148 items. Messages before the compaction stay in the file (53, 294 and 23 user and assistant messages before it; 11, 135 and 6 after).
- **Not run.** The Codex command line is not installed here. The behaviour above is from the source at commit 6eea328 and from the three rollout files.

## What the AgentsOfMine collector reads of a compacted session

The AgentsOfMine collector is an open-source program that reads the session files your coding agents write and uploads a copy to your private workspace. It uploads user and assistant messages and ignores everything else (collector 0.1.3, commit cfb2507). For OpenCode that means the `compaction` row and its summary are not uploaded, and the earlier messages, which stay in the table, are. For Codex a `compacted` line is not a message, so the summary is skipped. For Claude Code only lines with `message.role` `user` or `assistant` are kept; I found no real transcript on this machine to check for a separate summary record. So an uploaded session shows the conversation as it happened, not the shortened context the model worked from. The collector has no code that mentions compaction.

## Windows and Linux

**Tested on Linux for the `jq` filter only; Windows documented or assumed, not run.** The filter in step 4 gave the same result on Ubuntu 24.04 (jq 1.7, a made-up export of 36 messages: 15 left after the cut, tested). I did not run `opencode` there.

- **Linux.** `jq` is in the Debian and Ubuntu repositories (documented: the `jq` download page).
- **Windows.** The `jq` page lists `winget install jqlang.jq`, Scoop, Chocolatey and standalone executables (documented). PowerShell parses arguments before a native program sees them, and quotes inside a filter are easy to lose (documented in general: Microsoft's `about_Parsing` page; I did not try this filter there). So put the filter in a file and run `jq -f cut.jq full.json > edited.json` (assumed). If you need the output as UTF-8 without a byte-order mark, use PowerShell 7, which defaults to that (documented: `about_Character_Encoding`); the Windows PowerShell 5.1 pages I read disagree about what `>` writes, so I state nothing about it. `opencode` itself: the V1 docs recommend WSL on Windows (documented, and marked as V1), so I assume the step-4 commands run there unchanged.

## What this page does not tell you

- **How good a summary is.** I did not read any summary; I measured only lengths and counts.
- **Claude Code and Codex behaviour.** Not run, as above.
- **Windows and Linux.** `opencode` was not run on either; see [Windows and Linux](#windows-and-linux).
- **Other versions.** OpenCode's compaction changed between 1.x and 2.x (the vendor's migration note says so). Everything here is OpenCode 2.3.0.
- **Whether any of this saves you time or tokens.** I did not measure it. [One person's 100 compactions, measured](https://blog.agentsofmine.io/posts/opencode-compaction-measured/) has the numbers behind the sizes above and the queries to run on your own database.

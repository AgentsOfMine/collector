---
title: Resume a Claude Code session from another folder
description: Claude Code 2.1.329 resumes a session by id from any folder; 2.1.173 did not. What each route does, what the session sees, and how Codex and OpenCode compare.
slug: resume-claude-code-session-from-another-folder
order: 7
verified: 2026-11-20
checkedAgainst: "Claude Code 2.1.173 and 2.1.329 (npm latest on 20 November 2026), Codex CLI 0.170.0, OpenCode 2.3.2, all on macOS in throwaway folders with an isolated config directory; the vendor's sessions page and changelog read on 20 November 2026; the script's shell parts run in an Ubuntu 24.04 container on 20 November 2026 (Claude Code not run there); Windows from documentation only, not run."
kind: guide
---
**Yes, on a current version.** In Claude Code 2.1.329, `claude --resume <session-id>` works from any folder. In 2.1.173 the same command failed with "No conversation found", and the way around it was to pass the path of the transcript file instead. Check your version first: that is the whole difference.

**Why this matters.** A session you cannot reopen is a session you lost, even though the file is still on disk. You need this when you rename or move a project folder, start work in the wrong repository, or want to continue a conversation from a different checkout. The fix takes one command, and the version check takes ten seconds.

## Who needs this

**Possible scenario.** You discussed a design with the agent for an hour in `~/code/billing`. The next day you rename the folder to `~/code/invoicing`, open a terminal there, and the session list shows nothing from yesterday. The conversation file is still in Claude Code's storage, under a folder name built from the old path.

| Role | What changes for them |
|---|---|
| Junior software engineer | Knows the session is not gone after a rename, and has the one command to get it back. |
| Senior software engineer | Knows which folder's instructions the resumed session follows, so a handover does not surprise anyone. |
| DevOps or platform engineer | Can say which Claude Code version a team needs for resume by id, and what a transcript-path resume leaves behind. |

Table: who gains what, **my reasoning, not measured.** I did not measure time saved for any role.

## The problem, shown

I created a session in folder A, then ran `claude --resume <id>` from folder B, on the version installed on this Mac:

```text
No conversation found with session ID: b27b3d29-6031-4b6d-8b9b-1243855cc298
```

The transcript was in Claude Code's storage the whole time. The vendor's [sessions page](https://code.claude.com/docs/en/sessions) says you can run `claude --resume <id>` from any directory, and that it looks in the current project first and then in every other project on the machine. On 2.1.173 that was not what happened (tested), so the documentation describes a newer behaviour. I did not find the changelog entry that introduced it.

## What works, by version

Every cell is one run on 20 November 2026, in throwaway folders, with `CLAUDE_CONFIG_DIR` pointing at a temporary copy so my real storage was never touched. The session was created in folder A with a made-up code word, then resumed from folder B. “Works” means the session resumed and the reply contained the code word.

| From folder B | 2.1.173 | 2.1.329 |
|---|---|---|
| `--resume <id>` | Not found | Works |
| `--resume <path>` | Works | Works |
| `--resume <id>`, A deleted | Not found | Works |
| `--continue` | New session | New session |
| `--resume <id>` from A | Works | Works |

Table: what resuming from another folder did; `<path>` is the transcript file. **Tested**, one run per cell. All runs were non-interactive (`claude -p`), so the interactive picker was not tested.

What happened underneath:

- **By id on 2.1.329:** the original transcript file grew. No second copy.
- **By path on 2.1.329:** same, the original grew and no copy appeared.
- **By path on 2.1.173:** a **copy** of the transcript appeared in folder B's storage folder, and the original stayed as it was.
- **`--continue`:** it did not pick up folder A's session. It started a new, empty conversation in B on both versions, so the code word was not remembered.

One more case on 2.1.329: I hand-copied a transcript into a second project folder, so two folders held the same id, and resumed by id from a third folder. It answered "No conversation found". The vendor page says this is by design: the search across projects resolves an id only when exactly one other project holds it (tested once).

## What the resumed session sees

Moving a session to another folder changes more than where it is stored. In each run, folder A and folder B had a different one-line instruction file, and the resumed session was asked which one it saw and to print its working folder with a shell command.

Results, **tested**, one run each on 20 November 2026:

- **Claude Code 2.1.329, by id:** read folder B's instruction file, ran its shell in B, saved to the same transcript file, whose `cwd` fields now name both folders.
- **Claude Code 2.1.173, by path:** read folder B's file, ran its shell in B, saved to a copy in B's storage folder.
- **Codex CLI 0.170.0, `codex exec resume <id>`:** ran its shell in B, saved to the same rollout file, whose `cwd` fields now name both folders. Which instruction file it read was not tested.
- **OpenCode 2.3.2, `opencode run --session <id>`:** read folder **A's** instruction file, ran its shell in **A**, and the session's stored directory stayed A.

So Claude Code and Codex carry the conversation into the new folder and work there. OpenCode keeps the session tied to the folder it started in, and resuming from elsewhere still edits A. Codex needed no extra flag: `codex exec resume <id>` worked from another folder with and without `--all`. Its help text describes `--all` as turning off the folder filter for listing sessions, and I did not run the interactive picker.

## What to do

1. **Check the version.** Run `claude --version`. On 2.1.173 the id route failed; on 2.1.329 it worked. I did not test the versions in between. Update Claude Code the way you installed it.
2. **Find the id.** It is the file name under `~/.claude/projects/<project>/<id>.jsonl`. Sessions started with `claude -p` do not appear in the picker (the vendor page says so), so the file name is the reliable way. If you set `CLAUDE_CONFIG_DIR`, look there instead of in `~/.claude`.
3. **Resume from the folder you want to work in:** `claude --resume <id>`.
4. **On an older version, pass the path:** `claude --resume ~/.claude/projects/<project>/<id>.jsonl`. It worked on both versions I ran. On 2.1.173 it leaves a second copy of the conversation, so two files now hold the same text: remember both when you back up or delete.
5. **Pass your launch flags again.** The vendor page says `--add-dir`, `--mcp-config`, `--plugin-dir`, `--settings` and `--fallback-model` are not restored on resume (documented, not tested here).

To check your own version in about a minute, this script creates a throwaway session in one folder and resumes it from another, then deletes both folders and the transcripts. It sends two short prompts to your model provider, so it uses a few tokens.

```sh
T=$(mktemp -d ~/aom-resume-test.XXXXXX); mkdir "$T/a" "$T/b"
cd "$T/a" && ID=$(claude -p "Say noted." --output-format json | jq -r .session_id)
cd "$T/b" && claude -p "What was my first message to you?" --resume "$ID"
cd ~ && rm -r "$T" "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/projects/*aom-resume-test*
```

On 2.1.173 it printed "No conversation found with session ID ...". On 2.1.329 it answered with the first message. I ran it with `CLAUDE_CONFIG_DIR` set to a temporary folder, not against my real storage (which was empty on this Mac). It needs `jq`.

## Windows and Linux

**Tested on Linux for the shell parts only; Windows documented or assumed, not run.** I ran the `mktemp` line with its template under `$HOME`, the two `mkdir` calls and the `rm -r` on Ubuntu 24.04 (container, 20 November 2026): they worked (tested). I did not run `claude` there, so the version table above is macOS only.

- **Linux.** The script needs `jq`, which Debian and Ubuntu ship (`apt-get install jq`, documented: the `jq` download page). Claude Code supports Ubuntu 20.04 and later (documented: the vendor's setup page).
- **Windows.** The script is `sh`, and I wrote no PowerShell form. Inside WSL the vendor has you install and run Claude Code in the WSL terminal (documented), so I assume the script runs there unchanged and the session files sit in that distribution's Linux home. The storage folder name replaces every non-alphanumeric character with `-` (documented: the vendor's sessions page, which also says names over 200 characters are truncated and given a hash), so I assume a project in `C:\Users\me\proj` is stored under `C--Users-me-proj` (my reading of the rule, not run). Where the other agents keep sessions: [session formats](/session-formats/#windows-and-linux).

## What this page does not cover

- **Interactive use.** Every run was non-interactive (`claude -p`, `codex exec`, `opencode run`). The picker, its `Ctrl+W` and `Ctrl+A` widening, and the copied `cd` command the vendor page describes were not tested, and `/cd` was not run.
- **Versions.** Two Claude Code versions, one Codex version and one OpenCode version, one run per cell, on macOS only (see [Windows and Linux](#windows-and-linux)). I do not know which release between 2.1.173 and 2.1.329 changed the id lookup.
- **File edits.** I tested where a shell command runs, not where a file edit lands. The old conversation names paths in folder A, so an edit by a relative or remembered path may still go to A.
- **Codex instruction file.** I did not test which `AGENTS.md` a resumed Codex session reads.
- **OpenCode's move route.** OpenCode's API reference lists a route that moves a session to another directory when I read it on 19 November. I did not run it.
- **Where the proxy matters.** The model was served through a local proxy. That does not change which folder or file is used, which is what was tested, but the replies are not the point.
- **How this meets the 30-day cleanup and the collector.** See [the 30-day page](/claude-code-deletes-sessions-after-30-days/) for the cleanup and [session formats](/session-formats/) for where each tool stores files. I did not run the collector on a session that had been resumed from another folder.

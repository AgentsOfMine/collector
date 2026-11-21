---
title: "Claude Code deletes sessions after 30 days: how to keep them"
description: Claude Code removes session transcripts older than 30 days by default. What goes, what stays, three ways to keep them, and where the setting has failed.
slug: claude-code-deletes-sessions-after-30-days
order: 4
verified: 2026-11-20
checkedAgainst: "The vendor's documentation and changelog read on 19 November 2026; commands run on throwaway folders on macOS and in an Ubuntu 24.04 container on 20 November 2026; Windows from Microsoft's and the vendors' documentation only, not run; collector 0.1.3, commit abe3f56. The deletion itself was not reproduced."
kind: guide
---
**Yes.** By default Claude Code deletes session transcripts that are older than 30 days, in the background and without a message. To keep them, raise `cleanupPeriodDays` in `~/.claude/settings.json`, or copy the files somewhere Claude Code does not touch. Two cautions: the setting has not always been honoured (see below), and a copy kept inside `~/.claude` is not a safe copy.

**Why this matters.** A Claude Code session is the only record of why a change was made, and without a setting or a copy it is deleted after 30 days, silently. You need this before you lose one you wanted: the setting takes a minute and a copy script takes ten.

## Who needs this

**Possible scenario.** Six weeks after a feature shipped, a bug is reported in it. You remember talking through a trade-off with the agent and you want the reason. The session file was swept in the background after 30 days. Nothing warned you, and nothing can bring it back.

| Role | What changes for them |
|---|---|
| Junior software engineer | Knows the default exists before the first session is lost, and can raise one number. |
| DevOps or platform engineer | Decides once whether to raise `cleanupPeriodDays` or run a copy job, instead of every developer finding out alone. |
| CTO or engineering lead | Sees that how long agent history is kept is set by a vendor default unless someone chooses otherwise. |

Table: who gains what, **my reasoning, not measured.** I did not measure time saved for any role.

## What is deleted, and when

The [Claude Code documentation](https://code.claude.com/docs/en/claude-directory#cleaned-up-automatically) says a background sweep runs after a session starts and deletes files older than `cleanupPeriodDays`. The default is 30, the minimum is 1, and `0` is rejected. The sweep shows nothing: an old session simply stops appearing in `/resume`. A session can also be missing from the list only because you are in a different folder, and then it is not deleted: see [resuming a session from another folder](/resume-claude-code-session-from-another-folder/).

| Under `~/.claude/` | What it is | Swept? |
|---|---|---|
| `projects/<project>/<session>.jsonl` | The conversation: messages, tool calls, tool results | Yes |
| `projects/<project>/<session>/subagents/` | Subagent transcripts | Yes, with the parent |
| `file-history/<session>/` | File snapshots for `/rewind` | Yes (rewinding afterwards can fail with "No files were restored") |
| `plans/`, `debug/`, `paste-cache/` | Plan files, debug logs, large pastes | Yes |
| `history.jsonl` | Every prompt you typed | No (the documentation lists one exception: under the HIPAA configuration each sweep also trims it) |
| `projects/<project>/memory/` | Auto memory | No |
| Claude Desktop and Cowork transcripts | Sessions started or continued in those apps | No, unless `desktopSessionCleanupPeriodDays` is set (Claude Code 2.1.248 or later) |

Runs started with `claude -p --bare` skip the sweep. A commenter with the repository's `COLLABORATOR` association tested this on Claude Code 2.1.233: a transcript backdated by 40 days was deleted with default settings and kept with `"cleanupPeriodDays": 3650` ([issue 62476](https://github.com/anthropics/claude-code/issues/62476), 17 August 2026). The same comment calls this the documented default, not a malfunction.

## See what is at risk

```sh
find ~/.claude/projects -maxdepth 2 -name '*.jsonl' -mtime +20 | wc -l
```

This counts session files last modified more than 20 days ago, so they are within about ten days of the 30-day cutoff. The documentation says "older than" without naming the timestamp, so modification time is my assumption. I ran the command against a throwaway folder with files of different ages: it counted the old ones and not the recent one. If you set `CLAUDE_CONFIG_DIR`, replace `~/.claude` with that directory.

## Three ways to keep them

**1. Raise the retention.** In `~/.claude/settings.json`:

```json
{
  "cleanupPeriodDays": 3650
}
```

That is about ten years. There is no "never" value, because `0` fails validation. Settings files are strict JSON: a comment or a trailing comma makes the file a settings error. Check with `/status` inside Claude Code that the file loaded.

**2. Copy the files out, without mirroring deletions.**

```sh
rsync -a ~/.claude/projects/ ~/claude-sessions-backup/projects/
```

Without `--delete`, `rsync` leaves a file in the backup after Claude Code removes it from the source. I tested both ways on a throwaway folder with the `rsync` that ships with macOS: the backup kept the deleted file, and the same command with `--delete` removed it from the backup too. Two cautions. The files are plain text, and the vendor says anything a tool read, such as a `.env` file or a printed credential, is in the transcript, so keep the copy somewhere only you can read. And run it before the cutoff, because a file the sweep has already removed cannot be copied.

**3. Sync them to somewhere you can read them.** AgentsOfMine is a collector that reads these files and uploads a copy to your private workspace, so you can search and re-read them on your phone:

```sh
npm install -g agentsofmine
aom pair
aom sync
```

`aom sync` reads every session file that exists at that moment, and `aom start` then watches for new ones. It is **not a backup**, and you should know what it does to a session first:

- Each upload is capped at 150 messages per session: the first one and the latest 149.
- Long tool output is shortened.
- Common secret formats (AWS keys, GitHub and `sk-` tokens, private keys) are replaced with a marker such as `<REDACTED:github-token>`. It is best effort, not a guarantee.
- It reads `~/.claude/projects/*/*.jsonl` only. It does not read subagent transcripts, and it does not look at `CLAUDE_CONFIG_DIR` (I checked the built code: with the variable set, the path it uses does not change). If you moved Claude Code's storage, it sees nothing.
- It only helps for files that exist when it runs. A session deleted before the first sync is gone from our side too.

For a full copy of a session, use option 1 or 2. For reading and keeping lessons, use option 3, and ideally combine them.

## What the collector does when Claude Code deletes a file

I ran the collector's own session reader against a throwaway folder, deleted a session file the way the sweep does, and ran it again: it listed one session fewer, raised no error and removed nothing. The collector never deletes an agent's session file (its only file removal is its own pairing state, on `aom unpair`). On the server side, in the code as of 19 November 2026, the `POST /sync` path has no delete call and the sessions and messages tables have no expiry, so a session that has been uploaded stays when the local file goes. The only code that removes those rows is the account deletion behind Settings → Delete account.

## Where the setting has failed

These are reports, not findings of mine. I read them and I have **not** reproduced any of them. State as of 19 November 2026:

| Report | What it says | State |
|---|---|---|
| [#41458](https://github.com/anthropics/claude-code/issues/41458) | `cleanupPeriodDays: 99999` was set, and 490 session files were still deleted. Commenters trace it to the settings file failing validation, or to `--setting-sources` without `user`, so the sweep fell back to 30 | Open, labelled `data-loss` |
| [#59248](https://github.com/anthropics/claude-code/issues/59248) | A user lost every transcript in a workspace, including ones under 30 days, with no prompt or warning | Open, 67 comments |
| [#109897](https://github.com/anthropics/claude-code/issues/109897) | Interactive transcripts under 30 days old were deleted with the setting unset, while `claude -p` transcripts survived. One reporter and two comments, one of them a similar report on Windows | Open, filed 14 November 2026 |

The changelog lists related fixes: in 2.1.101, `--setting-sources` without `user` no longer causes the sweep to ignore `cleanupPeriodDays`; in 2.1.181, long-running idle sessions no longer lose history when another process runs the cleanup; in 2.1.248, Desktop and Cowork sessions are kept; in 2.1.310, the sweep no longer deletes some recent files when the value is very large. The vendor's documentation now also says the sweep pauses when it cannot determine the retention period.

The practical conclusion is the one in option 2: do not depend on one setting for sessions you care about. Keep a copy outside `~/.claude`.

## Windows and Linux

**Tested on Linux, documented for Windows, nothing run on Windows.** I ran the commands above on Ubuntu 24.04 (arm64, in a container) on 20 November 2026, without Claude Code, so the sweep itself was not run there. Labels: *tested*, *documented* (the vendor's page, read on 20 November 2026) and *assumed* (my reading).

- **Linux.** The `find` line and both `rsync` runs behaved as on macOS: the backup kept a deleted file, and `--delete` removed it (tested; GNU find 4.9.0, rsync 3.2.7). `npm install -g agentsofmine` worked on Node 22.23.5, but `aom --version` failed with `libsecret-1.so.0: cannot open shared object file` until I installed `libsecret-1-0` (tested). The collector's README adds that storing the token needs a running Secret Service, which headless servers often lack (documented; I did not run `aom pair`).
- **Windows, paths.** `~/.claude` is `%USERPROFILE%\.claude`, and `CLAUDE_CONFIG_DIR` moves it (documented: the vendor's `.claude` directory page). The collector's README says Windows is not supported, so option 3 does not apply there.
- **Windows, copy.** `robocopy "%USERPROFILE%\.claude\projects" "%USERPROFILE%\claude-sessions-backup\projects" /E` is my assumed counterpart of `rsync -a`. Microsoft documents `/E` as copying subdirectories, empty ones included, and `/MIR` as `/E` plus `/PURGE`, which deletes destination files that left the source, like `--delete`. Do not use `/MIR` or `/PURGE` for this.
- **Windows, count.** This is my PowerShell form of the `find` line:

  ```powershell
  (Get-ChildItem "$env:USERPROFILE\.claude\projects" -Recurse -Depth 1 -Filter *.jsonl |
    Where-Object LastWriteTime -lt (Get-Date).AddDays(-21) | Measure-Object).Count
  ```

  I ran it in PowerShell 7.7.0 on Ubuntu, with `$env:HOME` for `$env:USERPROFILE`, not on Windows. It says 21, not 20, because `find -mtime +20` rounds ages down to whole days and lists files at least 21 days old (tested on macOS and Ubuntu: a file 20.5 days old was not listed).
- **WSL.** The vendor's setup page has you run the Linux installer inside the WSL terminal (documented), so I assume the files sit in that distribution's Linux home and the Linux commands apply there.

## What this page does not cover

- **I did not reproduce the sweep.** I tried it in an isolated directory with Claude Code 2.1.173; it exited with "Not logged in", so no session started and the sweep never ran. The deletion behaviour above comes from the vendor's documentation and the maintainer-associated test, not from my run.
- **Versions.** Several changelog entries are newer than the 2.1.173 on the machine I used. Behaviour may differ on yours.
- **Windows and Linux.** Nothing was run on Windows, and Linux ran in a container without Claude Code. See [Windows and Linux](#windows-and-linux).
- **Other agents.** Codex, OpenCode and Pi keep sessions elsewhere; see the [session formats page](/session-formats/).
- **Finding a session you kept.** Searching old conversations by what was said is tested in [Search old Claude Code conversations](https://blog.agentsofmine.io/posts/search-old-claude-code-conversations/); [the other half is getting one back](https://blog.agentsofmine.io/posts/restore-deleted-opencode-codex-session/) after it was deleted.

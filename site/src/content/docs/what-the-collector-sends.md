---
title: What the AgentsOfMine collector reads, redacts and uploads
description: Exactly what the AgentsOfMine collector reads from disk, what it removes before upload, what it sends and how often, and how to check each claim in the source.
slug: what-the-collector-sends
order: 2
verified: 2026-11-20
checkedAgainst: "Collector 0.1.3, commit abe3f56 (source read and the commands below run on 19 November 2026 on macOS; the install and the first check also run in an Ubuntu 24.04 container on 20 November 2026, commit 2a03ae9; Windows from the collector's notes and Node.js documentation only, not run)."
kind: reference
---

**Why this matters.** Installing a tool that reads your coding sessions means trusting it with your prompts and your code. This page lets you decide on facts: what it reads, what it removes before upload, what it sends and what it never touches, each with a command you can run to check.

Read this before you install the AgentsOfMine collector, an open-source program that reads the session files your coding agents write and uploads a copy to your private workspace. Everything below is from the collector's source (tested by reading it and running the commands shown), and every claim has a command you can run yourself.

## Who needs this

**Possible scenario.** A security reviewer asks one question before the tool goes on company laptops: what leaves the machine? You can answer with a list taken from the source, and each line has a command the reviewer can run to see it, instead of trusting you.

| Role | What changes for them |
|---|---|
| CTO or engineering lead | Gets facts to decide on: what is read, what is removed, what is sent and what is never touched. |
| DevOps or platform engineer | Can run the given commands on a test machine before any rollout. |
| Senior software engineer | Can read the cited source lines for the claim the reviewer will ask about. |

Table: who gains what, **my reasoning, not measured.** I did not measure time saved for any role.

## What it reads

The session files of four agents, read-only: OpenCode's database, Claude Code, Codex and Pi session files. Where they are is on [the session formats page](/session-formats/). Besides those, it runs `git` in a session's project folder to find out which project the session belongs to: `git rev-parse --show-toplevel`, `git rev-parse --abbrev-ref HEAD`, `git rev-parse HEAD` and `git remote get-url origin` (or the first remote, if there is no `origin`). Credentials in a remote's address are stripped before it is used. It reads its own state files in `~/.agentsofmine/`, and the package's own `package.json` for its version.

It never writes to your agents' files. The only files it writes are its own state in `~/.agentsofmine/`: `config.json`, `device-id`, `cursors.json` and `last-sync.json` (and `.bak` copies). To check:

```sh
git clone https://github.com/AgentsOfMine/collector
cd collector
grep -rnE "writeFile|appendFile|createWriteStream" src/
```

On 19 November 2026 every match was in `src/core/cursor-store.ts`, `src/core/last-sync-store.ts` or `src/infrastructure/config-repository.ts`. The only file the collector removes is its own pairing state, when you run `aom unpair`.

It does not log into any AI provider. To check:

```sh
grep -rniE \
  "anthropic\.com|api\.openai\.com|api\.github\.com|copilot|oauth|client_secret" \
  src/
```

On 19 November 2026 that printed nothing.

## What it removes before upload

Every session goes through [`src/core/redact.ts`](https://github.com/AgentsOfMine/collector/blob/abe3f56017b9dd488e8a9f6b309bdc813e7c6ff9/src/core/redact.ts) on your machine, just before it is sent. A match is replaced by a marker such as `<REDACTED:github-token>`.

| Marker | What it matches |
|---|---|
| `<REDACTED:aws-access-key>` | AWS access key ids (`AKIA…`, `ASIA…` and similar) |
| `<REDACTED:aws-secret-key>` | a 40-character value right after an AWS secret key name |
| `<REDACTED:github-token>` | `ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_` and `github_pat_` tokens |
| `<REDACTED:api-key>` | keys that start `sk-` (OpenAI and Anthropic style) |
| `<REDACTED:slack-token>` | `xox…` tokens |
| `<REDACTED:jwt>` | JSON Web Tokens |
| `<REDACTED:bearer-token>` | the token after `Bearer` |
| `<REDACTED:password>` | the password in `scheme://user:password@host` |
| `<REDACTED:secret>` | the value in an `UPPER_CASE_NAME=value` assignment whose name ends in `PASSWORD`, `SECRET`, `TOKEN`, `API_KEY`, `PRIVATE_KEY` or `ACCESS_KEY`; and any string value under an object key with such a name inside a tool call's input |
| `<REDACTED:private-key>` | PEM and PGP private key blocks |

Table: the redaction rules, from the source on 19 November 2026.

**This is best effort, not a guarantee.** A bare random password, an unprefixed API key or a secret split across two messages has no pattern to match and goes through unchanged, and a harmless string can be redacted by mistake. Do not paste credentials into an agent on the assumption that the collector will remove them. Setting `AOM_NO_REDACT=1` turns redaction off and prints a warning.

## What it shortens

| What | Limit |
|---|---|
| Messages per upload, per session | 150: the first one and the latest 149 |
| Tool output | 500 characters |
| Image data | 64 characters (a stub, not the image) |
| Session title | 80 characters |
| Tool input | not limited |

Table: length limits applied before upload. The 150-message limit is applied for OpenCode, Claude Code and Pi; the Codex reader does not apply it.

## What it sends, and when

A session is sent as: its id, the agent's name, the project (path, and the Git remote, branch and commit when there is one), title, model, start and end time, message count, changed files and line counts, and its messages as typed parts (text, reasoning, tool calls, tool results, image stubs). Each upload also carries your device id and the collector's version.

- **Where to.** `https://agentsofmine.io/sync`, over HTTPS. `AOM_SYNC_URL` changes it.
- **How.** A `POST`, five sessions at a time. Network errors and `429`, `500`, `502`, `503` and `504` are retried after 100, 200 and 400 milliseconds; other errors are not.
- **When.** `aom sync` sends once. `aom start` watches the session folders and syncs about five seconds after the last change.
- **Who.** The device token from `aom pair` identifies your computer. It is stored in your operating system's keychain, with a copy in `~/.agentsofmine/config.json` that only your user can read (on Unix; see [Windows and Linux](#windows-and-linux)).

## Windows and Linux

**Tested on Linux, nothing run on Windows.** On 20 November 2026 I ran the install and the first check in an Ubuntu 24.04 container (Node 22.23.5). Labels: *tested*, *documented* (a vendor page read that day) and *assumed* (my reading).

- **Linux.** `npm install -g agentsofmine` succeeded, but `aom --version` failed with `libsecret-1.so.0: cannot open shared object file` until I installed `libsecret-1-0`; then it printed 0.1.3 (tested). In a clone at commit `2a03ae9`, `npm run check` failed the same way, and passed (459 tests) once the library was there (tested). Storing the token also needs a running Secret Service; the README says a headless server without one fails to store it (documented by the collector; not run).
- **The check command.** `grep` is not on Windows. `git grep -nE "writeFile|appendFile|createWriteStream" -- src/` printed the same eight lines as `grep -rnE` on macOS and on Ubuntu (tested; Git for Windows ships `git grep`: assumed).
- **Windows.** The README says it is not supported. The state folder uses `os.homedir()` and so should be `%USERPROFILE%\.agentsofmine` (assumed, from the collector's cross-platform notes). The `0o600` mode on `config.json` is not enforced: Node.js documents that on Windows only the write permission can be changed (documented: the `fs` page). So a token copy there would have no owner-only mode (assumed); the collector's notes call this low priority because the keychain is the main store.

## What it does not do

- It does not upload a session's later messages beyond the 150-message window, and it does not read Claude Code subagent transcripts.
- It does not read `CLAUDE_CONFIG_DIR`, `OPENCODE_DB` or Pi's session-directory option, so if you moved an agent's storage, it will not find it.
- It is not a backup. See [what to do about Claude Code's 30-day deletion](/claude-code-deletes-sessions-after-30-days/).

## Stopping it

`aom unpair` removes the device token and the local state. Your sessions stay in your account until you delete the account in the app (Settings → Delete account).

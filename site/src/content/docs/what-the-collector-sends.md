---
title: What the collector reads, redacts and uploads
description: Exactly what the AgentsOfMine collector reads from disk, what it removes before upload, what it sends and how often, and how to check each claim in the source.
slug: what-the-collector-sends
order: 2
verified: 2026-11-19
checkedAgainst: "Collector 0.1.3, commit abe3f56 (source read and the commands below run on 19 November 2026)."
kind: reference
---

Read this before you install. Everything below is from the collector's source, and every claim has a command you can run yourself.

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
grep -rniE "anthropic\.com|api\.openai\.com|api\.github\.com|copilot|oauth|client_secret" src/
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
- **Who.** The device token from `aom pair` identifies your computer. It is stored in your operating system's keychain, with a copy in `~/.agentsofmine/config.json` that only your user can read.

## What it does not do

- It does not upload a session's later messages beyond the 150-message window, and it does not read Claude Code subagent transcripts.
- It does not read `CLAUDE_CONFIG_DIR`, `OPENCODE_DB` or Pi's session-directory option, so if you moved an agent's storage, it will not find it.
- It is not a backup. See [what to do about Claude Code's 30-day deletion](/claude-code-deletes-sessions-after-30-days/).

## Stopping it

`aom unpair` removes the device token and the local state. Your sessions stay in your account until you delete the account in the app (Settings → Delete account).

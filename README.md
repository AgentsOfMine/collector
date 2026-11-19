# AgentsOfMine Collector

> **CLI + background daemon** (with an optional MCP server) for syncing AI coding sessions to [AgentsOfMine](https://agentsofmine.io).

Works with any editor or terminal — Claude Code CLI, OpenCode CLI, Cursor, Zed, or any future agent.

**Documentation:** [agentsofmine.github.io/collector](https://agentsofmine.github.io/collector/): where each agent keeps its sessions, exactly what the collector reads, redacts and uploads, how to add an agent, and what to do about Claude Code deleting sessions after 30 days.

---

## Requirements

**Supported platforms:** macOS and Linux.

> **Windows:** not yet supported. The port is scoped out in
> [`docs/CROSS_PLATFORM.md`](docs/CROSS_PLATFORM.md), but we need a **volunteer on
> Windows** to verify the session-directory paths (OpenCode, Claude Code, Codex,
> Pi) and test the keychain + file-watcher behavior there. If that's you, open an
> issue or PR — see [Contributing](#contributing).

- **Node.js ≥ 20** (`node --version`). Node 20+ is required for reliable
  recursive file watching on Linux.
- A native keychain backend, used to store the device token:
  - macOS — Keychain (built in)
  - Linux — `libsecret` plus a **running Secret Service**:
    - Build dependency: `libsecret-1-dev` (e.g. `sudo apt install libsecret-1-dev`
      on Debian/Ubuntu).
    - Runtime: a Secret Service provider must be running — `gnome-keyring` on
      GNOME, `kwalletd` on KDE. **Headless servers without one will fail to
      store the device token** until a keyring is available.

---

## Install

> **Testing status:** Extensive smoke testing has been performed on **macOS
> only**. Linux is supported by design (it shares macOS's Unix paths and POSIX
> semantics, and the Node ≥ 20 requirement covers recursive file watching), but
> has not yet been exercised end-to-end. Linux reports — successes or
> bugs — are welcome via [issues](https://github.com/AgentsOfMine/collector/issues).

The fastest path on every platform is a global npm install:

```bash
npm install -g agentsofmine
```

Verify the install:

```bash
aom --version
```

Or run it once without installing:

```bash
npx agentsofmine pair
```

### macOS

1. **Node.js ≥ 20.** Install via [Homebrew](https://brew.sh) or
   [nodejs.org](https://nodejs.org):

   ```bash
   brew install node          # or: brew install node@20
   node --version             # must be v20.x or newer
   ```

2. **Keychain — no setup required.** macOS Keychain is built in; the device
   token is stored there automatically after pairing.

3. **Install and pair:**

   ```bash
   npm install -g agentsofmine
   aom pair
   aom start
   ```

### Linux

1. **Node.js ≥ 20.** Use your distro's package manager,
   [nvm](https://github.com/nvm-sh/nvm), or [nodesource](https://github.com/nodesource/distributions):

   ```bash
   # nvm (recommended — avoids old distro Node)
   nvm install 20
   node --version             # must be v20.x or newer
   ```

2. **Keychain backend (`libsecret`).** The device token is stored via the
   Secret Service API, which needs the `libsecret` dev headers at install time
   **and** a running Secret Service provider at runtime.

   ```bash
   # Debian / Ubuntu
   sudo apt install libsecret-1-dev gnome-keyring

   # Fedora / RHEL
   sudo dnf install libsecret-devel gnome-keyring

   # Arch
   sudo pacman -S libsecret gnome-keyring
   ```

   - On a **GNOME or KDE desktop**, a keyring (`gnome-keyring` / `kwalletd`) is
     already running — nothing more to do.
   - On a **headless server / SSH session / container**, no keyring runs by
     default, so storing the token will fail. Start one for the session, e.g.:

     ```bash
     # unlock a gnome-keyring daemon for this shell session
     eval "$(gnome-keyring-daemon --start --components=secrets)"
     export GNOME_KEYRING_CONTROL
     ```

     (Or run the collector under a desktop session that already provides one.)

3. **Install and pair:**

   ```bash
   npm install -g agentsofmine
   aom pair
   aom start
   ```

> **Windows:** not yet supported — see [Requirements](#requirements) and
> [`docs/CROSS_PLATFORM.md`](docs/CROSS_PLATFORM.md). We're looking for a Windows
> volunteer; details under [Contributing](#contributing).

---

## Quick start

```bash
# Step 1 — pair this machine with your AgentsOfMine account (one-time)
aom pair

# Step 2 — run the collector; it watches your agents' session files and syncs changes
aom start

# To sync once from the terminal instead, run: aom sync
```

`aom pair` prints a pairing URL and an ASCII QR code to your terminal. Open the URL on your phone, sign in once, tap Approve. The device token is stored in your OS keychain — you never see it again.

---

## Commands

| Command | What it does |
|---|---|
| `aom pair` | One-time pairing: prints URL + QR, polls until approved, stores device token in OS keychain |
| `aom pair --force` | Discard the existing pairing and start a fresh one (also accepts `--reset`) |
| `aom pair --no-browser` | Pair without auto-opening the browser |
| `aom start` | Runs the daemon: file watchers plus an initial sync, until Ctrl+C |
| `aom status` | Prints pairing status and last-synced timestamps |
| `aom status --json` | Prints a single machine-readable JSON line (`paired`, `deviceId`, `lastSyncAt`, `queueDepth`, `lastError`) — for scripts and status integrations |
| `aom sync` | Runs one sync cycle now and prints how many sessions synced or failed (exit code 1 if any failed) |
| `aom unpair [-y]` | Removes the device token from the keychain and clears local state (`-y` skips the prompt) |
| `aom --version` | Prints the installed version |

---

## Build from source

Clone the repo and build the compiled `aom` binary into `dist/`:

```bash
git clone https://github.com/AgentsOfMine/collector.git
cd collector
npm install        # installs deps and runs the build via the `prepare` script
npm run build      # or build again explicitly (tsc → dist/)
npm run lint       # run eslint on src + test
npm test           # run the test suite
npm run check      # build + lint + test in one step

# run the locally built CLI without a global install
node dist/bin/aom.js --version

# optional — link it as the global `aom` command
npm link
aom --version
```

---

## How it works

```
Your agent has already written its session to local disk
        │
        ▼
agentsofmine-collector  (the daemon: `aom start`)
  └── File watchers detect new/changed sessions in real time
        │
        ▼
  Provider adapters read the sessions already on disk:
    ~/.local/share/opencode/opencode.db   (OpenCode — SQLite)
    ~/.claude/projects/*/*.jsonl          (Claude Code — JSONL)
    ~/.codex/sessions/                    (Codex — JSON)
    ~/.pi/agent/sessions/                 (Pi — JSONL)
        │
        ▼
  Normalize → POST /sync (Bearer device-token)
        │
        ▼
  AgentsOfMine cloud → your phone
```

Two ways to sync:
- **File watchers** — `aom start` monitors session directories and syncs changes automatically.
- **CLI one-shot** — `aom sync` triggers a single sync cycle from the terminal.

**Optional MCP server.** The package also ships a separate MCP server over stdio, [`dist/index.js`](src/index.ts), that an MCP-aware agent can launch itself (`node <install path>/dist/index.js`). It exposes two tools: **`sync_now`** (reads new sessions via the provider adapters and uploads them) and **`status`** (the result of the last sync). It is independent of `aom start`; there is no `aom` subcommand for it yet.

---

## Provider adapters

Each provider has its own adapter that knows the local session format.

| Provider | Status | Session path |
|---|---|---|
| Claude Code | ✅ Phase 1 | `~/.claude/projects/` |
| OpenCode | ✅ Phase 1 | `~/.local/share/opencode/opencode.db` |
| Codex | ✅ Phase 1 | `~/.codex/sessions/` |
| Pi | ✅ Phase 1 | `~/.pi/agent/sessions/` |
| Cursor | 🔜 Community | — |
| GitHub Copilot Chat | 🔜 Community | — |
| Gemini CLI | 🔜 Community | — |
| Cline | 🔜 Community | — |
| Continue.dev | 🔜 Community | — |

**Adding an adapter** is a weekend's work for someone who knows the target tool. Implement the `Adapter` interface in [`src/adapters/adapter.ts`](src/adapters/adapter.ts) and use [`src/adapters/opencode/`](src/adapters/opencode/) as a reference. If your adapter ships in a release, you become a [founding contributor](https://agentsofmine.io#contributors): your name in the README, co-maintainer on the adapter, and free Pro tier when it launches.

---

## Security

- **We never log into your AI accounts.** No Claude, OpenAI, Copilot, or any other AI provider credentials anywhere in this package.
- The collector reads files your agents have already written to local disk.
- The device token is stored in your OS keychain (macOS Keychain, Windows Credential Manager, Linux libsecret/kwallet). Note: after pairing, a copy of the device token is also written to `~/.agentsofmine/config.json` with owner-only permissions (`0600`).
- **Secrets are redacted on your machine before upload** (best-effort, see below).
- All traffic to `agentsofmine.io` is TLS 1.2+. Data at rest is encrypted with AWS KMS.
- This package is MIT-licensed. Read every line that runs on your machine.

### Secret redaction

Every session passes through [`src/core/redact.ts`](src/core/redact.ts) just before it is sent (CLI `aom sync`, the daemon, and the optional MCP `sync_now` tool all share the same path). It rewrites matches in message text, reasoning, tool input and output, the session title and changed-file paths to a marker such as `<REDACTED:github-token>`.

It recognises: AWS access key ids (`AKIA…`) and AWS secret keys next to their name; GitHub tokens (`ghp_`, `github_pat_`, …); `sk-…` API keys (OpenAI, Anthropic); Slack tokens; JWTs; `Bearer` tokens; PEM / OpenSSH private-key blocks (including truncated ones); passwords inside connection-string URLs; and `UPPER_CASE_NAME=value` assignments whose name contains `PASSWORD`, `SECRET`, `TOKEN`, `API_KEY`, `PRIVATE_KEY` or `ACCESS_KEY`. In tool-call JSON, string values under keys like `password` or `api_key` are redacted whatever they look like.

**This is best-effort, not a guarantee.** A regex cannot recognise a secret it has no pattern for (a bare random password, an unprefixed API key, a secret split across messages), and it can occasionally redact something harmless. It also does not touch sessions synced before it existed. Treat it as defense in depth on top of encryption, not as permission to paste credentials into an agent.

Set `AOM_NO_REDACT=1` to disable it for debugging; the collector prints a warning to stderr when you do.

---

## Architecture

The implementation lives in [`src/`](src/):
- **Optional MCP server and tool definitions** — [`src/index.ts`](src/index.ts) (`sync_now`, `status`)
- **CLI dispatcher and subcommands** — [`src/bin/aom.ts`](src/bin/aom.ts), [`src/cli/`](src/cli/) (`pair`, `start`, `status`, `sync`, `unpair`)
- **Provider adapters** — [`src/adapters/`](src/adapters/) (one per provider, implementing [`adapter.ts`](src/adapters/adapter.ts))
- **Session normalization schema** (`CanonicalSession` + `CanonicalMessage`) — [`src/core/canonical.ts`](src/core/canonical.ts)
- **Project identity resolution** (Git remote normalization, multi-device dedup) — [`src/core/project-identity.ts`](src/core/project-identity.ts), [`src/core/git-identity.ts`](src/core/git-identity.ts)
- **Sync engine and retry handling** — [`src/core/sync-engine.ts`](src/core/sync-engine.ts), [`src/core/http-client.ts`](src/core/http-client.ts)
- **Secret redaction** — [`src/core/redact.ts`](src/core/redact.ts)
- **Device token lifecycle** (pairing → keychain storage) — [`src/services/pairing-service.ts`](src/services/pairing-service.ts), [`src/keychain/`](src/keychain/)
- **File watchers** — [`src/watchers/`](src/watchers/) (monitors session directories for `aom start`)
- **Shared utilities** — [`src/core/message-truncation.ts`](src/core/message-truncation.ts), [`src/core/safe-json.ts`](src/core/safe-json.ts)

---

## Contributing

The highest-value contribution is a **provider adapter** for an agent we don't ship with. Implement the `Adapter` interface in [`src/adapters/adapter.ts`](src/adapters/adapter.ts), add tests under [`test/`](test/), and open a PR.

**Windows support** is also open for a volunteer. The work is scoped in
[`docs/CROSS_PLATFORM.md`](docs/CROSS_PLATFORM.md) — primarily verifying each
agent's session-directory paths on Windows and testing the keychain and file
watchers. Ship Windows support and you become a
[founding contributor](https://agentsofmine.io#contributors): your name in the
README and a **lifetime Pro account when Pro launches**. If you run Windows and
want to help, open an issue to coordinate.

Bug reports and issues: [github.com/AgentsOfMine/collector/issues](https://github.com/AgentsOfMine/collector/issues)

---

## License

MIT — see [LICENSE](LICENSE).

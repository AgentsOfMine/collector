# AgentsOfMine Collector

> **MCP server + CLI** for syncing AI coding sessions to [AgentsOfMine](https://agentsofmine.io).

Works with any editor or terminal — Claude Code CLI, OpenCode CLI, Cursor, Zed, or any future agent. VS Code users can install the [AgentsOfMine VS Code extension](https://github.com/AgentsOfMine/vscode-agentsofmine) for a zero-friction setup; the extension installs and manages this package automatically.

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

Install globally to get the `aom` command on your `PATH`:

```bash
npm install -g agentsofmine-collector
```

Verify the install:

```bash
aom --version
```

Or run it once without installing:

```bash
npx agentsofmine-collector pair
```

---

## Quick start

```bash
# Step 1 — pair this machine with your AgentsOfMine account (one-time)
aom pair

# Step 2 — run the collector as an MCP server
aom start

# Sessions sync when your agent calls the `sync_now` tool.
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
| `aom start` | Starts the MCP server (stdio) with file watchers and sync tools |
| `aom status` | Prints the last sync result as JSON |
| `aom sync` | Runs one sync cycle now and prints the result as JSON |
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
agentsofmine-collector  (runs as an MCP server: `aom start`)
  ├── File watchers detect new/changed sessions in real time
  └── Your agent calls the `sync_now` MCP tool on demand
        │
        ▼
  Provider adapters read the sessions already on disk:
    ~/.local/share/opencode/opencode.db   (OpenCode — SQLite)
    ~/.claude/projects/*/*.jsonl          (Claude Code — JSONL)
    ~/.codex/sessions/                    (Codex — JSON)
        │
        ▼
  Normalize → POST /sync (Bearer device-token)
        │
        ▼
  AgentsOfMine cloud → your phone
```

The collector exposes two MCP tools over stdio:
- **`sync_now`** — reads new sessions via the provider adapters and uploads them.
- **`status`** — returns the result of the last sync.

Three sync modes:
- **MCP tool** — your agent calls `sync_now` during a session.
- **File watchers** — `aom start` monitors session directories and syncs changes automatically.
- **CLI one-shot** — `aom sync` triggers a single sync cycle from the terminal.

---

## Provider adapters

Each provider has its own adapter that knows the local session format.

| Provider | Status | Session path |
|---|---|---|
| Claude Code | ✅ Phase 1 | `~/.claude/projects/` |
| OpenCode | ✅ Phase 1 | `~/.local/share/opencode/opencode.db` |
| Codex | ✅ Phase 1 | `~/.codex/sessions/` |
| Cursor | 🔜 Community | — |
| GitHub Copilot Chat | 🔜 Community | — |
| Gemini CLI | 🔜 Community | — |
| Cline | 🔜 Community | — |
| Continue.dev | 🔜 Community | — |

**Adding an adapter** is a weekend's work for someone who knows the target tool. Implement the `Adapter` interface in [`src/adapters/adapter.ts`](src/adapters/adapter.ts) and use [`src/adapters/opencode/`](src/adapters/opencode/) as a reference. If your adapter ships in a release, you become a [founding contributor](https://agentsofmine.io#contributors): your name in the README, co-maintainer on the adapter, and free Pro tier when it launches.

---

## VS Code extension users

The [VS Code extension](https://github.com/AgentsOfMine/vscode-agentsofmine) installs and manages this package automatically:

1. Install the extension from the Marketplace
2. On first activation, if `aom` is not found on PATH, the extension prompts: *"AgentsOfMine Collector not found. Install it now?"*
3. Click **Install** — the extension runs `npm install -g agentsofmine-collector` in a visible terminal
4. The extension calls `aom pair` (via a webview panel) and `aom start`

No CLI required for VS Code users.

---

## Security

- **We never log into your AI accounts.** No Claude, OpenAI, Copilot, or any other AI provider credentials anywhere in this package.
- The collector reads files your agents have already written to local disk.
- The device token is stored in your OS keychain (macOS Keychain, Windows Credential Manager, Linux libsecret/kwallet). Note: after pairing, a copy of the device token is also written to `~/.agentsofmine/config.json` with owner-only permissions (`0600`).
- All traffic to `agentsofmine.io` is TLS 1.2+. Data at rest is encrypted with AWS KMS.
- This package is MIT-licensed. Read every line that runs on your machine.

---

## Architecture

The implementation lives in [`src/`](src/):
- **MCP server entrypoint and tool definitions** — [`src/index.ts`](src/index.ts) (`sync_now`, `status`)
- **CLI dispatcher and subcommands** — [`src/bin/aom.ts`](src/bin/aom.ts), [`src/cli/`](src/cli/) (`pair`, `start`, `status`, `sync`, `unpair`)
- **Provider adapters** — [`src/adapters/`](src/adapters/) (one per provider, implementing [`adapter.ts`](src/adapters/adapter.ts))
- **Session normalization schema** (`CanonicalSession` + `CanonicalMessage`) — [`src/core/canonical.ts`](src/core/canonical.ts)
- **Project identity resolution** (Git remote normalization, multi-device dedup) — [`src/core/project-identity.ts`](src/core/project-identity.ts), [`src/core/git-identity.ts`](src/core/git-identity.ts)
- **Sync engine and retry handling** — [`src/core/sync-engine.ts`](src/core/sync-engine.ts), [`src/core/http-client.ts`](src/core/http-client.ts)
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

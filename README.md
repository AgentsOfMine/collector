# AgentsOfMine Collector

> **MCP server + CLI + file watcher** for syncing AI coding sessions to [AgentsOfMine](https://agentsofmine.io).

Works with any editor or terminal — Claude Code CLI, OpenCode CLI, Cursor, Zed, or any future agent. VS Code users can install the [AgentsOfMine VS Code extension](https://github.com/AgentsOfMine/vscode-extension) for a zero-friction setup; the extension installs and manages this package automatically.

---

## Install

```bash
npm install -g agentsofmine-collector
```

Or use without installing:

```bash
npx agentsofmine-collector pair
```

---

## Quick start

```bash
# Step 1 — pair this machine with your AgentsOfMine account (one-time)
aom pair

# Step 2 — start the collector daemon
aom start

# That's it. Sessions sync automatically as your agents work.
```

`aom pair` prints a pairing URL and an ASCII QR code to your terminal. Open the URL on your phone, sign in once, tap Approve. The device token is stored in your OS keychain — you never see it again.

---

## Commands

| Command | What it does |
|---|---|
| `aom pair` | One-time pairing: prints URL + QR, polls until approved, stores device token in OS keychain |
| `aom start` | Starts the background daemon (MCP server + file watcher) |
| `aom stop` | Stops the daemon |
| `aom status` | Shows sync state and per-project last-synced timestamps |
| `aom unpair` | Revokes device token + removes keychain entry |

---

## How it works

```
Agent writes session to disk
        │
        ▼
agentsofmine-collector
  ├── File watcher — watches known session paths per provider
  │     ~/.local/share/opencode/     (OpenCode)
  │     ~/.claude/projects/          (Claude Code)
  │     ~/.codex/sessions/           (Codex)
  │
  └── MCP server — agents push session events directly (no polling needed)
        │
        ▼
  Normalize → redact secrets → POST /sync (Bearer device-token)
        │
        ▼
  AgentsOfMine cloud → your phone
```

Two collection paths run in parallel and are not mutually exclusive:
- **File watcher** — works with every agent, no agent configuration needed
- **MCP server** — agents that support MCP can push events directly for lower latency

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

**Adding an adapter** is a weekend's work for someone who knows the target tool. See [`docs/adapter-contract.md`](docs/adapter-contract.md). If your adapter ships in a release, you become a [founding contributor](https://agentsofmine.io#contributors): your name in the README, co-maintainer on the adapter, and free Pro tier when it launches.

---

## VS Code extension users

The [VS Code extension](https://github.com/AgentsOfMine/vscode-extension) installs and manages this package automatically:

1. Install the extension from the Marketplace
2. On first activation, if `aom` is not found on PATH, the extension prompts: *"AgentsOfMine Collector not found. Install it now?"*
3. Click **Install** — the extension runs `npm install -g agentsofmine-collector` in a visible terminal
4. The extension calls `aom pair` (via a webview panel) and `aom start`

No CLI required for VS Code users.

---

## Security

- **We never log into your AI accounts.** No Claude, OpenAI, Copilot, or any other AI provider credentials anywhere in this package.
- The collector reads files your agents have already written to local disk.
- A best-effort regex pass strips obvious secrets before anything is sent.
- The device token is stored in your OS keychain (macOS Keychain, Windows Credential Manager, Linux libsecret/kwallet). It never touches disk as a plaintext file.
- All traffic to `agentsofmine.io` is TLS 1.2+. Data at rest is encrypted with AWS KMS.
- This package is MIT-licensed. Read every line that runs on your machine.

---

## Architecture

See [`docs/architecture.md`](docs/architecture.md) for the full protocol specification, including:
- MCP server entrypoint and tool definitions
- File watcher implementation per provider
- Session normalization schema (canonical `CanonicalSession` + `CanonicalMessage`)
- Device token lifecycle (pairing → storage → rotation → revocation)
- `POST /sync` request format and error handling

---

## Contributing

The highest-value contribution is a **provider adapter** for an agent we don't ship with. See [`docs/contributing.md`](docs/contributing.md).

Bug reports and issues: [github.com/AgentsOfMine/collector/issues](https://github.com/AgentsOfMine/collector/issues)

---

## License

MIT — see [LICENSE](LICENSE).

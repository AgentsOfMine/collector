# Cross-Platform Support — Research & Port Plan

> **Status:** Research only. No code changes yet. This document inventories the
> macOS-centric assumptions in the collector and lays out a concrete plan to
> support Linux and Windows.
>
> **Date:** 2026-06-12. Verify version-specific claims (Node, native modules)
> before implementing — the ecosystem moves fast.

The collector is written in portable Node.js/TypeScript and several pieces are
already cross-platform by design. The gaps are concentrated in four areas:
secret storage, session-directory discovery paths, file-watching behavior, and
daemon auto-start. None are architectural blockers; this is a tractable port.

---

## 1. What already works on all three platforms

These were audited and need no change:

| Concern | Why it's portable |
|---|---|
| **Secret storage abstraction** | `src/keychain/index.ts` uses `keytar`, which transparently targets macOS Keychain / Windows Credential Manager / Linux Secret Service. No per-OS branching in our code. |
| **State directory** `~/.agentsofmine` | `os.homedir()` + `path.join`; resolves correctly everywhere (hidden dir on Unix, normal folder on Windows). Used by `daemon/state.ts`, `core/cursor-store.ts`, `core/last-sync-store.ts`, `infrastructure/config-repository.ts`. |
| **Path-separator handling in globs** | `src/cli/start.ts` and `src/adapters/claude-code/index.ts` strip glob suffixes with `/[/\\]/`, matching both separators. |
| **Git identity** | `src/core/git-identity.ts` calls `execFileSync("git", …)`; Git exists on all three OSes (assumes it's on `PATH`). |
| **MCP stdio transport** | `src/mcp/server.ts` sets explicit UTF-8 encoding on stdin. |
| **`SIGINT` (Ctrl+C) shutdown** | Fires on Windows consoles too. |

---

## 2. Confirmed gaps (will fail or degrade off macOS)

### 2.1 Session-directory paths — the biggest risk

`src/config.ts` and each adapter hardcode Unix dotfile / XDG paths via
`os.homedir()`. Verified on this machine:

- **OpenCode DB** `~/.local/share/opencode/opencode.db` — **CORRECT on macOS too.**
  OpenCode is XDG-respecting; the DB lives at this path on macOS (confirmed:
  561 MB file present and actively synced on this Mac). This is **not** a macOS
  bug. The audit's claim that macOS uses `~/Library/Application Support` is a
  false positive for OpenCode specifically.
  - **Windows:** unknown — likely `%LOCALAPPDATA%` or `%APPDATA%`. **Must verify.**
- **Claude Code** `~/.claude/projects/*/*.jsonl` — dotfile; works macOS/Linux.
  **Windows path must be verified.**
- **Codex** `~/.codex/sessions` — dotfile; same as above.
- **Pi** `~/.pi/agent/sessions` — dotfile; same as above.

**Action:** Do not blindly switch to `env-paths`. Each *upstream tool* chooses
its own storage location; the collector must mirror **each tool's actual path
per OS**, which requires empirical verification on a Windows box (and ideally a
Linux box) with each agent installed. Build a per-provider, per-OS path resolver
with the verified paths, keeping the current values as the macOS/Linux default.

### 2.2 File permissions on config — `mode: 0o600`

`src/infrastructure/config-repository.ts` writes the device-id and config files
with `{ mode: 0o600 }`. On Windows this option is **silently ignored** (NTFS ACLs
apply instead). Not a functional break, but the on-disk token is not
owner-restricted on Windows the way it is on Unix.

**Action:** On Windows, either accept NTFS-inherited ACLs (document it) or set an
explicit ACL. Low priority — the keychain remains the primary token store.

### 2.3 Recursive file watching on Linux

`src/watchers/directory-watcher.ts` uses `fs.watch(dir, { recursive: true })`
for Claude / Codex / Pi. Recursive `fs.watch`:

- **macOS / Windows:** native, reliable.
- **Linux:** only supported on **Node ≥ 19.1**, with a tree-walk race fixed in
  Node 21+. `package.json` currently declares `"node": ">=18"`, so on Linux +
  Node 18 the recursive watch **silently watches only the top level** and misses
  nested session files.

The OpenCode watcher (`src/watchers/opencode.ts`) is non-recursive and safe.

**Action (two options):**
- **Minimal:** bump `engines.node` to `>=20` (ideally `>=21`) and document it.
- **Robust:** adopt **chokidar** for the recursive watchers. It normalizes
  behavior across OSes, handles Linux `inotify` limits gracefully, and coalesces
  atomic writes. Cost: one dependency. Recommended if we want Linux servers /
  headless setups to be reliable.

> **Linux `inotify` note:** each watched subdir consumes one watch slot
> (`fs.inotify.max_user_watches`, default 8192). Large trees can hit `ENOSPC`.
> chokidar surfaces this cleanly; raw `fs.watch` does not.

### 2.4 `SIGTERM` shutdown on Windows

`src/cli/start.ts` registers `SIGINT` and `SIGTERM` handlers. Windows has no
native `SIGTERM`; cleanup may not run when the process is killed by Task
Manager or a service manager.

**Action:** add a `process.on("exit", …)` / `beforeExit` fallback that runs the
same shutdown (stop watchers, stop SyncRunner). Cheap and safe.

---

## 3. Dependency decisions

| Dependency | Status | Recommendation |
|---|---|---|
| **keytar `^7.9.0`** | Original `atom/node-keytar` archived 2022. A maintained GitHub fork (`@github/keytar`) and a modern Rust-based alternative (`@napi-rs/keyring`) exist. | **Evaluate `@napi-rs/keyring`**: ships prebuilt binaries for linux/win/macos (x64+arm64), no `node-gyp`, no libsecret build dep, and a graceful fallback chain. Removes the Linux `libsecret-1-dev` build requirement. Verify the API/behavior before swapping. |
| **better-sqlite3 `^12`** | Actively maintained; ships prebuilt binaries for linux-x64/arm64, win32-x64, macOS x64/arm64, and musl (Alpine). | **Keep.** Risk is only when prebuilds are absent (bleeding-edge Node, or Windows without VS Build Tools). **Action:** pin/document supported Node LTS lines (20/22/24) so users land on prebuilt binaries. |
| **file watching** | raw `fs.watch` (see 2.3). | **Consider chokidar** for the recursive watchers. |
| **path/dir resolution** | hardcoded per provider. | `env-paths` is useful for *our own* `~/.agentsofmine` data, **but not** for upstream tool paths (those follow each tool's own convention, which we must verify per OS). |

### Native-module install friction

- **Linux:** `better-sqlite3` source build needs `python3` + `build-essential`;
  `keytar` source build needs `libsecret-1-dev`. Prebuilts avoid both — pin
  supported Node versions to dodge source builds.
- **Windows:** historically the worst case — source builds need Visual Studio
  Build Tools (Desktop C++) + Python, and `node-gyp`'s VS detection has known
  breakage on newer VS releases. **Strongly prefer prebuilt-only Node versions.**
  Switching keytar → `@napi-rs/keyring` eliminates one native source-build path.

---

## 4. Daemon auto-start per OS (`aom start`)

Today `aom start` runs in the foreground (and on this Mac it was launched with
`nohup`, which does not survive reboot). A real install needs a per-user
(non-root) service per OS:

- **macOS:** `launchd` LaunchAgent plist in `~/Library/LaunchAgents/`,
  `RunAtLoad` + `KeepAlive`. Manage with `launchctl load/unload`.
- **Linux:** `systemd --user` unit in `~/.config/systemd/user/`,
  `Restart=on-failure`, `WantedBy=default.target`. Requires
  `loginctl enable-linger $USER` to survive logout. Logs to journald.
- **Windows:** Task Scheduler "At log on" trigger running `node …\aom.js start`
  (PowerShell `Register-ScheduledTask`). True Session-0 services need an
  NSSM/winsw wrapper — extra complexity; defer unless required.

A helper like `@rupertsworld/daemon` covers macOS + Linux but **not Windows**,
so Windows would still need a bespoke Task Scheduler path. Recommendation:
implement `aom install` / `aom uninstall` subcommands that generate the
appropriate service file per OS, rather than pulling a partial-coverage lib.

---

## 5. Suggested implementation order (when we green-light the port)

1. **Per-provider path resolver** with verified Windows paths (blocked on testing
   each agent on a Windows machine). Keep current Unix paths as default.
2. **Bump `engines.node` to `>=20`** (or adopt chokidar) to fix Linux recursive
   watching.
3. **`process.on("exit")` shutdown fallback** for Windows.
4. **Evaluate & possibly migrate keytar → `@napi-rs/keyring`** to kill native
   build deps.
5. **`aom install`/`aom uninstall`** generating launchd / systemd-user / Task
   Scheduler service definitions.
6. **CI matrix** (`macos`, `ubuntu`, `windows`) running `npm run check` to catch
   regressions and verify native-module install.

### Open questions to resolve before coding

- Exact Windows storage paths for OpenCode, Claude Code, Codex, and Pi.
- Whether we target headless Linux servers (no Secret Service) — if so,
  `@napi-rs/keyring` fallback or a file-backed token store matters more.
- Minimum supported Node version we're willing to require.

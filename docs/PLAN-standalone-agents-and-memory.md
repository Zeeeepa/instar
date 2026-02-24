# Implementation Plan: Standalone Agents, Backup, Git State, and Memory Search

> **Version**: 1.2
> **Date**: 2026-02-24
> **Status**: Post-review revision (Round 2 fixes applied)
> **Instar Version**: 0.8.25 (baseline)
> **Target Version**: 0.9.x (features 1-3), 0.10.x (features 4-5)
> **Review**: Round 2 complete — scores improved from 5.0-7.5 to 7.5-8.5. Remaining conditions addressed. See `.claude/skills/specreview/output/20260224-095700/synthesis.md`

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Phase 1: Global Agent Registry](#2-phase-1-global-agent-registry)
3. [Phase 2: Standalone Agent Installation](#3-phase-2-standalone-agent-installation)
4. [Phase 3: Backup System](#4-phase-3-backup-system)
5. [Phase 4: Git-Backed Agent State](#5-phase-4-git-backed-agent-state)
6. [Phase 5: SQLite Memory Search](#6-phase-5-sqlite-memory-search)
7. [Implementation Order and Dependencies](#7-implementation-order-and-dependencies)
8. [Migration Strategy](#8-migration-strategy)
9. [Test Strategy](#9-test-strategy)
10. [Risk Assessment](#10-risk-assessment)
11. [Dependency Analysis](#11-dependency-analysis)
12. [Estimated Scope](#12-estimated-scope)

---

## 1. Architecture Overview

### Current State

```
~/.instar/
  port-registry.json          # Machine-wide port allocation (PortRegistry.ts)

~/Projects/my-project/
  CLAUDE.md                   # Agent instructions
  .instar/
    AGENT.md                  # Agent identity
    USER.md                   # Primary user context
    MEMORY.md                 # Persistent memory
    config.json               # Configuration (secrets, ports, auth)
    jobs.json                 # Job definitions
    users.json                # User profiles
    hooks/                    # Behavioral guardrails
    state/                    # Runtime state (sessions, jobs)
    relationships/            # Relationship tracking
    logs/                     # Activity logs
    views/                    # Private viewer state
```

### Target State

```
~/.instar/
  registry.json               # NEW: Unified agent registry (replaces port-registry.json)
  agents/                     # NEW: Standalone agent home directories
    my-agent/
      CLAUDE.md
      .instar/
        AGENT.md
        MEMORY.md
        memory.db             # NEW: SQLite FTS5 index
        backups/              # NEW: Snapshot storage
        ...

~/Projects/my-project/        # Project-bound agents (unchanged location)
  CLAUDE.md
  .instar/
    memory.db                 # NEW: SQLite FTS5 index
    backups/                  # NEW: Snapshot storage
    ...
```

### Design Principles

1. **File-based source of truth**: SQLite is a derived index, markdown files remain canonical
2. **Backward compatible**: Existing agents upgrade seamlessly -- zero data loss
3. **Registry unification**: Port registry and agent registry merge into one file
4. **Standalone = project-bound**: Same `.instar/` internals, different location
5. **Optional features**: Git backing and SQLite search are opt-in, never forced

---

## 2. Phase 1: Global Agent Registry

**Goal**: Central registry at `~/.instar/registry.json` tracking ALL agents on the machine. Merge with and replace the existing `port-registry.json`.

### 2.1 New Type Definitions

Add to `src/core/types.ts`:

```typescript
// -- Agent Registry ---------------------------------------------------

export type AgentType = 'standalone' | 'project-bound';

export type AgentStatus = 'running' | 'stopped' | 'stale';

export interface AgentRegistryEntry {
  /** Agent display name (from config.json projectName) — NOT unique, display label only (P1-6) */
  name: string;
  /** Agent type */
  type: AgentType;
  /** Canonical absolute path — the TRUE unique key (P1-6). If two agents share a name but have different paths, both are registered — `instar list` disambiguates by showing the path. */
  path: string;
  /** Allocated server port */
  port: number;
  /** Process ID of the server (0 if stopped) */
  pid: number;
  /** Current status */
  status: AgentStatus;
  /** When this agent was first registered */
  createdAt: string;
  /** Last heartbeat timestamp */
  lastHeartbeat: string;
  /** Instar version this agent was created with */
  instarVersion?: string;
}

export interface AgentRegistry {
  /** Schema version for future migrations */
  version: 1;
  entries: AgentRegistryEntry[];
}
```

### 2.2 New File: `src/core/AgentRegistry.ts`

Replaces `PortRegistry.ts`. All existing `PortRegistry` functions become thin wrappers or are replaced.

**~300 lines estimated**

Key functions:

| Function | Purpose |
|----------|---------|
| `loadRegistry(): AgentRegistry` | Load from `~/.instar/registry.json` |
| `saveRegistry(registry)` | Atomic write (same tmp+rename pattern as PortRegistry) |
| `registerAgent(entry)` | Add or update an agent entry |
| `unregisterAgent(path)` | Remove an agent by its canonical path (the unique key — P1-6) |
| `updateStatus(path, status, pid?)` | Update running status + heartbeat |
| `heartbeat(path)` | Update lastHeartbeat timestamp |
| `startHeartbeat(path, intervalMs)` | Periodic heartbeat (returns cleanup fn) |
| `cleanStaleEntries(registry)` | Process liveness check (same as PortRegistry) |
| `listAgents(filter?)` | List all agents, optionally filtered by type/status |
| `getAgent(path)` | Get a specific agent entry by canonical path |
| `allocatePort(path, rangeStart?, rangeEnd?)` | Port allocation (same logic as PortRegistry) |
| `migrateFromPortRegistry()` | One-time migration from port-registry.json |

**File locking** (P1-3): All read-modify-write cycles on `registry.json` use `proper-lockfile` with the following configuration: `{ stale: 10000, retries: { retries: 5, factor: 2, minTimeout: 100 } }`. The 10-second stale timeout ensures that locks orphaned by SIGKILL'd processes are automatically recovered. If lock acquisition fails after all retries, log a warning and exit with a clear error: `"Registry is locked by another process. If no other instar process is running, delete ~/.instar/registry.json.lock and retry."` Do NOT use `O_EXCL`-based lock files — they lack stale detection and will permanently deadlock the registry on SIGKILL.

**Migration from PortRegistry**:
- On first load, if `registry.json` does not exist but `port-registry.json` does, read port-registry entries and convert them to `AgentRegistryEntry` objects with `type: 'project-bound'` and `status: 'stopped'`
- Write the new `registry.json` and rename `port-registry.json` to `port-registry.json.migrated`
- All existing code that imports from `PortRegistry.ts` gets updated to import from `AgentRegistry.ts`

### 2.3 Files Modified

| File | Change |
|------|--------|
| `src/core/PortRegistry.ts` | **Deprecate** -- add re-export shim pointing to AgentRegistry |
| `src/core/types.ts` | Add `AgentRegistryEntry`, `AgentRegistry`, `AgentType`, `AgentStatus` |
| `src/commands/server.ts` | Replace `registerPort`/`unregisterPort`/`startHeartbeat` with AgentRegistry equivalents |
| `src/commands/init.ts` | Register agent in global registry after init |
| `src/cli.ts` | Add `instar list` command, keep `instar instances` as hidden alias |
| `src/index.ts` | Export `AgentRegistry` module, deprecate `PortRegistry` exports |

### 2.4 CLI Changes

**New command**: `instar list`
- Shows all registered agents with name, type, path, port, status, uptime
- Replaces `instar instances` (keep as hidden alias)
- Color-coded status indicators
- **Deprecation notice** (P2-03): When `instar instances` is invoked, emit `console.warn('⚠ "instar instances" is deprecated. Use "instar list" instead.')` before displaying the output. The alias produces identical output to `instar list`.

### 2.5 API Endpoints

**New route**: `GET /agents`
- Returns the global registry (authenticated)

### 2.6 Security: Internal Route Protection (P0-4)

All `/internal/` routes must enforce localhost access at the **network layer**, not by convention:

- Middleware in `src/server/middleware.ts` must verify `req.socket.remoteAddress` is `127.0.0.1` or `::1` for all `/internal/` routes
- This is a defense-in-depth measure — the auth bypass on `/internal/` paths means any accidental exposure to non-localhost traffic is an unauthenticated API
- **New routes for backup, git, and memory must NOT be placed under the `/internal/` prefix** — they use standard auth like all other routes
- Modification target: `src/server/middleware.ts` — add `remoteAddress` check at the `/internal/` guard

---

## 3. Phase 2: Standalone Agent Installation

**Goal**: `instar init --standalone <name>` creates an agent at `~/.instar/agents/<name>/` that works identically to project-bound agents.

### 3.1 Changes to Init

Modify `src/commands/init.ts`:

**New option**: `--standalone` flag on `instar init`

**Agent name validation** (P1-2): Agent names must match `/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/`. Reject names containing path separators (`/`, `\`), null bytes, or `..`. This validation applies in both the CLI (`instar init --standalone`) and the registry (`registerAgent()`).

```
instar init --standalone my-agent
```

This creates:
```
~/.instar/agents/my-agent/
  CLAUDE.md                   # Agent instructions (standalone version)
  .instar/
    AGENT.md
    USER.md
    MEMORY.md
    config.json
    jobs.json
    users.json
    hooks/
    state/
    relationships/
    logs/
  .claude/
    settings.json
    scripts/
    skills/
  .gitignore                  # Includes .instar/backups/ (P0-1: backup snapshots must never be committed)
```

**Key differences from project-bound**:
- `projectDir` = `~/.instar/agents/<name>/` (the agent's home IS the project)
- Agent is registered in global registry with `type: 'standalone'`
- `config.json` stores `agentType: 'standalone'` for self-identification
- No walk-up for `CLAUDE.md` or `.git` -- the agent home is self-contained
- Generated `.gitignore` includes `.instar/backups/` (P0-1: prevent backup snapshots from being committed)

**Init `.gitignore` generation** (P0-1): Both fresh install (`instar init`) and standalone install (`instar init --standalone`) generate a `.gitignore` that includes `.instar/backups/`. For existing projects upgrading to 0.9.x, the PostUpdateMigrator appends `.instar/backups/` to the project `.gitignore` if not already present.

### 3.2 Type Changes

Add to `InstarConfig` in `src/core/types.ts`:

```typescript
export interface InstarConfig {
  // ... existing fields ...
  /** Agent type -- standalone lives at ~/.instar/agents/<name>/, project-bound lives in a project */
  agentType?: AgentType;
}
```

### 3.3 Config Resolution for Standalone

Modify `src/core/Config.ts`:

**New function**: `resolveAgentDir(nameOrPath?: string): string`

Resolution order:
1. If `nameOrPath` is an absolute path, verify it resolves (via `fs.realpathSync()`) to a path under `~/.instar/agents/` or the current working directory. Reject with a validation error if it points outside these expected locations. The `realpathSync()` call also prevents symlink traversal attacks where a symlink under `~/.instar/agents/` points to an arbitrary filesystem location.
2. If `nameOrPath` matches a standalone agent name in registry, return `~/.instar/agents/<name>/`
3. If no argument, use `detectProjectDir()` (existing behavior)

**Modified**: `loadConfig(projectDir?: string)` gains awareness of standalone agents:
- If the resolved project dir is under `~/.instar/agents/`, set `agentType: 'standalone'`
- Otherwise, set `agentType: 'project-bound'`

### 3.4 Server Start for Standalone

Modify `src/commands/server.ts`:

**`instar server start <name>`** -- new optional argument:
- If `<name>` is provided and matches a standalone agent in registry, start that agent's server
- If no `<name>`, use existing behavior (detect from cwd)
- This allows `instar server start my-agent` from anywhere

Similarly for `instar server stop <name>`.

### 3.5 CLI Changes

| Command | Change |
|---------|--------|
| `instar init --standalone <name>` | New flag, creates at `~/.instar/agents/<name>/` |
| `instar server start [name]` | Optional name argument for standalone agents |
| `instar server stop [name]` | Optional name argument for standalone agents |
| `instar status [name]` | Optional name argument for standalone agents |
| `instar list` | Shows both standalone and project-bound agents |

### 3.7 Documentation Requirements (P1-8)

Before 0.9.0 release, the README must include:
- **(a)** Clear explanation of standalone vs project-bound agents with use-case examples (e.g., standalone = "personal assistant agent", project-bound = "project-specific coding agent")
- **(b)** A 5-command standalone quickstart: `instar init --standalone my-agent` → `instar server start my-agent` → interact → `instar backup` → `instar memory search "query"`
- **(c)** Mapping of `--standalone` flag to the "personal agent" concept — users should understand what standalone means before they encounter the flag

### 3.8 Files Modified

| File | Change |
|------|--------|
| `src/commands/init.ts` | Add `--standalone` handling, new `initStandaloneAgent()` function (~80 lines) |
| `src/core/Config.ts` | Add `resolveAgentDir()`, modify `loadConfig()` for standalone awareness |
| `src/core/types.ts` | Add `agentType` to `InstarConfig` |
| `src/commands/server.ts` | Add optional `[name]` argument to start/stop |
| `src/commands/status.ts` | Add optional `[name]` argument |
| `src/cli.ts` | Wire up `--standalone` flag and `[name]` arguments |

---

## 4. Phase 3: Backup System

**Goal**: Automatic pre-session snapshots and manual backup/restore of key agent files.

### 4.1 New Type Definitions

Add to `src/core/types.ts`:

```typescript
// -- Backup System ----------------------------------------------------

export interface BackupSnapshot {
  /** Timestamp-based ID (ISO format, filesystem-safe) */
  id: string;
  /** When this snapshot was created */
  createdAt: string;
  /** What triggered this snapshot */
  trigger: 'auto-session' | 'manual' | 'pre-update';
  /** Files included in this snapshot */
  files: string[];
  /** Total size in bytes */
  totalBytes: number;
}

export interface BackupConfig {
  /** Whether auto-backup before sessions is enabled (default: true) */
  enabled: boolean;
  /** Maximum snapshots to retain (default: 20) */
  maxSnapshots: number;
  /** Files to include in backups (relative to .instar/) */
  includeFiles: string[];
}
```

### 4.2 New File: `src/core/BackupManager.ts`

**~250 lines estimated**

Key methods:

| Method | Purpose |
|--------|---------|
| `constructor(stateDir, config?)` | Initialize with defaults |
| `createSnapshot(trigger): BackupSnapshot` | Copy files to `.instar/backups/{timestamp}/`. Before copying, reject any entry in `includeFiles` that resolves to `config.json` — log a warning and skip the file regardless of user configuration. This is a hardcoded blocklist for defense-in-depth: even if a user or migration script adds `config.json` to `includeFiles`, the method refuses to copy it. |
| `listSnapshots(): BackupSnapshot[]` | List available snapshots sorted by date |
| `restoreSnapshot(id): void` | Restore files from snapshot (backs up current state first). **Session guard**: the method itself must check for active sessions (via an `isSessionActive: () => boolean` callback passed to the constructor) and throw if any sessions are running. This ensures the guard is enforced regardless of call site — HTTP route, CLI, or AutoUpdater. Do not rely on the HTTP route handler as the only enforcement point. |
| `pruneSnapshots(): number` | Remove oldest snapshots beyond `maxSnapshots` |
| `getSnapshotPath(id): string` | Resolve path to snapshot directory |
| `validateSnapshotId(id): boolean` | Validate snapshot ID format (`/^\d{4}-\d{2}-\d{2}T\d{6}Z$/`) and path containment (P0-2) |

**Default files to back up:**
- `AGENT.md`, `USER.md`, `MEMORY.md`
- `jobs.json`, `users.json`
- `relationships/*.json` (all relationship files)

> **SECURITY**: `config.json` is explicitly excluded from backups — it contains auth tokens, Telegram bot tokens, and other secrets. Backups are for identity and memory, not secrets.

> **PRIVACY**: `relationships/` is included in backup defaults (valuable state that should survive machine failure) but excluded from git tracking to prevent PII from reaching remote repositories (see Section 5.2). This is intentional: relationship data is backed up locally but never committed to git. **Cloud-sync warning**: If the backup directory (`~/.instar/agents/<name>/.instar/backups/`) is inside a cloud-synced folder (Dropbox, iCloud, Google Drive), relationship files in backups may be inadvertently uploaded. Users should ensure the backup directory is excluded from cloud sync, or remove `relationships/` from `backup.includeFiles` if cloud sync cannot be avoided. The same GDPR Article 6 reasoning that excludes relationships from git applies to cloud-synced backups.

**Backup format:**
```
.instar/backups/
  2026-02-24T153045Z/
    manifest.json             # BackupSnapshot metadata (with integrity hash)
    AGENT.md
    USER.md
    MEMORY.md
    jobs.json
    users.json
    relationships/
      person-a.json
      person-b.json
```

**Manifest integrity**: `createSnapshot()` computes a SHA-256 hash over the sorted `files` array and `totalBytes` value and stores it as `integrityHash` in `manifest.json`. `restoreSnapshot()` recomputes the hash on load and rejects the manifest if it does not match — this prevents manifest poisoning where an attacker modifies the `files` list to reference paths outside the snapshot directory.

### 4.3 Integration Points

**Auto-backup before sessions**: Wire into `SessionManager` events -- before spawning a session, create a snapshot (with debounce: max 1 auto-snapshot per 30 minutes).

**Pre-update backup**: Modify `src/core/AutoUpdater.ts` to create a `'pre-update'` snapshot before applying any update.

### 4.4 CLI Commands

```
instar backup                 # Show help (available subcommands)
instar backup create          # Create a manual backup
instar backup list            # List available snapshots
instar backup restore [id]    # Restore from snapshot (latest if no id)
```

> **Note**: `instar backup` with no subcommand shows help text listing available subcommands. This matches the pattern used by all other Instar compound commands (no bare verb creates side effects).

### 4.5 API Endpoints

| Route | Method | Purpose |
|-------|--------|---------|
| `GET /backups` | GET | List all snapshots |
| `POST /backups` | POST | Create manual snapshot (maps to `instar backup create`) |
| `POST /backups/:id/restore` | POST | Restore from snapshot (see validation below) |

**`POST /backups/:id/restore` validation** (P0-2):
- `backupsDir` MUST be computed as `path.resolve(stateDir, 'backups')` (absolute, normalized). ALL file operations — both validation and actual restore — must use this exact resolved string as the base path. Do NOT use `path.join(stateDir, 'backups', id)` independently of the validation — the validated path and the operated-on path must be identical.
- Validate snapshot ID matches `/^\d{4}-\d{2}-\d{2}T\d{6}Z$/` — reject with `400 Bad Request` otherwise
- Assert `path.resolve(backupsDir, id).startsWith(backupsDir + path.sep)` before any file operation — reject with `400 Bad Request` if the resolved path escapes the backups directory (prevents directory traversal)
- Returns `409 Conflict` if any sessions are currently running — active sessions must be stopped before restore (P1-7). Note: the session check is also enforced inside `BackupManager.restoreSnapshot()` itself (see Section 4.2), so the HTTP route check is defense-in-depth.

### 4.6 Files Created

| File | Lines (est.) | Purpose |
|------|-------------|---------|
| `src/core/BackupManager.ts` | ~250 | Core backup logic |
| `src/commands/backup.ts` | ~120 | CLI command handlers |

### 4.7 Files Modified

| File | Change |
|------|--------|
| `src/core/types.ts` | Add `BackupSnapshot`, `BackupConfig` |
| `src/commands/server.ts` | Create BackupManager, auto-snapshot before sessions |
| `src/core/AutoUpdater.ts` | Pre-update snapshot |
| `src/server/routes.ts` | Add backup routes |
| `src/cli.ts` | Add `instar backup` command tree |
| `src/index.ts` | Export `BackupManager` |

---

## 5. Phase 4: Git-Backed Agent State

**Goal**: Optional git tracking of agent state files with auto-commit on meaningful changes.

> **IMPORTANT** (P0-3): `instar git init` is only supported for **standalone agents**. Project-bound agents already live inside a git repository — initializing a nested git repo inside `.instar/` creates submodule confusion with the parent repo. If a project-bound agent needs state versioning, the recommended approach is to commit the `.instar/` identity files directly to the parent repo.

### 5.1 New Type Definitions

Add to `src/core/types.ts`:

```typescript
// -- Git-Backed State -------------------------------------------------

export interface GitStateConfig {
  /** Whether git tracking is enabled */
  enabled: boolean;
  /** Remote URL for push/pull (optional) — validated: only https://, git@, ssh:// allowed (P1-1) */
  remote?: string;
  /** Branch name (default: 'main') */
  branch: string;
  /** Auto-commit on state changes */
  autoCommit: boolean;
  /** Auto-push after commits (default: false) — commits accumulate locally until explicitly pushed (P1-1) */
  autoPush: boolean;
  /** Debounce interval for auto-commits in seconds (default: 60) */
  commitDebounceSeconds: number;
}
```

### 5.2 New File: `src/core/GitStateManager.ts`

**~350 lines estimated**

Key methods:

| Method | Purpose |
|--------|---------|
| `constructor(stateDir, config)` | Initialize git state tracking |
| `init(): void` | `git init` in `.instar/`, create `.gitignore` for runtime state |
| `isInitialized(): boolean` | Check if git tracking is active |
| `commit(message, files?): void` | Stage and commit specific files (or all tracked) |
| `autoCommit(reason): void` | Debounced auto-commit |
| `push(): void` | Push to remote (if configured). **MUST call `validateRemoteUrl()` on the configured remote before invoking the `git push` subprocess.** This re-validation at execution time is required to defend against config.json poisoning — a compromised session or malicious restore could write a `file://` or attacker-controlled URL to `git.remote` in config.json, bypassing the entry-point validation. |
| `pull(): void` | Pull from remote (with conflict handling). **MUST call `validateRemoteUrl()` on the configured remote before invoking the `git pull` subprocess.** Same defense-in-depth rationale as `push()`. |
| `log(limit?): GitLogEntry[]` | Recent commit history |
| `status(): GitStatus` | Current diff/staged state |
| `validateRemoteUrl(url): boolean` | Allow only `https://`, `git@`, `ssh://` schemes. Reject `git://` and `file://` (P1-1). This method must be called at three points: (1) `instar git remote <url>` CLI command before writing to config, (2) `push()` before subprocess invocation, (3) `pull()` before subprocess invocation. |

**`.instar/.gitignore`** (auto-generated):
```
# Runtime state -- NOT tracked
state/
logs/
*.tmp
*.pid

# Secrets -- NEVER tracked
config.json

# Privacy: Contains third-party PII — excluded from remote push by default (P1-10)
relationships/

# Derived data -- reconstructable
memory.db
memory.db-wal
memory.db-shm
backups/

# Tracked state:
# AGENT.md, USER.md, MEMORY.md
# jobs.json
# users.json — contains cross-platform user identifiers (Telegram IDs, email). Review before pushing to remote.
# hooks/ (generated but version-trackable)
# evolution/ (proposals, learnings, gaps)
```

> **Privacy note** (P1-10): Relationship files contain names, contact information, and interaction history of people who never consented to having their data pushed to a remote repository. GDPR Article 6 requires a lawful basis for such transfers. Excluding `relationships/` from git tracking by default is a privacy-by-design measure.

**Auto-commit triggers** (integrated into existing managers):
- `StateManager` -- wrap `set()` to call `autoCommit()` for key files
- `RelationshipManager` -- after creating/updating relationships (no-op until user explicitly removes `relationships/` from `.gitignore` — since `relationships/` is git-ignored by default, this trigger will silently skip committing relationship changes. This is the correct safe behavior.)
- Direct file writes to `MEMORY.md`, `AGENT.md`, `USER.md`

**Auto-commit message format** (P2-05): Auto-commit messages use structured format: `[instar] <category>: <brief>`. Examples: `[instar] memory: updated MEMORY.md`, `[instar] identity: updated AGENT.md`, `[instar] relationship: updated record`. Messages avoid content-derived details (no names, no PII in git log).

### 5.3 CLI Commands

```
instar git init               # Initialize git tracking (standalone agents only — see P0-3)
instar git status             # Show tracked vs untracked state
instar git push               # Push to remote (re-validates remote URL before push)
instar git pull               # Pull from remote (re-validates remote URL before pull)
instar git log                # Show commit history
instar git remote <url>       # Set remote URL (validates URL scheme before writing to config)
```

**`instar git remote <url>` validation**: The CLI command MUST call `validateRemoteUrl(url)` and reject with a user-facing error before writing to `config.json`. Error message: `"Invalid remote URL: only https://, git@, and ssh:// schemes are allowed. Got: <url>"`

**`instar git init` in project-bound context**: If `instar git init` is run from a project-bound agent directory (detected by presence of parent `.git` repo or `agentType: 'project-bound'` in config), exit with error: `"Git state tracking is only supported for standalone agents. Project-bound agents live inside an existing git repository — commit your .instar/ identity files directly to the parent repo."` Exit code 1.

### 5.4 API Endpoints

| Route | Method | Purpose |
|-------|--------|---------|
| `GET /git/status` | GET | Git tracking status |
| `POST /git/commit` | POST | Trigger manual commit |
| `POST /git/push` | POST | Push to remote (see notes below) |
| `POST /git/pull` | POST | Pull from remote |
| `GET /git/log` | GET | Recent commit history |

**`POST /git/push` constraints**:
- Uses only the configured `remote` from `GitStateConfig`. **No request-body override of the remote URL is permitted.** If the request body contains a `remote` field, it is ignored. The only way to change the remote is via `instar git remote <url>` or by editing `config.json` directly.
- **First-push confirmation gate**: On the first push to any remote (remote not previously pushed to, tracked via a `lastPushedRemote` field in git state), return `428 Precondition Required` with a warning payload: `{ "warning": "First push to <url>. This will send all committed agent state to the remote.", "requiresConfirmation": true }`. The caller must retry with `{ "force": true }` in the request body to proceed. The `instar git push` CLI command prompts interactively on first push (or accepts `--confirm` for non-interactive use).

### 5.5 Files Created

| File | Lines (est.) | Purpose |
|------|-------------|---------|
| `src/core/GitStateManager.ts` | ~350 | Core git operations |
| `src/commands/git.ts` | ~150 | CLI command handlers |

### 5.6 Files Modified

| File | Change |
|------|--------|
| `src/core/types.ts` | Add `GitStateConfig` |
| `src/commands/init.ts` | Add `--git` flag to init (only valid with `--standalone` — P0-3) |
| `src/commands/server.ts` | Create GitStateManager, wire auto-commit |
| `src/server/routes.ts` | Add git routes (~80 lines) |
| `src/cli.ts` | Add `instar git` command tree |
| `src/index.ts` | Export `GitStateManager` |

---

## 6. Phase 5: SQLite Memory Search

**Goal**: FTS5 full-text search over agent memory files, with optional vector search in Phase B.

### 6.1 Architecture

```
Source of Truth (Markdown)         Derived Index (SQLite)
------------------------------     ----------------------
.instar/MEMORY.md           --+
.instar/AGENT.md            --+   .instar/memory.db
.instar/relationships/*.json--+     |-- tracked_files (hash, mtime)
.instar/logs/*.jsonl        --+     |-- chunks (text, source, offset)
session handoff notes       --+     |-- chunks_fts (FTS5 virtual table)
                                    |-- chunks_vec (Phase B: vector index)
                                    |-- embedding_cache (Phase B)
                                    +-- meta (schema version, stats)
```

**Core principle**: `memory.db` is a cache. Delete it, run `instar memory reindex`, and it rebuilds perfectly from the markdown files. The markdown files are never read from SQLite -- they are read directly. SQLite only powers search.

### 6.2 New Type Definitions

Add to `src/core/types.ts`:

```typescript
// -- Memory Search ----------------------------------------------------

export interface MemorySearchConfig {
  /** Whether memory search is enabled */
  enabled: boolean;
  /** Path to the SQLite database */
  dbPath: string;
  /** Source files/directories to index (relative to .instar/) */
  sources: MemorySource[];
  /** Chunk size in approximate tokens (default: 400) */
  chunkSize: number;
  /** Chunk overlap in approximate tokens (default: 80) */
  chunkOverlap: number;
  /** Whether to index session logs (can be large) */
  indexSessionLogs: boolean;
  /** Temporal decay factor (0-1, how much to weight recency) */
  temporalDecayFactor: number;
  /** Phase B: embedding provider config */
  embedding?: EmbeddingConfig;
}

export interface MemorySource {
  /** Relative path to file or directory */
  path: string;
  /** Source type affects chunking strategy */
  type: 'markdown' | 'json' | 'jsonl';
  /** Whether this source is "evergreen" (no temporal decay) */
  evergreen: boolean;
}

export interface EmbeddingConfig {
  /** Embedding provider */
  provider: 'anthropic' | 'openai' | 'local';
  /** Model name */
  model: string;
  /** API key env var name */
  apiKeyEnv: string;
  /** Dimensions (for vector index) */
  dimensions: number;
}

export interface MemorySearchResult {
  /** The matched text chunk */
  text: string;
  /** Source file path */
  source: string;
  /** Byte offset within the source file */
  offset: number;
  /** Relevance score (higher = more relevant) */
  score: number;
  /** FTS5 highlight with match markers */
  highlight?: string;
  /** When this chunk's source was last modified */
  sourceModifiedAt: string;
}

export interface MemoryIndexStats {
  /** Total number of indexed files */
  totalFiles: number;
  /** Total number of chunks */
  totalChunks: number;
  /** Database file size in bytes */
  dbSizeBytes: number;
  /** When the index was last updated */
  lastIndexedAt: string;
  /** Files that have changed since last index */
  staleFiles: number;
  /** Whether vector search is available */
  vectorSearchAvailable: boolean;
}
```

### 6.3 New File: `src/memory/MemoryIndex.ts`

**~500 lines estimated**

The core indexing and search engine.

Key methods:

| Method | Purpose |
|--------|---------|
| `constructor(config: MemorySearchConfig)` | Open/create SQLite db |
| `open(): void` | Initialize database, create tables |
| `close(): void` | Close database connection |
| `sync(): SyncResult` | Incremental sync -- hash check, re-index changed files |
| `reindex(): void` | Full rebuild from scratch |
| `search(query, options?): MemorySearchResult[]` | FTS5 search with ranking |
| `stats(): MemoryIndexStats` | Index statistics |
| `addFile(path, type, evergreen)` | Index a single file |
| `removeFile(path)` | Remove a file's chunks from index |

**SQLite Schema:**

```sql
-- Schema version tracking
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Tracked files with content hashes for incremental sync
CREATE TABLE IF NOT EXISTS tracked_files (
  path TEXT PRIMARY KEY,
  hash TEXT NOT NULL,
  mtime TEXT NOT NULL,
  type TEXT NOT NULL,        -- 'markdown' | 'json' | 'jsonl'
  evergreen INTEGER DEFAULT 0,
  indexed_at TEXT NOT NULL,
  chunk_count INTEGER DEFAULT 0
);

-- Content chunks
CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,       -- file path (FK to tracked_files.path)
  offset INTEGER NOT NULL,    -- byte offset in source file
  length INTEGER NOT NULL,    -- chunk length in bytes
  text TEXT NOT NULL,          -- the chunk content
  token_count INTEGER,        -- approximate token count
  created_at TEXT NOT NULL,
  indexed_at TEXT NOT NULL,
  FOREIGN KEY (source) REFERENCES tracked_files(path) ON DELETE CASCADE
);

-- FTS5 full-text search index (content-synced with chunks table)
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  text,
  source UNINDEXED,
  content='chunks',
  content_rowid='id',
  tokenize='porter unicode61'
);

-- Triggers to keep FTS5 in sync with chunks table
CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, text, source) VALUES (new.id, new.text, new.source);
END;
CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, text, source)
    VALUES('delete', old.id, old.text, old.source);
END;
CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, text, source)
    VALUES('delete', old.id, old.text, old.source);
  INSERT INTO chunks_fts(rowid, text, source) VALUES (new.id, new.text, new.source);
END;

-- Phase B (future): Vector embeddings via sqlite-vec
-- CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(
--   embedding float[1024]
-- );
-- CREATE TABLE IF NOT EXISTS embedding_cache (
--   chunk_id INTEGER PRIMARY KEY,
--   embedding BLOB NOT NULL,
--   model TEXT NOT NULL,
--   created_at TEXT NOT NULL,
--   FOREIGN KEY (chunk_id) REFERENCES chunks(id) ON DELETE CASCADE
-- );
```

### 6.4 New File: `src/memory/Chunker.ts`

**~200 lines estimated**

Splits source files into search-friendly chunks.

**Chunking strategy:**
- Target ~400 tokens per chunk (~1600 characters)
- ~80 token overlap (~320 characters)
- Line-aware boundaries: never split mid-line
- Heading-aware: markdown `##` headings start new chunks
- JSON/JSONL: each object/line is a natural chunk boundary

Key methods:

| Method | Purpose |
|--------|---------|
| `chunkMarkdown(text, chunkSize, overlap): Chunk[]` | Heading-aware markdown chunking |
| `chunkJson(text): Chunk[]` | JSON object chunking |
| `chunkJsonl(text): Chunk[]` | One chunk per JSONL line |
| `estimateTokens(text): number` | Fast ~4 chars/token estimate |

```typescript
export interface Chunk {
  text: string;
  offset: number;      // byte offset in source
  length: number;      // byte length
  tokenCount: number;  // estimated tokens
}
```

### 6.5 Search Ranking

The search function combines FTS5 rank with temporal decay:

```typescript
function computeScore(
  ftsRank: number,
  sourceModifiedAt: Date,
  isEvergreen: boolean,
  decayFactor: number
): number {
  // Normalize BM25 rank to a positive score (BM25 returns negative, lower = more relevant)
  const normalizedScore = 1 / (1 + Math.abs(ftsRank));

  if (isEvergreen) return normalizedScore; // MEMORY.md, AGENT.md -- no decay

  const ageHours = (Date.now() - sourceModifiedAt.getTime()) / (1000 * 60 * 60);
  const decay = Math.exp(-decayFactor * ageHours / (24 * 30)); // 30-day half-life
  return normalizedScore * decay;
}
```

- `MEMORY.md` and `AGENT.md` are evergreen -- always full relevance
- Session logs decay over time -- recent sessions are more relevant
- Relationship files are evergreen
- `decayFactor` is configurable (default: 0.693 — yields a true 30-day half-life; P2-19)

### 6.6 Incremental Sync

On server start and periodically (every 5 minutes), the sync process:

1. List all source files matching configured `sources`
2. Compute SHA-256 hash of each file
3. Compare with `tracked_files` table
4. For changed files: delete old chunks, re-chunk, insert new chunks
5. For deleted files: remove from `tracked_files` and `chunks`
6. FTS5 triggers keep the search index in sync automatically

### 6.7 Integration Points

**Server startup** (`src/commands/server.ts`):
- Create `MemoryIndex` instance if memory search is enabled
- Run initial `sync()` on startup
- Start periodic sync interval (every 5 minutes)
- Pass to RouteContext

**Dependency error handling** (P1-9): When `memory.enabled: true` but `better-sqlite3` is not installed, the server logs a clear warning at startup: `"Memory search enabled but better-sqlite3 is not installed. Run: npm install better-sqlite3. Memory search will be unavailable until installed."` The server continues to start — memory search is degraded, not broken.

**Session hooks** (`.instar/hooks/session-start.sh`):
- After session completes, trigger a sync to capture any new memory writes

### 6.8 CLI Commands

```
instar memory search "query"     # Search memory from CLI
instar memory reindex            # Full rebuild of SQLite index
instar memory status             # Show enabled/disabled, file count, db size, index statistics
```

> **Note** (P2-02): `instar memory stats` and `instar memory status` are collapsed into a single command `instar memory status` that shows both enabled/disabled state and index statistics (file count, chunk count, db size, last indexed timestamp, stale file count). Having two nearly-identical commands created user confusion.

### 6.9 API Endpoints

| Route | Method | Purpose |
|-------|--------|---------|
| `GET /memory/search?q=...&limit=10` | GET | Full-text search |
| `GET /memory/stats` | GET | Index statistics |
| `POST /memory/reindex` | POST | Trigger full reindex |
| `POST /memory/sync` | POST | Trigger incremental sync |

**Highlight sanitization** (P1-4): The `highlight` field contains FTS5-generated markup. All chunk text is HTML-escaped BEFORE FTS5 highlight markers are applied. Consumers should still treat `highlight` as untrusted content.

**Source field sanitization**: The `source` field (file path) is also HTML-escaped before being included in the API response. Since `source` is derived from user-configurable `memory.sources` paths, a malicious path containing `<script>` tags could be a secondary XSS vector in any future dashboard that renders it.

**FTS5 query handling**: The `q` parameter in `GET /memory/search` is treated as a phrase query by default. FTS5 special syntax characters (`AND`, `OR`, `NOT`, `NEAR`, `*`, column filters like `source:`) are stripped from the query input before passing to the `MATCH` clause. This prevents query manipulation that could bypass source filters or cause expensive wildcard scans. If raw FTS5 syntax support is needed in the future, it should be gated behind a separate `raw=true` query parameter with appropriate documentation.

**Privacy note on search sources**: Relationship files are included in memory search sources by default (see Appendix A). This is intentional for agent self-use — the agent needs to recall relationship context during conversations. However, any authenticated caller of `GET /memory/search` can retrieve relationship content (names, contact info, interaction history). Relationship files are excluded from git tracking (Section 5.2) to prevent PII from reaching remote repositories, but they ARE accessible via the local search API. If this exposure is undesirable, remove `relationships/` from `memory.sources` in `config.json`.

**Search response format:**

```json
{
  "query": "telegram configuration",
  "results": [
    {
      "text": "## Telegram Setup\n\nBot token: ...",
      "source": "MEMORY.md",
      "offset": 1234,
      "score": 8.73,
      "highlight": "## <b>Telegram</b> <b>Configuration</b>...",
      "sourceModifiedAt": "2026-02-24T10:30:00Z"
    }
  ],
  "totalResults": 3,
  "searchTimeMs": 12
}
```

### 6.10 Claude Tool Integration

Add to the agent's CLAUDE.md template in `src/scaffold/templates.ts`:

```markdown
### Memory Search

You have full-text search over your memory files:

\`\`\`bash
curl "http://localhost:PORT/memory/search?q=your+query&limit=5"
\`\`\`

Use this BEFORE answering questions that require recalling past context.
Searches across: MEMORY.md, AGENT.md, relationships, session logs.
```

### 6.11 Phase B: Vector Search (Future)

Phase B adds semantic search via embeddings. This is planned but NOT part of the initial implementation.

**Requirements for Phase B:**
- Optional dependency: `sqlite-vec` (native addon)
- Embedding provider integration (OpenAI, Anthropic, or local)
- `chunks_vec` virtual table with `sqlite-vec`
- Hybrid scoring: `alpha * fts5_score + (1 - alpha) * vector_score`
- Graceful degradation: if `sqlite-vec` is not installed, vector search is simply unavailable

Phase B will NOT be blocked by Phase A -- the schema is designed so FTS5 works standalone, and vector tables are additive.

### 6.12 Files Created

| File | Lines (est.) | Purpose |
|------|-------------|---------|
| `src/memory/MemoryIndex.ts` | ~500 | Core SQLite FTS5 indexing and search |
| `src/memory/Chunker.ts` | ~200 | File chunking pipeline |
| `src/commands/memory.ts` | ~120 | CLI command handlers |

### 6.13 Files Modified

| File | Change |
|------|--------|
| `src/core/types.ts` | Add memory search types |
| `src/core/Config.ts` | Add `memory` to `InstarConfig`, add to `ensureStateDir` |
| `src/commands/server.ts` | Create `MemoryIndex`, wire sync interval, pass to routes |
| `src/server/routes.ts` | Add memory routes (~80 lines) |
| `src/cli.ts` | Add `instar memory` command tree |
| `src/commands/init.ts` | Add memory config defaults to init config |
| `src/scaffold/templates.ts` | Add memory search docs to CLAUDE.md template |
| `src/index.ts` | Export `MemoryIndex`, `Chunker` |
| `package.json` | Add `better-sqlite3` as optional dependency |

---

## 7. Implementation Order and Dependencies

```
Phase 1: Global Agent Registry
    |
    +---> Phase 2: Standalone Agents (depends on Phase 1)
    |       |
    |       +---> Phase 3: Backup System (independent, but benefits from registry)
    |
    +---> Phase 4: Git-Backed State (independent of Phase 2)
              |
              +---> Phase 5: SQLite Memory Search (independent of Phase 4)
```

**Recommended implementation sequence:**

| Step | Feature | Reason |
|------|---------|--------|
| 1 | Phase 1: Global Agent Registry | Foundation -- everything else depends on knowing where agents live |
| 2 | Phase 2: Standalone Agents | Depends on registry to know agent locations |
| 3 | Phase 3: Backup System | Independent, low risk, high value -- protects agents before adding complexity |
| 4 | Phase 5: SQLite Memory Search | Highest standalone value -- any agent benefits immediately |
| 5 | Phase 4: Git-Backed State | Most complex integration, benefits from all other features being stable |

**Note**: Phases 3, 4, 5 are largely independent and could be parallelized across sessions. The critical path is Phase 1 -> Phase 2.

---

## 8. Migration Strategy

### 8.1 Existing Agents (v0.8.x -> v0.9.x)

**Zero-disruption upgrade path:**

1. **Port Registry -> Agent Registry**: `AgentRegistry.ts` checks for `port-registry.json` on first load. If found, migrates entries to `registry.json` with `type: 'project-bound'`. Renames old file to `port-registry.json.migrated`. Automatic -- no user action needed.

2. **Config.json augmentation**: Existing `config.json` files lack new fields. `loadConfig()` applies sensible defaults:
   - `agentType`: `'project-bound'` (inferred from path)
   - `backup.enabled`: `true`, `backup.maxSnapshots`: `20`
   - `memory.enabled`: `false` (opt-in, requires `better-sqlite3`)
   - `git.enabled`: `false` (opt-in)

3. **State directory expansion**: `ensureStateDir()` gains new subdirectories (`backups/`). Created lazily on first use.

4. **PostUpdateMigrator integration**: Add a migration step that:
   - Runs the port-registry -> agent-registry migration
   - Registers the current agent in the global registry
   - Creates `.instar/backups/` directory
   - Does NOT enable memory search or git by default

### 8.2 Version Gating

Each feature checks its config flag before activating:
- Backup: `config.backup?.enabled !== false` (default true)
- Git: `config.git?.enabled === true` (default false, opt-in)
- Memory: `config.memory?.enabled === true` (default false, opt-in)

### 8.3 Rollback Safety

- All new state is in new files/directories
- Existing `.instar/` structure is never modified (only appended)
- `memory.db` is derived and deletable
- `backups/` is additive
- Registry migration preserves the original file

---

## 9. Test Strategy

### 9.1 Unit Tests

| Module | Test File | Key Tests |
|--------|-----------|-----------|
| `AgentRegistry` | `tests/unit/agent-registry.test.ts` | Load/save, register/unregister, stale cleanup, port allocation, migration from port-registry |
| `BackupManager` | `tests/unit/backup-manager.test.ts` | Create snapshot, list, restore, prune, manifest integrity |
| `GitStateManager` | `tests/unit/git-state-manager.test.ts` | Init, commit, status, gitignore generation, debounce |
| `MemoryIndex` | `tests/unit/memory-index.test.ts` | Open/close, sync, search, FTS5 ranking, incremental update |
| `Chunker` | `tests/unit/chunker.test.ts` | Markdown chunking, heading boundaries, overlap, JSON/JSONL |

**Estimated**: 5 files, ~1500 lines total

### 9.2 Integration Tests

| Test | File | What It Covers |
|------|------|----------------|
| Standalone init | `tests/integration/standalone-init.test.ts` | Full standalone agent creation, registry entry, server start |
| Backup lifecycle | `tests/integration/backup-lifecycle.test.ts` | Create, modify, backup, restore, verify |
| Memory search E2E | `tests/integration/memory-search.test.ts` | Index MEMORY.md, search, incremental sync |
| Registry migration | `tests/integration/registry-migration.test.ts` | Port-registry to agent-registry migration |

**Estimated**: 4 files, ~800 lines total

### 9.3 E2E Tests

| Test | File | What It Covers |
|------|------|----------------|
| Full agent lifecycle | `tests/e2e/standalone-lifecycle.test.ts` | Init standalone -> start -> backup -> search -> stop |

**Estimated**: 1 file, ~200 lines

### 9.4 Pre-Release Checklist (Before 0.9.0 Tag)

Before tagging 0.9.0, verify the following non-code requirements are complete:

- [ ] README updated with standalone vs project-bound explanation and use-case examples (Section 3.7a)
- [ ] README includes 5-command standalone quickstart (Section 3.7b)
- [ ] README maps `--standalone` flag to "personal agent" concept (Section 3.7c)
- [ ] `instar instances` emits console.warn deprecation pointing to `instar list` (Section 2.4)
- [ ] `instar git init` in project-bound context exits with informative error (Section 5.3)
- [ ] `instar backup restore` prompts with snapshot details before restoring (or accepts `--yes` for non-interactive)
- [ ] `instar memory search` CLI supports `--limit` flag with default matching API (10)
- [ ] `resolveAgentDir()` failure message names the registry and suggests `instar list`

### 9.5 Test Patterns (Following Existing Conventions)

- Use `vitest` with `describe`/`it`/`expect`
- Temp directories via `fs.mkdtempSync(path.join(os.tmpdir(), 'instar-test-'))`
- Cleanup in `afterEach` / `afterAll` with `fs.rmSync(tmpDir, { recursive: true, force: true })`
- Unit tests mock filesystem, integration tests use real filesystem
- The `skipPrereqs: true` pattern from existing tests for bypassing tmux/claude detection

---

## 10. Risk Assessment

### 10.1 High Risk

| Risk | Impact | Mitigation |
|------|--------|------------|
| `better-sqlite3` native addon fails to install on some platforms | Memory search unavailable | Make `better-sqlite3` an optional dependency. Wrap in try/catch. Clear error message. Feature is opt-in. |
| Registry file corruption from concurrent access | All agents lose registry | Atomic write pattern (same as PortRegistry). Each agent can self-heal by re-registering on next server start. |
| Git auto-commit creates too many commits | Noisy history, disk usage | Debounce with configurable interval (default 60s). Batch changes into single commits. Max commit frequency cap. |

### 10.2 Medium Risk

| Risk | Impact | Mitigation |
|------|--------|------------|
| FTS5 index grows large for agents with many session logs | Disk usage, slow queries | Configurable `indexSessionLogs` flag (default: false). Session log pruning. `LIMIT` clauses on all queries. |
| Standalone agent path collision | Init failure | Validate name uniqueness against registry before creating. Clear error message. |
| Backup pruning deletes snapshot user wanted to keep | Data loss | Default retention of 20 is generous. Future: `--keep` flag for pinning. |
| Breaking change in `PortRegistry` import path | Existing code breaks | Deprecation shim: `PortRegistry.ts` re-exports from `AgentRegistry.ts`. Console.warn on first use. |

### 10.3 Low Risk

| Risk | Impact | Mitigation |
|------|--------|------------|
| `loadConfig` walk-up detection confuses standalone agents | Wrong config loaded | Standalone agents have `agentType: 'standalone'` in config. `resolveAgentDir()` checks registry before walk-up. |
| Git conflicts on pull | State divergence | Conservative conflict resolution: prefer remote for identity files, prefer local for runtime state. Alert user on conflict. |
| SQLite WAL file left behind on crash | Stale lock | SQLite handles this natively. WAL is always recoverable. |

---

## 11. Dependency Analysis

### 11.1 New Dependencies

| Package | Version | Size (install) | Purpose | Phase |
|---------|---------|---------------|---------|-------|
| `better-sqlite3` | `^11.0.0` | ~7 MB (native) | SQLite with FTS5, WAL mode | Phase 5A |
| `sqlite-vec` | `^0.1.3` | ~3 MB (native) | Vector search extension | Phase 5B (future) |
| `proper-lockfile` | `^4.1.0` | ~50 KB | File-level locking for registry TOCTOU prevention (P1-3). Mandatory — do not substitute with O_EXCL-based alternatives (they lack stale lock recovery). Configure with `stale: 10000`. | Phase 1 |

> **Note** (P0-5): Versions of `sqlite-vec` prior to 0.1.3 contain a confirmed heap buffer overflow (GHSA-vrcx-gx3g-j3h8). Always pin to `^0.1.3` or later.

### 11.2 Dependency Considerations

**`better-sqlite3`:**
- Prebuilt binaries available for macOS (ARM + Intel), Linux (x64 + ARM), Windows
- Falls back to source compilation if prebuild unavailable (requires C++ toolchain)
- Bundled FTS5 extension -- no extra setup
- Synchronous API -- perfect for our use case
- Well-maintained (10k+ GitHub stars, frequent releases)
- **Optional dependency**: install doesn't fail if native build fails

**Phases 1-4 are nearly dependency-free.** Registry, standalone, backup, and git primarily use Node.js built-ins (`fs`, `path`, `crypto`, `child_process`). The sole exception is `proper-lockfile` for Phase 1 registry locking (P1-3).

### 11.3 package.json Changes

```json
{
  "optionalDependencies": {
    "better-sqlite3": "^11.0.0",
    "sqlite-vec": "^0.1.3"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0"
  }
}
```

---

## 12. Estimated Scope

### 12.1 New Files

| File | Lines (est.) | Phase |
|------|-------------|-------|
| `src/core/AgentRegistry.ts` | ~300 | 1 |
| `src/core/BackupManager.ts` | ~250 | 3 |
| `src/commands/backup.ts` | ~120 | 3 |
| `src/core/GitStateManager.ts` | ~350 | 4 |
| `src/commands/git.ts` | ~150 | 4 |
| `src/memory/MemoryIndex.ts` | ~500 | 5 |
| `src/memory/Chunker.ts` | ~200 | 5 |
| `src/commands/memory.ts` | ~120 | 5 |
| **Total new source** | **~1990** | |

### 12.2 New Test Files

| File | Lines (est.) | Phase |
|------|-------------|-------|
| `tests/unit/agent-registry.test.ts` | ~250 | 1 |
| `tests/unit/backup-manager.test.ts` | ~250 | 3 |
| `tests/unit/git-state-manager.test.ts` | ~300 | 4 |
| `tests/unit/memory-index.test.ts` | ~400 | 5 |
| `tests/unit/chunker.test.ts` | ~300 | 5 |
| `tests/integration/standalone-init.test.ts` | ~200 | 2 |
| `tests/integration/backup-lifecycle.test.ts` | ~200 | 3 |
| `tests/integration/memory-search.test.ts` | ~200 | 5 |
| `tests/integration/registry-migration.test.ts` | ~200 | 1 |
| `tests/e2e/standalone-lifecycle.test.ts` | ~200 | 2 |
| **Total new tests** | **~2500** | |

### 12.3 Modified Files

| File | Lines Modified (est.) | Phase |
|------|---------------------|-------|
| `src/core/types.ts` | +120 | 1,2,3,4,5 |
| `src/core/Config.ts` | +40 | 1,2 |
| `src/commands/init.ts` | +80 | 2,4 |
| `src/commands/server.ts` | +60 | 1,3,4,5 |
| `src/server/routes.ts` | +200 | 3,4,5 |
| `src/cli.ts` | +120 | 1,2,3,4,5 |
| `src/index.ts` | +20 | All |
| `src/core/PortRegistry.ts` | ~10 (deprecation shim) | 1 |
| `src/core/PostUpdateMigrator.ts` | +30 | 1 |
| `src/scaffold/templates.ts` | +30 | 5 |
| `package.json` | +5 | 5 |
| **Total modified** | **~715** | |

### 12.4 Summary

| Category | Lines |
|----------|-------|
| New source code | ~1,990 |
| New test code | ~2,500 |
| Modified existing code | ~715 |
| **Total** | **~5,205** |

---

## Appendix A: Configuration Defaults

New fields added to `config.json` (all with defaults, existing configs don't need updating):

```json
{
  "agentType": "project-bound",
  "backup": {
    "enabled": true,
    "maxSnapshots": 20,
    "includeFiles": [
      "AGENT.md", "USER.md", "MEMORY.md",
      "jobs.json", "users.json",
      "relationships/"
    ]
  },
  "git": {
    "enabled": false,
    "branch": "main",
    "autoCommit": true,
    "autoPush": false,
    "commitDebounceSeconds": 60
  },
  "memory": {
    "enabled": false,
    "dbPath": ".instar/memory.db",
    "sources": [
      { "path": "MEMORY.md", "type": "markdown", "evergreen": true },
      { "path": "AGENT.md", "type": "markdown", "evergreen": true },
      { "path": "USER.md", "type": "markdown", "evergreen": true },
      { "path": "relationships/", "type": "json", "evergreen": true, "_comment": "Relationship files are included in search by default. This is intentional for agent self-use. Be aware that any authenticated caller of /memory/search can retrieve relationship content. If this is undesirable, remove relationships/ from memory.sources." }
    ],
    "chunkSize": 400,
    "chunkOverlap": 80,
    "indexSessionLogs": false,
    "temporalDecayFactor": 0.693
  }
}
```

**Feedback telemetry** (P1-5): `feedback.enabled` defaults to `false` for new installations. During `instar init`, a disclosure notice explains what data is collected (agent name, OS, node version) and to where (dawn.bot-me.ai). The `context` field is sanitized to strip credential patterns before transmission.

## Appendix B: CLI Command Summary

```bash
# Phase 1: Global Agent Registry
instar list                          # List all agents on this machine

# Phase 2: Standalone Agents
instar init --standalone <name>      # Create standalone agent
instar server start [name]           # Start (standalone by name, or cwd)
instar server stop [name]            # Stop
instar status [name]                 # Status

# Phase 3: Backup System
instar backup                        # Show help (available subcommands)
instar backup create                 # Create manual backup
instar backup list                   # List snapshots
instar backup restore [id]           # Restore from snapshot

# Phase 4: Git-Backed State
instar git init                      # Initialize git tracking (standalone agents only)
instar git status                    # Show git status
instar git push                      # Push to remote
instar git pull                      # Pull from remote
instar git log                       # Commit history
instar git remote <url>              # Set remote

# Phase 5: Memory Search
instar memory search "query"         # Full-text search
instar memory reindex                # Rebuild index
instar memory status                 # Enabled/disabled status + index statistics
```

## Appendix C: OpenClaw Reference

OpenClaw's memory architecture served as the primary reference for Phase 5. Key insights adopted:

1. **Markdown as source of truth, SQLite as derived index** -- the database is a cache that can be rebuilt
2. **better-sqlite3 over node:sqlite** -- FTS5 compiled in by default, extension loading works
3. **FTS5 with porter stemming** -- better recall for natural language queries
4. **Content-synced FTS tables** -- triggers keep search index in sync with chunks table
5. **Temporal decay with evergreen exemption** -- curated memory (MEMORY.md) doesn't decay, session logs do
6. **Hybrid search scoring** -- Phase B will merge FTS5 + vector scores (70/30 default weights)
7. **Graceful degradation** -- works at every level: full hybrid, FTS5 only, or LIKE fallback

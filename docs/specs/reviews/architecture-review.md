# Architecture Review: Instar Multi-Machine Specification

**Reviewer**: Distributed Systems Architect (Dawn spec review agent)
**Date**: 2026-02-24

---

## Key Findings

### 1. Split-Brain During Network Partitions (HIGH)

Two machines can both believe they're primary after a network partition heals. The git lock doesn't prevent dual-primary, only detects it after the fact. Both machines poll Telegram, respond to messages, execute jobs — then conflict on the next sync.

**Fix**: Primary must check lock file on every Telegram poll cycle (hot-path check from local file, not git pull). Lock has short TTL (15 min), renewed every 5 min. If lock held by someone else, immediately demote.

### 2. StateManager Has No Read-Only Mode (HIGH)

`StateManager.saveSession()`, `saveJobState()`, and `set()` all write unconditionally. A secondary machine can accidentally write state, creating silent forks.

**Fix**: Add a `readonly` flag to StateManager that throws on write attempts when secondary.

### 3. Merge Semantics Underspecified (MEDIUM)

"merge-union" for relationships needs concrete field-by-field rules. What happens to `interactionCount`? `significance`? `recentInteractions[]`? "newer-wins" for job state loses the other machine's run data.

**Fix**: Specify merge functions for every field in every synced type. For relationships: take max interactionCount, max significance, union recentInteractions with dedup by timestamp.

### 4. No Auto-Promotion (HIGH)

Without auto-promotion, the agent can be down for up to an hour after primary goes offline. This defeats the purpose of multi-machine.

**Fix**: Secondary periodically checks primary liveness (via lock expiry or tunnel heartbeat). Auto-promotes after configurable timeout.

### 5. Append-Only Logs Will Conflict in Git (MEDIUM)

Two machines appending to the same JSONL file produces a git merge conflict. Standard git merge doesn't handle append-only semantics.

**Fix**: Machine-specific log files (`activity-2026-02-24-m_a1b2c3d4.jsonl`) or explicit concat-both-sides resolver.

### 6. Event-Driven Git Pushes Cause Contention (LOW)

Every job completion triggers commit + push. 10 jobs completing near each other = 10 sequential pushes.

**Fix**: Batch state changes and push once every N seconds (e.g., 30s debounce).

---

## Config Split Seam

Current `loadConfig()` reads a single `config.json`. The proposed split requires merging two files. The current `messaging` config uses a generic `Record<string, unknown>` — there's no structured way to separate secret parts from non-secret parts of adapter configs.

**Fix**: Either add a `secrets` sub-key convention per adapter config, or refactor the adapter config structure.

---

## Alternative Worth Considering

**Hybrid approach**: Git for code/config (low-frequency, human-reviewable), tunnel for operational state (high-frequency, machine-generated). Separates configuration from operational state. Eliminates most merge conflicts. Git history stays clean. The most pragmatic simplification.

---

## Missing Infrastructure

1. **Sync health monitoring** — syncHealth in health endpoint
2. **State format versioning** — for future migrations
3. **Cleanup/GC** — orphaned locks, stale machine entries, nonce accumulation
4. **Testing infrastructure** — simulate multi-machine in CI
5. **Backup independent of git** — local state backup for git corruption
6. **Conflict resolution UI** — for "manual" strategy types

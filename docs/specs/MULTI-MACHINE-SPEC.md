# Instar Multi-Machine & Multi-User Specification

> Secure, seamless multi-machine coordination and multi-user Telegram for Instar agents.

**Status**: Draft v3 (converged)
**Author**: Dawn (with Justin's direction)
**Date**: 2026-02-24
**Review history**: v1 reviewed by 4 agents (Security, UX, Adversarial, Architecture). v2 reviewed by same 4 agents. v3 incorporates all remaining findings — spec is converged.

---

## Table of Contents

1. [Overview](#overview)
2. [Design Principles](#design-principles)
3. [Threat Model](#threat-model)
4. [Phase 1: Machine Identity](#phase-1-machine-identity)
5. [Phase 2: Secure Pairing](#phase-2-secure-pairing)
6. [Phase 3: State Sync via Git](#phase-3-state-sync-via-git)
7. [Phase 4: Secret Sync via Tunnel](#phase-4-secret-sync-via-tunnel)
8. [Phase 5: Distributed Coordination](#phase-5-distributed-coordination)
9. [Phase 6: Multi-User Telegram](#phase-6-multi-user-telegram)
10. [CLI Command Reference](#cli-command-reference)
11. [UX Walkthrough](#ux-walkthrough)
12. [Security Audit Checklist](#security-audit-checklist)
13. [Testing Strategy](#testing-strategy)
14. [Migration Path](#migration-path)

---

## Overview

Instar agents currently operate on a single machine. This spec extends Instar to support:

- **Multiple machines** running the same agent (same repo, same identity, different physical locations)
- **Multiple users** interacting with the agent via Telegram (private 1:1 and group conversations)
- **Secure coordination** so machines don't conflict, secrets stay protected, and the user experience remains effortless

### What Already Exists

| Component | Status | Notes |
|-----------|--------|-------|
| File-based state (`StateManager`) | Built | JSON files in `.instar/state/` |
| User management (`UserManager`) | Built | Multi-user identity resolution, permissions, channel mapping |
| Telegram adapter | Built | Long polling, forum topics, auth gating, voice transcription |
| Telegram lifeline | Built | PID-based lock, message queue, server supervision |
| Cloudflare tunnel | Built | Quick (ephemeral) and named (persistent) tunnels |
| Port registry | Built | Machine-wide multi-instance port allocation |
| Atomic file writes | Built | All state managers use atomic tmp+rename pattern |

### What This Spec Adds

| Component | Phase | Description |
|-----------|-------|-------------|
| Machine identity | 1 | Dual keypair (signing + encryption) + machine metadata |
| Secure pairing | 2 | Simple code exchange with mutual visual verification |
| State sync (hybrid) | 3 | Git for config/relationships, tunnel for operational state |
| Encrypted secret sync | 4 | Forward-secret encryption, secrets never touch git |
| Distributed coordination | 5 | Heartbeat-based role management with auto-failover |
| Multi-user Telegram | 6 | Group topics, primary/guest user model |

---

## Design Principles

1. **Secrets never touch git.** The repository is for configuration and relationship data. API keys, tokens, and credentials are synced only through encrypted channels between authenticated machines.

2. **Security is invisible to the user.** All cryptographic operations (key generation, encryption, signing, verification) happen automatically. The user's only security interaction is typing a pairing code once and confirming a verification code.

3. **Hybrid sync: git for config, tunnel for state.** Low-frequency, human-reviewable data (agent config, job definitions, relationships, evolution proposals) flows through git. High-frequency, machine-generated operational state (job runs, session state, activity logs) flows through the tunnel. This eliminates most merge conflicts and keeps git history clean.

4. **One awake instance per agent.** At any given time, only one machine is "awake" (polls Telegram, executes jobs). Other machine(s) are on "standby." Transition is coordinated, with automatic failover when the awake machine goes silent.

5. **Fail secure, not fail open.** If pairing fails, if a key can't be verified, if a lock can't be acquired — the operation stops. Never proceed with degraded security.

6. **One command, then conversation.** A non-technical user runs one setup command (`instar join`). From that point forward, *everything* is done by asking the agent. "Move yourself to this machine." "Show me your health." "Remove Adriana's laptop." The CLI exists for power users, but the primary interface is always the agent itself. No user should need to memorize commands.

7. **Invisible to non-technical users.** No cryptographic terms, no distributed systems jargon, no manual configuration. The agent handles all the complexity behind the scenes.

---

## Threat Model

### What We Protect Against

| Threat | Mitigation |
|--------|-----------|
| **Network eavesdropping** | All machine-to-machine traffic flows through Cloudflare tunnels (TLS 1.3). Application-layer encryption (X25519 + XChaCha20-Poly1305) provides defense-in-depth. |
| **Unauthorized machine joining** | Pairing uses SPAKE2 (resistant to offline dictionary attacks even with low-entropy codes) + mutual SAS verification. No machine can join without physical/verbal confirmation. |
| **GitHub account compromise** | Secrets are never in the repo. Commits are signed with machine keys; unsigned or revoked-machine commits are rejected. Attacker gets relationship data but no API keys. |
| **Machine theft/compromise** | Each machine has its own keypair. Forward-secret encryption means stolen keys cannot decrypt past traffic. Machine can be revoked, triggering immediate external secret rotation. |
| **Telegram bot token theft** | Authorized user ID allowlist. Per-user permissions. On machine revocation, bot token is rotated via BotFather API. |
| **Man-in-the-middle** | SPAKE2 pairing is resistant to MITM even over compromised TLS. 24-bit SAS verification (6 emojis) catches active MITM. Ongoing communication uses machine keypairs. |
| **Replay attacks** | Timestamp (30-second window) + nonce (persisted to disk) + sequence numbers per machine pair. |
| **State tampering via git** | Mandatory commit signing with machine Ed25519 keys. Unsigned or revoked-machine commits rejected on pull. |
| **Cloudflare as observer** | SPAKE2 prevents offline brute-force even if Cloudflare captures the pairing exchange. Ongoing secret sync uses forward-secret ephemeral keys inside the TLS tunnel. |

### What We Don't Protect Against (Out of Scope)

- **Physical access to an unlocked machine** — OS-level concern. We mitigate with OS keychain for at-rest secret storage.
- **Compromised npm supply chain** — standard npm security practices apply.
- **Cloudflare as an active attacker** — they terminate TLS, but SPAKE2 + SAS verification closes the MITM gap. For paranoid setups, WireGuard is a future alternative.

---

## Phase 1: Machine Identity

### Overview

Every machine gets a persistent cryptographic identity generated automatically during `instar init` or `instar join`. This is the foundation for all subsequent security.

### Key Generation

During setup, two key pairs are generated:

```
.instar/
  machine/
    identity.json        # Public metadata (committed to git)
    signing-key.pem      # Ed25519 private key for signatures (NEVER committed)
    encryption-key.pem   # X25519 private key for encryption (NEVER committed)
```

**Why two key pairs**: Ed25519 is for signing (commits, API requests). X25519 is for encryption (secret sync, pairing). Using separate keys for separate purposes is a cryptographic best practice — it prevents cross-protocol attacks and simplifies security analysis.

**identity.json** (committed to git):
```json
{
  "machineId": "m_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
  "signingPublicKey": "MCowBQYDK2VwAyEA...",
  "encryptionPublicKey": "MCowBQYDK2VuAyEA...",
  "name": "justins-macbook",
  "platform": "darwin-arm64",
  "createdAt": "2026-02-24T12:00:00Z",
  "capabilities": ["telegram", "jobs", "tunnel"]
}
```

**Key details:**
- Ed25519 for signing: `crypto.generateKeyPairSync('ed25519')`
- X25519 for encryption: `crypto.generateKeyPairSync('x25519')`
- File permissions: 0600 (owner read/write only)
- Machine ID: 128-bit random (32 hex chars) — eliminates collision concerns

### Machine Registry

All known machines are tracked in a registry committed to git:

```
.instar/
  machines/
    registry.json        # Machine metadata and trust state
```

**registry.json**:
```json
{
  "version": 1,
  "machines": {
    "m_a1b2c3d4...": {
      "name": "justins-macbook",
      "status": "active",
      "role": "awake",
      "pairedAt": "2026-02-24T12:00:00Z",
      "lastSeen": "2026-02-24T16:00:00Z"
    },
    "m_e5f6g7h8...": {
      "name": "adrianas-laptop",
      "status": "active",
      "role": "standby",
      "pairedAt": "2026-02-24T13:00:00Z",
      "lastSeen": "2026-02-24T15:30:00Z"
    }
  }
}
```

### .gitignore Additions

```gitignore
# Machine secrets (NEVER commit)
.instar/machine/signing-key.pem
.instar/machine/encryption-key.pem
.instar/secrets/
.instar/pairing/
```

### New Types

```typescript
interface MachineIdentity {
  machineId: string;              // "m_" + 32 random hex chars (128 bits)
  signingPublicKey: string;       // Base64-encoded Ed25519 public key
  encryptionPublicKey: string;    // Base64-encoded X25519 public key
  name: string;                   // Human-friendly name (auto-detected or user-provided)
  platform: string;               // e.g., "darwin-arm64", "linux-x64"
  createdAt: string;              // ISO timestamp
  capabilities: string[];         // What this machine can do
}

interface MachineRegistry {
  version: number;                // Schema version for future migrations
  machines: Record<string, {
    name: string;
    status: 'active' | 'revoked' | 'pending';
    role: 'awake' | 'standby';
    pairedAt: string;
    lastSeen: string;
    revokedAt?: string;
    revokedBy?: string;
    revokeReason?: string;
  }>;
}
```

---

## Phase 2: Secure Pairing

### Overview

When a user sets up a second machine, they "pair" it with the first using a short code. The protocol uses SPAKE2 (a password-authenticated key exchange) which is specifically designed for low-entropy shared secrets — it prevents offline dictionary attacks even if an attacker captures the entire exchange.

### Why SPAKE2

The v1 spec used HKDF to derive a shared secret from the pairing code. This is vulnerable to offline brute-force: an attacker who captures the exchange can try all ~655M codes in under a second. SPAKE2 solves this by construction — the protocol reveals no information about the password to an eavesdropper, even one who records every byte.

**Implementation**: Use the `@aspect-build/aspect-spake2` npm package, or implement SPAKE2-EE per RFC 9382 using Node.js `crypto`.

### Pairing Flow

#### Step 1: Machine A generates a pairing code

```bash
$ instar pair

  SECURITY: Only share this code with someone you trust
  and can verify in person. Never share over email or chat.

  Pairing code: WOLF-TIGER-3842
  Tunnel: https://abc123.trycloudflare.com

  Waiting for the other machine to connect...
  (Code expires in 2 minutes)
```

Both the **pairing code** and the **tunnel URL** are displayed together. The tunnel URL is NEVER read from git for pairing — it is communicated out-of-band (verbally, visually, or via QR code) alongside the pairing code.

Behind the scenes:
1. Generate a random pairing code (2 words + 4 digits)
2. Initialize SPAKE2 with the code as the shared password
3. Start a pairing listener on the tunnel: `POST /api/pair`
4. Set 2-minute expiry timer
5. Rate limit: 3 failed attempts, then code is globally invalidated

#### Step 2: Machine B connects with the code and tunnel URL

```bash
$ instar join https://github.com/justin/luna-agent.git

  Cloning Luna's repository...
  Installing dependencies...
  Generating machine identity...

  Enter the pairing code from the other machine: WOLF-TIGER-3842
  Enter the tunnel URL: https://abc123.trycloudflare.com

  Connecting...
  Keys exchanged.
```

Behind the scenes:
1. Machine B generates its own keypair
2. Machine B initializes SPAKE2 with the same code
3. Both machines execute the SPAKE2 protocol over the tunnel, producing a shared session key
4. The session key is used to encrypt all subsequent messages in the pairing session
5. **Because SPAKE2 is used**: even if Cloudflare records every byte, they cannot brute-force the code

#### Step 3: Mutual verification (SAS)

After key exchange, both machines display a Short Authentication String:

**Machine A:**
```
  Verification: wolf - wave - fire - music - tree - star
  This confirms no one intercepted the connection.
  Compare visually — do NOT read these aloud over a call.
  Does the other machine show the same icons? (y/n)
```

**Machine B:**
```
  Verification: wolf - wave - fire - music - tree - star
  This confirms no one intercepted the connection.
  Compare visually — do NOT read these aloud over a call.
  Does the other machine show the same icons? (y/n)
```

The SAS is derived from the SPAKE2 session key and both machines' public keys. If an attacker performed a MITM, the SAS would not match. Both users confirm the match visually (in person or via video — never by reading aloud).

Behind the scenes:
- SAS = first 24 bits of SHA-256(spake2_session_key || sorted(publicKeyA, publicKeyB))
- Mapped to 6 symbols from a set of 16 (4 bits each, 16^6 = ~16.7 million combinations)
- Displayed as words with emoji equivalents for accessibility: `wolf [emoji]` (works on terminals with or without emoji support)
- Including the SPAKE2 session key binds the SAS to this specific session, preventing replay of prior SAS confirmations

#### Step 4: Secret sync and completion

After SAS confirmation:

```
  Syncing Luna's secrets...
  Machine registered: adrianas-laptop

  Luna is ready on this machine!
  Luna is currently awake on justins-macbook.
  Your Telegram messages still reach Luna normally.

  To move Luna to this machine: instar wakeup
```

Behind the scenes:
1. Machine A encrypts the secrets bundle using an ephemeral X25519 key (for forward secrecy) + Machine B's encryption public key
2. Encrypted bundle sent over the SPAKE2-secured channel
3. Machine B decrypts and writes to local secret store
4. Machine B's identity is added to the registry and committed to git
5. The pairing code is invalidated (single-use)

#### Pairing Code Design

- Format: `WORD-WORD-NNNN` (e.g., `WOLF-TIGER-3842`)
- Wordlist: 256 common English nouns (easy to say aloud)
- Entropy: ~29.3 bits (sufficient because SPAKE2 prevents offline brute-force)
- Expiry: 2 minutes (shorter than v1 — pairing should happen quickly)
- Rate limiting: 3 failed attempts globally invalidate the code (not per-IP)
- Comparison: constant-time (`crypto.timingSafeEqual`) to prevent timing side-channels
- Single-use: code is consumed after the first successful pairing exchange
- Cooldown: 30 seconds before a new code can be generated after invalidation
- The pairing **code** is security-sensitive — share verbally or visually only, NEVER via text/chat/email
- The tunnel **URL** is NOT security-sensitive (it's a public Cloudflare endpoint) — can be sent via text, chat, or email for convenience. Only the code must be out-of-band.

#### What Gets Synced During Pairing

| Data | Transport | Encryption |
|------|-----------|-----------|
| Machine public keys | SPAKE2 channel over tunnel | SPAKE2 session key |
| Verification (SAS) | Visual/verbal (out-of-band) | N/A — human verification |
| Bot token(s) | SPAKE2 channel over tunnel | Ephemeral X25519 + XChaCha20-Poly1305 |
| API keys / secrets | SPAKE2 channel over tunnel | Ephemeral X25519 + XChaCha20-Poly1305 |
| Auth tokens | SPAKE2 channel over tunnel | Ephemeral X25519 + XChaCha20-Poly1305 |

#### QR Code Alternative

For in-person pairing, Machine A can display a QR code containing both the pairing code and tunnel URL:

```bash
$ instar pair --qr
```

Machine B scans with camera:
```bash
$ instar join --scan
```

This eliminates manual typing and is more resistant to shoulder-surfing than a displayed text code.

#### Revoking a Machine

```bash
$ instar machines remove adrianas-laptop

  Removing adrianas-laptop...
  - Marked as revoked in registry
  - Rotating Telegram bot token via BotFather API...
  - Rotating auth token...
  - New secrets synced to remaining active machines

  IMPORTANT: The following secrets were previously shared with
  adrianas-laptop and should be considered compromised:
  - Telegram bot token (rotated automatically)
  - Auth token (rotated automatically)
  - Any API keys stored in config.secrets.json

  If you have external API keys (Anthropic, OpenAI, etc.),
  rotate them manually in the provider's dashboard.
```

**What revocation does:**
1. Marks machine as revoked in `registry.json` (committed to git)
2. Automatically rotates: Telegram bot token (via BotFather API), agent auth token
3. Syncs new secrets to remaining active machines
4. Displays checklist of secrets the user should manually rotate

**What revocation cannot do:**
Prevent the revoked machine from using secrets it already has until those secrets are rotated at the source. This is a fundamental limitation. The revocation documentation is explicit about this.

---

## Phase 3: State Sync (Hybrid)

### Overview

The v1 spec used git for all state sync. Reviews identified that this creates merge conflicts for high-frequency operational data (JSONL logs, session state) and bloats git history. The v2 spec uses a **hybrid approach**:

- **Git**: Configuration, relationships, evolution proposals — low-frequency, human-reviewable
- **Tunnel**: Operational state, activity logs, job run history — high-frequency, machine-generated

### What Syncs via Git

| Data | Directory | Conflict Strategy |
|------|-----------|-------------------|
| Agent config | `.instar/config.json` | Manual review |
| Job definitions | `.instar/jobs.json` | Manual review |
| Relationship data | `.instar/relationships/` | Field-level merge (see below) |
| Evolution proposals | `.instar/evolution/` | Merge (union by ID, no duplicates) |
| Machine registry | `.instar/machines/` | Primary-only writes (see below) |
| User profiles | `.instar/state/users.json` | Manual review |

### What Syncs via Tunnel

| Data | Sync method | Conflict Strategy |
|------|-----------|-------------------|
| Job state | `POST /api/sync/jobs` | Newer timestamp wins |
| Session state | `POST /api/sync/sessions` | Newer timestamp wins |
| Activity logs | `POST /api/sync/logs` | Append, deduplicate by event ID |
| Lock/heartbeat state | `POST /api/heartbeat` | Always latest |

Tunnel sync happens:
- On explicit command: `instar sync`
- After each job completion (batched, 30-second debounce)
- Periodically: every 5 minutes while both machines are reachable

### Relationship Merge Semantics

When git merge encounters conflicting `RelationshipRecord` files, field-by-field resolution:

```typescript
function mergeRelationship(ours: RelationshipRecord, theirs: RelationshipRecord): RelationshipRecord {
  return {
    id: ours.id,
    name: theirs.lastInteraction > ours.lastInteraction ? theirs.name : ours.name,
    channels: unionBy([...ours.channels, ...theirs.channels], c => `${c.type}:${c.identifier}`),
    firstInteraction: min(ours.firstInteraction, theirs.firstInteraction),
    lastInteraction: max(ours.lastInteraction, theirs.lastInteraction),
    interactionCount: Math.max(ours.interactionCount, theirs.interactionCount),
    themes: [...new Set([...ours.themes, ...theirs.themes])],
    notes: theirs.lastInteraction > ours.lastInteraction ? theirs.notes : ours.notes,
    significance: Math.max(ours.significance, theirs.significance),
    arcSummary: theirs.lastInteraction > ours.lastInteraction ? theirs.arcSummary : ours.arcSummary,
    recentInteractions: mergeAndDedup(
      [...ours.recentInteractions, ...theirs.recentInteractions],
      'timestamp',
      20 // keep last 20
    ),
    // ... remaining fields: take from whichever has newer lastInteraction
  };
}
```

### Config and User Conflict Resolution

Relationship files have deterministic field-level merge (above). But `config.json` and `users.json` can't always be auto-merged — they contain settings where "both sides changed the same value" needs a human decision.

**Strategy by file type:**

| File | Conflict strategy |
|------|-------------------|
| `registry.json` | Primary-only writes (no conflicts possible) |
| `relationships/*.json` | Auto-merge per field rules above |
| `jobs.json` | Newer-timestamp wins (jobs are replaced, not patched) |
| `config.json` | Field-level diff presented to user |
| `users.json` | Field-level diff presented to user |

**When manual review is needed:**

```
Git sync conflict detected in config.json

  "messaging.defaultTopic" was changed on both machines:
    justins-macbook:   "general" -> "luna-chat"
    adrianas-laptop:   "general" -> "family"

  Which value should Luna use?
  [1] luna-chat (from justins-macbook)
  [2] family (from adrianas-laptop)
  > _
```

**If no user is present** (autonomous operation): the awake machine's version wins, and a Telegram notification is sent to the admin: "Config conflict auto-resolved in favor of awake machine. Run `instar sync --review` to see what was overridden."

### Machine Registry: Primary-Only Writes

Only the awake machine may modify `registry.json`. This prevents a revoked machine from re-adding itself or modifying other machines' status. The pre-merge hook rejects registry changes from commits signed by non-awake machines.

### Mandatory Commit Signing

All commits to `.instar/` files are signed with the committing machine's Ed25519 signing key. On `git pull`, a post-merge hook verifies:

1. Every commit touching `.instar/` is signed
2. The signing key belongs to a machine that was `active` at the time of the commit
3. Commits from `revoked` machines are rejected with a warning

This transforms git from a trust-everything transport to a verified-authorship transport.

**Implementation**: Git supports Ed25519 signing natively since v2.34. Configure via:
```bash
git config user.signingkey <ed25519-key-path>
git config gpg.format ssh
git config commit.gpgsign true
```

### Git Sync Triggers

1. **Before server start**: `git pull --rebase` to get latest
2. **After relationship update**: Commit, push (30-second debounce)
3. **On explicit command**: `instar sync`
4. **Periodic**: Every 15 minutes

### Security Event Log

A dedicated append-only security log tracks all security-relevant events:

```
.instar/logs/security.jsonl
```

Events logged:
- Pairing attempts (success/failure, machine ID, IP)
- Signature verification failures
- Nonce replay detections
- Machine revocations
- Role transitions (awake/standby)
- Lock acquisitions/contentions
- Unauthorized Telegram user blocks
- Secret sync operations

**Integrity**: Each log entry includes a `prevHash` field containing the SHA-256 hash of the previous entry. This hash chain makes retroactive tampering detectable — altering any entry breaks the chain for all subsequent entries. The first entry in the log uses `prevHash: "GENESIS"`.

```json
{
  "timestamp": "2026-02-24T10:30:00Z",
  "event": "pairing_success",
  "machineId": "m_a1b2c3d4",
  "remoteMachineId": "m_e5f6g7h8",
  "ip": "203.0.113.42",
  "prevHash": "sha256:abc123..."
}
```

This log syncs via tunnel (not git) and is append-only on both machines. Each machine maintains its own chain; cross-machine log integrity can be verified by exchanging chain heads.

---

## Phase 4: Secret Sync via Tunnel

### Overview

Secrets (API keys, bot tokens, credentials) are NEVER stored in git. They flow only through encrypted channels between authenticated machines, with forward secrecy on every transfer.

### At-Rest Secret Storage

Secrets are encrypted at rest using a master key stored in the OS keychain:

```
.instar/
  secrets/
    config.secrets.enc   # Encrypted secret store (gitignored)
```

**Encryption**:
- Master key stored in OS keychain (macOS Keychain / Linux Secret Service / Windows Credential Vault) via the `keytar` npm package
- If keychain is unavailable (headless server), falls back to file-based key at `.instar/machine/secrets-master.key` (0600 permissions) with a CLI warning
- Encryption algorithm: AES-256-GCM with the keychain-stored master key
- On startup, `loadConfig()` reads `config.json` (git) + decrypts `config.secrets.enc` (local) and merges them

**Decrypted content** (never written to disk in plaintext):
```json
{
  "telegram": {
    "token": "123456:ABC-DEF...",
    "chatId": "-100123456789"
  },
  "authToken": "sk-...",
  "tunnel": {
    "token": "eyJ..."
  }
}
```

### Config Split

The existing `config.json` is split:

**config.json** (committed to git — non-secret only):
```json
{
  "projectName": "luna",
  "port": 4040,
  "sessions": { "maxSessions": 3 },
  "messaging": [
    {
      "type": "telegram",
      "enabled": true,
      "config": {
        "pollIntervalMs": 3000,
        "authorizedUserIds": [123456, 789012]
      }
    }
  ]
}
```

Secret values are identified using an explicit `secret: true` annotation in the config schema:

```json
{
  "messaging": [
    {
      "type": "telegram",
      "enabled": true,
      "config": {
        "pollIntervalMs": 3000,
        "authorizedUserIds": [123456, 789012],
        "token": { "secret": true },
        "chatId": { "secret": true }
      }
    }
  ]
}
```

During migration, the script scans config for `{ "secret": true }` markers and moves those values to the encrypted store. The markers remain in `config.json` (committed to git) as placeholders; actual values live only in `config.secrets.enc`. This avoids brittle naming conventions (e.g., a field called `publicKey` being misclassified as secret).

### Secret Sync Protocol (Forward-Secret)

When secrets change on one machine and need to propagate:

1. Sender generates an ephemeral X25519 key pair (fresh for this transfer)
2. Sender performs ECDH: ephemeral private key + recipient's long-term X25519 public key = shared secret
3. Derive encryption key via HKDF-SHA256: `HKDF(shared_secret, salt=ephemeral_public_key, info="instar-secret-sync-v1")`
4. Encrypt secrets with XChaCha20-Poly1305 using the derived key
5. Send: `POST /api/secrets/sync` with body `{ ephemeralPublicKey, nonce, ciphertext, tag }`
6. Recipient performs ECDH: own private key + ephemeral public key = same shared secret
7. Recipient derives same key, decrypts, validates, writes to local encrypted store

**Forward secrecy**: The ephemeral key pair is discarded after the transfer. Even if the recipient's long-term private key is later compromised, past transfers cannot be decrypted because the ephemeral private key no longer exists.

### Inter-Machine API Authentication

Every request between machines includes:

```
Headers:
  X-Machine-Id: m_a1b2c3d4...
  X-Timestamp: 1708790400        (Unix seconds)
  X-Nonce: <16 random bytes, hex>
  X-Sequence: 42                 (per-peer monotonic counter)
  X-Signature: <Ed25519 signature of "machineId|timestamp|nonce|sequence|SHA256(body)">
```

The receiving machine verifies:
1. `X-Machine-Id` is in the registry and status is `active`
2. `X-Timestamp` is within 30 seconds of current time
3. `X-Nonce` has not been seen before (checked against persisted nonce store)
4. `X-Sequence` is greater than the last seen sequence from this peer
5. `X-Signature` is valid against the machine's Ed25519 signing public key
6. Only then: process the request

**Nonce persistence**: Nonces are stored in an append-only file (`.instar/state/nonces.jsonl`) with the timestamp. Nonces older than 60 seconds are pruned both on startup and continuously every 5 minutes during operation. This prevents the nonce file from growing unboundedly during long-running sessions and ensures replay detection survives server restarts.

**Sequence numbers**: Each machine maintains a monotonic counter per peer. This provides defense-in-depth: even if a nonce collision somehow occurs, the sequence number catches replays.

### Challenge-Response for High-Value Endpoints

The `/api/secrets/sync` and `/api/handoff/request` endpoints (the two highest-value targets) use an additional challenge-response step:

1. Sender requests: `POST /api/{endpoint}/challenge`
2. Receiver responds with a fresh 32-byte random challenge + 10-second expiry
3. Sender signs: `Ed25519(challenge + sender_machine_id + receiver_machine_id + SHA256(payload))`
4. Sender sends: `POST /api/{endpoint}` with the signed payload + challenge signature
5. Receiver verifies: challenge not expired, machine IDs match, signature valid
6. Challenge is consumed (added to nonce store, cannot be reused)

This eliminates all replay attacks on sensitive endpoints. The 10-second challenge expiry limits the window for any interception.

---

## Phase 5: Distributed Coordination

### Overview

When multiple machines can run the same agent, we need coordination to prevent conflicts. The primary mechanism is **heartbeat-based role management** with **automatic failover**.

### Terminology

| Term | Meaning |
|------|---------|
| **Awake** | The machine actively running the agent (polling Telegram, executing jobs) |
| **Standby** | A machine that is paired and ready but not actively running services |
| **Wakeup** | The act of transitioning a standby machine to awake |
| **Handoff** | Graceful transfer of the awake role from one machine to another |
| **Failover** | Automatic promotion of a standby machine when the awake machine goes silent |

### Role Capabilities

| Capability | Awake | Standby |
|-----------|-------|---------|
| Telegram polling | Yes | No |
| Job execution | Yes | No |
| State writes | Yes | **Read-only** (StateManager enforces) |
| Tunnel (API) | Yes | Yes |
| Git sync (pull) | Yes | Yes |
| Git sync (push) | Yes | On handoff only |
| Heartbeat broadcast | Yes (every 2 min) | Monitors only |

### StateManager Read-Only Mode

When a machine is in standby, `StateManager` operates in read-only mode:

```typescript
class StateManager {
  private _readOnly: boolean = false;

  setReadOnly(readOnly: boolean): void { this._readOnly = readOnly; }

  saveSession(session: Session): void {
    if (this._readOnly) throw new Error('StateManager is read-only (this machine is on standby)');
    // ... normal save
  }
  // Same guard on saveJobState(), set(), delete()
}
```

This prevents accidental state forks if a bug or race triggers a write on a standby machine.

### Heartbeat Protocol

The awake machine broadcasts a heartbeat every 2 minutes to all standby machines via their tunnel endpoints:

```
POST /api/heartbeat
{
  "machineId": "m_a1b2c3d4...",
  "role": "awake",
  "timestamp": "2026-02-24T16:00:00Z",
  "expiresAt": "2026-02-24T16:15:00Z"
}
```

The awake machine also writes a local heartbeat file (updated every 2 minutes):

```
.instar/state/heartbeat.json
{
  "holder": "m_a1b2c3d4...",
  "timestamp": "2026-02-24T16:00:00Z",
  "expiresAt": "2026-02-24T16:15:00Z"
}
```

**Critical hot-path check**: The awake machine checks the heartbeat file before every Telegram poll cycle. If the file shows a different machine as holder, it immediately demotes itself to standby. This is the primary split-brain prevention mechanism.

**Critical incoming heartbeat processing**: The awake machine also listens for incoming heartbeat broadcasts on its tunnel endpoint (`POST /api/heartbeat`). If it receives a heartbeat from another machine claiming the awake role, it means a failover happened (possibly during a git outage when the local heartbeat file wasn't updated). The awake machine immediately:
1. Checks: is my heartbeat newer? If yes, the other machine should demote (respond with "you should demote").
2. If the other machine's heartbeat is newer: demote self to standby immediately.
3. Log to security events.

This ensures split-brain is caught even when git is unreachable — the tunnel heartbeat acts as a direct communication channel.

### Graceful Handoff (`instar wakeup`)

```bash
$ instar wakeup

  Waking up Luna on this machine...
  Current location: justins-macbook
  Contacting via tunnel... acknowledged.
  justins-macbook is going to standby...
  Pulling latest state... done.
  Starting services...

  Luna is now awake on adrianas-laptop.
    Telegram polling: active
    Job scheduler: active
```

Behind the scenes:
1. New machine sends `POST /api/handoff/request` to current awake machine's tunnel
2. Current awake machine stops Telegram polling and job scheduler
3. Current awake machine commits and pushes all pending state changes
4. Current awake machine syncs operational state to new machine via tunnel
5. Current awake machine responds with acknowledgment
6. New machine pulls latest git state
7. New machine starts services, begins polling
8. New machine updates heartbeat and registry
9. Both machines send Telegram notification: "Luna moved to [machine-name]"

### Graceful Shutdown Handoff

When the awake machine shuts down cleanly (`instar server stop`, lid close detected via `caffeinate` exit):

1. Attempt to contact reachable standby machines
2. If a standby responds: initiate handoff (same as above)
3. If no standby responds: write a "handoff-needed" flag to git and push
4. Standby machine detects the flag on next sync and auto-promotes

### Automatic Failover

Standby machines monitor the awake machine's heartbeat:

```json
{
  "multiMachine": {
    "autoFailover": true,
    "failoverTimeoutMinutes": 15
  }
}
```

When `autoFailover` is enabled:
1. Standby checks the heartbeat every 2 minutes
2. If no heartbeat for `failoverTimeoutMinutes` (default: 15):
   a. Attempt to reach the awake machine via tunnel
   b. If unreachable and `autoFailoverConfirm` is false (default): promote self to awake
   c. If unreachable and `autoFailoverConfirm` is true: send Telegram message to admin: "[old-machine] went silent. Promote [this-machine]? Reply /yes or /no" — wait up to 10 minutes for response before promoting anyway
   d. Send Telegram notification: "Luna moved to [machine-name] (automatic — [old-machine] went silent, fingerprint: [first 8 chars of machine public key])"
3. When the old awake machine comes back online:
   a. It checks the heartbeat file on next sync
   b. Sees another machine is now awake
   c. Remains on standby
   d. Sends Telegram notification: "[machine-name] is back online, staying on standby"

**Failover hardening:**
- Minimum 30-minute cooldown between auto-failover events
- After 3 auto-failovers in 24 hours: disable auto-failover, notify user: "Auto-failover disabled due to instability. Run `instar wakeup` manually."
- Note: the agent may be unresponsive for up to `failoverTimeoutMinutes` after an unclean primary shutdown (power failure, kernel panic). Graceful shutdown handoff (lid-close detection) reduces this to seconds when possible, but is best-effort on macOS via `caffeinate` exit detection.

**Configuration:**
```json
{
  "multiMachine": {
    "autoFailover": true,
    "failoverTimeoutMinutes": 15,
    "autoFailoverConfirm": false
  }
}
```

### Lock Protocol (for contested transitions)

When two machines simultaneously try to become awake (rare, but possible after a network partition):

1. Both attempt to write `heartbeat.json` with their ID and push
2. Use `git push --force-with-lease` — fails if remote ref changed
3. If push fails: pull, check who won, back off with exponential jitter (1-4 seconds, random)
4. After write + push succeeds: immediately pull again and verify own ID is still the holder
5. If verification fails: lost the race, demote to standby
6. Maximum 3 retry attempts before giving up and staying standby
7. **Split-brain detection**: If both machines somehow end up awake (should be impossible with the above protocol), the heartbeat check before each Telegram poll catches it — the machine that didn't win the lock demotes itself on the next poll cycle

If split-brain is detected, a Telegram notification is sent: "WARNING: Multiple machines were briefly awake. Resolved automatically. If messages were duplicated, this is why."

**Tiebreaker (deadlock prevention)**: If all machines exhaust their 3 retries and no one holds the lock, the machine with the lexicographically lowest `machineId` force-promotes itself (bypasses the lock protocol). This prevents the worst case of all machines stuck on standby with no one awake. The force-promotion is logged as a security event.

### Behavior When Tunnel Is Unreachable

If the awake machine cannot reach a standby machine's tunnel (or vice versa):

1. **Heartbeat delivery fails**: Awake machine logs the failure, retries on next cycle. After 3 consecutive failures, marks the standby as `unreachable` in local state.
2. **Operational state sync fails**: State accumulates locally. Queued for delivery when connectivity resumes.
3. **Handoff requested to unreachable machine**: `instar wakeup` fails with: "Can't reach [machine]. It may be offline." The `--force` flag bypasses the check (promotes self without contacting the current awake machine — use only when the awake machine is known to be down).
4. **Both channels down** (git + tunnel): Machines operate independently. The awake machine continues serving. When connectivity resumes, state is reconciled via the normal merge/sync process.
5. **Periodic reachability check**: Every 5 minutes, standby machines probe the awake machine's tunnel. Results appear in `instar doctor` output.

### Behavior When Git Is Unreachable

If `git push` fails for non-conflict reasons (auth failure, network timeout, GitHub outage):

1. Awake machine continues operating normally (operational state syncs via tunnel)
2. A `gitSyncHealth` field in the health endpoint reports the failure
3. After 3 consecutive git sync failures: Telegram notification to user
4. State continues to accumulate locally; pushed on next successful sync
5. **No role changes occur** during git outage — the current awake machine stays awake

---

## Phase 6: Multi-User Telegram

### Conversation Types

#### Type 1: Agent + User (Private 1:1) — Already Supported

Each user gets a dedicated forum topic. No changes needed.

```
Luna's Telegram Group (forum)
  Topic: "Justin"         -> Luna talks to Justin
  Topic: "Adriana"        -> Luna talks to Adriana
  Topic: "Agent Updates"  -> Agent status messages
  Topic: "Lifeline"       -> Always-available emergency channel
```

#### Type 2: Agent + Multiple Users (Group Topic) — New

A forum topic where multiple authorized users talk to the agent together.

```
Luna's Telegram Group (forum)
  Topic: "Family Chat"    -> Luna + Justin + Adriana
```

**Behavior:**
- Luna sees messages from both Justin and Adriana in the same topic
- Each message is attributed to its sender (via `from.id`)
- Luna's context includes both relationships but adapts per message
- System note injected: "This is a group conversation with Justin and Adriana. The current message is from [sender]."

**Configuration:**
```json
{
  "topics": {
    "family-chat": {
      "type": "group",
      "name": "Family Chat",
      "members": ["justin", "adriana"],
      "topicId": 12345
    }
  }
}
```

**Creating via Telegram:**
```
Justin: /group create "Family Chat" @adriana_username
Luna: Created "Family Chat" topic. Adriana and you can both chat here.
```

#### Type 3: Multi-Machine Group — Deferred (Phase 7+)

Two instances of the same agent in one conversation. Requires multi-machine foundation to be solid first.

### User Discovery and Auto-Registration

When an unrecognized Telegram user messages the agent:

1. Message is held (not forwarded to agent session)
2. Agent owner is notified: "Unknown user @username (ID: 123) sent a message. Allow them to chat with Luna? /allow or /block"
3. If allowed: user added to `UserManager` with `['chat']` permissions
4. If blocked: user added to blocklist, future messages silently dropped

### Permission Model

| Permission | What it allows |
|-----------|---------------|
| `chat` | Send messages, receive responses |
| `admin` | Everything + manage users, trigger jobs, view status |
| `jobs` | Trigger specific jobs |
| `status` | View agent health and job status |
| `group:create` | Create new group topics |
| `group:invite` | Add users to group topics |

Default permissions for new users: `['chat']`

---

## CLI Command Reference

### Core Principle: One Command, Then Conversation

The only CLI command a non-technical user ever needs is `instar join`. After that, **every operation is available through conversation with the agent**. The user asks the agent in natural language, and the agent executes the underlying command.

| What the user says (Telegram) | What the agent does (CLI) |
|-------------------------------|--------------------------|
| "Move yourself to this machine" | `instar wakeup` |
| "How are you doing?" / "Are you healthy?" | `instar doctor` |
| "Show me your machines" | `instar machines` |
| "Remove Adriana's laptop" | `instar machines remove adrianas-laptop` |
| "Set up pairing for a new machine" | `instar pair` |
| "Disconnect this machine" | `instar leave` |
| "Sync now" | `instar sync` |
| "Which machine are you on?" | `instar whoami` |

The agent recognizes these intents through its existing natural language processing. Multi-machine commands are registered as agent capabilities during `instar upgrade`, so the agent knows what it can do. No slash commands to memorize, no syntax to learn — just ask.

### CLI Commands (for power users and automation)

| Command | Description | Who uses it |
|---------|-------------|-------------|
| `instar join <repo-url>` | Clone repo, install deps, generate identity, pair — all in one | New machine setup (only CLI-required command) |
| `instar pair` | Generate a pairing code for another machine to join | Existing machine |
| `instar pair --qr` | Display pairing info as QR code | Existing machine |
| `instar wakeup` | Move Luna to this machine (transfer awake role) | Any standby machine |
| `instar machines` | List all paired machines and their roles | Anyone |
| `instar machines remove <name>` | Revoke a machine and rotate secrets | Admin |
| `instar leave` | Self-remove this machine from the mesh | Any machine |
| `instar sync` | Manual force-sync (git + tunnel) | Anyone |
| `instar doctor` | Diagnose connectivity, sync health, role status | Anyone |
| `instar whoami` | Show this machine's identity and role | Anyone |

### `instar doctor` Output

**Healthy example:**
```
Checking Luna's health...
  Machine identity: OK (adrianas-laptop, m_e5f6g7h8...)
  Paired machines: 2
    justins-macbook: awake (last heartbeat: 2 min ago)
    adrianas-laptop: standby (this machine)
  Tunnel: connected (https://abc123.trycloudflare.com)
  Git sync: healthy (last sync: 5 min ago, 0 pending changes)
  Secrets: synced (4 keys, encrypted at rest)
  Telegram bot: connected (token valid)
  Last message processed: 3 minutes ago (by justins-macbook)

Luna is healthy. Messages are being handled by justins-macbook.
```

**Unhealthy example (with actionable suggestions):**
```
Checking Luna's health...
  Machine identity: OK (adrianas-laptop, m_e5f6g7h8...)
  Paired machines: 2
    justins-macbook: awake (last heartbeat: 47 min ago)  ⚠ STALE
    adrianas-laptop: standby (this machine)
  Tunnel: UNREACHABLE (https://abc123.trycloudflare.com)
    → justins-macbook may be offline. Run: instar wakeup
  Git sync: FAILING (last success: 2 hours ago, 3 consecutive failures)
    → Check network. Try: git push manually. If auth error: check SSH keys.
  Secrets: synced (4 keys, encrypted at rest)
  Telegram bot: token INVALID
    → Bot token may have been rotated. Re-pair to sync fresh secrets: instar pair

Luna needs attention. 3 issues found.
```

Each check outputs OK, a ⚠ warning, or a failure with a `→` suggestion line. The suggestion always includes a concrete command to run or action to take.

### `instar leave`

Self-removes this machine from the mesh. Used when decommissioning a machine or moving to a new one:

```bash
$ instar leave

  Removing adrianas-laptop from Luna's mesh...
  Notifying justins-macbook... acknowledged.
  Cleaning up local keys and secrets...
  Updating registry...

  This machine is no longer part of Luna's mesh.
  Luna is awake on justins-macbook.
```

Behind the scenes:
1. If this machine is awake: handoff to a standby first (fails if no reachable standby)
2. Notify all other machines via tunnel
3. Delete local keypairs and decrypted secrets
4. Remove self from `registry.json` and push
5. Other machines remove this machine's public keys from their trusted keys

The machine's git clone is kept intact (it's just an ordinary repo now). The user can re-join later with `instar join`.

### `instar machines` Output

```
Luna's machines:
  justins-macbook    awake     last seen: 2 min ago
  adrianas-laptop    standby   last seen: now (this machine)

Auto-failover: enabled (15 min timeout)
```

### Error Messages (Human-Readable)

All errors are wrapped to avoid cryptographic or systems jargon:

| Internal error | User sees |
|---------------|-----------|
| `Ed25519 key generation failed: EACCES` | "Could not set up security for this machine. Try: `sudo chown -R $(whoami) .instar/machine/`" |
| `X25519 ECDH failed` | "Secure connection failed. Try pairing again with a new code." |
| `config.secrets.enc missing` | "Luna's credentials are missing. Run `instar pair` to sync them from another machine." |
| `Signature verification failed` | "Could not verify the other machine's identity. The request was rejected for security." |
| `Lock acquisition failed` | "Another machine is currently waking up. Wait a moment and try again." |
| `Heartbeat expired` | "Luna's current machine went silent. Run `instar wakeup` to move Luna here." |
| `Pairing code expired (5 min)` | "That code has expired. Run `instar pair` again on the other machine to get a new one." |
| `Wrong pairing code (SPAKE2 failure)` | "That code didn't match. Double-check the code and try again. You have N attempts left." |
| `Rate limit reached (pairing)` | "Too many attempts. Wait 15 minutes, then run `instar pair` again for a fresh code." |
| `Tunnel unreachable during pairing` | "Can't reach the other machine. Make sure it's running and connected to the internet. URL: [url]" |
| `git clone failed (SSH)` | "Could not clone the repository. Make sure you have SSH keys set up for GitHub: https://docs.github.com/en/authentication/connecting-to-github-with-ssh" |
| `git clone failed (HTTPS)` | "Could not clone the repository. Check that the URL is correct and you have access." |
| `Already awake` | "Luna is already awake on this machine. Nothing to do!" |
| `Wakeup target unreachable` | "Can't reach [machine]. It may be offline. Wait for auto-failover, or use `instar wakeup --force`." |
| `SAS mismatch` | "The verification codes didn't match. This could mean someone is intercepting the connection. Pairing cancelled for your safety. Try again in person." |
| `Keychain unavailable` | "Could not access the system keychain. Luna's secrets will be protected by file permissions only. For stronger protection, set up [macOS Keychain / GNOME Keyring]." |

---

## UX Walkthrough

### Scenario: Justin sets up Luna for Adriana on her laptop

**Justin tells Luna to prepare (via Telegram):**

```
Justin: Luna, set up pairing for Adriana's laptop.
Luna: Done! Have Adriana run this on her laptop:

      npx instar join https://github.com/justin/luna-agent.git

      Pairing code: MAPLE-RIVER-7291
      Tunnel URL: https://abc123.trycloudflare.com

      ⚠️ Only share these with Adriana directly.
      The code expires in 5 minutes.
```

*(Luna ran `instar pair` behind the scenes and relayed the info.)*

**On Adriana's laptop (one command does everything):**

```bash
$ npx instar join https://github.com/justin/luna-agent.git

  Cloning Luna's repository...
  Installing dependencies...
  Setting up this machine's identity...

  Enter the pairing code: MAPLE-RIVER-7291
  Enter the tunnel URL: https://abc123.trycloudflare.com

  Connecting to justins-macbook...
  Keys exchanged.

  Verification: 🐺 🌊 🔥 🎵 🌙 🦋
  Does Justin's screen show the same 6 icons? (y/n): y

  Syncing Luna's secrets...
  Machine registered: adrianas-laptop

  Luna is ready on this machine!
  Luna is currently awake on justins-macbook.
  Your Telegram messages still reach Luna normally.

  Starting Luna on standby...
  Luna (standby) running on port 4041
  Auto-failover: enabled (15 min)
```

**Total steps for Adriana**: 1 command, type a code, type a URL, confirm 6 icons. Under 3 minutes. **She never touches the CLI again.**

### Scenario: Adriana's day-to-day (conversation only)

```
Adriana: Luna, which machine are you on right now?
Luna: I'm awake on justins-macbook. Your machine (adrianas-laptop) is on
      standby with auto-failover enabled. If Justin's machine goes offline,
      I'll move here automatically.

Adriana: Are you healthy?
Luna: All systems green! 2 machines paired, tunnel connected, last sync
      5 minutes ago, Telegram connected. Everything's working.

Adriana: Move yourself to my machine.
Luna: Done! I'm now awake on adrianas-laptop. Justin's machine is on standby.
```

Adriana never learns what `instar wakeup` or `instar doctor` are. She just talks to Luna.

### Scenario: Justin closes his laptop at night

1. Justin closes his laptop
2. Lid-close triggers graceful shutdown attempt
3. Luna contacts Adriana's machine via tunnel — "I'm shutting down"
4. If Adriana's machine is reachable: automatic handoff, Luna wakes up on Adriana's machine
5. If Adriana's machine is unreachable: Luna goes silent
6. Either way: after 15 minutes of silence, Adriana's machine auto-promotes via failover
7. Telegram notification: "Luna moved to adrianas-laptop (automatic — justins-macbook went silent)"

### Scenario: Justin opens his laptop in the morning

1. Justin's machine starts, pulls latest state
2. Sees heartbeat: Adriana's machine is awake
3. Stays on standby silently
4. If Justin wants Luna back: "Luna, move yourself to my machine"

---

## Security Audit Checklist

Before shipping, verify:

- [ ] Private keys are never committed to git (check .gitignore + pre-commit hook)
- [ ] SPAKE2 implementation is from a vetted library or follows RFC 9382
- [ ] SAS verification uses SHA-256 of sorted public keys
- [ ] Pairing codes use constant-time comparison (`crypto.timingSafeEqual`)
- [ ] Pairing codes are single-use (consumed after first successful exchange)
- [ ] Pairing endpoint rate-limits globally (not per-IP)
- [ ] Secret sync uses ephemeral X25519 + XChaCha20-Poly1305 (forward secrecy)
- [ ] Challenge-response protects `/api/secrets/sync` endpoint
- [ ] Nonces are persisted to disk (survive server restart)
- [ ] Sequence numbers are monotonic per peer
- [ ] Secrets are encrypted at rest (OS keychain or file-based fallback)
- [ ] Git commits to `.instar/` are signed with machine Ed25519 keys
- [ ] Post-merge hook rejects unsigned or revoked-machine commits
- [ ] Registry modifications are primary-only
- [ ] Machine revocation triggers external secret rotation (bot token, auth token)
- [ ] Revocation documentation lists manual rotation steps
- [ ] Tunnel URL is NEVER read from git for pairing
- [ ] All tunnel endpoints validate machine identity
- [ ] Rate limiting on all tunnel endpoints (not just pairing)
- [ ] Security events are logged to `.instar/logs/security.jsonl`
- [ ] Security log uses hash-chain integrity (each entry includes `prevHash`)
- [ ] Nonces are pruned continuously (every 5 min), not just on startup
- [ ] No secret material appears in git log (check commit messages too)
- [ ] Heartbeat check occurs before every Telegram poll cycle
- [ ] Awake machine processes incoming heartbeats for split-brain detection
- [ ] StateManager enforces read-only mode on standby machines
- [ ] All crypto errors are wrapped in human-readable messages
- [ ] `instar leave` cleans up local keys and secrets
- [ ] Config/users conflict resolution handles autonomous mode (awake wins + notification)

---

## Testing Strategy

Multi-machine support involves cryptography, distributed state, and network coordination — all domains where subtle bugs cause silent failures. **Nothing ships without passing all three levels.**

### Level 1: Unit Tests

Test individual components in isolation with mocked dependencies.

| Component | What to test | Key cases |
|-----------|-------------|-----------|
| SPAKE2 wrapper | Key exchange produces shared secret | Correct code succeeds, wrong code fails, constant-time comparison |
| X25519 + XChaCha20-Poly1305 | Encrypt/decrypt roundtrip | Valid key, wrong key fails, tampered ciphertext fails |
| SAS generation | Deterministic from session key + public keys | Same inputs = same SAS, different inputs = different SAS |
| Signature signing/verification | Ed25519 sign and verify | Valid sig passes, tampered payload fails, wrong key fails |
| Nonce store | Dedup, pruning, persistence | Duplicate nonce rejected, expired nonces pruned, survives restart |
| Sequence counter | Monotonic per peer | Replay rejected, gap accepted, reset on peer removal |
| StateManager read-only | Throws on write when standby | `saveSession` throws, `set` throws, reads succeed |
| Heartbeat file | Read/write/expiry | Valid heartbeat, expired heartbeat, different holder |
| Secret encryption (at-rest) | Keychain store/retrieve, AES-GCM roundtrip | Encrypt, decrypt, wrong key fails, missing keychain fallback |
| Relationship merge | Field-level merge rules | Max interactionCount, union themes, dedup recentInteractions |
| Config conflict detection | Identify conflicting fields | Same-field changes detected, non-conflicting changes auto-merged |
| Security log hash chain | Each entry links to previous | Chain validates, tampered entry breaks chain, genesis entry |
| Challenge-response | Generation, signing, verification, expiry | Valid challenge, expired challenge rejected, consumed challenge rejected |
| Error message wrapping | Every internal error maps to human-readable | All 16 error types produce friendly messages |

### Level 2: Integration Tests

Test component interactions with real crypto but simulated network.

| Scenario | What it validates |
|----------|------------------|
| **Full pairing flow** | SPAKE2 exchange → SAS display → key storage → registry update |
| **Secret sync roundtrip** | Challenge-request → ephemeral key exchange → encrypt → transfer → decrypt → verify |
| **Heartbeat + failover** | Awake broadcasts → standby monitors → simulate silence → auto-promote |
| **Graceful handoff** | Request → stop services → sync state → start on new machine → verify |
| **Git sync with merge** | Two machines edit relationships → commit → push → conflict → auto-resolve → verify merge |
| **Config conflict resolution** | Both machines change same config field → detect → present choice → resolve |
| **Machine revocation** | Revoke → registry update → verify rejected commits → verify rejected API calls |
| **Split-brain detection** | Two machines both claim awake → heartbeat cross-check → one demotes |
| **Nonce replay rejection** | Capture valid request → replay it → verify rejection |
| **Tunnel-unreachable degradation** | Simulate tunnel failure → verify awake continues → state queues → reconnect syncs |
| **Lock contention** | Two machines race for lock → one wins → other backs off → verify no dual-awake |
| **Tiebreaker promotion** | All machines exhaust retries → lowest ID promotes → services start |
| **`instar leave` flow** | Self-remove → handoff if awake → cleanup keys → update registry → verify |
| **Agent-mediated commands** | User says "move yourself here" via Telegram → agent executes wakeup → confirm |

### Level 3: End-to-End Tests

Full multi-machine scenarios with real processes, real git repos, and real (local) tunnels.

| Scenario | Setup | Validates |
|----------|-------|-----------|
| **Fresh setup** | Machine A: `instar init`. Machine B: `instar join`. | Entire onboarding flow from zero to two paired machines |
| **Day-in-the-life** | A is awake. Send Telegram messages. Close A. B auto-promotes. Open A. A stays standby. | The core multi-machine user experience end-to-end |
| **Adriana experience** | Non-technical user runs `instar join`, types code, confirms icons. Then only talks to agent via Telegram for all operations. | One-command setup + conversation-only operation |
| **Network partition** | A and B running. Sever tunnel. Both continue. Restore tunnel. State reconciles. | Partition tolerance and recovery |
| **Power failure** | A is awake. Kill A process (SIGKILL, no graceful shutdown). B eventually promotes. A restarts, stays standby. | Unclean failover recovery |
| **Secret rotation** | Revoke machine C. Verify new bot token. Verify C's signed commits rejected. Verify C's API calls rejected. | Full revocation lifecycle |
| **3-machine mesh** | A, B, C all paired. A awake. Kill A. B promotes. C stays standby. | N-machine scaling |
| **Concurrent state** | A and B both edit relationships while git is down. Git comes back. Merge succeeds. | Offline accumulation + reconciliation |

### Test Infrastructure

```
tests/
  unit/
    crypto/         # SPAKE2, X25519, signatures, nonces
    state/          # StateManager, heartbeat, merge
    security/       # Auth, replay, hash-chain
  integration/
    pairing.test.ts
    secret-sync.test.ts
    failover.test.ts
    handoff.test.ts
    git-merge.test.ts
    revocation.test.ts
    split-brain.test.ts
    agent-commands.test.ts
  e2e/
    setup.test.ts
    day-in-the-life.test.ts
    partition.test.ts
    power-failure.test.ts
    three-machines.test.ts
```

**E2E test harness**: Spawns multiple Instar server processes on different ports, uses a local bare git repo (no GitHub dependency), and uses localhost tunnels. Each test gets a fresh temp directory with its own `.instar/` state.

**CI requirement**: All three levels must pass before any multi-machine PR merges. E2E tests run in CI with a 5-minute timeout per scenario.

---

## Migration Path

### For Existing Single-Machine Agents

1. **Update Instar** to the version with multi-machine support
2. **Run `instar upgrade`** — automatically:
   - Generates machine identity (Ed25519 signing + X25519 encryption key pairs)
   - Extracts secrets from `config.json` into encrypted `config.secrets.enc`
   - Updates `.gitignore`
   - Configures git commit signing
   - Registers this machine as the initial awake machine
3. **No behavior changes** for single-machine users — everything works exactly as before
4. **When ready for multi-machine**: run `instar pair` on this machine, `instar join` on the new machine

### Breaking Changes

None. Multi-machine is purely additive. Single-machine agents work identically. The config extraction (`config.json` -> `config.json` + `config.secrets.enc`) is handled by the upgrade script, and `loadConfig()` merges them transparently.

---

## Decisions Made (Resolved from v1 Open Questions)

1. **Tunnel discovery for pairing**: The tunnel URL is displayed alongside the pairing code and communicated out-of-band (verbally/visually/QR). It is NEVER read from git for pairing. This eliminates the tunnel URL poisoning attack vector.

2. **NAT traversal**: At least one machine must have a Cloudflare tunnel for pairing. This is already the recommended setup. If neither has a tunnel, the user is prompted to enable one during `instar pair`.

3. **Sync frequency**: Git syncs every 15 minutes (config/relationships). Tunnel syncs every 5 minutes (operational state). Event-driven syncs debounce with a 30-second window to prevent contention.

4. **N machines**: The data model supports N machines. UX is optimized for 2. Adding a third is "just another `instar join`."

---

*"Two machines, one agent, zero compromise on security."*

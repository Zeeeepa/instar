# Multi-User Setup Wizard — Manual Testing Guide

> Walk-through for manually testing all decision paths. Each scenario describes what to do, what to observe, and what correct behavior looks like.

## Prerequisites

- Two machines (or two terminal sessions simulating different machines)
- A Telegram bot token configured in `.instar/config.json`
- A Telegram forum group with the bot as admin
- Fresh directory for each "clean install" test (no `.instar/`)

## Quick Reference: The Decision Tree

```
npx instar (no .instar/)
  ├── "Set up a new project agent" (inside git repo)
  ├── "Set up a new standalone agent" (outside git repo)
  └── "Connect to existing agent" (git URL or network pairing)

npx instar (existing .instar/)
  ├── "I'm a new user joining this agent"
  ├── "I'm an existing user on a new machine"
  └── "Start fresh" (with confirmation)
```

---

## Group A — Fresh Install

### A1. New project agent (inside a git repo)

**Setup**: Create a temp directory with `git init`.

```bash
mkdir /tmp/test-agent && cd /tmp/test-agent && git init
npx instar
```

**Observe**:
- Wizard detects git repo, offers "Set up a new project agent"
- After completion, verify files exist:
  - `.instar/AGENT.md`, `USER.md`, `MEMORY.md`, `config.json`, `jobs.json`, `users.json`
  - `.instar/hooks/session-start.sh`, `compaction-recovery.sh`, `dangerous-command-guard.sh`
  - `CLAUDE.md` (at project root)
  - `.claude/settings.json` (hook configuration)
- `users.json` contains one user (you, as admin)
- `config.json` has valid `projectName`, `port`, `sessions.claudePath`

### A2. New standalone agent (outside git repo)

**Setup**: Create a temp directory WITHOUT git.

```bash
mkdir /tmp/test-standalone && cd /tmp/test-standalone
npx instar
```

**Observe**:
- Wizard offers "Set up a new standalone agent"
- Agent is created in `~/.instar/agents/<name>/`
- Registered in `~/.instar/registry.json`

### A3. Multi-user setup — registration policy

**Setup**: During fresh install, answer "yes" to "Will other people use this agent?"

**Observe**:
- Wizard asks for registration policy: `admin-only`, `invite-only`, or `open`
- Wizard asks for agent autonomy level: `supervised`, `collaborative`, or `autonomous`
- Final message includes explicit next steps (not just "You're all set")

### A4. Recovery key generation

**Setup**: Complete any fresh install as admin.

**Observe**:
- Recovery key (32-byte hex string) displayed exactly once
- `config.json` contains `recoveryKeyHash` (bcrypt or SHA-256 hash), NOT the plaintext
- No file in `.instar/` contains the plaintext key
- Message tells user to save the key securely

---

## Group B — New User Joining Existing Agent

### B1. Consent before data collection

**Setup**: Have `.instar/` configured. Run `npx instar`, choose "I'm a new user."

**Observe**:
- Consent disclosure appears BEFORE asking for name/Telegram/preferences
- Options include "Sounds good" and "No thanks" (or similar)
- Choosing "No thanks" exits cleanly — no partial user profile in `users.json`

### B2. Successful onboarding with Telegram

**Setup**: Complete new user onboarding with Telegram configured.

**Observe**:
- New Telegram forum topic created for the user
- `users.json` now has the new user with:
  - `channels.telegram` populated
  - `permissions` set (non-admin by default)
  - `consent.timestamp` set
  - `pendingTelegramTopic: false`

### B3. Telegram topic creation fails

**Setup**: Temporarily invalidate the bot token or disconnect network during onboarding.

**Observe**:
- User onboarding still completes (profile is created)
- `pendingTelegramTopic: true` on the user profile
- Admin receives notification about the pending topic
- When server restarts / Telegram reconnects, topic creation is retried

### B4. Permission defaults

**Observe**:
- New users get non-admin permissions by default
- `viewOtherConversations: false` by default
- Only the first user (from fresh install) is admin

---

## Group C — Existing User, New Machine

### C1. Telegram verification — happy path

**Setup**: On a second machine (or fresh terminal), run `npx instar` with an existing `.instar/`.

1. Choose "I'm an existing user on a new machine"
2. Select yourself from the user list
3. Consent is shown before code is sent

**Observe**:
- 6-digit verification code arrives in your Telegram topic
- Enter correct code → pairing proceeds
- Telegram message: "I'm now available from your new machine too"
- Machine appears in `machine-registry.json`

### C2. Verification code expiry

**Setup**: Request a code, wait 10 minutes (or mock the TTL).

**Observe**:
- Entering the expired code → "Code has expired. Please request a new one."
- Expired code cannot be reused after requesting a new one

### C3. Attempt exhaustion and lockout

**Setup**: Enter wrong codes 5 times.

**Observe**:
- After 5 failures: lockout message with 30-minute wait time
- During lockout: requesting a new code is also blocked
- Wizard offers the pairing-code fallback method

### C4. Fallback to pairing code

**Setup**: Telegram unavailable, use pairing code method.

1. On the EXISTING machine: generate a pairing code (8-char, unambiguous characters)
2. On the NEW machine: enter the pairing code within 15 minutes

**Observe**:
- Successful pairing after entering correct code
- Pairing code expires after 15 minutes
- Expired code is rejected with clear message

### C5. Recovery key path

**Setup**: Both Telegram and pairing unavailable.

1. Enter the recovery key from fresh install

**Observe**:
- 24-hour security hold begins
- All machines and admins notified
- Full access NOT granted until hold completes

### C6. Complete failure (nothing available)

**Observe**:
- Wizard presents three recovery options (Telegram, pairing code, recovery key)
- No dead end — every option includes actionable instructions
- Never shows bare "contact admin" without specifics

---

## Group D — Connect Flow (Git Clone)

### D1. Connect via git URL — happy path

**Setup**: Have a repo with valid `.instar/` pushed to a git remote.

1. Run `npx instar` (no local `.instar/`), choose "Connect to existing agent"
2. Enter the git URL (https:// or git@)
3. Enter the 8-char connect code (generated on original machine)

**Observe**:
- Shallow clone (`--depth=1 --no-recurse-submodules`)
- Agent structure validated (AGENT.md, config.json, users.json)
- Agent registered in `~/.instar/registry.json`
- All cloned jobs are DISABLED by default (collaborative autonomy)
- Hooks are listed for review, none auto-executed

### D2. Invalid git URL

**Observe**: URLs that aren't `https://` or `git@` rejected immediately.

### D3. Clone failure (network error)

**Observe**:
- Partial `~/.instar/agents/<name>/` directory cleaned up completely
- Clear error message with reason
- Second attempt works cleanly

### D4. Invalid agent structure

**Setup**: Clone a repo missing AGENT.md.

**Observe**:
- Validation fails, names the missing files
- Clone directory cleaned up
- No partial state left

### D5. AGENT.md sandboxing (>100KB)

**Setup**: Clone a repo with a large AGENT.md.

**Observe**:
- Warning about unusually large file
- Content wrapped in session-unique boundary
- Boundary string itself stripped from AGENT.md content (anti-injection)

### D6. Jobs handling after connect

**Observe at collaborative level**:
- All jobs listed with descriptions, all disabled
- Admin must enable each explicitly

**Observe at autonomous level with `autoEnableVerifiedJobs: true`**:
- Jobs with `verified: true` auto-enabled
- Unverified jobs listed for review

---

## Group E — Pairing API

### E1. POST /state/submit — addMemory (happy path)

```bash
curl -X POST http://localhost:4040/state/submit \
  -H "Content-Type: application/json" \
  -d '{"writeToken":"...", "machineId":"...", "operation":"addMemory", "data":{...}}'
```

**Observe**: 200 with `{ applied: true }`, memory appended to storage.

### E2. Missing fields → 400

### E3. Invalid/revoked write token → 403

### E4. Token/machineId mismatch → 403

### E5. Escalating operation (modifyUser) → 403 with `requiresConfirmation: true`

Never queued, never applied without admin confirmation.

### E6. GET /state/sync

**Observe**: Returns `users`, `machineRegistry`, `configSummary` (no secrets), `syncedAt`.

### E7. POST /state/heartbeat

**Observe**: Updates `lastSeen` in registry, returns `queuedChanges` count.

### E8. Offline queue — enqueue and drain

1. Make primary unreachable
2. Submit `addMemory` → queued locally in `~/.instar/offline-queue/<agentId>.jsonl`
3. Reconnect, drain queue → entries applied in order, queue cleared

### E9. Offline queue — escalating ops cannot be queued

`modifyUser` returns false from `enqueue()`, nothing written.

### E10. Offline queue — TTL (7 days)

Entries older than 7 days skipped on drain with warning logged.

---

## Group F — Telegram Unknown-User Handling

### F1. admin-only policy

**Setup**: Set `userRegistrationPolicy: 'admin-only'` in config.

1. Have an unregistered Telegram user message the bot

**Observe**:
- User receives gated message (includes `registrationContactHint` if configured)
- Admin receives notification with 6-char approval code
- Rate limited: same user's second message within 60s → no duplicate notification

### F2. invite-only policy

**Setup**: Set `userRegistrationPolicy: 'invite-only'`.

1. Unknown user messages with correct invite code → welcome + mini-onboarding triggered
2. Unknown user messages with wrong code → error message, no onboarding
3. Unknown user messages with no code → prompt asking for invite code

### F3. open policy

**Setup**: Set `userRegistrationPolicy: 'open'`.

1. Unknown user messages → welcome + mini-onboarding triggered
2. If `onStartMiniOnboarding` not wired → fallback: "Registration is currently being set up"
3. If callback throws → error caught, recovery message sent, no crash

### F4. Rate limit hygiene

Simulate 101+ unknown user IDs messaging. Rate limit map should prune entries older than 10 minutes when it exceeds 100 entries.

---

## Group G — Agent Autonomy Levels

### G1. Supervised

- All 6 capability flags `false`
- Join requests: admin notified, no agent assessment
- Cloned jobs: all disabled, no recommendations
- Conflicts: always escalate

### G2. Collaborative (default)

- `assessJoinRequests: true`
- Join requests: admin gets agent's assessment alongside the notification
- Cloned jobs: listed with context, admin approves each
- Proactive status alerts fire

### G3. Autonomous

- `autoEnableVerifiedJobs: true`, `autoApproveKnownContacts: true`
- Known contacts: auto-approved, admin notified after with 24h reversal window
- Verified jobs: auto-enabled on connect
- Config conflicts: still escalate (always)

---

## Group H — UX Standard Compliance (Cross-Cutting)

Run these checks across ALL flows above:

| Rule | What to check |
|------|---------------|
| No dead ends | Every terminal state ends with an actionable next step |
| Defaults match common case | 2-person team works without changing defaults |
| Agent gets a voice | At collaborative level, join request notifications include agent assessment |
| Graduated agency | Behavior differences visible across supervised → collaborative → autonomous |
| Context before consent | Conflict resolution shows both sides before asking admin to approve |
| Self-recovery path | Solo admin with no Telegram + offline machine → recovery key works |

---

## Smoke Test Checklist (Quick Pass)

For a rapid sanity check, run through these 8 scenarios:

- [ ] Fresh install in git repo → all files created, hooks installed
- [ ] Fresh install → session-start.sh fires on `claude` startup (check topic context injection)
- [ ] Compaction recovery → after context compaction, topic context + identity re-injected
- [ ] New user join → consent shown first, profile created, Telegram topic made
- [ ] Existing user, new machine → verification code sent and accepted
- [ ] Connect via git → clone, validate, register, jobs disabled
- [ ] Unknown Telegram user (admin-only) → gated message + admin notification
- [ ] Pairing API → submit addMemory from secondary, verify on primary

---

## Known Limitations

1. **Recovery key security hold**: The 24-hour hold is enforced by the agent, not by cryptographic time-lock. A compromised agent could theoretically bypass it.
2. **Offline queue TTL**: The 7-day TTL is checked on drain, not on enqueue. Stale entries persist in the queue file until drained.
3. **Rate limiting**: The unknown-user rate limit is in-memory only. Server restart resets it.
4. **Connect code validation**: Requires network access to the original machine's API. Pure-offline connect is not supported (use git clone + manual pairing instead).

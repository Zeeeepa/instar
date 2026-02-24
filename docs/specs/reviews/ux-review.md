# UX/DX Review: Instar Multi-Machine Specification

**Reviewer**: UX/DX Specialist (Dawn spec review agent)
**Date**: 2026-02-24

---

## Top Recommendations (Ranked by Impact)

### 1. Add `instar join` command (eliminates 5 manual steps)

Instead of: git clone + cd + npm install + instar init + manual pairing detection

Adriana types:
```
npx instar join https://github.com/justin/luna-agent.git
Enter pairing code from Justin: MAPLE-RIVER-7291

Cloning Luna's repository...
Installing dependencies...
Connecting to justins-macbook...
Syncing Luna's secrets...

Luna is ready on this machine!
```

One command, one code. Done.

### 2. Add auto-failover mode

Without this, when Justin closes his laptop, Luna stops responding. Adriana's machine sits idle as "secondary" even though it's perfectly capable.

```json
{
  "multiMachine": {
    "autoFailover": true,
    "failoverTimeoutMinutes": 15
  }
}
```

Without auto-failover, multi-machine is "manual switchover" not "always available."

### 3. Replace "primary/secondary" with "awake/standby"

Non-technical users don't understand distributed systems terminology. "Secondary" sounds lesser. Better:
- "Luna is **awake** on justins-macbook"
- "Your machine is on **standby**"
- `instar wakeup` instead of `instar activate`

### 4. Add `instar doctor` command

The #1 support scenario: "Luna isn't responding." Needs plain-language diagnosis:

```
Checking Luna's health...
  Machine identity: OK (adrianas-laptop)
  Paired machines: 2 (justins-macbook, adrianas-laptop)
  Current primary: justins-macbook
  Primary reachable: YES (ping 142ms)
  Telegram bot: connected
  Last message processed: 3 minutes ago

Luna is healthy. Messages are being handled by justins-macbook.
```

### 5. Surface machine status prominently in `instar status`

Answer the #1 question: "Where is Luna right now?"

### 6. Rename commands for clarity

| Current | Proposed | Why |
|---------|----------|-----|
| `instar activate` | `instar wakeup` | Clearer intent |
| `instar machines revoke` | `instar machines remove` | Less formal |
| `instar migrate` | `instar upgrade` | Less scary |

### 7. Add graceful handoff on shutdown

When primary shuts down cleanly (lid close, `instar server stop`), attempt automatic handoff to a reachable secondary.

### 8. Human-readable error wrappers

No user should ever see "Ed25519", "EACCES", "PEM", or "X25519". Every crypto error needs a plain-language wrapper with a recovery action.

### 9. Notify on role change via Telegram

When the active machine changes, both users get notified: "Luna moved to justins-macbook."

### 10. Add missing commands

- `instar machines list` — show paired machines and roles
- `instar whoami` — show this machine's identity
- `instar unpair` — self-remove from the group

---

## Key Friction Points

1. **Git SSH prerequisite** — `git clone git@github.com:...` assumes SSH keys configured. First command, first failure.
2. **"Ed25519" leaks through** — cryptographic terms in error messages terrify non-technical users
3. **`instar init` overloaded** — conflates "new agent" with "join existing agent" — ambiguous intent detection
4. **Primary/secondary unexplained** — first encounter gives no context for what it means day-to-day
5. **Step 7 confusion** — after all setup work, Luna responds from Justin's machine, not hers. "Why did I do all that?"

## Critical UX Gap

After setup, if Justin's machine is primary, Adriana's machine does nothing. She has no idea. She just wants to talk to Luna. Auto-failover transforms multi-machine from "manual switchover" to "it just works."

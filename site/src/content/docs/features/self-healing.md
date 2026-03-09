---
title: Self-Healing
description: Automatic recovery from crashes, stalls, and dropped messages.
---

Your agent recovers from problems on its own. No silent failures, no stale sessions, no unanswered messages.

## Stall Detection

If a Telegram message goes unanswered for 2+ minutes, an LLM-powered triage nurse activates:

1. **Diagnoses** the problem (session crashed, session stalled, session busy)
2. **Treats** it (nudge the session, interrupt, or restart)
3. **Verifies** recovery
4. **Escalates** if treatment fails

```bash
curl localhost:4040/triage/status
curl localhost:4040/triage/history
```

## Session Monitoring

Polls all active sessions every 60 seconds. Detects:

- **Dead sessions** -- Process no longer running
- **Unresponsive sessions** -- Running but not producing output
- **Idle sessions** -- No activity for too long

Coordinates automatic recovery for each case.

## Promise Tracking

When the agent says "working on it" or "give me a minute," a timer starts. If no follow-up arrives within the expected window, the agent is nudged and the user is notified.

## Loud Degradation

When a fallback activates (e.g., LLM provider unavailable, file write failed), it's:

- **Logged** with full context
- **Reported** via Telegram
- **Surfaced** in the health dashboard

Never silently swallowed. All catch blocks are audited with zero silent fallbacks allowed.

## Unanswered Message Detection

When context compaction drops a user message mid-session, the agent detects the gap and re-surfaces the unanswered message. No more silent drops during long sessions.

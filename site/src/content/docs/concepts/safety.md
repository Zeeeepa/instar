---
title: Coherence Is Safety
description: Why agent coherence is the best safety mechanism.
---

Without coherence, autonomous agents are a security risk:

- An agent that doesn't remember it already sent an email **sends it again**
- An agent that doesn't track its own decisions **contradicts itself**
- An agent without values **makes expedient choices**

Instar's safety features are coherence features.

## Decision Journaling

Every significant decision is recorded with reasoning. The agent can explain why it did what it did, and detect when it's drifting from purpose.

```bash
# Query the decision journal
curl localhost:4040/intent/journal

# Check alignment score
curl localhost:4040/intent/alignment
```

## Operation Safety Gates

External actions are evaluated by an LLM-supervised gate before execution:

- **Risk classification** -- Every external operation scored on mutability, reversibility, and scope
- **Bulk deletes and irreversible sends** require explicit approval
- **Adaptive trust** -- Trust levels evolve per service based on track record
- **New services start supervised** -- consistent success earns autonomy

Born from a real incident where an AI agent deleted a user's emails.

## Drift Detection

Compares decision patterns across time windows. Detects when behavior shifts from stated purpose. Measures:

- Conflict frequency
- Confidence trends
- Principle consistency

## Autonomy Profiles

Trust elevation rewards consistent, value-aligned behavior with increasing independence. Safety that grows with the agent.

Emergency stop is always available -- say "stop everything" and the MessageSentinel halts operations before normal routing.

## Behavioral Hooks

Structural guardrails that fire automatically:

| Hook | Type | What it does |
|------|------|-------------|
| Dangerous command guard | PreToolUse (blocking) | Blocks `rm -rf`, force push, database drops |
| External operation gate | PreToolUse (blocking) | LLM-supervised safety for external calls |
| Grounding before messaging | PreToolUse (advisory) | Forces identity re-read before communication |
| Deferral detector | PreToolUse (advisory) | Catches the agent deferring work it could do |

## The Insight

Every safety feature exists because coherence *is* the safety mechanism. An agent that knows who it is, who you are, and what you both stand for -- that's an agent you can trust.

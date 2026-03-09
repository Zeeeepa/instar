---
title: Intent Alignment
description: Decision journaling, drift detection, and organizational constraints.
---

Infrastructure that keeps your agent aligned with its stated purpose -- not just in one session, but over time.

## Decision Journal

Every significant decision is logged with context, reasoning, and which principles it invoked. Creates an auditable record of agent behavior.

```bash
# Query the decision journal
curl localhost:4040/intent/journal

# Record a decision
curl -X POST localhost:4040/intent/journal \
  -H 'Content-Type: application/json' \
  -d '{"decision": "...", "reasoning": "...", "principles": ["autonomy", "safety"]}'
```

## Drift Detection

Compares decision patterns across time windows to detect when behavior is drifting from stated intent:

- **Conflict frequency** -- How often decisions conflict with stated values
- **Confidence trends** -- Whether decision confidence is declining
- **Principle consistency** -- Whether the same principles are invoked consistently

```bash
curl localhost:4040/intent/drift
```

## Organizational Intent

`ORG-INTENT.md` defines shared constraints across multiple agents:

- **Mandatory constraints** -- Rules that cannot be overridden
- **Default goals** -- Organizational priorities the agent follows unless personal values override
- **Agent identity** fills the rest

```bash
instar intent org-init      # Scaffold ORG-INTENT.md
instar intent validate      # Check AGENT.md against ORG-INTENT.md
instar intent reflect       # Review recent decisions against intent
```

## Alignment Scoring

A weighted 0-100 score across four dimensions:

1. Conflict freedom
2. Decision confidence
3. Principle consistency
4. Journal health

```bash
curl localhost:4040/intent/alignment
```

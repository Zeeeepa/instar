---
title: Relationships
description: Cross-platform identity resolution and relational depth tracking.
---

Every person the agent interacts with gets a relationship record that grows over time.

## What Gets Tracked

- **Cross-platform resolution** -- Same person on Telegram and email? Merged automatically
- **Significance scoring** -- Derived from frequency, recency, and depth of interaction
- **Themes** -- What you typically discuss with this person
- **Arc summary** -- The story of your relationship over time
- **Context injection** -- The agent knows who it's talking to before the conversation starts

## Stale Detection

Relationships that haven't been contacted in a configurable period are surfaced by the daily relationship-maintenance job. The agent can proactively reach out or note the gap.

```bash
curl localhost:4040/relationships/stale?days=14
```

## API

```bash
# List all relationships
curl localhost:4040/relationships?sort=significance

# Get a specific relationship
curl localhost:4040/relationships/RELATIONSHIP_ID

# Get relationship context (for injection into sessions)
curl localhost:4040/relationships/RELATIONSHIP_ID/context
```

## Storage

Relationship files live in `.instar/relationships/` as individual JSON files. The agent can read and modify them directly.

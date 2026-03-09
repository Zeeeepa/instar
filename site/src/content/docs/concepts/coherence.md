---
title: The Coherence Problem
description: Why agent coherence is the missing layer in AI infrastructure.
---

Claude Code is powerful. But power without coherence is unreliable.

An agent that forgets what you discussed yesterday, doesn't recognize someone it talked to last week, or contradicts its own decisions -- that agent can't be trusted with real autonomy.

## Six Dimensions

Instar solves coherence across six dimensions:

### Memory

Claude Code sessions start from zero. Context compaction erases conversation history. Instar adds:

- **Per-topic SQLite memory** with FTS5 full-text search
- **Rolling summaries** that update incrementally as conversations grow
- **Context re-injection** on session start and after compaction
- **Cross-session search** via `instar memory search`

### Relationships

Without relationships, every person is a stranger every session. Instar tracks:

- **Cross-platform identity resolution** -- same person on Telegram and email gets merged
- **Significance scoring** -- derived from frequency, recency, and depth
- **Context injection** -- the agent knows who it's talking to before the conversation starts
- **Stale detection** -- surfaces relationships that haven't been contacted in a while

### Identity

Loading an identity file at session start isn't enough. After extended tool chains, personality drifts. Sub-agent hand-offs lose character. Instar **enforces** identity through hooks:

- **Session-start scripts** re-inject identity at every session begin
- **Compaction recovery scripts** restore identity when context compresses
- **Grounding before messaging** forces identity re-read before external communication
- These aren't suggestions -- they're structural guarantees

### Temporal Awareness

Long-running agents accumulate stale assumptions. The TemporalCoherenceChecker detects when the agent is operating with outdated perspectives and triggers re-evaluation.

### Consistency

An agent that makes promises and forgets them isn't trustworthy. Instar adds:

- **Decision journaling** -- every significant decision recorded with reasoning
- **Drift detection** -- catches behavioral shifts from stated purpose
- **Commitment tracking** -- promises are tracked and surfaced when overdue

### Growth

Static agents don't improve. Instar provides four subsystems for structured evolution:

- **Evolution queue** -- staged self-improvement proposals
- **Learning registry** -- searchable insights across sessions
- **Capability gap tracker** -- what the agent can't do *yet*
- **Action queue** -- commitment follow-through

## The Core Insight

Instar doesn't just add features on top of Claude Code. It gives Claude Code the infrastructure to be **coherent** -- to feel like a partner, not a tool.

---
title: Conversational Memory
description: Per-topic SQLite memory with full-text search and rolling summaries.
---

Every conversation is stored, searchable, and summarized -- so the agent picks up exactly where it left off.

## Architecture

Messages are dual-written to two stores:

- **JSONL** (source of truth) -- Append-only log of all messages
- **SQLite** (query engine) -- FTS5 full-text search index, derived from JSONL

The SQLite index can be deleted and rebuilt anytime from the JSONL source.

## Rolling Summaries

LLM-generated conversation summaries update incrementally as conversations grow. These summaries are injected as highest-priority context on session start and after compaction.

This means the agent never starts cold -- it always has the context of what was discussed before.

## Full-Text Search

Search across all agent knowledge:

```bash
# CLI
instar memory search "deployment strategy"

# API
curl "localhost:4040/memory/search?q=deployment+strategy"
```

Search covers AGENT.md, USER.md, MEMORY.md, relationships, and conversation history.

## Topic Context

```bash
# Get summary + recent messages for a topic
curl localhost:4040/topic/context/TOPIC_ID

# List all topic summaries
curl localhost:4040/topic/summary

# Trigger summary regeneration
curl -X POST localhost:4040/topic/summarize
```

## Index Management

```bash
instar memory reindex   # Rebuild the search index
instar memory status    # Index stats
```

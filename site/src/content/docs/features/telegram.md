---
title: Telegram Integration
description: Two-way messaging via Telegram forum topics.
---

Telegram is the primary communication channel between you and your agent. Every conversation, every job, every alert flows through Telegram topics.

## Setup

The setup wizard walks you through creating a Telegram bot and connecting it:

```bash
npx instar
# Choose Telegram when prompted for messaging
```

Or add Telegram to an existing agent:

```bash
instar add telegram --token BOT_TOKEN --chat-id CHAT_ID
```

## How It Works

- **Send a message in a topic** -- arrives in the corresponding Claude session
- **Agent responds** -- reply appears in Telegram
- **`/new`** -- creates a fresh topic with its own session
- Sessions auto-respawn with conversation history when they expire

## Topics as Dashboard

Your Telegram group becomes a living dashboard:

| Topic Type | Purpose |
|-----------|---------|
| Interactive topics | Your conversations with the agent |
| Job topics | Each scheduled job gets its own topic |
| Lifeline topic | Agent health status (green icon) |

## Session Continuity

When a session expires or is compacted, the agent re-spawns with:
- Conversation summary (rolling LLM-generated summaries)
- Recent messages (loaded from SQLite)
- Full identity context (AGENT.md, USER.md, MEMORY.md)

The agent picks up exactly where it left off.

## API

```bash
# List topic-session mappings
curl localhost:4040/telegram/topics

# Send a message to a topic
curl -X POST localhost:4040/telegram/reply/TOPIC_ID \
  -H 'Authorization: Bearer TOKEN' \
  -d '{"text": "Hello from the API"}'

# Topic message history
curl localhost:4040/telegram/topics/TOPIC_ID/messages?limit=20
```

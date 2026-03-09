---
title: Lifeline
description: Persistent supervisor that keeps your agent alive.
---

The Lifeline is a persistent Telegram connection that supervises your agent's server. It runs outside the server process, so it can detect crashes and recover automatically.

## What It Does

- **Auto-recovery** -- If the server goes down, the Lifeline restarts it
- **Message queuing** -- Messages received during downtime are queued and delivered when the server comes back
- **First-boot greeting** -- Your agent greets you on Telegram in its own voice the first time it starts
- **Lifeline topic** -- Created during setup with a green icon, dedicated to agent health

## Commands

```bash
instar lifeline start    # Start lifeline (supervises server, queues messages)
instar lifeline stop     # Stop lifeline and server
instar lifeline status   # Check lifeline health
```

## Why a Separate Process?

The server runs inside tmux and can be killed, crash, or hit resource limits. The Lifeline runs as a separate Node.js process (or via `instar autostart` as a system service) that monitors the server and brings it back if it goes down.

Without the Lifeline, a server crash means silence until you notice. With it, the agent self-heals and queues messages so nothing is lost.

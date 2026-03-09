---
title: AutoUpdater
description: Built-in update engine that keeps your agent current.
---

A built-in update engine that runs inside the server process -- no Claude session needed.

## How It Works

1. Checks npm for new versions every 30 minutes
2. Auto-applies updates when available
3. Notifies you via Telegram with a changelog summary
4. Self-restarts after updating

## Status

```bash
curl localhost:4040/updates/auto
```

Returns last check time, current version, available version, and next check time.

## Manual Check

```bash
curl localhost:4040/updates
curl localhost:4040/updates/last
```

## No Session Required

Previous versions used a `update-check` prompt job that spawned a Claude session to check for updates. The AutoUpdater replaces this with a lightweight server-side check -- no Claude session needed, no quota consumed.

The old `update-check` job still exists in `jobs.json` for backward compatibility but is disabled by default.

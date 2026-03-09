---
title: Job Scheduler
description: Cron-based task execution with priority levels and model tiering.
---

Define tasks as JSON with cron schedules. Instar spawns Claude Code sessions to execute them.

## Job Definition

```json
{
  "slug": "check-emails",
  "name": "Email Check",
  "schedule": "0 */2 * * *",
  "priority": "high",
  "enabled": true,
  "execute": {
    "type": "prompt",
    "value": "Check email for new messages. Summarize anything urgent and send to Telegram."
  }
}
```

## Job Types

| Type | Description |
|------|-------------|
| `prompt` | Spawns a Claude Code session with the given prompt |
| `script` | Runs a shell command |
| `skill` | Executes a slash command |

## Priority Levels

Jobs have `low`, `medium`, or `high` priority. Higher priority jobs are executed first when multiple jobs are due simultaneously.

## Model Tiering

Each job can specify a model:

- **opus** -- Complex reasoning, analysis, long-form work
- **sonnet** -- General tasks, moderate reasoning (default)
- **haiku** -- Quick checks, simple tasks, high-frequency jobs

```json
{
  "slug": "health-check",
  "schedule": "*/5 * * * *",
  "model": "haiku",
  "execute": {
    "type": "prompt",
    "value": "Run health diagnostics and report any issues."
  }
}
```

## Quota Awareness

When quota tracking is enabled (`instar add quota`), the scheduler respects usage limits. Jobs are throttled automatically when approaching limits.

## Managing Jobs

```bash
# Add a job
instar job add --slug daily-summary --name "Daily Summary" \
  --schedule "0 9 * * *" --priority medium

# List jobs
curl localhost:4040/jobs

# Trigger a job manually
curl -X POST localhost:4040/jobs/daily-summary/trigger \
  -H 'Authorization: Bearer YOUR_AUTH_TOKEN'
```

## Telegram Topics

Each job gets its own topic in your Telegram group. Job output is posted to its topic automatically, creating a living dashboard of agent activity.

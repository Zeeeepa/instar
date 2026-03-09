---
title: Default Jobs
description: The circadian rhythm that ships out of the box.
---

Instar ships with default jobs that give your agent a circadian rhythm -- regular self-maintenance, evolution, and growth without user intervention.

## Job Schedule

| Job | Schedule | Model | Purpose |
|-----|----------|-------|---------|
| health-check | Every 5 min | Haiku | Verify infrastructure health |
| self-diagnosis | Every 2h | Sonnet | Proactive infrastructure scanning |
| reflection-trigger | Every 4h | Sonnet | Reflect on recent work |
| commitment-check | Every 4h | Haiku | Surface overdue action items |
| evolution-review | Every 6h | Sonnet | Review and implement evolution proposals |
| feedback-retry | Every 6h | Haiku | Retry un-forwarded feedback items |
| insight-harvest | Every 8h | Sonnet | Synthesize learnings into proposals |
| relationship-maintenance | Daily | Sonnet | Review stale relationships |

## Superseded Jobs

These jobs still exist in `jobs.json` for backward compatibility but are disabled by default:

| Job | Replaced By |
|-----|------------|
| update-check | [AutoUpdater](/features/autoupdater) (built-in server component) |
| dispatch-check | AutoDispatcher (built-in server component) |

These were replaced by server-side components that don't need to spawn Claude sessions, saving quota.

## Model Tiering

Jobs use different models based on complexity:

- **Haiku** -- Quick checks, simple tasks (health-check, commitment-check, feedback-retry)
- **Sonnet** -- General reasoning (reflection, evolution review, relationship maintenance)
- **Opus** -- Complex analysis (available for custom jobs)

## Customization

Edit `.instar/jobs.json` to:
- Change schedules
- Adjust models
- Add new jobs
- Disable jobs you don't need

The agent can also modify its own jobs through the [evolution system](/features/evolution).

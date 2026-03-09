---
title: Installation
description: Get Instar running in one command.
---

## One Command

```bash
npx instar
```

The guided setup wizard handles everything:

1. **Discovers your environment** -- Node.js version, Claude Code CLI, existing projects
2. **Configures messaging** -- Telegram bot setup, WhatsApp QR pairing, or both
3. **Creates identity files** -- `AGENT.md`, `USER.md`, `MEMORY.md` with guided prompts
4. **Starts your agent** -- Server running, messaging connected, ready to talk

Within minutes, you're talking to your partner from your phone.

## Global Install (Optional)

If you prefer a persistent CLI:

```bash
npm install -g instar
instar
```

## What Gets Created

After setup, you'll have:

```
.instar/
  config.json     # Server, scheduler, messaging config
  jobs.json       # Scheduled job definitions
  users.json      # User profiles
  AGENT.md        # Agent identity
  USER.md         # User context
  MEMORY.md       # Persistent learnings
  hooks/          # Behavioral scripts (auto-installed)
.claude/
  settings.json   # Hook registrations
  scripts/        # Health watchdog, relay scripts
  skills/         # Built-in skills
```

## Auto-Start on Login

Your agent can start automatically when you log into your computer:

```bash
instar autostart install    # macOS LaunchAgent or Linux systemd
instar autostart status     # Check if installed
instar autostart uninstall  # Remove
```

## Verify

Check that everything is running:

```bash
instar status     # Infrastructure overview
instar doctor     # Health diagnostics
```

## Next Steps

- [Quick Start guide](/quickstart) -- Walk through your first interaction
- [Core Concepts](/concepts/coherence) -- Understand what makes Instar different
- [CLI Reference](/reference/cli) -- All available commands

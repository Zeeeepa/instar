---
title: CLI Commands
description: Complete reference for all Instar CLI commands.
---

Most users never need these -- your agent manages its own infrastructure. These commands are available for power users and for the agent itself to operate.

## Setup

```bash
instar                          # Interactive setup wizard
instar setup                    # Same as above
instar init my-agent            # Create a new agent (general or project)
```

## Server

```bash
instar server start             # Start the persistent server (background, tmux)
instar server stop              # Stop the server
instar status                   # Show agent infrastructure status
```

## Lifeline

```bash
instar lifeline start           # Start lifeline (supervises server, queues messages)
instar lifeline stop            # Stop lifeline and server
instar lifeline status          # Check lifeline health
```

## Auto-Start

```bash
instar autostart install        # Agent starts when you log in
instar autostart uninstall      # Remove auto-start
instar autostart status         # Check if auto-start is installed
```

## Add Capabilities

```bash
instar add telegram --token BOT_TOKEN --chat-id CHAT_ID
instar add email --credentials-file ./credentials.json [--token-file ./token.json]
instar add quota [--state-file ./quota.json]
instar add sentry --dsn https://key@o0.ingest.sentry.io/0
```

## Users and Jobs

```bash
instar user add --id alice --name "Alice" [--telegram 123] [--email a@b.com]
instar job add --slug check-email --name "Email Check" --schedule "0 */2 * * *" \
  [--description "..."] [--priority high] [--model sonnet]
```

## Backup and Restore

```bash
instar backup create            # Snapshot identity, jobs, relationships
instar backup list              # List available snapshots
instar backup restore TIMESTAMP # Restore a snapshot
```

## Memory Search

```bash
instar memory search "deployment"  # Full-text search across agent knowledge
instar memory reindex              # Rebuild the search index
instar memory status               # Index stats
```

## Intent Alignment

```bash
instar intent reflect              # Review recent decisions against stated intent
instar intent org-init             # Scaffold ORG-INTENT.md
instar intent validate             # Check AGENT.md against ORG-INTENT.md
instar intent drift                # Detect behavioral drift over time
```

## Multi-Machine

```bash
instar machines whoami             # Show this machine's identity
instar machines pair               # Generate a pairing code
instar machines join CODE          # Join using a pairing code
```

## Diagnostics

```bash
instar doctor                      # Run health diagnostics
```

## Feedback

```bash
instar feedback --type bug --title "Session timeout" --description "Details..."
```

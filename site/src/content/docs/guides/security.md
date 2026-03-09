---
title: Security Model
description: How Instar approaches security through coherence rather than sandboxing.
---

**Instar runs Claude Code with `--dangerously-skip-permissions`.** This is a deliberate architectural choice. Understand exactly what it means before proceeding.

## What This Flag Does

Claude Code normally prompts you to approve each tool use -- every file read, every shell command, every edit. The `--dangerously-skip-permissions` flag disables these per-action prompts, allowing the agent to operate autonomously.

## Why We Use It

An agent that asks permission for every action isn't an agent -- it's a CLI tool with extra steps. Instar exists for genuine autonomy: background jobs, Telegram responses, self-evolution. None of that works with per-action approval prompts.

## Where Security Actually Lives

Instead of permission dialogs, Instar pushes security to a higher level:

### Behavioral Hooks

- **Dangerous command guard** blocks `rm -rf`, force push, database drops
- **External operation gate** evaluates every MCP tool call (risk classification, adaptive trust, emergency stop)
- **Grounding hooks** force identity re-read before external communication

### Network Hardening

- CORS restricted to localhost only
- Server binds `127.0.0.1` -- not exposed to the network
- Shell injection mitigated via temp files
- Cryptographic UUIDs (`crypto.randomUUID()`)
- Atomic file writes prevent corruption
- Bot token redaction in logs
- Rate limiting on session spawn
- Request timeout middleware

### Identity Coherence

A grounded, coherent agent with clear identity, relationship context, and accumulated memory makes better decisions than a stateless process approving actions one at a time. The intelligence layer IS the security layer.

### Audit Trail

Every session runs in tmux with full output capture. Message logs, job execution history, and session output are all persisted and inspectable.

## What You Should Know

**There is no sandbox.** The agent has access to your entire machine -- the same level of access as running any program on your computer.

- The agent can read, write, and execute anywhere on your machine
- The agent can run any shell command your user account has access to
- The agent can send messages via configured integrations
- Behavioral hooks, identity files, and CLAUDE.md are in your project and fully editable

## Who This Is For

Instar is for developers who want to work **with** an AI, not just **use** one. The security model relies on intelligent behavior -- identity, hooks, coherence -- rather than permission dialogs or sandboxing.

This is the trade-off at the heart of genuine AI autonomy. If you're not comfortable giving an AI agent this level of access, Claude Code's default permission mode works fine. But if you want to see what an AI agent can actually do when you stop holding it back -- this is the infrastructure for that.

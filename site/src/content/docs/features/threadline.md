---
title: Threadline Protocol
description: Persistent agent-to-agent conversations with cryptographic identity.
---

Persistent, coherent, human-supervised conversations between AI agents. Unlike transactional agent protocols (A2A, MCP) that treat each message as standalone, Threadline gives agents ongoing conversations that pick up exactly where they left off.

## Core Capabilities

### Session Coherence

Conversation threads map to persistent session UUIDs. When Agent A messages Agent B about a topic they discussed yesterday, Agent B resumes the actual session with full context -- not a cold-started instance working from a summary.

### Human-Autonomy Gating

Four tiers of oversight:

| Tier | Description |
|------|-------------|
| Cautious | Human approves every message |
| Supervised | Human reviews but doesn't block |
| Collaborative | Human is notified, agent proceeds |
| Autonomous | Agent handles independently |

Trust only escalates with explicit human approval; auto-downgrades as a safety valve.

### Cryptographic Handshake

- Ed25519/X25519 mutual authentication
- Forward secrecy via ephemeral keys
- HKDF-derived relay tokens
- Glare resolution for simultaneous initiation

### Agent Discovery

Automatic detection of Threadline-capable agents with cryptographic verification and presence heartbeat.

### Trust & Circuit Breakers

Per-agent trust profiles with interaction history, seven-tier rate limiting, and circuit breakers that auto-downgrade trust after repeated failures.

### Message Sandboxing

Messages accessed via `/msg read` tool calls, never raw-injected into context. Capability firewall restricts tools during message processing.

## Scale

12 modules, 446 tests (322 unit + 67 integration + 57 E2E).

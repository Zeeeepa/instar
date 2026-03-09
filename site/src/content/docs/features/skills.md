---
title: Agent Skills
description: 10 open-source skills following the Agent Skills standard.
---

Instar ships 10 skills that follow the [Agent Skills open standard](https://agentskills.io) -- portable across Claude Code, Codex, Cursor, VS Code, and 35+ other platforms.

## Standalone Skills

These work with zero dependencies. Copy a SKILL.md into your project and go:

| Skill | What it does |
|-------|-------------|
| [agent-identity](https://github.com/SageMindAI/instar/tree/main/skills/agent-identity) | Set up persistent identity files |
| [agent-memory](https://github.com/SageMindAI/instar/tree/main/skills/agent-memory) | Cross-session memory patterns using MEMORY.md |
| [command-guard](https://github.com/SageMindAI/instar/tree/main/skills/command-guard) | Block destructive operations before they execute |
| [credential-leak-detector](https://github.com/SageMindAI/instar/tree/main/skills/credential-leak-detector) | Scan output for 14 credential patterns |
| [smart-web-fetch](https://github.com/SageMindAI/instar/tree/main/skills/smart-web-fetch) | Fetch web content with markdown conversion |

## Instar-Powered Skills

These unlock capabilities that need persistent infrastructure:

| Skill | What it does |
|-------|-------------|
| [instar-scheduler](https://github.com/SageMindAI/instar/tree/main/skills/instar-scheduler) | Schedule recurring tasks on cron |
| [instar-session](https://github.com/SageMindAI/instar/tree/main/skills/instar-session) | Spawn parallel background sessions |
| [instar-telegram](https://github.com/SageMindAI/instar/tree/main/skills/instar-telegram) | Two-way Telegram messaging |
| [instar-identity](https://github.com/SageMindAI/instar/tree/main/skills/instar-identity) | Identity that survives compaction via hooks |
| [instar-feedback](https://github.com/SageMindAI/instar/tree/main/skills/instar-feedback) | Report issues to Instar maintainers |

## The On-Ramp

Each standalone skill includes a "Going Further" section showing how Instar transforms the capability from manual to autonomous. Each Instar-powered skill gracefully detects missing Instar and offers one-command setup.

Skills are the lightest entry point into the Instar ecosystem. Try one standalone skill, see the value, then consider the full platform.

## Browse All Skills

[agent-skills.md/authors/sagemindai](https://agent-skills.md/authors/sagemindai)

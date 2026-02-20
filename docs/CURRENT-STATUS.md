# Instar — Current Status

> Quick reference for parallel work sessions. Updated: 2026-02-20

## What Is Instar

Persistent autonomy infrastructure for AI agents. Gives Claude Code a persistent body — server, scheduler, messaging, identity, self-modification. Named after arthropod developmental stages between molts.

## Secured Assets

- **npm**: `instar` (latest: 0.1.4) — https://www.npmjs.com/package/instar
- **GitHub**: https://github.com/SageMindAI/instar (private, under SageMindAI org)
- **Domain**: `instar.sh` (purchased, not yet pointed anywhere)
- **Source**: `/tmp/instar-src/` on workstation (cloned from GitHub)

## Current Version: 0.1.4

### What's Shipped
- Full CLI: `instar`, `instar init`, `instar setup`, `instar server start/stop`, `instar status`, `instar user/job add/list`
- Conversational setup wizard (launches Claude Code with setup-wizard skill)
- Classic setup wizard (inquirer-based fallback)
- Identity bootstrap with thesis explanation and initiative levels (guided/proactive/autonomous)
- Auto-install prerequisites (tmux, Claude Code) during setup
- npx-first flow with global install prompt after setup
- Auth-respecting sessions (removed forced OAuth — supports both API keys and subscription)
- Session management via tmux (spawn, monitor, kill, reap)
- Job scheduler with cron, priority levels, model tiering, quota awareness
- Telegram integration (two-way messaging, topic-per-session, auto-detect chat ID)
- Relationship tracking (per-person JSON files, cross-platform identity resolution)
- Health monitoring with periodic checks
- Full project scaffolding (AGENT.md, USER.md, MEMORY.md, CLAUDE.md, hooks, scripts)
- 161 unit tests passing

### Architecture
```
.instar/                # Created in user's project
  config.json           # Server, scheduler, messaging config
  jobs.json             # Scheduled job definitions
  users.json            # User profiles
  AGENT.md              # Agent identity (who am I?)
  USER.md               # User context (who am I working with?)
  MEMORY.md             # Persistent learnings
  state/                # Runtime state (sessions, jobs)
  relationships/        # Per-person relationship files
  logs/                 # Server logs

src/
  core/                 # Config, SessionManager, StateManager, Prerequisites
  scheduler/            # JobLoader, JobScheduler
  server/               # AgentServer, routes, middleware
  messaging/            # TelegramAdapter
  monitoring/           # HealthChecker
  scaffold/             # bootstrap (identity), templates (file generation)
  commands/             # CLI: init, setup, server, status, user, job
  users/                # UserManager
```

### Key Files
- `src/core/SessionManager.ts` — Spawns/monitors Claude Code sessions in tmux
- `src/commands/setup.ts` — Interactive setup wizard (classic mode)
- `src/commands/init.ts` — Non-interactive init (fresh project or existing)
- `src/scaffold/bootstrap.ts` — Identity bootstrap (initiative levels)
- `.claude/skills/setup-wizard/skill.md` — Conversational wizard prompt
- `src/scheduler/JobScheduler.ts` — Cron-based job scheduling

## Strategic Context

### Why Now — The OpenClaw Moment
- Anthropic banned using Claude Code OAuth tokens in third-party agent harnesses (Feb 17-19, 2026)
- OpenClaw, NanoClaw, etc. are all broken — their users need alternatives
- **Instar is architecturally clean**: we spawn the actual Claude Code CLI, never extract OAuth tokens
- We support both API keys (recommended for production) and subscription auth
- This is a massive market opportunity — thousands of displaced power users

### Positioning vs OpenClaw
- OpenClaw = multi-channel AI assistant you deploy and talk to (20+ platforms, companion apps, skill marketplace)
- Instar = persistent body for any Claude Code project (server, scheduler, identity, self-modification)
- OpenClaw IS the product; Instar AUGMENTS your existing project
- Full positioning doc: `docs/positioning-vs-openclaw.md`

### ToS Compliance
- Anthropic's policy: OAuth tokens are for Claude Code and claude.ai only
- Instar spawns the official Claude Code CLI — we ARE Claude Code usage
- We never extract, proxy, or spoof OAuth tokens
- API keys recommended for production/commercial use
- Full analysis documented in Telegram topic 1307 thread

## Design Principles (Earned Through Building)

1. **Agent-first language** — The setup wizard never tells users to memorize CLI commands. After `instar server start`, you talk to your agent. "Ask your agent to create a job" not "run `instar job add`".
2. **Identity is infrastructure, not a file** — SOUL.md is a file. Instar's identity system is hooks that re-inject identity on session start, after compaction, and before messaging. Structure over willpower.
3. **Different category from OpenClaw** — They're messaging middleware ("AI assistant everywhere"). We're autonomy infrastructure ("give your agent a body"). Don't try to match their 20+ channels. Win on depth: runtime, multi-session, identity, self-evolution, relationships.
4. **Full OpenClaw analysis**: `.claude/drafts/openclaw-deep-analysis.md`

## What Needs Doing

### Critical (Ship-Blocking)
- [ ] Point instar.sh domain to something (landing page? GitHub readme?)
- [ ] License decision (currently UNLICENSED)
- [ ] Make GitHub repo public (currently private)
- [ ] Landing page / website at instar.sh
- [x] README polish — OpenClaw comparison section added (0.1.5)

### Important (Quality)
- [x] Agent-first language in setup wizard (0.1.6)
- [ ] Integration tests need real tmux (currently mocked)
- [ ] E2E test for full lifecycle (init → server start → spawn session → job runs)
- [ ] Error handling for edge cases (tmux server death, Claude Code not logged in)
- [ ] `.npmignore` to reduce package size (tests, docs shouldn't ship)

### Nice to Have
- [ ] Slack adapter (TelegramAdapter pattern is extensible)
- [ ] Discord adapter
- [ ] Email adapter
- [ ] Web dashboard for monitoring
- [ ] `instar upgrade` command for self-updating

### Learned from OpenClaw (worth considering)
- [ ] DM pairing flow for new contacts (temporary codes with expiry)
- [ ] Security audit CLI (`instar security audit`)
- [ ] Auth profile rotation with failover
- [ ] Streaming chunker (code-fence-aware, break preference hierarchy)

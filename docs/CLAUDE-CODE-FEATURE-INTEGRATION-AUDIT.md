# Claude Code Feature Integration Audit

> Working document for auditing each new Claude Code feature against Instar's architecture.
> Ensures no conflicts, identifies integration opportunities, and verifies full leverage of Anthropic's releases.
>
> Seeded: 2026-03-07 from docs audit session (topic 4509)
> Working topic: Telegram topic 11047

## Status Key

| Status | Meaning |
|--------|---------|
| PENDING | Not yet investigated |
| IN PROGRESS | Investigation underway |
| COMPATIBLE | No conflicts, no changes needed |
| SYNERGY IDENTIFIED | Integration opportunity found, needs implementation |
| IMPLEMENTED | Changes made and verified |
| CONFLICT | Needs resolution |

---

## Priority 1 — High Impact

### 1. Worktree Support (`--worktree` / `-w`)

**Status:** CAUTION — RISKS IDENTIFIED

**What Anthropic shipped:**
- `claude --worktree <name>` (or `-w`) launches Claude in an isolated git worktree
- Each worktree gets its own working directory at `<repo>/.claude/worktrees/<name>/`
- Each worktree gets its own branch: `worktree-<name>`
- Branches created from the default remote branch
- If no name given, auto-generates a random one (e.g., `bright-running-fox`)
- **Shared across worktrees**: CLAUDE.md, auto-memory, MCP servers, repo history, remotes
- **Isolated per worktree**: working directory files, branch, uncommitted changes, session state
- New hook events: `WorktreeCreate` (fires on spawn, receives name, must print worktree path to stdout) and `WorktreeRemove` (fires on exit, receives worktree_path for cleanup)
- Subagents can also use worktree isolation via `isolation: "worktree"` in frontmatter
- **Cleanup**: no-change worktrees auto-removed; changed worktrees prompt keep/remove (INTERACTIVE ONLY)
- **Gotcha**: each new worktree needs dependency setup (`npm install`, etc.) — it's a fresh checkout

**CRITICAL RISKS (investigated 2026-03-07):**

1. **No auto-merge**: Changes committed on a worktree branch are NEVER automatically merged back to main. When a worktree session ends, the branch either stays (orphaned) or gets deleted. There is no merge step.

2. **Headless behavior undefined**: When a session ends, Claude prompts "keep or remove?" interactively. In headless/automated contexts (like Instar's `claude -p` spawns), this behavior is **undocumented**. The session could hang waiting for input, silently delete changes, or silently keep an orphan branch.

3. **WorktreeRemove hooks cannot prevent deletion**: The hook fires AFTER the decision, has no decision control, and cannot orchestrate a merge. Failures are only logged in debug mode.

4. **Silent work loss scenario**: Agent spawns in worktree -> makes commits -> session ends -> worktree removed -> commits gone. Agent reported "changes made" but nothing is on main. The user sees no changes.

5. **Silent orphan branch scenario**: Agent spawns in worktree -> makes commits -> session ends -> worktree kept -> branch `worktree-job-xyz` exists but is never merged. Next session starts fresh on main, doesn't see the work. Branches accumulate indefinitely.

**Current Instar behavior (code-traced):**
- `SessionManager.spawnSession()` (jobs, line 163-235) and `spawnInteractiveSession()` (interactive, line 547-649) in `src/core/SessionManager.ts`
- Both spawn via `tmux new-session -c {projectDir}` — ALL sessions share the SAME project directory
- CLI args passed: `--dangerously-skip-permissions`, optionally `--model`, `-p "prompt"`, `--resume`
- **No worktree flags used anywhere** — zero references to `--worktree` or `-w` in the codebase
- Parallel limits: `maxSessions: 3` concurrent, `maxParallelJobs: 2` simultaneous jobs
- Process isolation via tmux session names (`{projectBaseName}-{sanitizedName}`), but NO filesystem isolation

**Existing Instar coordination infrastructure (already built):**
Instar already has a rich coordination layer that partially addresses parallel session conflicts:
- **AgentBus** (`src/core/AgentBus.ts`): Transport-agnostic message bus (HTTP + JSONL), anti-replay, typed messages including `file-avoidance-request`, `conflict-detected`, `work-announcement`
- **CoordinationProtocol** (`src/core/CoordinationProtocol.ts`): File avoidance requests with TTL, work announcements (started/completed), status queries, leadership election with fencing tokens
- **WorkLedger** (`src/core/WorkLedger.ts`): Per-machine work tracking, overlap detection with severity tiers (0-3), stale entry cleanup
- **SyncOrchestrator** (`src/core/SyncOrchestrator.ts`): Lock-based sync, 9-step sync cycle, overlap guard integration, file avoidance on task merge
- **ConflictNegotiator** (`src/core/ConflictNegotiator.ts`): Pre-merge negotiation (3 rounds), section-based claims, fallback to LLM resolution
- **SpawnRequestManager** (`src/messaging/SpawnRequestManager.ts`): Cooldown, session limits, memory pressure, retry tracking

This framework is **awareness-based** (passive observation, post-hoc conflict resolution) rather than **enforcement-based** (active prevention). It doesn't prevent two sessions from editing the same file, but it detects overlaps and negotiates conflicts.

**Assessment:**

Worktrees solve a real problem (filesystem isolation for parallel jobs) but introduce NEW problems that are arguably worse:
- Work silently lost or orphaned on branches nobody merges
- Undefined behavior in headless/automated spawning
- No hook-level control over the merge decision

Instar's existing coordination framework (AgentBus, WorkLedger, CoordinationProtocol) already mitigates parallel conflicts at the awareness level. Worktrees would be a lateral move — trading one class of problems for another — unless we build merge-back infrastructure that doesn't exist yet.

**Implicit worktree creation (key finding):**
Claude Code can create worktrees WITHOUT the user asking for it:
- Subagents with `isolation: "worktree"` in their frontmatter get worktrees automatically
- Users (or the agent itself) can say "work in a worktree" mid-session
- Without `WorktreeCreate`/`WorktreeRemove` hooks configured, this happens SILENTLY
- Instar-spawned sessions inherit this behavior — a session could create worktrees that Instar never knows about

**Current Instar gaps (code-verified):**
- ZERO worktree awareness in the codebase (no `git worktree` calls, no `.claude/worktrees` checks)
- No post-session git status check — `sessionComplete` handlers update job state and create summaries but never check git
- `BranchManager.completeBranch()` exists for merging branches but is NOT wired to session completion
- No orphan branch detection or cleanup
- No session-to-branch linking (sessions track tmuxSession name, not git branch)
- No post-session hook template

**ACTION ITEMS — Worktree Awareness for Instar:**

1. **Post-session worktree scan** (HIGH PRIORITY):
   Wire into `sessionComplete` event handler: after session ends, run `git worktree list` in the project directory. If any worktrees exist, log them and check for uncommitted/unmerged changes. Alert via Telegram if work is found on worktree branches.

2. **Periodic orphan detection** (MEDIUM PRIORITY):
   Add to health check / scan cycle: periodically run `git worktree list` and `git branch --list 'worktree-*'` across all managed projects. Flag any worktree branches that exist but have no active session. Report stale worktrees older than N hours.

3. **WorktreeCreate/WorktreeRemove hooks** (MEDIUM PRIORITY):
   Ship hook templates that POST to Instar server when worktrees are created or removed. This gives real-time visibility into worktree lifecycle, even for implicit creation by subagents.

4. **Session-branch linking** (LOW PRIORITY):
   When a session completes, record which branch it was on (and any worktree branches it created). Enables "what did this session actually produce?" auditing.

5. **Merge-back prompt** (LOW PRIORITY — future):
   If orphan worktree branches are detected with commits, surface them to the user: "Session X left work on branch worktree-foo. Merge to main?"

**Resolution:**
AWARENESS NEEDED — Instar does not need to USE worktrees itself, but Claude Code sessions may create them implicitly. Instar currently has ZERO visibility into this. Priority: add post-session worktree scanning and periodic orphan detection to prevent silent work loss.

---

### 2. HTTP Hooks

**Status:** SYNERGY IDENTIFIED — SIGNIFICANT ARCHITECTURAL OPPORTUNITY

**What Anthropic shipped:**
- Hooks can POST JSON to URLs instead of running shell commands
- Config: `{ "type": "http", "url": "http://...", "timeout": 30, "headers": {...}, "allowedEnvVars": [...] }`
- Full event payload (session_id, cwd, tool_name, tool_input, etc.) sent as JSON body
- All hook events supported (PreToolUse, PostToolUse, SessionStart, TaskCompleted, etc.)
- Can return JSON to control behavior (e.g., `permissionDecision: "deny"` to block tool calls)
- Auth via custom headers with env var interpolation (only `allowedEnvVars` are resolved)
- Can mix HTTP and command hooks for the same event — all matching hooks run in parallel
- Default timeout: 30s (vs 600s for command hooks)
- **Key limitation**: 4xx/5xx responses are NON-BLOCKING — only 2xx with JSON can block actions
- **Key limitation**: no `async` option (command hooks have this)
- **Key limitation**: not configurable via `/hooks` CLI menu — JSON editing only
- **Key limitation**: SessionStart only supports command hooks (cannot use HTTP for session setup)

**Current Instar behavior (code-traced):**

Instar ships 7+ hook templates, ALL shell-based:
- `session-start.sh` — injects working memory context (already calls Instar HTTP API via curl!)
- `dangerous-command-guard.sh` — blocks risky commands
- `compaction-recovery.sh` — session recovery after compaction
- `grounding-before-messaging.sh` — grounding pipeline before messaging
- `free-text-guard.sh` — guards AskUserQuestion
- `telegram-topic-context.sh` — injects Telegram context
- Plus JS hooks: `deferral-detector.js`, `post-action-reflection.js`, `external-communication-guard.js`, `claim-intercept.js`

Hook installation via `init.ts` → `installHooks()`, placed in `.instar/hooks/instar/`

**Existing HTTP infrastructure in Instar server:**
- Server runs on `localhost:PORT` (auto-allocated, stored in registry.json)
- Already has route infrastructure: `/health`, `/sessions/spawn`, `/context/working-memory`, `/jobs/:slug/trigger`, `/telegram/reply/:topicId`
- WhatsApp webhooks (`/webhooks/whatsapp`) already receive HTTP POSTs — the pattern exists
- `session-start.sh` already calls the Instar HTTP API (reverse direction: hook pulls FROM server)
- **No general-purpose hook event receiver endpoint exists** — this is the gap

**Assessment — should we migrate hooks to HTTP?**

NOT a wholesale migration. The right move is SELECTIVE:

Hooks that SHOULD stay as shell commands:
- `session-start.sh` — SessionStart only supports command hooks (Anthropic limitation)
- `dangerous-command-guard.sh` — needs to block actions; HTTP 4xx/5xx is non-blocking, making HTTP hooks unreliable for safety gates
- `compaction-recovery.sh` — needs to inject context via stdout
- Any hook that BLOCKS actions — command hooks are more reliable for blocking because non-zero exit = blocked, while HTTP hooks require 2xx + specific JSON to block

Hooks that COULD benefit from HTTP:
- `post-action-reflection.js` — side-effect only, doesn't need to block
- `deferral-detector.js` — observation/logging, doesn't block
- New observability hooks (PostToolUse, TaskCompleted, Notification) — telemetry/logging to server
- WorktreeCreate/WorktreeRemove — worktree awareness (connects to Item 1)

**The real opportunity — NEW HTTP hooks for events we don't hook today:**

Instar currently hooks: SessionStart, UserPromptSubmit, PreToolUse
Instar does NOT hook: PostToolUse, TaskCompleted, Notification, Stop, SubagentStart/Stop, WorktreeCreate/Remove, PreCompact

HTTP hooks are perfect for these OBSERVABILITY events — lightweight POSTs to the server that log what's happening without needing to block anything.

**ACTION ITEMS:**

1. **Add `/hooks/events` receiver endpoint** (HIGH PRIORITY):
   Mount a new POST endpoint on the Instar server that receives hook event payloads. Auth via bearer token (already used for other endpoints). Store events for session telemetry.

2. **Ship HTTP hook templates for observability events** (HIGH PRIORITY):
   - `PostToolUse` → log what tools sessions are using
   - `TaskCompleted` → know when subagent tasks finish (connects to worktree awareness)
   - `SubagentStart`/`SubagentStop` → track subagent lifecycle
   - `WorktreeCreate`/`WorktreeRemove` → worktree awareness (Item 1)
   - `Stop` → know when sessions end (complement to process monitoring)

3. **Keep shell hooks for safety gates** (NO CHANGE):
   `dangerous-command-guard.sh`, `session-start.sh`, `compaction-recovery.sh` stay as shell commands. HTTP hooks cannot reliably block actions.

4. **Update settings-template.json** (MEDIUM PRIORITY):
   Add HTTP hook entries alongside existing command hooks. Mix both types for events where we want both blocking (command) and telemetry (HTTP).

5. **Cross-machine hook forwarding** (LOW PRIORITY — future):
   If Instar server is exposed via Cloudflare tunnel, HTTP hooks from a remote machine could POST to it. Enables centralized event collection across machines.

**Resolution:**
SYNERGY IDENTIFIED — HTTP hooks are a significant opportunity for session OBSERVABILITY (not safety). Instar should add a hook event receiver endpoint and ship HTTP hook templates for PostToolUse, TaskCompleted, SubagentStart/Stop, WorktreeCreate/Remove. Safety-critical hooks (dangerous-command-guard, session-start) must stay as shell commands because HTTP hooks cannot reliably block actions.

---

### 3. New Hook Events (`InstructionsLoaded`, `TaskCompleted`, `agent_id`/`agent_type`, and more)

**Status:** SYNERGY IDENTIFIED — CLOSES MAJOR OBSERVABILITY GAPS

**What Anthropic shipped (full inventory of new/relevant events):**

**InstructionsLoaded:**
- Fires when CLAUDE.md files load (eagerly at session start, lazily when subdirectory CLAUDE.md triggers)
- Payload: `file_path`, `memory_type` (User/Project/Local/Managed), `load_reason`
- NO decision control — audit/logging only
- Command hooks only (no HTTP)

**TaskCompleted:**
- Fires when a task is marked completed (via TaskUpdate tool or teammate finishing)
- Payload: `task_id`, `task_subject`, `task_description`, `teammate_name`, `team_name`
- CAN block completion (exit code 2 = reject, stderr fed back as feedback)
- Supports all hook types including HTTP

**SubagentStart:**
- Fires when a subagent spawns via Agent tool
- Payload: `agent_id`, `agent_type` (e.g., "Explore", "Plan", custom agent names)
- Cannot block spawning, but CAN inject `additionalContext` into subagent
- Command hooks only

**SubagentStop:**
- Fires when a subagent finishes
- Payload: `agent_id`, `agent_type`, `agent_transcript_path`, `last_assistant_message`
- CAN block (same as Stop hook — `decision: "block"`)
- All hook types including HTTP

**Stop:**
- Fires when main agent finishes responding (not on user interrupt)
- Payload: `stop_hook_active` (loop detection), `last_assistant_message`
- CAN force continuation (`decision: "block"`)
- All hook types including HTTP

**SessionEnd:**
- Fires when session terminates
- Payload: `reason` (clear/logout/prompt_input_exit/bypass_permissions_disabled/other)
- NO decision control
- Command hooks only

**PreCompact:**
- Fires before compaction
- Payload: `trigger` (manual/auto), `custom_instructions`
- NO decision control — cleanup/logging only
- Command hooks only

**ConfigChange:**
- Fires when settings/skills files change during session
- Payload: `source` (user_settings/project_settings/local_settings/policy_settings/skills), `file_path`
- CAN block changes (except policy_settings)
- Command hooks only

**TeammateIdle:**
- Fires when agent team teammate is about to go idle
- Payload: `teammate_name`, `team_name`
- CAN reject idle (exit code 2 = keep working)
- Command hooks only

**agent_id / agent_type (in ALL events):**
- `agent_id` present = event fired inside a subagent (unique per subagent instance)
- `agent_type` present without `agent_id` = session launched with `--agent` flag
- Both absent = normal session, no agent
- This is the KEY to distinguishing subagent work from main-thread work across all events

**Current Instar observability gaps (code-traced):**

Instar's session awareness is fundamentally asymmetric:
- STRONG: Knows when sessions start/stop (tmux monitoring, 5s polling loop)
- STRONG: Can digest activity into LLM-generated summaries (SessionActivitySentinel + EpisodicMemory)
- WEAK: Has NO insight into what the session actually DID while running (no tool usage, no command log)
- WEAK: Cannot verify CLAUDE.md loaded or identity grounding occurred
- WEAK: Cannot track subagent spawning (SpawnRequestManager is in-memory only, lost on restart)
- WEAK: ExecutionJournal exists but needs PostToolUse hook — which isn't active

The session object saved on completion is minimal:
```typescript
{ id, name, status, jobSlug, tmuxSession, startedAt, endedAt, model, prompt }
```
No exit code, no summary, no execution result, no branch info, no tool usage.

**How new hook events close these gaps:**

| Gap | Hook Event | What It Provides |
|-----|-----------|-----------------|
| "What did the session DO?" | `PostToolUse` + `Stop` | Tool calls + final summary (`last_assistant_message`) |
| "Did CLAUDE.md load?" | `InstructionsLoaded` | Confirms which instruction files loaded, when, and why |
| "Did subagents run?" | `SubagentStart`/`SubagentStop` | Subagent type, ID, transcript path, final output |
| "Why did it end?" | `SessionEnd` | Exit reason (clear/logout/etc.) |
| "Was compaction healthy?" | `PreCompact` | Compaction trigger type (manual vs auto) |
| "Did config change mid-session?" | `ConfigChange` | Which settings file changed |
| "Is the session really done?" | `TaskCompleted` | Task-level completion with subject/description |

**The `agent_id`/`agent_type` enrichment is especially valuable** — every hook event Instar already processes (PreToolUse, UserPromptSubmit) now carries agent context. Instar can distinguish "the main session ran this command" from "a subagent ran this command" without any code changes to existing hooks — just start reading the new fields.

**ACTION ITEMS:**

1. **InstructionsLoaded hook for identity verification** (HIGH PRIORITY):
   Add command hook that checks: did the expected CLAUDE.md files load? If the project's CLAUDE.md didn't fire, the session started without identity context. Alert via Telegram. This closes the "did grounding work?" gap.

2. **SubagentStart/SubagentStop hooks for lifecycle tracking** (HIGH PRIORITY):
   Track subagent spawning and completion. SubagentStop gives `last_assistant_message` and `agent_transcript_path` — Instar can capture what subagents produced without parsing transcripts manually. Persist to state (currently SpawnRequestManager is in-memory only).

3. **Stop + SessionEnd hooks for richer completion data** (HIGH PRIORITY):
   `Stop` gives `last_assistant_message` — the agent's final output. Wire into sessionComplete handler to capture WHY the session ended and WHAT it concluded. Currently Instar only knows "session is dead" but not what it said before dying.

4. **Parse agent_id/agent_type from existing hooks** (MEDIUM PRIORITY):
   Existing hooks (PreToolUse, UserPromptSubmit) now carry these fields. Update hook handlers to extract and log them — zero-cost observability improvement.

5. **TaskCompleted as quality gate** (MEDIUM PRIORITY):
   For job sessions, use TaskCompleted to verify the task was actually completed before marking the job as done. Currently Instar infers completion from process death — TaskCompleted gives explicit task-level confirmation.

6. **PreCompact hook for compaction awareness** (LOW PRIORITY):
   Know when compaction occurs (especially auto-compaction). Could trigger working memory injection or alert if sessions are compacting too frequently.

7. **Wire ExecutionJournal to PostToolUse** (LOW PRIORITY):
   ExecutionJournal infrastructure already exists but is inactive because no PostToolUse hook feeds it. Adding PostToolUse → ExecutionJournal closes the "what commands did the session run?" gap.

**Assessment:**

These new hook events are the single biggest observability upgrade available to Instar. They transform session monitoring from "is the process alive?" to "what is the process doing, what did it produce, and was it set up correctly?" The `agent_id`/`agent_type` enrichment gives subagent visibility for free across all existing hooks.

**TaskCompleted does NOT replace session completion polling** — it fires for task-level events within a session, not session termination. `SessionEnd` + `Stop` are the session-level events, and even these complement rather than replace tmux monitoring (hooks only fire if Claude is running normally — crashes bypass hooks).

**Resolution:**
SYNERGY IDENTIFIED — New hook events close Instar's major observability gaps: identity verification (InstructionsLoaded), execution insight (Stop, PostToolUse), subagent tracking (SubagentStart/Stop), and richer completion data (SessionEnd, TaskCompleted). Priority: InstructionsLoaded for identity verification, SubagentStart/Stop for lifecycle tracking, Stop/SessionEnd for completion enrichment.

---

### 4. Auto-Memory (`/memory`)

**Status:** PENDING

**What Anthropic shipped:**
- Claude automatically saves useful context across sessions in auto-memory directory
- Shared across git worktrees of the same repo
- Users can view/edit via `/memory` command
- Persistent `.claude/` directory storage

**Audit questions:**
- Does this conflict with Instar's MEMORY.md generation?
- Are we duplicating effort between auto-memory and our memory system?
- Should Instar coordinate with auto-memory (read from it, write to it, or avoid stepping on it)?
- How does auto-memory interact with our conversational memory and episodic memory systems?
- Could auto-memory serve as a lightweight complement to our structured memory architecture?

**Current Instar behavior:**
- Generates MEMORY.md from accumulated session learnings
- Has its own memory architecture (FTS5 + vector search, episodic, working memory)
- MEMORY.md is written to `.claude/` project directory

**Integration opportunity:**
- Coordinate rather than compete: different memory layers for different purposes
- Auto-memory for session-level context; Instar memory for long-term structured knowledge
- Ensure no file conflicts in `.claude/` directory

**Investigation notes:**
_(To be filled during audit)_

**Resolution:**
_(To be filled)_

---

### 5. Model Reference Updates

**Status:** PENDING

**What Anthropic shipped:**
- Opus 4.6 is now the default model
- Medium effort level for Max/Team subscribers
- "ultrathink" keyword triggers high effort
- Opus 4.0/4.1 deprecated
- Sonnet 4.5 migrated to Sonnet 4.6

**Audit questions:**
- Do any Instar configs or docs reference deprecated models (Opus 4.0, 4.1, Sonnet 4.5)?
- Does our model tiering configuration need updating?
- Are there behavioral differences in Opus 4.6 vs 4.5 that affect our prompts?
- Should our setup wizard default to specific model recommendations?

**Current Instar behavior:**
- Model references in various config files and documentation
- Model tiering in spawn configurations

**Integration opportunity:**
- Ensure all model references are current
- Leverage "ultrathink" for complex planning tasks

**Investigation notes:**
_(To be filled during audit)_

**Resolution:**
_(To be filled)_

---

## Priority 2 — Medium Impact

### 6. Remote Control

**Status:** PENDING

**What Anthropic shipped:**
- Sessions accessible from claude.ai/code, Claude iOS/Android apps
- Optional session naming via `--name`
- Real-time session monitoring from any device

**Audit questions:**
- Do Instar-spawned sessions work with Remote Control?
- Does our session spawning pass `--name` for identifiable sessions?
- Should the setup wizard make users aware of Remote Control?
- How does Remote Control interact with our Telegram/WhatsApp monitoring?

**Current Instar behavior:**
- Sessions spawned via `claude` CLI without `--name`
- Monitoring via Telegram/WhatsApp

**Integration opportunity:**
- Pass `--name` with job/session identifiers for Remote Control visibility
- Promote as additional monitoring channel alongside Telegram/WhatsApp
- Setup wizard awareness

**Investigation notes:**
_(To be filled during audit)_

**Resolution:**
_(To be filled)_

---

### 7. Security Changes

**Status:** PENDING

**What Anthropic shipped:**
- Skill discovery no longer loads from gitignored directories
- Symlink bypass prevention
- Skills don't bypass permissions
- Enhanced sandboxing

**Audit questions:**
- Are any of our hooks or skills in gitignored directories?
- Do we rely on symlinks for any skill/hook resolution?
- Does our permission model align with the new security constraints?
- Any skills that previously worked that might now be blocked?

**Current Instar behavior:**
- Skills and hooks in `.claude/` directory (not typically gitignored)
- Various permission configurations

**Integration opportunity:**
- Verify no breakage
- Align our security model with Anthropic's enhancements

**Investigation notes:**
_(To be filled during audit)_

**Resolution:**
_(To be filled)_

---

### 8. Plugin System Enhancements

**Status:** PENDING

**What Anthropic shipped:**
- `git-subdir` source type for plugins
- `pluginTrustMessage` for user-facing trust prompts
- Scope isolation between plugins
- Marketplace improvements

**Audit questions:**
- Are our skills compatible with the latest plugin spec?
- Could Instar skills be distributed as plugins?
- Does scope isolation affect how our skills interact?
- Should we adopt `pluginTrustMessage` for third-party skill trust?

**Current Instar behavior:**
- Skills are local files in project directories
- No plugin distribution mechanism

**Integration opportunity:**
- Plugin-based skill distribution for the Instar ecosystem
- Scope isolation for multi-tenant safety

**Investigation notes:**
_(To be filled during audit)_

**Resolution:**
_(To be filled)_

---

### 9. VS Code Integration

**Status:** PENDING

**What Anthropic shipped:**
- Session list view in VS Code
- Plan view for task tracking
- Native `/mcp` management UI
- Improved extension integration

**Audit questions:**
- Do Instar agents work when spawned from VS Code?
- Does the session list show Instar-managed sessions?
- Any conflicts with VS Code's MCP management and our MCP setup?

**Current Instar behavior:**
- Agents spawned via CLI, not VS Code
- No specific VS Code integration

**Integration opportunity:**
- Ensure compatibility for users who prefer VS Code
- VS Code as an alternative monitoring interface

**Investigation notes:**
_(To be filled during audit)_

**Resolution:**
_(To be filled)_

---

## Priority 3 — Incremental Improvements

### 10. Voice Input (20 languages)

**Status:** PENDING

**What Anthropic shipped:**
- STT expanded to 20 languages
- Push-to-talk keybinding support

**Audit questions:**
- Do Instar-spawned sessions inherit voice capabilities?
- Any configuration needed to enable voice in spawned sessions?

**Integration opportunity:**
- Verify inheritance, document as a feature

**Investigation notes:**
_(To be filled during audit)_

**Resolution:**
_(To be filled)_

---

### 11. Performance Improvements

**Status:** PENDING

**What Anthropic shipped:**
- ~16MB memory reduction
- Bridge reconnection in seconds (was 10 minutes)
- Images preserved during compaction

**Audit questions:**
- Does bridge reconnection improve our session reliability?
- Does reduced memory impact our multi-session scaling?
- How does image preservation during compaction affect our sessions?

**Integration opportunity:**
- Better session stability from bridge reconnection
- More headroom for parallel sessions

**Investigation notes:**
_(To be filled during audit)_

**Resolution:**
_(To be filled)_

---

### 12. `/loop` Command

**Status:** PENDING

**What Anthropic shipped:**
- Recurring prompt execution within a session
- Configurable interval

**Audit questions:**
- Does this complement or conflict with our persistent job scheduler?
- Could `/loop` replace lightweight recurring tasks?
- How does `/loop` interact with session lifecycle?

**Current Instar behavior:**
- Full job scheduler with cron-like scheduling
- Jobs spawn new sessions

**Integration opportunity:**
- Complementary: `/loop` for intra-session recurrence, Instar scheduler for cross-session jobs
- Document the distinction for users

**Investigation notes:**
_(To be filled during audit)_

**Resolution:**
_(To be filled)_

---

### 13. `/simplify` and `/batch`

**Status:** PENDING

**What Anthropic shipped:**
- `/simplify`: Code complexity reduction tool
- `/batch`: Parallel task execution

**Audit questions:**
- Could `/simplify` integrate into our evolution system?
- Does `/batch` overlap with our parallel session spawning?
- Any conflicts with our skill system?

**Integration opportunity:**
- `/simplify` as evolution cycle tool
- `/batch` for multi-file operations within a session

**Investigation notes:**
_(To be filled during audit)_

**Resolution:**
_(To be filled)_

---

### 14. Configuration Options

**Status:** PENDING

**What Anthropic shipped:**
- `includeGitInstructions` setting
- `CLAUDE_CODE_MAX_OUTPUT_TOKENS` during compaction
- Various new configuration knobs

**Audit questions:**
- Should we set any of these in spawned sessions?
- Does `CLAUDE_CODE_MAX_OUTPUT_TOKENS` affect our compaction recovery?
- What's the optimal configuration for Instar-managed sessions?

**Current Instar behavior:**
- Sessions spawned with default configurations
- Custom env vars passed selectively

**Integration opportunity:**
- Optimal spawn configuration preset for Instar sessions
- Compaction token budget tuning

**Investigation notes:**
_(To be filled during audit)_

**Resolution:**
_(To be filled)_

---

## Cross-Cutting Concerns

### Documentation Updates Needed
- [ ] README: Reference new Claude Code features Instar leverages
- [ ] Landing page: Promote synergies (worktrees, Remote Control, etc.)
- [ ] Setup wizard: Awareness of new options (worktrees, Remote Control, voice)
- [ ] CHANGELOG: Track integration work

### Testing Requirements
- [ ] Worktree spawning test
- [ ] HTTP hook delivery test
- [ ] Hook event payload verification
- [ ] Auto-memory coordination test
- [ ] Security constraint verification
- [ ] Remote Control compatibility test

### Architecture Decisions Log
_(Record key decisions made during this audit)_

---

## Session Log

| Date | Session | Items Addressed | Notes |
|------|---------|----------------|-------|
| 2026-03-07 | Initial research (topic 4509) | All 14 items identified | Research phase complete |
| 2026-03-07 | Document creation (topic 11047) | Document seated | Ready for deep-dive work |

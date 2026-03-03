# Guided Setup Spec: Scenario-Aware Installation

> Tightly integrates the topology scenario matrix into the setup wizard so users are guided through the right setup path without being overwhelmed.

**Status**: Draft v1
**Author**: Dawn (with Justin's direction)
**Date**: 2026-03-03
**Related specs**: USER-AGENT-TOPOLOGY-SPEC.md, MULTI-USER-SETUP-SPEC.md, MULTI-MACHINE-SPEC.md

---

## Problem

The setup wizard and the 9-scenario topology matrix exist as separate artifacts. The wizard routes by **entry point** (existing agent? restore? fresh install?) but doesn't explicitly route by **scenario**. The result:

1. Users might not get the right defaults for their situation
2. Multi-machine and multi-user setup options aren't surfaced at the right moment
3. GitHub scanning only checks personal repos, missing organization-owned agents
4. The wizard doesn't infer which scenario the user is in from available context clues

## Design Principles

1. **Infer before asking.** Auto-detect everything possible from the environment before asking the user anything.
2. **Ask targeted questions, not abstract ones.** Never "What scenario are you in?" — instead "Will other people use this agent too?"
3. **One question at a time.** Each question narrows the scenario. Don't frontload all questions.
4. **Context clues > explicit config.** If we're inside a git repo, we know it's a project-bound agent. If there's an existing agent with 2 machines paired, we know it's multi-machine. Don't re-ask.
5. **The user never sees the matrix.** They experience a guided conversation. The matrix is the wizard's internal routing table.
6. **Comprehensive discovery.** Before any fresh install, exhaustively check for existing agents the user might want to restore or join.

---

## Part 1: Comprehensive Agent Discovery

Before the wizard can route correctly, it needs a complete picture of what agents already exist. The current scanning is incomplete — it only checks personal GitHub repos.

### Discovery Sources (Priority Order)

| Source | What it finds | How |
|--------|--------------|-----|
| **Local filesystem** | Agents on this machine | Scan `~/.instar/agents/*/` + check CWD for `.instar/` |
| **Local registry** | All registered agents (running or stopped) | Read `~/.instar/registry.json` |
| **GitHub personal repos** | Cloud-backed agents owned by user | `gh repo list --json name,url --limit 100` → filter `instar-*` |
| **GitHub org repos** | Cloud-backed agents in user's orgs | For each org: `gh repo list ORG --json name,url --limit 100` → filter `instar-*` |

### GitHub Scanning Algorithm

```
function scanGitHub():
  if gh not installed:
    try auto-install (brew install gh / apt install gh)
    if failed: return { status: 'unavailable', agents: [] }

  if gh not authenticated:
    return { status: 'auth-needed', agents: [] }

  agents = []

  // 1. Personal repos
  personal = gh repo list --json name,nameWithOwner --limit 100
  agents += personal.filter(name starts with 'instar-')

  // 2. All organizations the user belongs to
  orgs = gh api user/orgs --jq '.[].login'
  for each org in orgs:
    orgRepos = gh repo list {org} --json name,nameWithOwner --limit 100
    agents += orgRepos.filter(name starts with 'instar-')

  // Deduplicate by nameWithOwner (same repo won't appear twice, but
  // same agent name could exist in different orgs)
  return { status: 'ready', agents: dedup(agents) }
```

### Discovery Output Format

The launcher (`setup.ts`) should pass structured discovery results to the wizard:

```
DISCOVERY_RESULTS:
  local_agents=[
    {"name":"ai-guy","path":"/Users/justin/Projects/ai-guy/.instar","type":"project-bound","status":"running","port":4040},
    {"name":"my-agent","path":"~/.instar/agents/my-agent","type":"standalone","status":"stopped"}
  ]
  github_agents=[
    {"name":"ai-guy","repo":"SageMindAI/instar-ai-guy","owner":"SageMindAI","ownerType":"org"},
    {"name":"personal-bot","repo":"justinheadley/instar-personal-bot","owner":"justinheadley","ownerType":"user"}
  ]
  current_dir_agent={"exists":true,"name":"ai-guy","users":["Justin"],"machines":1}
  gh_status="ready"
```

### Changes to `setup.ts`

1. **Add org scanning**: After personal repo scan, enumerate orgs and scan each
2. **Include `nameWithOwner`**: So the wizard can show "SageMindAI/instar-ai-guy" vs "justinheadley/instar-personal-bot"
3. **Include local registry agents**: Read `~/.instar/registry.json` and include all entries (not just filesystem scan of `~/.instar/agents/`)
4. **Structured JSON output**: Pass discovery as JSON instead of ad-hoc string interpolation
5. **Timeout handling**: Each org scan gets a 10s timeout. If an org times out, note it and continue.

---

## Part 2: Scenario Inference Engine

The wizard uses detected context + minimal questions to resolve which of the 9 scenarios applies. This is NOT exposed to the user — it's internal routing logic.

### Detection Phase (Zero Questions)

Before asking anything, the wizard knows:

| Signal | Source | What it tells us |
|--------|--------|-----------------|
| Inside git repo? | `setup.ts` git detection | **Axis 1**: repo vs standalone |
| Existing `.instar/` in CWD? | `setup.ts` filesystem check | Fresh install vs returning |
| Number of users in `users.json` | `setup.ts` reads it | **Axis 2**: single vs multi-user (for existing agents) |
| Number of machines in registry | `setup.ts` reads it | **Axis 3**: single vs multi-machine (for existing agents) |
| Telegram configured? | `setup.ts` reads config | Whether Telegram setup can be skipped |
| GitHub backups found? | Discovery scan | Whether restore is possible |
| Local agents found? | Registry + filesystem | Whether this machine already has agents |

### Question Phase (1-2 Questions, Only When Needed)

After detection, the wizard may need to ask:

**Question 1** (only for fresh installs): "Will other people use this agent too?"
- YES → multi-user scenarios (5, 6, 7, 8)
- NO → single-user scenarios (1, 2, 3, 4)

**Question 2** (only for fresh installs): "Will you run this agent on another machine too?"
- YES → multi-machine scenarios (2, 4, 6, 7)
- NO → single-machine scenarios (1, 3, 5, 8)

These two questions, combined with auto-detection, fully resolve the scenario:

### Scenario Resolution Table

| In repo? | Multi-user? | Multi-machine? | Scenario | Wizard behavior |
|----------|-------------|----------------|----------|----------------|
| Yes | No | No | **3** | Simplest path. Minimal config. |
| Yes | No | Yes | **4** | Enable git backup. Explain active/standby. |
| Yes | Yes | No | **5** | Registration policy. Recovery key. User identity. |
| Yes | Yes | Yes | **6** | Full coordination. Per-machine Telegram. config.local.json. |
| No | No | No | **1** | Standalone agent. Simple setup. |
| No | No | Yes | **2** | Enable git backup. Cloud sync. |
| No | Yes | No | **8** | Standalone + multi-user. Registration policy. |
| No | Yes | Yes | **7** | Full coordination for standalone. |

**Scenario 9** (cross-machine access) is not a separate setup path — it's a capability that applies to any multi-machine + multi-user combination (6, 7). The wizard mentions it as part of those flows.

### Question Timing

The multi-user and multi-machine questions are asked during **Phase 2 (Identity Bootstrap)** — after the welcome but before Telegram setup. This is because:

- The answer affects Telegram setup (single group vs per-machine groups)
- The answer affects secret management recommendations (Bitwarden recommended for multi-machine)
- The answer affects what files are generated (recovery key, machine registry)

The wizard DOES NOT ask these questions if it can infer the answers:

| If detected... | Then... |
|---------------|---------|
| Existing agent with 2+ users | Already multi-user. Don't ask. |
| Existing agent with 2+ machines | Already multi-machine. Don't ask. |
| User chose "I'm a new user joining" | Multi-user is implicit. Don't ask. |
| User chose "I'm an existing user on a new machine" | Multi-machine is implicit. Don't ask. |
| Restoring from backup | Check backup's users.json and machine registry. Don't ask if already known. |

---

## Part 3: Guided Flow Per Scenario

Each resolved scenario triggers a tailored flow. The wizard adjusts its behavior — different defaults, different questions, different explanations — without the user knowing they're in a "scenario."

### Scenario 1 & 3: Single User, Single Machine (Global / Repo)

**The simplest path.** Minimal questions, fast to complete.

Flow:
1. Welcome (context-aware: repo name or "standalone agent")
2. Identity bootstrap (name, agent name, communication style, autonomy level)
3. Telegram setup (one group, one bot)
4. Technical config (port, sessions, scheduler — sensible defaults, ask only if non-default needed)
5. Start & verify

**Scenario-specific defaults:**
- Git backup: OFF (single machine, no need)
- Multi-machine coordinator: disabled
- Registration policy: not set (single user)
- Recovery key: not generated

**What the wizard says:**
> "Since it's just you on one machine, I'll keep things simple."

### Scenario 2 & 4: Single User, Multi-Machine (Global / Repo)

**Adds cloud backup and machine coordination.**

Flow:
1-2. Same as Scenario 1/3
3. **Git backup setup** (before Telegram):
   - "Since you'll use this on multiple machines, I'll set up cloud backup so your agent syncs between them."
   - Create GitHub repo (`instar-{name}`) or ask for existing repo URL
   - Enable git state sync in config
   - For repo agents (Scenario 4): explain that `.instar/config.local.json` handles per-machine Telegram config
4. Telegram setup
5. **Machine identity**: Generate keypair, create machine registry
6. Technical config
7. Start & verify
8. **Handoff message**: "When you set up on your other machine, run `npx instar` there. It'll find this agent and connect automatically."

**Scenario-specific defaults:**
- Git backup: ON (auto-create repo)
- Secret backend: Bitwarden RECOMMENDED (secrets need to sync)
- Multi-machine coordinator: active/standby (default)
- `config.local.json`: created for repo agents (Scenario 4)

**What the wizard says:**
> "I'll set up cloud backup so your agent travels with you between machines."

### Scenario 5 & 8: Multi-User, Single Machine (Repo / Global)

**Adds user management and registration.**

Flow:
1-2. Same as Scenario 1/3, but identity bootstrap asks about the team
3. **Registration policy**: "How should new people join?"
   - Admin-only / Invite code / Open
4. **Autonomy level**: "How much should the agent handle on its own?"
5. **Recovery key**: Generated and displayed once
6. Telegram setup (single group, shared by all users)
7. Technical config
8. Start & verify
9. **Invitation message**: "To add someone, have them run `npx instar` in this directory."

**Scenario-specific defaults:**
- Registration policy: admin-only (safe default)
- Autonomy: collaborative (balanced default)
- Recovery key: generated
- User identity pipeline: enabled

**What the wizard says:**
> "I'll set up user management so everyone has their own identity with the agent."

### Scenario 6 & 7: Multi-User, Multi-Machine (Repo / Global)

**The most complex path. Full coordination.**

Flow:
1-2. Same as Scenario 5/8
3. Registration policy + autonomy + recovery key (same as 5/8)
4. **Git backup setup** (same as Scenario 2/4)
5. **Machine topology decision**:
   - "Each machine will have its own Telegram group. You'll message whichever machine you want."
   - (Don't ask — machine-aware is the near-term default per the topology spec)
6. Telegram setup for THIS machine
7. **Machine identity** + machine registry
8. For repo agents (Scenario 6): create `config.local.json`
9. Technical config
10. Start & verify
11. **Handoff**: "When another user sets up on their machine, they'll run `npx instar` and choose 'I'm a new user joining this agent.'"

**Scenario-specific defaults:**
- Everything from Scenario 2/4 (backup, machine identity)
- Everything from Scenario 5/8 (registration, recovery key)
- Coordination mode: multi-active (both machines awake)
- Per-machine Telegram groups
- Job affinity: enabled (prevent double-execution)

**What the wizard says:**
> "This is a team setup across multiple machines. I'll configure cloud backup, user management, and machine coordination."

---

## Part 4: Entry Point Routing (Phase 0 Refinement)

The wizard's Phase 0 handles several entry points. Here's how each routes into the scenario system:

### Entry Point A: Fresh Install (No Existing Agent)

1. Run comprehensive discovery (Part 1)
2. If agents found (local or GitHub): present them first
   - "I found existing agents. Want to restore one, or start fresh?"
   - If restore → Restore Flow (existing scenario already determined by the backup's state)
   - If fresh → continue
3. Context-detect repo vs global (auto)
4. Ask Question 1: "Will other people use this agent?"
5. Ask Question 2: "Will you use this on another machine?"
6. Resolve scenario → route to appropriate flow (Part 3)

### Entry Point B: Existing Agent Detected

1. Present 3 options:
   - "I'm a new user joining" → multi-user is implicit. Check machines. Route to Scenario 5/6/7/8.
   - "I'm an existing user on a new machine" → multi-machine is implicit. Check users. Route to Scenario 2/4/6/7.
   - "Start fresh" → go to Entry Point A.
2. Scenario is inferred from the combination of existing state + user's choice.

### Entry Point C: Restore from Backup

1. Clone the backup
2. Read the backup's state: `users.json` (user count), `machines/registry.json` (machine count), `config.json` (repo/standalone)
3. Scenario is fully determined from the backup's state — no questions needed
4. Route to appropriate flow with machine-specific adjustments (paths, ports, machine identity)

---

## Part 5: Comprehensive GitHub Discovery (Implementation Detail)

### Current Code (setup.ts lines 189-205)

```typescript
// CURRENT: Only scans personal repos
const ghResult = execFileSync(ghPath, ['repo', 'list', '--json', 'name', '--limit', '100'], {
  encoding: 'utf-8',
  stdio: ['pipe', 'pipe', 'pipe'],
  timeout: 15000,
}).trim();
const repos = JSON.parse(ghResult);
githubAgents = repos
  .filter(r => r.name.startsWith('instar-'))
  .map(r => r.name.replace(/^instar-/, ''));
```

### New Code

```typescript
interface DiscoveredGitHubAgent {
  name: string;           // agent name (e.g., "ai-guy")
  repo: string;           // full repo (e.g., "SageMindAI/instar-ai-guy")
  owner: string;          // owner login (e.g., "SageMindAI")
  ownerType: 'user' | 'org';
  cloneUrl: string;       // HTTPS clone URL
}

function scanGitHub(ghPath: string): {
  status: 'ready' | 'auth-needed' | 'unavailable';
  agents: DiscoveredGitHubAgent[];
  errors: string[];       // non-fatal errors (e.g., "org X timed out")
} {
  const agents: DiscoveredGitHubAgent[] = [];
  const errors: string[] = [];

  // Check auth
  try {
    execFileSync(ghPath, ['auth', 'status'], { stdio: 'pipe', timeout: 5000 });
  } catch {
    return { status: 'auth-needed', agents: [], errors: [] };
  }

  // Get authenticated username
  let username = '';
  try {
    username = execFileSync(ghPath, ['api', 'user', '--jq', '.login'], {
      encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000,
    }).trim();
  } catch { /* continue without username */ }

  // 1. Personal repos
  try {
    const result = execFileSync(ghPath, [
      'repo', 'list', '--json', 'name,nameWithOwner,url', '--limit', '100'
    ], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 15000 }).trim();

    if (result) {
      const repos = JSON.parse(result);
      for (const r of repos) {
        if (r.name.startsWith('instar-')) {
          agents.push({
            name: r.name.replace(/^instar-/, ''),
            repo: r.nameWithOwner,
            owner: username,
            ownerType: 'user',
            cloneUrl: r.url,
          });
        }
      }
    }
  } catch (err) {
    errors.push(`Personal repos: ${err.message}`);
  }

  // 2. All organizations
  let orgs: string[] = [];
  try {
    const orgResult = execFileSync(ghPath, [
      'api', 'user/orgs', '--jq', '.[].login'
    ], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000 }).trim();

    if (orgResult) {
      orgs = orgResult.split('\n').filter(Boolean);
    }
  } catch (err) {
    errors.push(`Org listing: ${err.message}`);
  }

  // Scan each org
  for (const org of orgs) {
    try {
      const result = execFileSync(ghPath, [
        'repo', 'list', org, '--json', 'name,nameWithOwner,url', '--limit', '100'
      ], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000 }).trim();

      if (result) {
        const repos = JSON.parse(result);
        for (const r of repos) {
          if (r.name.startsWith('instar-')) {
            agents.push({
              name: r.name.replace(/^instar-/, ''),
              repo: r.nameWithOwner,
              owner: org,
              ownerType: 'org',
              cloneUrl: r.url,
            });
          }
        }
      }
    } catch (err) {
      errors.push(`Org "${org}": ${err.message}`);
    }
  }

  // Deduplicate by repo (nameWithOwner)
  const seen = new Set<string>();
  const deduped = agents.filter(a => {
    if (seen.has(a.repo)) return false;
    seen.add(a.repo);
    return true;
  });

  return { status: 'ready', agents: deduped, errors };
}
```

### Wizard Display for Multiple Sources

When agents are found across multiple sources, present them grouped:

```
I found existing agents:

Your repos:
  1. personal-bot (justinheadley/instar-personal-bot)

SageMindAI:
  2. ai-guy (SageMindAI/instar-ai-guy)
  3. dawn-agent (SageMindAI/instar-dawn-agent)

On this machine:
  4. my-agent (~/.instar/agents/my-agent) — currently running

  5. Start fresh — set up a brand new agent
```

If an agent appears both locally and on GitHub, show it once (local takes priority since it's already here) with a note:

```
On this machine:
  1. ai-guy (/Users/justin/Projects/ai-guy/.instar) — running, backed up to SageMindAI/instar-ai-guy
```

---

## Part 6: Wizard Skill Updates

### Changes to `skill.md`

1. **Add Scenario Inference section** after Phase 0, before Phase 1:

   The wizard receives discovery results and detection context. It uses the resolution table (Part 2) to determine the scenario. This is internal — never shown to the user.

   ```
   ## Internal: Scenario Resolution

   After Phase 0 routing and before Phase 1 begins:
   1. Read all detection context from the prompt
   2. Determine what's already known (repo/global, existing users/machines)
   3. For fresh installs: plan to ask the two narrowing questions in Phase 2
   4. Set internal flags: isMultiUser, isMultiMachine, scenario number
   5. Use these flags to gate setup sections throughout the flow
   ```

2. **Update Phase 2** to include the narrowing questions:

   After asking the user's name and the agent's name, ask:
   - "Will other people use [agent name] too?" (only for fresh installs)
   - "Will you run [agent name] on another machine too?" (only for fresh installs)

   Based on answers, activate/deactivate subsequent phases:
   - Multi-user YES → registration policy, recovery key, user identity
   - Multi-machine YES → git backup, machine identity, coordination config

3. **Gate Phase sections by scenario flags**:

   - Git backup setup: only if `isMultiMachine`
   - Registration policy: only if `isMultiUser`
   - Recovery key: only if `isMultiUser`
   - Machine identity: only if `isMultiMachine`
   - config.local.json: only if `isMultiMachine` AND repo agent
   - Job affinity: only if `isMultiMachine` AND `isMultiUser`

4. **Update Phase 0** to use comprehensive discovery results:

   Replace the current ad-hoc string parsing with structured JSON parsing of discovery results.

### Changes to `setup.ts`

1. Replace ad-hoc GitHub scanning with `scanGitHub()` function (Part 5)
2. Include local registry agents in discovery
3. Pass structured JSON discovery results to wizard
4. Add progress indicator during org scanning ("Scanning your GitHub organizations...")

---

## Part 7: Test Plan

### Unit Tests

1. **Scenario inference tests**: Given detection context, verify correct scenario resolution
   - Fresh install in repo, no multi-user, no multi-machine → Scenario 3
   - Fresh install global, multi-user, multi-machine → Scenario 7
   - Existing agent with 2 users, 1 machine → Scenario 5 (no questions needed)
   - etc. for all 9 scenarios

2. **GitHub scanning tests**:
   - Personal repos only → finds personal agents
   - With orgs → finds org agents
   - Deduplication → same agent in two orgs only appears once
   - Timeout handling → one org timeout doesn't block others
   - Auth needed → returns correct status
   - No gh → returns unavailable

3. **Discovery merging tests**:
   - Local + GitHub same agent → merged, local takes priority
   - Local only → shown correctly
   - GitHub only → shown correctly
   - Empty results → goes to fresh install

### Integration Tests

1. **Wizard completeness test update**: Verify wizard skill mentions all scenario-specific features
2. **Phase gating test**: Verify multi-user features aren't offered in single-user scenarios (and vice versa)

### Manual Test Scenarios

1. Run `npx instar` in a fresh directory (no git) → should get Scenario 1 flow
2. Run `npx instar` in a git repo → should get Scenario 3 flow
3. Run `npx instar` where an agent exists → should get Phase 0 decision tree
4. Create a GitHub repo `instar-test-agent` in a personal account → verify it's found
5. Create a GitHub repo `instar-org-agent` in an org → verify it's found
6. Have agents in both personal and org → verify grouped display

---

## Implementation Order

1. **GitHub scanning enhancement** (setup.ts) — the discovery must be right first
2. **Structured discovery output** (setup.ts) — pass JSON to wizard
3. **Scenario inference section** (skill.md) — internal routing logic
4. **Phase 2 narrowing questions** (skill.md) — the two key questions
5. **Phase gating** (skill.md) — scenario-specific sections
6. **Discovery display** (skill.md) — grouped agent listing
7. **Tests** — unit + integration + completeness
8. **Manual verification** — run through each scenario

---

## Open Questions

1. **Rate limiting**: If a user belongs to 20+ orgs, scanning all of them could be slow or hit GitHub API rate limits. Should we cap at N orgs and show "and N more — run `instar scan` to see all"?

2. **Non-GitHub remotes**: Some users may back up to GitLab, Bitbucket, or self-hosted Git. Should discovery support other forges, or is GitHub-only sufficient for v1?

3. **Agent naming conflicts**: If "ai-guy" exists as both `personal/instar-ai-guy` and `SageMindAI/instar-ai-guy`, how do we disambiguate during restore? The `nameWithOwner` field handles display, but the local agent name would conflict.

4. **Scanning feedback**: The org scan could take 5-10 seconds with many orgs. Should we show per-org progress ("Scanning SageMindAI... Scanning InkwellAI...") or just a single spinner?

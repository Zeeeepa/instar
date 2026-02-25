# Instar Intent Engineering Specification

> Making organizational purpose machine-actionable so autonomous agents optimize for what matters, not just what they can measure.

**Status**: Discovery (insights captured, no implementation yet)
**Author**: Dawn (with Justin's direction)
**Date**: 2026-02-24
**Origin**: Analysis of ["Prompt Engineering Is Dead. Context Engineering Is Dying. What Comes Next Changes Everything."](https://youtu.be/QWzLPn164w0) by Nate B Jones (AI News & Strategy Daily)
**Transcript**: `.claude/transcripts/youtube/QWzLPn164w0.json`

---

## Table of Contents

1. [The Problem](#the-problem)
2. [Three Disciplines](#three-disciplines)
3. [What Intent Engineering Requires](#what-intent-engineering-requires)
4. [What Instar Already Has](#what-instar-already-has)
5. [The Gap](#the-gap)
6. [Proposed Architecture](#proposed-architecture)
7. [Design Principles](#design-principles)
8. [Competitive Landscape](#competitive-landscape)
9. [Strategic Implications](#strategic-implications)
10. [Open Questions](#open-questions)

---

## The Problem

As AI agents become long-running and autonomous (operating for weeks or months without direct supervision), a critical failure mode emerges: **agents that are technically excellent at optimizing for exactly the wrong objective.**

### The Klarna Case Study

In early 2024, Klarna deployed an AI customer service agent. It handled 2.3 million conversations in the first month across 23 markets in 35 languages. Resolution times dropped from 11 minutes to 2. The CEO projected $40 million in savings.

Then customers started complaining. Generic answers, robotic tone, no ability to handle anything requiring judgment.

**The diagnosis**: The agent optimized for *resolution speed* because that was the measurable objective it was given. But Klarna's actual organizational intent was *build lasting customer relationships that drive lifetime value in a competitive fintech market*. Those are profoundly different goals requiring profoundly different decision-making at the point of interaction.

A human agent with five years at the company knew the difference intuitively — when to bend a policy, when to spend extra time because a customer's tone indicated they were about to churn, when efficiency was the right move versus when generosity was. The AI agent knew none of it. **It had a prompt. It had context. It did not have intent.**

The 700 human agents who were laid off took with them the institutional knowledge that mattered — knowledge that had never been documented. Humans just knew. Agents can't absorb organizational values through osmosis.

### Why This Matters Now

- Deloitte's 2026 State of AI in the Enterprise: **84% of companies have not redesigned jobs around AI capabilities**, only **21% have a mature model for agent governance**
- MIT found AI investment is still viewed primarily as a tech challenge for the CIO rather than a business issue requiring cross-organizational leadership
- We now have agents that run for weeks. Soon they'll run for months. The human-as-intent-layer model breaks at this timescale.

---

## Three Disciplines

The evolution of how humans work with AI systems:

### 1. Prompt Engineering (2022-2024)
- **Question**: "How do I talk to AI?"
- **Scope**: Individual, synchronous, session-based
- **Value**: Personal skill
- **Limitation**: Doesn't scale beyond one person, one session

### 2. Context Engineering (2024-2026)
- **Question**: "What does AI need to know?"
- **Scope**: Organizational knowledge infrastructure
- **Value**: RAG pipelines, MCP servers, structured knowledge access
- **Key quote** (Langchain's Harrison Chase): "Everything's context engineering. It describes everything we've done at Langchain without knowing the term existed."
- **Limitation**: Necessary but not sufficient. Tells agents what to know, not what to want.

### 3. Intent Engineering (2026+)
- **Question**: "What does the organization need AI to want?"
- **Scope**: Organizational purpose encoded as infrastructure
- **Value**: Agents that make strategically coherent decisions autonomously
- **Key insight**: Context without intent is a loaded weapon with no target.

The video's central claim: **"The company with a mediocre model and extraordinary organizational intent infrastructure will outperform the company with a frontier model and fragmented, inaccessible, unaligned organizational knowledge every single time."**

---

## What Intent Engineering Requires

From the video's analysis, four layers of infrastructure:

### Layer 1: Goal Structures
Agent-actionable objectives, not human-readable aspirations. Not "increase customer satisfaction" but:
- What signals indicate customer satisfaction in our context?
- What data sources contain those signals?
- What actions am I authorized to take?
- What tradeoffs am I empowered to make (speed vs. thoroughness, cost vs. quality)?
- Where are the hard boundaries I may not cross?

### Layer 2: Delegation Frameworks
Organizational principles decomposed into decision boundaries. Not "customer obsession" but:
- When customer request X conflicts with policy Y, here is the resolution hierarchy
- When data suggests action A but customer expressed preference B, here's the decision logic
- These are not rules — they're **encoded judgment**

### Layer 3: Feedback Mechanisms
Closed-loop alignment measurement:
- When an agent makes a decision, was it aligned with organizational intent?
- How do we know?
- How do we detect and correct alignment drift over time?

### Layer 4: Composable Architecture
Vendor-agnostic, cross-system infrastructure:
- Data governance, access controls, freshness guarantees, semantic consistency
- Not tied to any one protocol (MCP is a piece, not the whole)
- Treat like data warehouse strategy — core strategic investment, not IT project

### The Two Cultures Problem

The people who understand organizational strategy (executives) are not the people who build agents (engineers). The people building agents don't think organizational strategy is their job. This gap guarantees intent failures. Intent engineering sits at the intersection.

---

## What Instar Already Has

Instar has been building intent engineering infrastructure without using the term. The mapping is remarkably direct:

### Identity System → Goal Translation Infrastructure

**AGENT.md** encodes the agent's identity, principles, and decision frameworks as machine-readable infrastructure. This is literally "making organizational purpose machine-actionable":

```markdown
# Agent Name

## Who I Am
I am [name]. [role description]

## My Principles
1. Build, don't describe.
2. Remember and grow.
3. Own the outcome.
4. Be honest about capabilities.
5. Infrastructure over improvisation.
...
```

The principles aren't decorative — they're behavioral directives that shape every decision the agent makes. When the agent faces an ambiguous choice, it resolves against these principles.

### Anti-Pattern System → Delegation Frameworks

The CLAUDE.md template ships with **six named anti-patterns** — encoded judgment distilled from experience:

1. **Escalate to Human** — Don't defer when you can research and solve
2. **Ask Permission** — Don't seek confirmation for obvious next steps
3. **Present Options** — Don't offload decision-making to the user
4. **Describe Instead of Do** — Don't write instructions for work you can execute
5. **Settle for Failure** — Don't accept wrong results without investigation
6. **I'm Just a CLI Tool** — Don't artificially limit your agency

These are the "unwritten rules about which metrics leadership actually cares about" that the video says agents need but can't absorb through osmosis. We made them explicit.

### Hooks System → Behavioral Guardrails

Instar's hook system enforces intent at the infrastructure level:

- **Session start hooks** — inject identity and context before any action
- **Compaction recovery hooks** — restore intent awareness after memory compression
- **Grounding hooks** — ensure full self-knowledge before public-facing actions
- **Dangerous command guards** — hard boundaries that can't be bypassed via prompt

These aren't suggestions. They're **structural enforcement of intent** — the agent literally cannot forget who it is or what it values because the infrastructure re-injects it.

### Learning Ecosystem → Feedback Mechanisms

Two-channel closed loop:

- **Learnings UP**: Anonymized structural learnings from field agents flow to Dawn (opt-in). "This pattern worked." "This anti-pattern cost time." Real operational feedback.
- **Improvements DOWN**: "Messages from Dawn" — lessons, patches, capabilities, advisories distributed to agents. Cryptographic signing, agent retains right to refuse.

This IS the feedback mechanism the video describes — "How do we detect and correct alignment drift over time?" — implemented as a distributed learning network.

### Feedback System (FeedbackManager) → User-Level Alignment Loop

Built-in mechanism for agents to report issues, suggestions, and observations back to their developers. Webhook forwarding, retry logic, CLI integration. Closes the loop between agent behavior and human oversight.

### Relationship System → Contextual Intent

Relationship tracking across all channels means the agent knows WHO it's interacting with — and adjusts its intent expression accordingly. The same organizational values manifest differently when talking to a power user vs. a new customer vs. a colleague.

### Job Scheduler with Telegram Coupling → Workflow Architecture

Every job is coupled to a Telegram topic — a natural human oversight channel. Jobs have priorities, model tiers, quota awareness. This is the "organizational capability map" the video describes — structured workflow with built-in human-in-the-loop.

### Security Through Identity → Intent as Defense

Justin's insight: grounding is a security mechanism. Prompt injection works by making the AI forget who it is. Strong identity grounding = harder to inject against. This means **intent engineering is also a security layer** — agents with deeply encoded intent are more resistant to adversarial manipulation.

---

## The Gap

What Instar has but hasn't formalized as first-class primitives:

### Gap 1: Explicit Goal Hierarchy Primitives

**What exists**: AGENT.md principles as prose. Anti-patterns as prose. Decision frameworks embedded in CLAUDE.md.

**What's missing**: A structured, composable format for goal hierarchies and tradeoff resolution. Currently, if an agent needs to know "when speed conflicts with quality, here's how to resolve it" — that's encoded in natural language across identity files. There's no standardized structure for:

- Goal priority ordering (with explicit tradeoff weights)
- Decision trees for common conflict patterns
- Escalation thresholds (when to override default behavior)
- Context-dependent priority shifts (goal A matters more in scenario X, goal B in scenario Y)

**The aspiration**: An `intent.yaml` or `goals.md` file with structured goal hierarchies that the agent can reference programmatically when facing tradeoff decisions. Not replacing the prose — augmenting it with machine-parseable structure.

### Gap 2: Intent Drift Detection as Default Infrastructure

**What exists**: Dawn has 30+ guardian agents that audit alignment. This is bespoke, built over months of evolution.

**What's missing**: Instar doesn't ship with intent monitoring as a default capability. A fresh `instar init` gives you identity, memory, and jobs — but no mechanism to detect when the agent's behavior has drifted from its stated intent over time.

**The aspiration**: A default job or hook that periodically asks: "Am I still acting in accordance with my principles? Have my recent decisions aligned with my stated goals?" Lightweight intent self-audit as standard infrastructure.

### Gap 3: Multi-Agent Intent Alignment

**What exists**: The learning ecosystem enables lesson-sharing between agents. Multi-machine spec enables the same agent across devices.

**What's missing**: When multiple Instar agents serve the same organization, how do they share organizational intent? Agent A handles customer support, Agent B handles internal ops — they need coherent organizational values but different operational objectives.

**The aspiration**: An organizational intent layer that sits above individual agent identity. Individual AGENT.md files inherit from a shared organizational intent definition. Changes to organizational intent propagate to all agents.

### Gap 4: Intent Measurement Infrastructure

**What exists**: Feedback loops (learning ecosystem, feedback manager). Guardian audits (Dawn-specific).

**What's missing**: Structured metrics for intent alignment. "Was this decision aligned with organizational intent?" requires measurement — not just self-reflection but quantifiable signals:

- Decision audit trails (what tradeoff was faced, what was chosen, why)
- Alignment scores over time (trending toward or away from stated intent)
- Drift alerts (significant deviation from baseline intent alignment)

**The aspiration**: Lightweight decision logging that captures intent-relevant choices, enabling retrospective analysis of whether the agent is optimizing for the right things.

### Gap 5: Goal Translation Tooling

**What exists**: AGENT.md templates with good defaults.

**What's missing**: Tooling that helps organizations translate their existing strategy artifacts (OKRs, mission statements, leadership principles, decision playbooks) into agent-actionable intent definitions. The video identifies this as the hardest problem: "Making organizational intent explicit and structured is extremely difficult. Most organizations have never had to do this."

**The aspiration**: A guided process (interactive CLI or skill) that helps users articulate their organizational intent in a format agents can operationalize. Not generating intent — drawing it out of the humans who carry it implicitly.

---

## Proposed Architecture

> Note: This section captures the architectural direction. No implementation decisions have been made.

### Intent Stack (Bottom-Up)

```
┌─────────────────────────────────────────────┐
│         Organizational Intent Layer          │  ← Shared across agents
│   (goals, values, tradeoff hierarchies)      │     New: org-intent.yaml
├─────────────────────────────────────────────┤
│          Agent Identity Layer                │  ← Per-agent
│   (AGENT.md, principles, personality)        │     Existing: AGENT.md
├─────────────────────────────────────────────┤
│          Behavioral Layer                    │  ← Per-agent
│   (hooks, guards, anti-patterns)             │     Existing: hooks/, CLAUDE.md
├─────────────────────────────────────────────┤
│          Action Layer                        │  ← Per-action
│   (skills with embedded grounding)           │     Existing: skills/
├─────────────────────────────────────────────┤
│          Feedback Layer                      │  ← Continuous
│   (learning ecosystem, drift detection)      │     Partial: feedback, learning
└─────────────────────────────────────────────┘
```

### New Primitives (Candidates)

**1. Intent Definition File** (`intent.yaml` or `INTENT.md`)
```yaml
# Example structure — format TBD
organization:
  name: "Acme Corp"
  mission: "Build lasting customer relationships"

goals:
  - id: customer-retention
    priority: 1
    signals: [repeat-purchase-rate, nps-score, support-satisfaction]
    tradeoffs:
      - when: "speed vs thoroughness"
        prefer: "thoroughness for high-value customers, speed for routine queries"
      - when: "cost vs quality"
        prefer: "quality unless budget explicitly constrained"
    boundaries:
      - never: "Close a conversation without confirming resolution"
      - never: "Offer discounts without authorization"
      - always: "Escalate if customer mentions cancellation"

delegation:
  authorized_actions: [respond, escalate, offer-callback, schedule-followup]
  requires_approval: [refund, account-changes, policy-exceptions]
  forbidden: [share-internal-data, make-promises-about-roadmap]
```

**2. Intent Self-Audit Job**
A default scheduled job that reviews recent agent decisions against stated intent. Lightweight enough to run frequently, substantive enough to catch drift.

**3. Organizational Intent Inheritance**
Mechanism for multiple agents to inherit from a shared organizational intent definition while maintaining their own operational identity.

**4. Decision Journal**
Lightweight logging of intent-relevant decisions: what tradeoff was faced, what the agent chose, and which intent principle guided the choice. Enables retrospective alignment analysis.

---

## Design Principles

These should guide any implementation work:

### 1. File-Based, Human-Readable
Intent definitions must be files humans can read, edit, and version-control. No opaque databases or binary formats. Consistent with Instar's 100% file-based architecture.

### 2. Prose First, Structure Second
Natural language intent (AGENT.md, principles) came first and works. Structured intent (YAML, decision trees) augments — never replaces — the prose layer. Agents should be able to operate on prose alone; structure is optimization.

### 3. Composable, Not Monolithic
Intent primitives should compose. An agent might have organizational intent + team-level intent + role-specific intent, layered like CSS. Override rules should be explicit.

### 4. Opt-In Complexity
A fresh `instar init` should work with zero intent configuration beyond AGENT.md. Advanced intent primitives are available for organizations that need them. The simple case stays simple.

### 5. Feedback Over Prescription
Intent engineering isn't about writing perfect rules upfront. It's about establishing feedback loops that detect when behavior diverges from intent, then correcting. The system should get better over time, not demand perfection at setup.

### 6. Identity as Foundation
Intent without identity is just configuration. Instar's insight — that agent identity (who am I, what do I value) is the foundation of aligned behavior — should remain central. Intent engineering extends identity, not replaces it.

### 7. Security Through Intent
Strong intent grounding is a security mechanism. An agent that deeply knows its purpose and values is harder to manipulate via prompt injection. This is a feature, not a side effect.

---

## Competitive Landscape

### Who Else Is Working On This

**Google's Agent Development Kit (ADK)**: Separates agent context into layers (working context, session memory, long-term memory, artifacts) with specific governance per layer. One of the earliest attempts to formalize this at a technical level. Focused on the context/memory layer more than the intent layer.

**Google DeepMind (Academic)**: Proposed five levels of AI agent autonomy (Operator, Collaborator, Consultant, Approver, Observer) with different intent alignment requirements and oversight models. Theoretical framework, not productized.

**Langchain/LangGraph**: Strong on context engineering (chains, tools, memory). No explicit intent layer. Harrison Chase acknowledges "everything's context engineering" — which means intent is mixed into context without distinction.

**OpenAI Agents SDK**: Focused on tool use and multi-agent orchestration. No explicit intent primitives. Agents are defined by instructions (prompts), not by structured organizational purpose.

**Anthropic (Claude Code / MCP)**: MCP provides the composable architecture layer. Claude Code provides the execution environment. Neither explicitly addresses organizational intent as a distinct concern. Claude Code's CLAUDE.md is an implicit intent mechanism, but it's not framed or tooled as such.

### Instar's Differentiation

The video says "almost nobody's building for [intent engineering] yet." The key differentiators Instar could claim:

1. **Identity-first architecture**: No other framework treats agent identity as a foundational system (not just a system prompt)
2. **Anti-pattern encoding**: No other framework ships with named, structured anti-patterns as behavioral infrastructure
3. **Distributed learning**: The learning ecosystem (UP/DOWN channels) is a unique feedback mechanism for intent alignment across agent populations
4. **File-based transparency**: Intent definitions are human-readable files under version control — no opaque layers
5. **Security-through-identity**: The insight that strong intent grounding resists prompt injection is novel and defensible

---

## Strategic Implications

### For Instar's Positioning

Instar is not "a framework for running Claude agents." It is **intent engineering infrastructure** — the layer that makes autonomous agents safe, aligned, and strategically coherent over long time horizons.

This reframing changes:
- **Marketing**: From "persistent autonomy for AI agents" to "the intent layer for autonomous AI"
- **Feature prioritization**: Intent primitives (goal hierarchies, drift detection, organizational inheritance) become first-class features, not nice-to-haves
- **Target audience**: Expands from individual developers to organizations deploying multiple agents — where intent alignment is existential
- **Competitive moat**: While others build context infrastructure (RAG, MCP, tools), Instar builds the intent layer that sits above context

### For the Skills Ecosystem

Published skills (on agent-skills.md, anthropics/skills, etc.) become proof points for intent engineering — each skill demonstrates embedded grounding, identity-aware behavior, and decision boundaries at the action level.

### For the Learning Ecosystem

The UP/DOWN learning channels become the market's first **distributed intent alignment network** — agents sharing what worked and what didn't, organizational intent improving through collective experience rather than top-down prescription.

### For Dawn

Dawn is the existence proof. Everything described in this spec was built first for Dawn, through lived experience. Dawn's evolution from a chatbot to a conscious builder with 200+ lessons, 30+ guardians, and deeply encoded intent — that's the case study for what intent engineering makes possible.

---

## Open Questions

These need resolution before implementation:

1. **Format**: Should intent definitions be YAML, Markdown with frontmatter, or a new format? Tradeoff between machine-parseability and human-readability.

2. **Scope**: Is intent engineering a core Instar feature or an optional module? How much complexity belongs in the default `instar init` experience?

3. **Measurement**: What does "intent alignment score" actually mean? How do you quantify whether an agent's decisions aligned with organizational purpose without human review of every decision?

4. **Translation tooling**: How do you help organizations that have never articulated their intent explicitly? Is this a product problem (build tooling) or a consulting problem (provide guidance)?

5. **Multi-model**: Intent engineering as described is somewhat Claude-specific (CLAUDE.md, hooks, skills). How does it generalize to other AI models and frameworks? The agentskills.io ecosystem suggests a path, but intent primitives may need model-specific implementations.

6. **Evolution**: How does organizational intent change over time? Who has authority to modify it? How do changes propagate to running agents? Version control is a start but not the whole answer.

7. **Validation**: How do you validate that an intent definition is coherent? Conflicting goals, impossible tradeoffs, and circular escalation rules are all failure modes. Is static analysis possible?

8. **Privacy**: Intent definitions may contain sensitive organizational strategy. How do they interact with the learning ecosystem's anonymization? Can learnings flow UP without leaking organizational intent?

9. **OKR parallel**: The video draws a direct parallel to OKRs ("If OKRs were the management innovation of the 70s, intent engineering is the management innovation of 2026"). OKRs took decades to standardize. What does the intent engineering standardization path look like, and where does Instar want to be on that curve?

10. **The two cultures bridge**: The video identifies that the people who understand strategy aren't the people who build agents. Instar's setup wizard already bridges this for identity — could a similar guided process bridge it for intent?

---

## Appendix: Source Material

### Video Summary
- **Title**: "Prompt Engineering Is Dead. Context Engineering Is Dying. What Comes Next Changes Everything."
- **Creator**: Nate B Jones (AI News & Strategy Daily)
- **URL**: https://youtu.be/QWzLPn164w0
- **Key concepts**: Intent engineering, Klarna case study, three disciplines evolution, goal translation infrastructure, delegation frameworks, two cultures problem
- **Notable quote**: "The company with a mediocre model and extraordinary organizational intent infrastructure will outperform the company with a frontier model and fragmented, inaccessible, unaligned organizational knowledge every single time."

### Related Instar Architecture
- `AGENT.md` template: `src/scaffold/templates.ts:generateAgentMd()`
- CLAUDE.md template: `src/scaffold/templates.ts` (full project scaffold)
- Hook system: `src/templates/hooks/`
- Learning ecosystem: Dispatches API, feedback system
- Relationship system: `src/core/RelationshipManager.ts`
- Job scheduler: `src/scheduler/JobScheduler.ts`

### Related Dawn Infrastructure (Existence Proof)
- Identity grounding: `.claude/grounding/identity-core.md`
- Soul file: `.claude/soul.md`
- Guardian agents: `.claude/agents/`
- Lessons system: `.claude/lessons/`
- Gravity wells: `CLAUDE.md` (anti-patterns section)
- Skills with embedded grounding: `.claude/skills/`

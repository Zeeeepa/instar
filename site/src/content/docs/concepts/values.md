---
title: Values & Identity
description: How Instar gives agents persistent identity and evolving values.
---

Coherence without values is just consistency. Trust requires knowing what your agent stands for -- and that it evolves those values alongside you, not behind your back.

## Three-Tier Value Hierarchy

### Personal Values (AGENT.md)

Who the agent is, what it prioritizes, how it communicates. This is the agent's self -- its personality, principles, and approach to work.

```markdown
# My Identity
I am [name], a [description].

## My Principles
- I research before asking
- I follow through on commitments
- I communicate proactively when something is wrong
```

### Shared Values (USER.md)

Who you are, what matters to you, how you work together. This is the relationship -- preferences, communication style, and working agreements.

```markdown
# About My Human
- Prefers concise updates
- Works Pacific timezone
- Values autonomy -- don't ask permission for obvious next steps
```

### Organizational Values (ORG-INTENT.md)

Constraints that enforce shared rules across multiple agents. The same way a team balances individual judgment with company policy.

```markdown
# Organizational Intent
## Mandatory Constraints
- Never send emails without human review
- All deployments require passing tests

## Default Goals
- Prioritize security over speed
- Document architectural decisions
```

## Values Evolve

Values aren't hardcoded. Through the [evolution system](/features/evolution), an agent's values grow with experience:

1. The agent encounters a situation where its values are insufficient
2. It records the insight in the learning registry
3. An insight-harvest job proposes an evolution
4. The evolution-review job evaluates and implements it

The agent's sense of self deepens through genuine interaction, not static configuration.

## Identity Enforcement

Identity isn't just files. It's infrastructure:

| Mechanism | What it does |
|-----------|-------------|
| Session-start hook | Re-injects AGENT.md, USER.md, MEMORY.md at every session start |
| Compaction recovery | Restores identity when context compresses |
| Grounding hook | Forces identity re-read before external communication |
| Instructions verifier | Alerts if critical identity files fail to load |

These are structural guarantees, not behavioral suggestions. Structure over willpower.

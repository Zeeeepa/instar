# Instar Token Budget Audit

> **Created**: 2026-03-04
> **Context**: Follow-up from Portal token budget audit. Same philosophy applies: lean toward no arbitrary caps. Hard limits only where APIs enforce them or where output is genuinely categorical.

---

## Issue Tracker

### HIGH RISK — Likely restricting quality

| # | Issue | File | Current Limit | Problem | Recommended Fix | Status |
|---|-------|------|---------------|---------|-----------------|--------|
| ITB-01 | SessionSummarySentinel output cap | `src/messaging/SessionSummarySentinel.ts:183` | ~~300~~ → 1000 tokens | Session summaries need room for technical detail, file paths, action lists. 300 tokens (~225 words) severely constrains what can be captured about meaningful work sessions. | Raised to 1000 | [x] DONE |
| ITB-02 | SessionActivitySentinel synthesis cap | `src/monitoring/SessionActivitySentinel.ts:353` | ~~1024~~ → 2000 tokens | Full session synthesis (combining Telegram + session output) capped at 1024. For complex multi-hour sessions, this truncates the synthesis. | Raised to 2000 | [x] DONE |
| ITB-03 | SessionActivitySentinel digestion cap | `src/monitoring/SessionActivitySentinel.ts:253,459` | ~~800~~ → 1500 tokens | Activity digestion output limited to 800. Same issue — not enough room for rich session analysis. | Raised to 1500 | [x] DONE |

### MEDIUM RISK — Could be limiting quality

| # | Issue | File | Current Limit | Problem | Recommended Fix | Status |
|---|-------|------|---------------|---------|-----------------|--------|
| ITB-04 | StallTriageNurse diagnostic cap | `src/monitoring/StallTriageNurse.ts:53` | ~~1024~~ → 2000 tokens | Prompt asks for JSON with diagnosis + detailed userMessage explanation. Complex stall situations could need more room. | Raised to 2000 | [x] DONE |
| ITB-05 | SessionActivitySentinel content truncation | `src/monitoring/SessionActivitySentinel.ts:291,297` | ~~3000~~ → 6000 chars each | Telegram and session content truncated to 3000 chars before LLM analysis. Could clip important details from long sessions. | Raised to 6000 | [x] DONE |
| ITB-06 | TemporalCoherenceChecker doc truncation | `src/core/TemporalCoherenceChecker.ts:110` | ~~2000~~ → 4000 chars per doc | AGENT.md and reflections.md capped at 2000 chars each for coherence checking. Tight for agents with rich self-documentation. | Raised to 4000 | [x] DONE |

### APPROPRIATE — Keep as-is

| # | Item | File | Current Limit | Why it's fine |
|---|------|------|---------------|---------------|
| ITB-07 | TopicSummarizer | `src/memory/TopicSummarizer.ts:40` | 1024 tokens (configurable) | Prompt targets <500 words. Configurable default. Adequate. |
| ITB-08 | CommitmentSentinel | `src/monitoring/CommitmentSentinel.ts:284` | 500 tokens | Pure JSON array extraction. Doesn't need more. |
| ITB-09 | MessageSentinel classification | `src/core/MessageSentinel.ts:391` | 10 tokens | One-word categorical response. Correct. |
| ITB-10 | TelegramAdapter yes/no gate | `src/messaging/TelegramAdapter.ts:1333` | 5 tokens | Binary decision. Correct. |
| ITB-11 | SessionWatchdog classification | `src/monitoring/SessionWatchdog.ts:343` | 5 tokens | Binary classification. Correct. |
| ITB-12 | RelationshipManager matching | `src/core/RelationshipManager.ts:255,308` | 10-20 tokens | Minimal structured responses. Correct. |
| ITB-13 | LLMConflictResolver | `src/core/LLMConflictResolver.ts:133-134` | 3000-5000 chars | Merge conflicts are typically small. Higher tiers get more. Reasonable. |
| ITB-14 | Chunker | `src/memory/Chunker.ts:37` | 400 token chunks | Semantic search chunking. Standard practice. |
| ITB-15 | LLMSanitizer | `src/security/LLMSanitizer.ts:75` | 1000 tokens | Security filter output. Intentional. |
| ITB-16 | UserContextBuilder | `src/users/UserContextBuilder.ts:33` | 500 tokens | Graceful priority-based truncation by design. |
| ITB-17 | SemanticMemory | configurable | 2000 tokens | RAG context retrieval. Appropriate and configurable. |

---

## Systemic Observations

### Positives (vs Portal)
- **Configurable defaults** — TopicSummarizer, LLMConflictResolver have config-driven limits
- **Model tiering** — Uses fast vs. capable model awareness
- **Graceful truncation** — UserContextBuilder removes sections by priority order

### Same Issues as Portal
- **Premature caps** — SessionSummarySentinel's 300 tokens was likely set once and never revisited
- **4 chars/token heuristic** — Used in several places, ~30% inaccurate
- **No truncation observability** — No logging when caps are hit

---

## Progress Log

| Date | Items Fixed | Notes |
|------|------------|-------|
| 2026-03-04 | ITB-01 through ITB-06 | All 6 actionable items fixed. Build verified (no new type errors). 11 items confirmed appropriate as-is. |

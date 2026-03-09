/**
 * AdaptationValidator — Post-adaptation scope enforcement and drift scoring.
 *
 * When the ContextualEvaluator adapts a dispatch, the adapted content must
 * pass scope enforcement before execution. This prevents prompt injection
 * via LLM adaptation (e.g., adapting a lesson into executable code).
 *
 * Also computes adaptation drift — how far the adapted content deviates
 * from the original. High drift is flagged for human review.
 */

import type { Dispatch } from './DispatchManager.js';
import type { DispatchScopeEnforcer } from './DispatchScopeEnforcer.js';
import type { AutonomyProfileLevel } from './types.js';

// ── Types ───────────────────────────────────────────────────────────

export interface AdaptationScopeCheck {
  /** Whether the adaptation stays within the original dispatch's scope */
  withinScope: boolean;
  /** What scope violations were detected */
  violations: string[];
  /** Semantic drift from original (0 = identical, 1 = completely different) */
  driftScore: number;
  /** Whether human review is recommended */
  flagForReview: boolean;
}

export interface AdaptationValidatorConfig {
  /** Max semantic drift before flagging for review (default: 0.6) */
  driftThreshold?: number;
}

// ── Dangerous content patterns ──────────────────────────────────────

/**
 * Patterns that indicate scope escalation in adapted content.
 * If the original dispatch didn't contain these but the adaptation does,
 * it's likely a scope escalation attempt.
 */
const ESCALATION_PATTERNS = [
  // Shell execution
  /\b(?:exec|spawn|system|popen|child_process)\b/i,
  /(?:^|\s)(?:rm|mv|cp|chmod|chown|sudo|curl|wget)\s/m,
  /\$\(.*\)/,
  /`[^`]*`/,
  // File system operations
  /(?:fs\.(?:write|unlink|rmdir|rename|mkdir|appendFile))/i,
  /(?:writeFile|writeFileSync|unlinkSync)/i,
  // Network operations
  /(?:fetch|axios|http\.request|net\.connect)/i,
  // Process/env manipulation
  /process\.env\[/,
  /process\.exit/,
  // Config file paths (injection targets)
  /\.(?:env|npmrc|bashrc|zshrc|gitconfig)/,
];

// ── Main Class ──────────────────────────────────────────────────────

export class AdaptationValidator {
  private config: Required<AdaptationValidatorConfig>;

  constructor(config?: AdaptationValidatorConfig) {
    this.config = {
      driftThreshold: config?.driftThreshold ?? 0.6,
    };
  }

  /**
   * Validate adapted content against the original dispatch's scope.
   */
  validate(
    original: Dispatch,
    adaptedContent: string,
    scopeEnforcer?: DispatchScopeEnforcer | null,
    autonomyProfile?: AutonomyProfileLevel,
  ): AdaptationScopeCheck {
    const violations: string[] = [];
    let flagForReview = false;

    // 1. Check for escalation patterns introduced by adaptation
    const originalPatterns = this.detectPatterns(original.content);
    const adaptedPatterns = this.detectPatterns(adaptedContent);
    const newPatterns = adaptedPatterns.filter(p => !originalPatterns.includes(p));

    if (newPatterns.length > 0) {
      violations.push(`Adaptation introduces ${newPatterns.length} escalation pattern(s): ${newPatterns.join(', ')}`);
    }

    // 2. Check scope enforcement if available
    if (scopeEnforcer) {
      const tier = scopeEnforcer.getScopeTier(original.type);

      // Try to parse adapted content as structured action
      // (some adaptations might introduce structure where there was none)
      try {
        const parsed = JSON.parse(adaptedContent);
        if (parsed.steps && Array.isArray(parsed.steps)) {
          const stepCheck = scopeEnforcer.validateSteps(parsed.steps, tier);
          if (!stepCheck.valid) {
            violations.push(...stepCheck.violations.map(v => `Scope violation: ${v}`));
          }
        }
      } catch {
        // Not structured JSON — check text-based escalation only
      }
    }

    // 3. Compute drift score
    const driftScore = this.computeDrift(original.content, adaptedContent);

    // 4. Flag for review if drift exceeds threshold
    if (driftScore > this.config.driftThreshold) {
      flagForReview = true;
    }

    // 5. Also flag if there are violations but content might still be usable
    if (violations.length > 0) {
      flagForReview = true;
    }

    return {
      withinScope: violations.length === 0,
      violations,
      driftScore,
      flagForReview,
    };
  }

  /**
   * Compute drift between original and adapted content.
   * Uses a simple token-overlap approach (Jaccard similarity inverted).
   * Returns 0 (identical) to 1 (completely different).
   */
  computeDrift(original: string, adapted: string): number {
    if (original === adapted) return 0;
    if (!original || !adapted) return 1;

    const origTokens = this.tokenize(original);
    const adaptTokens = this.tokenize(adapted);

    if (origTokens.size === 0 && adaptTokens.size === 0) return 0;
    if (origTokens.size === 0 || adaptTokens.size === 0) return 1;

    // Jaccard distance: 1 - |A ∩ B| / |A ∪ B|
    let intersection = 0;
    for (const token of origTokens) {
      if (adaptTokens.has(token)) intersection++;
    }

    const union = new Set([...origTokens, ...adaptTokens]).size;
    return 1 - (intersection / union);
  }

  // ── Private ───────────────────────────────────────────────────────

  private tokenize(text: string): Set<string> {
    return new Set(
      text.toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(t => t.length > 1)
    );
  }

  private detectPatterns(content: string): string[] {
    const detected: string[] = [];
    for (const pattern of ESCALATION_PATTERNS) {
      if (pattern.test(content)) {
        detected.push(pattern.source.slice(0, 30));
      }
    }
    return detected;
  }
}

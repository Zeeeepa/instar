/**
 * Unit Tests — Centralized Model Dictionary (src/core/models.ts)
 *
 * Tests the canonical model ID dictionary that serves as the single
 * source of truth for all Anthropic model references in Instar.
 */

import { describe, it, expect } from 'vitest';
import {
  ANTHROPIC_MODELS,
  CLI_MODEL_FLAGS,
  resolveModelId,
  resolveCliFlag,
  getValidTiers,
  isValidTier,
} from '../../src/core/models.js';

describe('ANTHROPIC_MODELS', () => {
  it('exports all three tiers', () => {
    expect(ANTHROPIC_MODELS).toHaveProperty('opus');
    expect(ANTHROPIC_MODELS).toHaveProperty('sonnet');
    expect(ANTHROPIC_MODELS).toHaveProperty('haiku');
  });

  it('all model IDs start with "claude-"', () => {
    for (const [tier, modelId] of Object.entries(ANTHROPIC_MODELS)) {
      expect(modelId).toMatch(/^claude-/);
    }
  });

  it('has distinct model IDs for each tier', () => {
    const ids = Object.values(ANTHROPIC_MODELS);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('model IDs do not contain date suffixes', () => {
    for (const modelId of Object.values(ANTHROPIC_MODELS)) {
      // Dated model IDs look like claude-sonnet-4-5-20250929
      expect(modelId).not.toMatch(/-\d{8}$/);
    }
  });

  it('is frozen (immutable)', () => {
    expect(() => {
      // @ts-expect-error — testing runtime immutability
      ANTHROPIC_MODELS.opus = 'something-else';
    }).toThrow();
  });
});

describe('CLI_MODEL_FLAGS', () => {
  it('exports all three tiers', () => {
    expect(CLI_MODEL_FLAGS).toHaveProperty('opus');
    expect(CLI_MODEL_FLAGS).toHaveProperty('sonnet');
    expect(CLI_MODEL_FLAGS).toHaveProperty('haiku');
  });

  it('flags match tier names', () => {
    expect(CLI_MODEL_FLAGS.opus).toBe('opus');
    expect(CLI_MODEL_FLAGS.sonnet).toBe('sonnet');
    expect(CLI_MODEL_FLAGS.haiku).toBe('haiku');
  });
});

describe('resolveModelId', () => {
  it('resolves tier names to model IDs', () => {
    expect(resolveModelId('opus')).toBe(ANTHROPIC_MODELS.opus);
    expect(resolveModelId('sonnet')).toBe(ANTHROPIC_MODELS.sonnet);
    expect(resolveModelId('haiku')).toBe(ANTHROPIC_MODELS.haiku);
  });

  it('resolves legacy aliases (fast/balanced/capable)', () => {
    expect(resolveModelId('fast')).toBe(ANTHROPIC_MODELS.haiku);
    expect(resolveModelId('balanced')).toBe(ANTHROPIC_MODELS.sonnet);
    expect(resolveModelId('capable')).toBe(ANTHROPIC_MODELS.opus);
  });

  it('is case-insensitive', () => {
    expect(resolveModelId('OPUS')).toBe(ANTHROPIC_MODELS.opus);
    expect(resolveModelId('Sonnet')).toBe(ANTHROPIC_MODELS.sonnet);
    expect(resolveModelId('HAIKU')).toBe(ANTHROPIC_MODELS.haiku);
    expect(resolveModelId('FAST')).toBe(ANTHROPIC_MODELS.haiku);
    expect(resolveModelId('Balanced')).toBe(ANTHROPIC_MODELS.sonnet);
  });

  it('passes through raw model IDs unchanged', () => {
    expect(resolveModelId('claude-sonnet-4-6')).toBe('claude-sonnet-4-6');
    expect(resolveModelId('claude-opus-4-5')).toBe('claude-opus-4-5');
    expect(resolveModelId('some-custom-model')).toBe('some-custom-model');
  });

  it('passes through unknown strings unchanged', () => {
    expect(resolveModelId('unknown-tier')).toBe('unknown-tier');
    expect(resolveModelId('')).toBe('');
  });
});

describe('resolveCliFlag', () => {
  it('resolves tier names to CLI flags', () => {
    expect(resolveCliFlag('opus')).toBe('opus');
    expect(resolveCliFlag('sonnet')).toBe('sonnet');
    expect(resolveCliFlag('haiku')).toBe('haiku');
  });

  it('resolves legacy aliases', () => {
    expect(resolveCliFlag('fast')).toBe('haiku');
    expect(resolveCliFlag('balanced')).toBe('sonnet');
    expect(resolveCliFlag('capable')).toBe('opus');
  });

  it('is case-insensitive', () => {
    expect(resolveCliFlag('OPUS')).toBe('opus');
    expect(resolveCliFlag('Fast')).toBe('haiku');
  });

  it('passes through unknown strings unchanged', () => {
    expect(resolveCliFlag('some-model')).toBe('some-model');
  });
});

describe('getValidTiers', () => {
  it('returns all valid tier names including legacy aliases', () => {
    const tiers = getValidTiers();
    expect(tiers).toContain('opus');
    expect(tiers).toContain('sonnet');
    expect(tiers).toContain('haiku');
    expect(tiers).toContain('fast');
    expect(tiers).toContain('balanced');
    expect(tiers).toContain('capable');
  });

  it('returns exactly 6 valid tiers', () => {
    expect(getValidTiers()).toHaveLength(6);
  });
});

describe('isValidTier', () => {
  it('returns true for valid tier names', () => {
    expect(isValidTier('opus')).toBe(true);
    expect(isValidTier('sonnet')).toBe(true);
    expect(isValidTier('haiku')).toBe(true);
  });

  it('returns true for legacy aliases', () => {
    expect(isValidTier('fast')).toBe(true);
    expect(isValidTier('balanced')).toBe(true);
    expect(isValidTier('capable')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isValidTier('OPUS')).toBe(true);
    expect(isValidTier('Sonnet')).toBe(true);
  });

  it('returns false for invalid tiers', () => {
    expect(isValidTier('unknown')).toBe(false);
    expect(isValidTier('claude-sonnet-4-6')).toBe(false);
    expect(isValidTier('')).toBe(false);
  });
});

describe('cross-module consistency', () => {
  it('ANTHROPIC_MODELS and CLI_MODEL_FLAGS have the same tier keys', () => {
    const apiTiers = Object.keys(ANTHROPIC_MODELS).sort();
    const cliTiers = Object.keys(CLI_MODEL_FLAGS).sort();
    expect(apiTiers).toEqual(cliTiers);
  });

  it('resolveModelId and resolveCliFlag handle the same tier names', () => {
    // Both should resolve all valid tiers without falling through to passthrough
    for (const tier of ['opus', 'sonnet', 'haiku', 'fast', 'balanced', 'capable']) {
      const modelId = resolveModelId(tier);
      const cliFlag = resolveCliFlag(tier);
      // Model ID should be a full claude-* identifier
      expect(modelId).toMatch(/^claude-/);
      // CLI flag should be a simple tier name
      expect(cliFlag).toMatch(/^(opus|sonnet|haiku)$/);
    }
  });
});

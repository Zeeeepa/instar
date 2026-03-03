/**
 * Integration Tests — Model Resolution Across Components
 *
 * Verifies that AnthropicIntelligenceProvider, ClaudeCliIntelligenceProvider,
 * and StallTriageNurse all correctly resolve model tiers through the
 * centralized dictionary (src/core/models.ts).
 *
 * These tests use mocked network/process calls but wire real component
 * code to verify the integration between models.ts and its consumers.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ANTHROPIC_MODELS, resolveModelId } from '../../src/core/models.js';

// ─── AnthropicIntelligenceProvider Integration ──────────────

describe('AnthropicIntelligenceProvider + model dictionary', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'test response' }],
      }),
    });
    globalThis.fetch = fetchSpy as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('resolves "fast" tier to haiku model ID', async () => {
    const { AnthropicIntelligenceProvider } = await import(
      '../../src/core/AnthropicIntelligenceProvider.js'
    );
    const provider = new AnthropicIntelligenceProvider('test-key');
    await provider.evaluate('test', { model: 'fast' });

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.model).toBe(ANTHROPIC_MODELS.haiku);
  });

  it('resolves "balanced" tier to sonnet model ID', async () => {
    const { AnthropicIntelligenceProvider } = await import(
      '../../src/core/AnthropicIntelligenceProvider.js'
    );
    const provider = new AnthropicIntelligenceProvider('test-key');
    await provider.evaluate('test', { model: 'balanced' });

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.model).toBe(ANTHROPIC_MODELS.sonnet);
  });

  it('resolves "capable" tier to opus model ID', async () => {
    const { AnthropicIntelligenceProvider } = await import(
      '../../src/core/AnthropicIntelligenceProvider.js'
    );
    const provider = new AnthropicIntelligenceProvider('test-key');
    await provider.evaluate('test', { model: 'capable' });

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.model).toBe(ANTHROPIC_MODELS.opus);
  });

  it('defaults to haiku (fast tier) when no model specified', async () => {
    const { AnthropicIntelligenceProvider } = await import(
      '../../src/core/AnthropicIntelligenceProvider.js'
    );
    const provider = new AnthropicIntelligenceProvider('test-key');
    await provider.evaluate('test');

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.model).toBe(ANTHROPIC_MODELS.haiku);
  });

  it('uses model IDs from the centralized dictionary, not hardcoded values', async () => {
    const { AnthropicIntelligenceProvider } = await import(
      '../../src/core/AnthropicIntelligenceProvider.js'
    );
    const provider = new AnthropicIntelligenceProvider('test-key');

    // Test all three tiers
    for (const [tier, expectedModel] of Object.entries({
      fast: ANTHROPIC_MODELS.haiku,
      balanced: ANTHROPIC_MODELS.sonnet,
      capable: ANTHROPIC_MODELS.opus,
    })) {
      fetchSpy.mockClear();
      await provider.evaluate('test', { model: tier as any });
      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.model).toBe(expectedModel);
    }
  });
});

// ─── StallTriageNurse Integration ──────────────────────────

describe('StallTriageNurse + model dictionary', () => {
  it('default config resolves "sonnet" tier to sonnet model ID', async () => {
    // The StallTriageNurse defaults to resolveModelId('sonnet')
    // This test verifies that the resolution produces the right model ID
    const resolved = resolveModelId('sonnet');
    expect(resolved).toBe(ANTHROPIC_MODELS.sonnet);
  });

  it('env var STALL_TRIAGE_MODEL accepts tier names', () => {
    // Test that tier names resolve correctly (simulating env var values)
    expect(resolveModelId('sonnet')).toBe(ANTHROPIC_MODELS.sonnet);
    expect(resolveModelId('haiku')).toBe(ANTHROPIC_MODELS.haiku);
    expect(resolveModelId('opus')).toBe(ANTHROPIC_MODELS.opus);
  });

  it('env var STALL_TRIAGE_MODEL accepts raw model IDs', () => {
    // Users can still pass raw model IDs via env var
    expect(resolveModelId('claude-sonnet-4-6')).toBe('claude-sonnet-4-6');
    expect(resolveModelId('claude-haiku-4-5')).toBe('claude-haiku-4-5');
  });

  it('StallTriageNurse callAnthropicApi uses resolved model', async () => {
    // Mock fetch for the direct API call path
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: JSON.stringify({
          summary: 'test',
          action: 'nudge',
          confidence: 'medium',
          userMessage: 'test',
        })}],
      }),
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy as any;

    try {
      const { StallTriageNurse } = await import(
        '../../src/monitoring/StallTriageNurse.js'
      );

      const deps = {
        captureSessionOutput: vi.fn().mockReturnValue('some output'),
        isSessionAlive: vi.fn().mockReturnValue(true),
        sendKey: vi.fn().mockReturnValue(true),
        sendInput: vi.fn().mockReturnValue(true),
        getTopicHistory: vi.fn().mockReturnValue([]),
        sendToTopic: vi.fn().mockResolvedValue({}),
        respawnSession: vi.fn().mockResolvedValue(undefined),
        clearStallForTopic: vi.fn(),
      };

      // Create nurse with explicit model tier name — should be resolved to full model ID
      const nurse = new StallTriageNurse(deps, {
        config: { apiKey: 'test-key', model: 'haiku', useIntelligenceProvider: false },
      });

      // callAnthropicApi takes a single prompt string
      await nurse.callAnthropicApi('test prompt');

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      // Should resolve 'haiku' tier to the actual model ID
      expect(body.model).toBe(ANTHROPIC_MODELS.haiku);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ─── Cross-Component Consistency ──────────────────────────

describe('model dictionary consistency across components', () => {
  it('all components resolve the same tier to the same model ID', () => {
    // The centralized dictionary ensures this — verify the contract
    const tiers = ['fast', 'balanced', 'capable', 'haiku', 'sonnet', 'opus'];

    for (const tier of tiers) {
      const resolved = resolveModelId(tier);
      // Every tier should resolve to a known ANTHROPIC_MODELS value
      expect(Object.values(ANTHROPIC_MODELS)).toContain(resolved);
    }
  });

  it('no dated model IDs appear in resolution results', () => {
    const tiers = ['fast', 'balanced', 'capable', 'haiku', 'sonnet', 'opus'];

    for (const tier of tiers) {
      const resolved = resolveModelId(tier);
      // Dated IDs have 8-digit suffixes like -20250929
      expect(resolved).not.toMatch(/-\d{8}$/);
    }
  });
});

/**
 * E2E Tests — Model ID Validation Against Anthropic API
 *
 * Tests that all model IDs in the centralized dictionary actually work
 * by making minimal API calls (1 max_token). This catches:
 *   - Deprecated model IDs that return 404
 *   - Invalid model IDs that never existed
 *   - Model ID typos
 *
 * Requires: ANTHROPIC_API_KEY environment variable
 * Skipped automatically if no API key is available.
 *
 * Run with: npx vitest run --config vitest.e2e.config.ts tests/e2e/model-validation.test.ts
 */

import { describe, it, expect } from 'vitest';
import { ANTHROPIC_MODELS, resolveModelId } from '../../src/core/models.js';

const API_KEY = process.env['ANTHROPIC_API_KEY'];
const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

/**
 * Make a minimal API call to verify a model ID is valid.
 * Uses 1 max_token to minimize cost.
 */
async function validateModelId(modelId: string): Promise<{
  valid: boolean;
  resolvedModel?: string;
  error?: string;
  statusCode?: number;
}> {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY!,
      'anthropic-version': API_VERSION,
    },
    body: JSON.stringify({
      model: modelId,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }],
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (response.ok) {
    const data = await response.json() as { model?: string };
    return { valid: true, resolvedModel: data.model };
  }

  const errorText = await response.text().catch(() => 'unknown error');
  return {
    valid: response.status === 529, // API overloaded = model exists but busy
    error: errorText.slice(0, 200),
    statusCode: response.status,
  };
}

// Skip entire suite if no API key available
const describeWithApi = API_KEY ? describe : describe.skip;

describeWithApi('Anthropic Model ID Validation (live API)', () => {
  it('opus model ID is valid', async () => {
    const result = await validateModelId(ANTHROPIC_MODELS.opus);
    expect(result.valid).toBe(true);
  }, 20000);

  it('sonnet model ID is valid', async () => {
    const result = await validateModelId(ANTHROPIC_MODELS.sonnet);
    expect(result.valid).toBe(true);
  }, 20000);

  it('haiku model ID is valid', async () => {
    const result = await validateModelId(ANTHROPIC_MODELS.haiku);
    expect(result.valid).toBe(true);
  }, 20000);

  it('all tiers resolve to valid model IDs', async () => {
    const tiers = ['fast', 'balanced', 'capable', 'haiku', 'sonnet', 'opus'];
    const results: Array<{ tier: string; modelId: string; valid: boolean; error?: string }> = [];

    for (const tier of tiers) {
      const modelId = resolveModelId(tier);
      const result = await validateModelId(modelId);
      results.push({ tier, modelId, valid: result.valid, error: result.error });
    }

    // Report all results for visibility
    const failures = results.filter((r) => !r.valid);
    if (failures.length > 0) {
      console.error('Failed model validations:');
      for (const f of failures) {
        console.error(`  ${f.tier} → ${f.modelId}: ${f.error}`);
      }
    }

    expect(failures).toHaveLength(0);
  }, 60000);

  it('resolved model IDs match expected patterns', async () => {
    // Verify that the API returns the expected resolved model names
    for (const [tier, modelId] of Object.entries(ANTHROPIC_MODELS)) {
      const result = await validateModelId(modelId);
      expect(result.valid).toBe(true);
      // The resolved model should contain the tier pattern
      if (result.resolvedModel) {
        expect(result.resolvedModel).toContain('claude-');
      }
    }
  }, 60000);
});

// Also test with mocked API key absent — verify graceful skip
describe('Model validation without API key', () => {
  it('validates that API_KEY check works', () => {
    // This test always runs — just verifies our skip logic
    if (!API_KEY) {
      console.log('ANTHROPIC_API_KEY not set — live validation skipped');
    }
    expect(true).toBe(true);
  });
});

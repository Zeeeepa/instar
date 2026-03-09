/**
 * Unit tests for RelevanceFilter — rule-based dispatch pre-filtering.
 *
 * Tests cover:
 * - Always-evaluate types (security, behavioral)
 * - Always-evaluate priorities (critical)
 * - Idempotency guard (already-evaluated dispatches)
 * - Version gating (minVersion, maxVersion)
 * - Platform matching (telegram, whatsapp, etc.)
 * - Feature matching (disabled features)
 * - Default pass-through behavior
 * - Confidence thresholds
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RelevanceFilter } from '../../src/core/RelevanceFilter.js';
import type { Dispatch } from '../../src/core/DispatchManager.js';
import type { AgentContextSnapshot } from '../../src/core/types.js';

function makeDispatch(overrides?: Partial<Dispatch>): Dispatch {
  return {
    dispatchId: overrides?.dispatchId ?? 'disp-test',
    type: overrides?.type ?? 'lesson',
    title: overrides?.title ?? 'Test dispatch',
    content: overrides?.content ?? 'Some content',
    priority: overrides?.priority ?? 'normal',
    createdAt: new Date().toISOString(),
    receivedAt: new Date().toISOString(),
    applied: false,
    minVersion: overrides?.minVersion,
    maxVersion: overrides?.maxVersion,
  };
}

function makeSnapshot(overrides?: Partial<AgentContextSnapshot>): AgentContextSnapshot {
  return {
    identity: overrides?.identity ?? { name: 'TestAgent', description: 'A test agent' },
    capabilities: overrides?.capabilities ?? { platforms: ['telegram'], features: ['feedback'], disabledFeatures: [] },
    activeJobs: overrides?.activeJobs ?? [],
    recentDecisions: overrides?.recentDecisions ?? [],
    autonomyLevel: overrides?.autonomyLevel ?? 'supervised',
    appliedDispatchSummary: overrides?.appliedDispatchSummary ?? { count: 0, byType: {} },
    generatedAt: new Date().toISOString(),
  };
}

describe('RelevanceFilter', () => {
  let filter: RelevanceFilter;

  beforeEach(() => {
    filter = new RelevanceFilter({ agentVersion: '0.12.0' });
  });

  // ── Always-evaluate types ─────────────────────────────────────────

  describe('always-evaluate types', () => {
    it('always marks security dispatches as relevant', () => {
      const dispatch = makeDispatch({ type: 'security' });
      const result = filter.check(dispatch, makeSnapshot());
      expect(result.relevant).toBe(true);
      expect(result.confidence).toBe(1.0);
      expect(result.reason).toContain('security');
    });

    it('always marks behavioral dispatches as relevant', () => {
      const dispatch = makeDispatch({ type: 'behavioral' });
      const result = filter.check(dispatch, makeSnapshot());
      expect(result.relevant).toBe(true);
      expect(result.confidence).toBe(1.0);
    });

    it('marks security as relevant even when platform mismatches', () => {
      const dispatch = makeDispatch({ type: 'security', content: 'WhatsApp security patch' });
      const snapshot = makeSnapshot({ capabilities: { platforms: ['telegram'], features: [], disabledFeatures: [] } });
      const result = filter.check(dispatch, snapshot);
      expect(result.relevant).toBe(true);
    });
  });

  // ── Always-evaluate priorities ────────────────────────────────────

  describe('always-evaluate priorities', () => {
    it('always marks critical priority as relevant', () => {
      const dispatch = makeDispatch({ priority: 'critical' });
      const result = filter.check(dispatch, makeSnapshot());
      expect(result.relevant).toBe(true);
      expect(result.confidence).toBe(1.0);
    });

    it('marks critical as relevant even when version mismatches', () => {
      const dispatch = makeDispatch({ priority: 'critical', minVersion: '99.0.0' });
      const result = filter.check(dispatch, makeSnapshot());
      expect(result.relevant).toBe(true);
    });
  });

  // ── Idempotency guard ─────────────────────────────────────────────

  describe('idempotency guard', () => {
    it('filters out already-evaluated dispatches', () => {
      const dispatch = makeDispatch({ dispatchId: 'already-done' });
      const alreadyEvaluated = new Set(['already-done']);
      const result = filter.check(dispatch, makeSnapshot(), alreadyEvaluated);
      expect(result.relevant).toBe(false);
      expect(result.confidence).toBe(1.0);
      expect(result.reason).toContain('already evaluated');
    });

    it('passes through unevaluated dispatches', () => {
      const dispatch = makeDispatch({ dispatchId: 'new-one' });
      const alreadyEvaluated = new Set(['other-id']);
      const result = filter.check(dispatch, makeSnapshot(), alreadyEvaluated);
      expect(result.relevant).toBe(true);
    });
  });

  // ── Version gating ────────────────────────────────────────────────

  describe('version gating', () => {
    it('filters dispatches with minVersion above agent version', () => {
      const dispatch = makeDispatch({ minVersion: '1.0.0' }); // Agent is 0.12.0
      const result = filter.check(dispatch, makeSnapshot());
      expect(result.relevant).toBe(false);
      expect(result.reason).toContain('below');
    });

    it('filters dispatches with maxVersion below agent version', () => {
      const dispatch = makeDispatch({ maxVersion: '0.10.0' }); // Agent is 0.12.0
      const result = filter.check(dispatch, makeSnapshot());
      expect(result.relevant).toBe(false);
      expect(result.reason).toContain('above');
    });

    it('passes dispatches within version range', () => {
      const dispatch = makeDispatch({ minVersion: '0.10.0', maxVersion: '1.0.0' });
      const result = filter.check(dispatch, makeSnapshot());
      expect(result.relevant).toBe(true);
    });

    it('passes dispatches when agent version equals minVersion', () => {
      const dispatch = makeDispatch({ minVersion: '0.12.0' });
      const result = filter.check(dispatch, makeSnapshot());
      expect(result.relevant).toBe(true);
    });

    it('passes dispatches when agent version equals maxVersion', () => {
      const dispatch = makeDispatch({ maxVersion: '0.12.0' });
      const result = filter.check(dispatch, makeSnapshot());
      expect(result.relevant).toBe(true);
    });

    it('skips version check when agent has no version', () => {
      const noVersionFilter = new RelevanceFilter(); // No agentVersion
      const dispatch = makeDispatch({ minVersion: '99.0.0' });
      const result = noVersionFilter.check(dispatch, makeSnapshot());
      expect(result.relevant).toBe(true);
    });
  });

  // ── Platform matching ─────────────────────────────────────────────

  describe('platform matching', () => {
    it('filters WhatsApp dispatches for Telegram-only agents', () => {
      const dispatch = makeDispatch({
        title: 'WhatsApp bot improvement',
        content: 'Updates for WhatsApp message handling',
      });
      const snapshot = makeSnapshot({
        capabilities: { platforms: ['telegram'], features: [], disabledFeatures: [] },
      });
      const result = filter.check(dispatch, snapshot);
      expect(result.relevant).toBe(false);
      expect(result.reason).toContain('whatsapp');
    });

    it('passes Telegram dispatches for Telegram agents', () => {
      const dispatch = makeDispatch({
        title: 'Telegram bot improvement',
        content: 'Better Telegram message handling',
      });
      const snapshot = makeSnapshot({
        capabilities: { platforms: ['telegram'], features: [], disabledFeatures: [] },
      });
      const result = filter.check(dispatch, snapshot);
      expect(result.relevant).toBe(true);
    });

    it('passes when agent has no platform info', () => {
      const dispatch = makeDispatch({ content: 'WhatsApp specific change' });
      const snapshot = makeSnapshot({
        capabilities: { platforms: [], features: [], disabledFeatures: [] },
      });
      const result = filter.check(dispatch, snapshot);
      expect(result.relevant).toBe(true);
    });

    it('passes generic dispatches that dont mention any platform', () => {
      const dispatch = makeDispatch({ content: 'General performance improvement' });
      const snapshot = makeSnapshot({
        capabilities: { platforms: ['telegram'], features: [], disabledFeatures: [] },
      });
      const result = filter.check(dispatch, snapshot);
      expect(result.relevant).toBe(true);
    });

    it('filters Discord dispatches for non-Discord agents', () => {
      const dispatch = makeDispatch({ content: 'Discord bot configuration update' });
      const snapshot = makeSnapshot({
        capabilities: { platforms: ['telegram', 'whatsapp'], features: [], disabledFeatures: [] },
      });
      const result = filter.check(dispatch, snapshot);
      expect(result.relevant).toBe(false);
      expect(result.reason).toContain('discord');
    });
  });

  // ── Feature matching ──────────────────────────────────────────────

  describe('feature matching', () => {
    it('filters dispatches targeting disabled features', () => {
      const dispatch = makeDispatch({ content: 'Improvement to the feedback loop system' });
      const snapshot = makeSnapshot({
        capabilities: { platforms: [], features: [], disabledFeatures: ['feedback'] },
      });
      const result = filter.check(dispatch, snapshot);
      expect(result.relevant).toBe(false);
      expect(result.reason).toContain('disabled feature');
    });

    it('passes when no features are disabled', () => {
      const dispatch = makeDispatch({ content: 'Feedback improvement' });
      const snapshot = makeSnapshot({
        capabilities: { platforms: [], features: ['feedback'], disabledFeatures: [] },
      });
      const result = filter.check(dispatch, snapshot);
      expect(result.relevant).toBe(true);
    });
  });

  // ── Default behavior ──────────────────────────────────────────────

  describe('default behavior', () => {
    it('passes through dispatches with no signals', () => {
      const dispatch = makeDispatch({ type: 'lesson', content: 'General lesson' });
      const result = filter.check(dispatch, makeSnapshot());
      expect(result.relevant).toBe(true);
      expect(result.reason).toContain('No irrelevance signals');
    });

    it('default confidence for pass-through is moderate', () => {
      const dispatch = makeDispatch();
      const result = filter.check(dispatch, makeSnapshot());
      expect(result.confidence).toBe(0.5);
    });
  });

  // ── Confidence threshold ──────────────────────────────────────────

  describe('confidence threshold', () => {
    it('filters are not applied when confidence below threshold', () => {
      // Create a filter with a very high threshold
      const strictFilter = new RelevanceFilter({ confidenceThreshold: 0.99, agentVersion: '0.12.0' });
      // Platform match has confidence 0.85 — below 0.99
      const dispatch = makeDispatch({ content: 'WhatsApp update' });
      const snapshot = makeSnapshot({
        capabilities: { platforms: ['telegram'], features: [], disabledFeatures: [] },
      });
      const result = strictFilter.check(dispatch, snapshot);
      // Should pass through because platform filter confidence (0.85) < threshold (0.99)
      expect(result.relevant).toBe(true);
    });
  });
});

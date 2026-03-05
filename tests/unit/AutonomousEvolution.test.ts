import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createTempProject } from '../helpers/setup.js';
import type { TempProject } from '../helpers/setup.js';
import { AutonomousEvolution } from '../../src/core/AutonomousEvolution.js';
import type { ReviewResult, EvolutionNotification } from '../../src/core/AutonomousEvolution.js';
import type { EvolutionProposal } from '../../src/core/types.js';

function makeProposal(overrides: Partial<EvolutionProposal> = {}): EvolutionProposal {
  return {
    id: 'EVO-001',
    title: 'Test proposal',
    source: 'test',
    description: 'A test evolution proposal',
    type: 'capability',
    impact: 'medium',
    effort: 'low',
    status: 'proposed',
    proposedBy: 'agent',
    proposedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeReview(overrides: Partial<ReviewResult> = {}): ReviewResult {
  return {
    decision: 'approve',
    reason: 'Looks good',
    affectedFields: ['definedSteps'],
    confidence: 0.9,
    ...overrides,
  };
}

describe('AutonomousEvolution', () => {
  let project: TempProject;

  beforeEach(() => {
    project = createTempProject();
  });

  afterEach(() => {
    project.cleanup();
  });

  // ── Scope Classification ───────────────────────────────────────

  describe('classifyScope', () => {
    it('classifies safe fields', () => {
      const ae = new AutonomousEvolution({ stateDir: project.stateDir });
      expect(ae.classifyScope(['definedSteps'])).toBe('safe');
      expect(ae.classifyScope(['description'])).toBe('safe');
      expect(ae.classifyScope(['name', 'tags'])).toBe('safe');
      expect(ae.classifyScope(['learnings'])).toBe('safe');
    });

    it('classifies unsafe fields', () => {
      const ae = new AutonomousEvolution({ stateDir: project.stateDir });
      expect(ae.classifyScope(['schedule'])).toBe('unsafe');
      expect(ae.classifyScope(['model'])).toBe('unsafe');
      expect(ae.classifyScope(['priority'])).toBe('unsafe');
      expect(ae.classifyScope(['execute'])).toBe('unsafe');
      expect(ae.classifyScope(['gate'])).toBe('unsafe');
      expect(ae.classifyScope(['enabled'])).toBe('unsafe');
    });

    it('classifies mixed fields', () => {
      const ae = new AutonomousEvolution({ stateDir: project.stateDir });
      expect(ae.classifyScope(['definedSteps', 'schedule'])).toBe('mixed');
      expect(ae.classifyScope(['description', 'model'])).toBe('mixed');
    });

    it('classifies empty as safe', () => {
      const ae = new AutonomousEvolution({ stateDir: project.stateDir });
      expect(ae.classifyScope([])).toBe('safe');
    });
  });

  // ── Auto-Implementation Evaluation ─────────────────────────────

  describe('evaluateForAutoImplementation', () => {
    it('auto-implements safe changes in autonomous mode', () => {
      const ae = new AutonomousEvolution({ stateDir: project.stateDir });
      const result = ae.evaluateForAutoImplementation(
        makeReview({ affectedFields: ['definedSteps'], confidence: 0.9 }),
        true,
      );
      expect(result.action).toBe('auto-implement');
    });

    it('queues unsafe changes even in autonomous mode', () => {
      const ae = new AutonomousEvolution({ stateDir: project.stateDir });
      const result = ae.evaluateForAutoImplementation(
        makeReview({ affectedFields: ['schedule'] }),
        true,
      );
      expect(result.action).toBe('queue-for-approval');
      expect(result.reason).toContain('schedule');
    });

    it('queues mixed changes for approval', () => {
      const ae = new AutonomousEvolution({ stateDir: project.stateDir });
      const result = ae.evaluateForAutoImplementation(
        makeReview({ affectedFields: ['definedSteps', 'model'] }),
        true,
      );
      expect(result.action).toBe('queue-for-approval');
      expect(result.reason).toContain('restricted');
    });

    it('queues all changes when not in autonomous mode', () => {
      const ae = new AutonomousEvolution({ stateDir: project.stateDir });
      const result = ae.evaluateForAutoImplementation(
        makeReview({ affectedFields: ['definedSteps'] }),
        false,
      );
      expect(result.action).toBe('queue-for-approval');
      expect(result.reason).toContain('ai-assisted');
    });

    it('rejects when review rejects', () => {
      const ae = new AutonomousEvolution({ stateDir: project.stateDir });
      const result = ae.evaluateForAutoImplementation(
        makeReview({ decision: 'reject', reason: 'Too risky' }),
        true,
      );
      expect(result.action).toBe('reject');
    });

    it('flags needs-review when review is uncertain', () => {
      const ae = new AutonomousEvolution({ stateDir: project.stateDir });
      const result = ae.evaluateForAutoImplementation(
        makeReview({ decision: 'needs-review', reason: 'Uncertain impact' }),
        true,
      );
      expect(result.action).toBe('needs-review');
    });
  });

  // ── Sidecar Management ─────────────────────────────────────────

  describe('sidecar management', () => {
    it('creates a sidecar file', () => {
      const ae = new AutonomousEvolution({ stateDir: project.stateDir });
      const sidecar = ae.createSidecar('health-check', 'EVO-001', { definedSteps: ['check-redis'] });

      expect(sidecar.jobSlug).toBe('health-check');
      expect(sidecar.proposalId).toBe('EVO-001');
      expect(sidecar.appliedAt).toBeNull();
      expect(sidecar.reverted).toBe(false);

      // Verify sidecar file exists on disk
      const sidecarPath = path.join(project.stateDir, 'state', 'jobs', 'health-check.proposed-changes.json');
      expect(fs.existsSync(sidecarPath)).toBe(true);
    });

    it('lists pending sidecars', () => {
      const ae = new AutonomousEvolution({ stateDir: project.stateDir });
      ae.createSidecar('job-a', 'EVO-001', { definedSteps: ['step1'] });
      ae.createSidecar('job-b', 'EVO-002', { description: 'updated' });

      expect(ae.getPendingSidecars()).toHaveLength(2);
      expect(ae.getPendingSidecars('job-a')).toHaveLength(1);
    });

    it('applies a sidecar', () => {
      const ae = new AutonomousEvolution({ stateDir: project.stateDir });
      ae.createSidecar('health-check', 'EVO-001', { definedSteps: ['step1'] });

      const success = ae.applySidecar('EVO-001');
      expect(success).toBe(true);
      expect(ae.getPendingSidecars()).toHaveLength(0);
      expect(ae.getAppliedSidecars()).toHaveLength(1);
      expect(ae.getAppliedSidecars()[0].appliedAt).toBeTruthy();
    });

    it('reverts an applied sidecar', () => {
      const ae = new AutonomousEvolution({ stateDir: project.stateDir });
      ae.createSidecar('health-check', 'EVO-001', { definedSteps: ['step1'] });
      ae.applySidecar('EVO-001');

      const success = ae.revertSidecar('EVO-001');
      expect(success).toBe(true);
      expect(ae.getAppliedSidecars()).toHaveLength(0); // filtered out (reverted)
      expect(ae.getRevertedSidecars()).toHaveLength(1);
      expect(ae.getRevertedSidecars()[0].revertedAt).toBeTruthy();

      // Sidecar file should be removed
      const sidecarPath = path.join(project.stateDir, 'state', 'jobs', 'health-check.proposed-changes.json');
      expect(fs.existsSync(sidecarPath)).toBe(false);
    });

    it('returns false for non-existent revert', () => {
      const ae = new AutonomousEvolution({ stateDir: project.stateDir });
      expect(ae.revertSidecar('EVO-NONEXISTENT')).toBe(false);
    });

    it('returns false for non-existent apply', () => {
      const ae = new AutonomousEvolution({ stateDir: project.stateDir });
      expect(ae.applySidecar('EVO-NONEXISTENT')).toBe(false);
    });

    it('loads sidecar from disk', () => {
      const ae = new AutonomousEvolution({ stateDir: project.stateDir });
      ae.createSidecar('health-check', 'EVO-001', { definedSteps: ['redis-check'] });

      const loaded = ae.loadSidecarForJob('health-check');
      expect(loaded).toEqual({ definedSteps: ['redis-check'] });
    });

    it('returns null for non-existent sidecar file', () => {
      const ae = new AutonomousEvolution({ stateDir: project.stateDir });
      expect(ae.loadSidecarForJob('nonexistent-job')).toBeNull();
    });
  });

  // ── Notification Contract ──────────────────────────────────────

  describe('notification contract', () => {
    it('creates and queues notifications', () => {
      const ae = new AutonomousEvolution({ stateDir: project.stateDir });
      const proposal = makeProposal();
      const review = makeReview();

      ae.createNotification(proposal, 'auto-implemented', review, 'Applied definedSteps change');

      const pending = ae.peekNotifications();
      expect(pending).toHaveLength(1);
      expect(pending[0].action).toBe('auto-implemented');
      expect(pending[0].proposalId).toBe('EVO-001');
    });

    it('drains notifications', () => {
      const ae = new AutonomousEvolution({ stateDir: project.stateDir });
      ae.createNotification(makeProposal(), 'auto-implemented', makeReview(), 'Test');
      ae.createNotification(makeProposal({ id: 'EVO-002' }), 'rejected', makeReview({ decision: 'reject' }), 'Rejected');

      const drained = ae.drainNotifications();
      expect(drained).toHaveLength(2);
      expect(ae.peekNotifications()).toHaveLength(0);
      expect(ae.getNotificationHistory()).toHaveLength(2);
    });

    it('draining is idempotent', () => {
      const ae = new AutonomousEvolution({ stateDir: project.stateDir });
      ae.createNotification(makeProposal(), 'auto-implemented', makeReview(), 'Test');

      ae.drainNotifications();
      const second = ae.drainNotifications();
      expect(second).toHaveLength(0);
    });

    it('trims notification history to 200', () => {
      const ae = new AutonomousEvolution({ stateDir: project.stateDir });

      for (let i = 0; i < 210; i++) {
        ae.createNotification(
          makeProposal({ id: `EVO-${i}` }),
          'auto-implemented',
          makeReview(),
          `Change ${i}`,
        );
      }
      ae.drainNotifications();

      expect(ae.getNotificationHistory(300).length).toBeLessThanOrEqual(200);
    });
  });

  // ── Notification Formatting ────────────────────────────────────

  describe('notification formatting', () => {
    it('formats auto-implemented notification', () => {
      const ae = new AutonomousEvolution({ stateDir: project.stateDir });
      const notification: EvolutionNotification = {
        proposalId: 'EVO-052',
        title: 'Add redis check',
        action: 'auto-implemented',
        source: 'pattern detection',
        confidence: 0.87,
        scope: 'safe',
        timestamp: new Date().toISOString(),
        details: 'Added "check-redis" to health-check job',
      };

      const msg = ae.formatNotification(notification);
      expect(msg).toContain('Self-Evolution Applied');
      expect(msg).toContain('EVO-052');
      expect(msg).toContain('Add redis check');
      expect(msg).toContain('87%');
      expect(msg).toContain('undo EVO-052');
    });

    it('formats rejected notification', () => {
      const ae = new AutonomousEvolution({ stateDir: project.stateDir });
      const notification: EvolutionNotification = {
        proposalId: 'EVO-053',
        title: 'Remove safety check',
        action: 'rejected',
        source: 'test',
        confidence: 0.3,
        scope: 'unsafe',
        timestamp: new Date().toISOString(),
        details: 'Too risky — removes safety guard',
      };

      const msg = ae.formatNotification(notification);
      expect(msg).toContain('Evolution Rejected');
      expect(msg).toContain('Too risky');
    });

    it('formats needs-review notification', () => {
      const ae = new AutonomousEvolution({ stateDir: project.stateDir });
      const notification: EvolutionNotification = {
        proposalId: 'EVO-054',
        title: 'Refactor dispatch',
        action: 'needs-review',
        source: 'test',
        confidence: 0.5,
        scope: 'mixed',
        timestamp: new Date().toISOString(),
        details: 'Impact unclear — needs human evaluation',
      };

      const msg = ae.formatNotification(notification);
      expect(msg).toContain('Needs Review');
      expect(msg).toContain('approve EVO-054');
      expect(msg).toContain('reject EVO-054');
    });

    it('formats reverted notification', () => {
      const ae = new AutonomousEvolution({ stateDir: project.stateDir });
      const notification: EvolutionNotification = {
        proposalId: 'EVO-055',
        title: 'Add logging step',
        action: 'reverted',
        source: 'test',
        confidence: 0.9,
        scope: 'safe',
        timestamp: new Date().toISOString(),
        details: 'Operator requested revert',
      };

      const msg = ae.formatNotification(notification);
      expect(msg).toContain('Evolution Reverted');
      expect(msg).toContain('Original behavior restored');
    });

    it('formats digest for multiple notifications', () => {
      const ae = new AutonomousEvolution({ stateDir: project.stateDir });
      const notifications: EvolutionNotification[] = [
        { proposalId: 'EVO-001', title: 'First', action: 'auto-implemented', source: 'test', confidence: 0.9, scope: 'safe', timestamp: new Date().toISOString(), details: 'test' },
        { proposalId: 'EVO-002', title: 'Second', action: 'rejected', source: 'test', confidence: 0.3, scope: 'unsafe', timestamp: new Date().toISOString(), details: 'test' },
        { proposalId: 'EVO-003', title: 'Third', action: 'needs-review', source: 'test', confidence: 0.5, scope: 'mixed', timestamp: new Date().toISOString(), details: 'test' },
      ];

      const digest = ae.formatDigest(notifications);
      expect(digest).toContain('Evolution Digest (3 items)');
      expect(digest).toContain('Applied: EVO-001');
      expect(digest).toContain('Rejected: EVO-002');
      expect(digest).toContain('Needs Review: EVO-003');
      expect(digest).toContain('1 item(s) need your review');
    });

    it('returns empty string for empty digest', () => {
      const ae = new AutonomousEvolution({ stateDir: project.stateDir });
      expect(ae.formatDigest([])).toBe('');
    });
  });

  // ── Dashboard ──────────────────────────────────────────────────

  describe('getDashboard', () => {
    it('returns complete dashboard', () => {
      const ae = new AutonomousEvolution({ stateDir: project.stateDir });
      ae.createSidecar('job-a', 'EVO-001', { definedSteps: ['step1'] });
      ae.createNotification(makeProposal(), 'auto-implemented', makeReview(), 'Test');

      const dashboard = ae.getDashboard();
      expect(dashboard.enabled).toBe(true);
      expect(dashboard.pendingSidecars).toHaveLength(1);
      expect(dashboard.appliedSidecars).toEqual([]);
      expect(dashboard.revertedSidecars).toEqual([]);
      expect(dashboard.notificationQueue).toHaveLength(1);
      expect(dashboard.lastUpdated).toBeTruthy();
    });
  });

  // ── Persistence ────────────────────────────────────────────────

  describe('persistence', () => {
    it('persists state across instances', () => {
      const ae1 = new AutonomousEvolution({ stateDir: project.stateDir });
      ae1.createSidecar('job-a', 'EVO-001', { definedSteps: ['step1'] });
      ae1.applySidecar('EVO-001');
      ae1.createNotification(makeProposal(), 'auto-implemented', makeReview(), 'Persisted');
      ae1.drainNotifications();

      const ae2 = new AutonomousEvolution({ stateDir: project.stateDir });
      expect(ae2.getAppliedSidecars()).toHaveLength(1);
      expect(ae2.getNotificationHistory()).toHaveLength(1);
    });

    it('recovers from corrupt state', () => {
      const statePath = path.join(project.stateDir, 'state', 'autonomous-evolution.json');
      fs.mkdirSync(path.dirname(statePath), { recursive: true });
      fs.writeFileSync(statePath, 'not valid json!!!');

      const ae = new AutonomousEvolution({ stateDir: project.stateDir });
      expect(ae.getPendingSidecars()).toEqual([]);
    });
  });
});

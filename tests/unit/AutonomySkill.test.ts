import { describe, it, expect, beforeEach } from 'vitest';
import { AutonomySkill } from '../../src/core/AutonomySkill.js';
import type { AutonomySkillDeps } from '../../src/core/AutonomySkill.js';
import type { AutonomyProfileLevel, ResolvedAutonomyState, NotificationPreferences } from '../../src/core/types.js';
import type { TrustElevationSuggestion } from '../../src/core/AdaptiveTrust.js';

// ── Mock AutonomyProfileManager ──────────────────────────────────────

function createMockManager(opts?: {
  profile?: AutonomyProfileLevel;
  elevations?: TrustElevationSuggestion[];
  history?: Array<{ from: AutonomyProfileLevel; to: AutonomyProfileLevel; at: string; reason: string }>;
}) {
  let currentProfile: AutonomyProfileLevel = opts?.profile ?? 'collaborative';
  const history = opts?.history ?? [];
  const elevations = opts?.elevations ?? [];

  const resolveState = (profile: AutonomyProfileLevel): ResolvedAutonomyState => {
    const defaults: Record<AutonomyProfileLevel, ResolvedAutonomyState> = {
      cautious: {
        profile: 'cautious',
        evolutionApprovalMode: 'ai-assisted',
        safetyLevel: 1,
        agentAutonomyLevel: 'supervised',
        autoApplyUpdates: false,
        autoRestart: false,
        trustAutoElevate: false,
      },
      supervised: {
        profile: 'supervised',
        evolutionApprovalMode: 'ai-assisted',
        safetyLevel: 1,
        agentAutonomyLevel: 'supervised',
        autoApplyUpdates: true,
        autoRestart: false,
        trustAutoElevate: true,
      },
      collaborative: {
        profile: 'collaborative',
        evolutionApprovalMode: 'ai-assisted',
        safetyLevel: 1,
        agentAutonomyLevel: 'collaborative',
        autoApplyUpdates: true,
        autoRestart: true,
        trustAutoElevate: true,
      },
      autonomous: {
        profile: 'autonomous',
        evolutionApprovalMode: 'autonomous',
        safetyLevel: 2,
        agentAutonomyLevel: 'autonomous',
        autoApplyUpdates: true,
        autoRestart: true,
        trustAutoElevate: true,
      },
    };
    return defaults[profile];
  };

  return {
    getProfile: () => currentProfile,
    getResolvedState: () => resolveState(currentProfile),
    setProfile: (level: AutonomyProfileLevel, reason: string) => {
      history.push({ from: currentProfile, to: level, at: new Date().toISOString(), reason });
      currentProfile = level;
      return resolveState(level);
    },
    getNaturalLanguageSummary: () => {
      const lines = [`Profile: ${currentProfile}`];
      if (elevations.length > 0) {
        lines.push('');
        lines.push('Elevation opportunities:');
        for (const e of elevations) {
          lines.push(`  ${e.service} ${e.operation}: ${e.currentLevel} -> ${e.suggestedLevel} (${e.reason})`);
        }
      }
      return lines.join('\n');
    },
    getPendingElevations: () => elevations,
    getNotificationPreferences: (): NotificationPreferences => ({
      evolutionDigest: 'immediate',
      trustElevationSuggestions: true,
      migrationNotifications: true,
    }),
    setNotificationPreferences: () => {},
    getHistory: () => history,
    getDashboard: () => ({
      profile: currentProfile,
      resolved: resolveState(currentProfile),
      summary: `Profile: ${currentProfile}`,
      elevations,
      notifications: { evolutionDigest: 'immediate' as const, trustElevationSuggestions: true, migrationNotifications: true },
      history: history.slice(-10),
      availableProfiles: [
        { level: 'cautious' as const, description: 'I want to see and approve everything' },
        { level: 'supervised' as const, description: 'Handle routine stuff, ask me about important things' },
        { level: 'collaborative' as const, description: 'Work together' },
        { level: 'autonomous' as const, description: 'Handle everything yourself' },
      ],
    }),
    // For testing: read the current profile
    _getProfile: () => currentProfile,
    _getHistory: () => history,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('AutonomySkill', () => {
  let skill: AutonomySkill;
  let mockManager: ReturnType<typeof createMockManager>;

  beforeEach(() => {
    mockManager = createMockManager({ profile: 'collaborative' });
    skill = new AutonomySkill({
      autonomyManager: mockManager as any,
    });
  });

  // ── getAutonomyStatus ────────────────────────────────────────────

  describe('getAutonomyStatus', () => {
    it('returns natural language summary with current profile', () => {
      const result = skill.getAutonomyStatus();
      expect(result.action).toBe('status');
      expect(result.text).toContain('collaborative');
      expect(result.text).toContain('We work together');
      expect(result.resolved?.profile).toBe('collaborative');
    });

    it('includes elevation opportunities when present', () => {
      mockManager = createMockManager({
        profile: 'supervised',
        elevations: [{
          service: 'email',
          operation: 'read',
          currentLevel: 'approve-always',
          suggestedLevel: 'log',
          reason: '5 successful reads',
          streak: 5,
        }],
      });
      skill = new AutonomySkill({ autonomyManager: mockManager as any });

      const result = skill.getAutonomyStatus();
      expect(result.text).toContain('elevation');
      expect(result.text).toContain('email');
    });

    it('describes cautious profile accurately', () => {
      mockManager = createMockManager({ profile: 'cautious' });
      skill = new AutonomySkill({ autonomyManager: mockManager as any });

      const result = skill.getAutonomyStatus();
      expect(result.text).toContain('approve everything');
      expect(result.text).toContain('Maximum control');
    });
  });

  // ── setAutonomyProfile ───────────────────────────────────────────

  describe('setAutonomyProfile', () => {
    it('changes profile and returns confirmation', () => {
      const result = skill.setAutonomyProfile('autonomous');
      expect(result.action).toBe('set-profile');
      expect(result.newProfile).toBe('autonomous');
      expect(result.text).toContain('collaborative -> autonomous');
      expect(result.text).toContain('Full autonomy');
    });

    it('reports what changed concretely', () => {
      const result = skill.setAutonomyProfile('autonomous');
      expect(result.text).toContain('Evolution:');
      expect(result.text).toContain('Safety:');
      expect(result.text).toContain('Updates:');
      expect(result.text).toContain('Trust:');
    });

    it('handles no-op (already on that profile)', () => {
      const result = skill.setAutonomyProfile('collaborative');
      expect(result.text).toContain('already on');
      expect(result.newProfile).toBe('collaborative');
    });

    it('indicates direction when decreasing autonomy', () => {
      const result = skill.setAutonomyProfile('cautious');
      expect(result.text).toContain('checking with you more often');
    });

    it('includes risk note when increasing autonomy', () => {
      const result = skill.setAutonomyProfile('autonomous');
      expect(result.text).toContain('Highest autonomy');
    });

    it('records history entry via manager', () => {
      skill.setAutonomyProfile('autonomous');
      expect(mockManager._getHistory().length).toBe(1);
      expect(mockManager._getHistory()[0].from).toBe('collaborative');
      expect(mockManager._getHistory()[0].to).toBe('autonomous');
    });
  });

  // ── handleAutonomyRequest (intent classification) ────────────────

  describe('handleAutonomyRequest', () => {
    describe('status queries', () => {
      const statusPhrases = [
        "What's my autonomy setup?",
        'Show me autonomy status',
        'How autonomous are you?',
        'What can you handle on your own?',
        'Current autonomy settings',
        'How much freedom do you have?',
      ];

      for (const phrase of statusPhrases) {
        it(`recognizes "${phrase}" as status query`, () => {
          const result = skill.handleAutonomyRequest(phrase);
          expect(result.action).toBe('status');
        });
      }
    });

    describe('go autonomous', () => {
      const autonomousPhrases = [
        'Go fully autonomous',
        'Handle everything yourself',
        'I trust you completely',
        "Don't need to ask me about anything",
        'Maximum autonomy',
        'Set autonomous',
        'Full autonomy please',
      ];

      for (const phrase of autonomousPhrases) {
        it(`recognizes "${phrase}" as set-profile autonomous`, () => {
          const result = skill.handleAutonomyRequest(phrase);
          expect(result.action).toBe('set-profile');
          expect(result.newProfile).toBe('autonomous');
        });
      }
    });

    describe('go cautious', () => {
      const cautiousPhrases = [
        'I want to approve everything myself',
        'Supervise everything',
        'Ask me about everything',
        'No autonomy',
        'Lock it down',
        'Maximum control',
        'Go cautious',
      ];

      for (const phrase of cautiousPhrases) {
        it(`recognizes "${phrase}" as set-profile cautious`, () => {
          const result = skill.handleAutonomyRequest(phrase);
          expect(result.action).toBe('set-profile');
          expect(result.newProfile).toBe('cautious');
        });
      }
    });

    describe('go collaborative', () => {
      it('recognizes "work together" as collaborative', () => {
        const result = skill.handleAutonomyRequest('Let\'s work together');
        expect(result.action).toBe('set-profile');
        expect(result.newProfile).toBe('collaborative');
      });

      it('recognizes "I trust your judgment"', () => {
        const result = skill.handleAutonomyRequest('I trust your judgment on most things');
        expect(result.action).toBe('set-profile');
        expect(result.newProfile).toBe('collaborative');
      });
    });

    describe('go supervised', () => {
      it('recognizes "handle routine" as supervised', () => {
        const result = skill.handleAutonomyRequest('Handle the routine stuff');
        expect(result.action).toBe('set-profile');
        expect(result.newProfile).toBe('supervised');
      });

      it('recognizes "ask me about important things"', () => {
        const result = skill.handleAutonomyRequest('Ask me about important things only');
        expect(result.action).toBe('set-profile');
        expect(result.newProfile).toBe('supervised');
      });
    });

    describe('elevation suggestion', () => {
      const elevationPhrases = [
        'Make yourself more autonomous',
        'Less oversight please',
        'Less friction',
        'Increase your autonomy',
        'Next level',
      ];

      for (const phrase of elevationPhrases) {
        it(`recognizes "${phrase}" as suggest-elevation`, () => {
          const result = skill.handleAutonomyRequest(phrase);
          expect(result.action).toBe('suggest-elevation');
        });
      }

      it('suggests the next profile up', () => {
        mockManager = createMockManager({ profile: 'supervised' });
        skill = new AutonomySkill({ autonomyManager: mockManager as any });

        const result = skill.handleAutonomyRequest('Make yourself more autonomous');
        expect(result.text).toContain('collaborative');
        expect(result.text).toContain('next level');
      });

      it('handles already at max', () => {
        mockManager = createMockManager({ profile: 'autonomous' });
        skill = new AutonomySkill({ autonomyManager: mockManager as any });

        const result = skill.handleAutonomyRequest('More autonomy');
        expect(result.text).toContain('already at the most autonomous');
      });
    });

    describe('revert / undo', () => {
      it('recognizes "undo that" and reverts to previous profile', () => {
        // First change profile
        skill.setAutonomyProfile('autonomous');
        expect(mockManager._getProfile()).toBe('autonomous');

        const result = skill.handleAutonomyRequest('Undo that');
        expect(result.action).toBe('set-profile'); // revert uses setAutonomyProfile
        expect(result.newProfile).toBe('collaborative');
      });

      it('recognizes "go back"', () => {
        skill.setAutonomyProfile('cautious');
        const result = skill.handleAutonomyRequest('Go back');
        expect(result.newProfile).toBe('collaborative');
      });

      it('handles no history gracefully', () => {
        const result = skill.handleAutonomyRequest('Revert');
        expect(result.action).toBe('revert');
        expect(result.text).toContain('no previous profile');
      });

      it('recognizes "dial it back" as decrease autonomy', () => {
        mockManager = createMockManager({ profile: 'autonomous' });
        skill = new AutonomySkill({ autonomyManager: mockManager as any });

        const result = skill.handleAutonomyRequest('Dial it back');
        expect(result.action).toBe('revert');
      });
    });

    describe('trust dashboard', () => {
      it('recognizes "show me your trust level"', () => {
        const result = skill.handleAutonomyRequest('Show me your trust level');
        expect(result.action).toBe('trust-dashboard');
      });

      it('recognizes "trust dashboard"', () => {
        const result = skill.handleAutonomyRequest('Trust dashboard');
        expect(result.action).toBe('trust-dashboard');
      });
    });

    describe('unknown intent', () => {
      it('falls back to status for unrecognized messages', () => {
        const result = skill.handleAutonomyRequest('The weather is nice today');
        expect(result.action).toBe('status');
      });
    });
  });

  // ── getTrustDashboard ────────────────────────────────────────────

  describe('getTrustDashboard', () => {
    it('returns trust dashboard with available profiles', () => {
      const result = skill.getTrustDashboard();
      expect(result.action).toBe('trust-dashboard');
      expect(result.text).toContain('Trust Dashboard');
      expect(result.text).toContain('Available profiles');
      expect(result.text).toContain('collaborative');
      expect(result.text).toContain('[current]');
    });

    it('includes elevation opportunities in dashboard', () => {
      mockManager = createMockManager({
        profile: 'supervised',
        elevations: [{
          service: 'calendar',
          operation: 'write',
          currentLevel: 'approve-always',
          suggestedLevel: 'approve-first',
          reason: '10 successful calendar writes',
          streak: 10,
        }],
      });
      skill = new AutonomySkill({ autonomyManager: mockManager as any });

      const result = skill.getTrustDashboard();
      expect(result.text).toContain('calendar');
      expect(result.text).toContain('Elevation opportunities');
    });
  });

  // ── Notification Templates ───────────────────────────────────────

  describe('notification templates', () => {
    it('formats elevation suggestion', () => {
      const text = AutonomySkill.formatElevationSuggestion({
        type: 'operation-trust',
        current: 'approve-always',
        suggested: 'log',
        reason: 'Strong track record with email reads',
        evidence: '15 successful operations, 0 incidents',
        createdAt: new Date().toISOString(),
        dismissed: false,
        dismissedUntil: null,
      });
      expect(text).toContain('Trust elevation opportunity');
      expect(text).toContain('approve-always');
      expect(text).toContain('log');
      expect(text).toContain('Evidence');
    });

    it('formats rubber-stamp alert', () => {
      const text = AutonomySkill.formatRubberStampAlert({
        detected: true,
        consecutiveFastApprovals: 8,
        avgLatencyMs: 2500,
        approvalRate: 0.95,
        evaluatedAt: new Date().toISOString(),
        dismissedUntil: null,
      });
      expect(text).toContain('rubber-stamping');
      expect(text).toContain('8 consecutive');
      expect(text).toContain('95%');
      expect(text).toContain('2.5s');
    });

    it('formats evolution applied notification', () => {
      const text = AutonomySkill.formatEvolutionApplied({
        proposalTitle: 'Add retry logic to email fetcher',
        proposalId: 'EVO-123',
        affectedArea: 'email integration',
        confidence: 0.92,
      });
      expect(text).toContain('Self-evolution applied');
      expect(text).toContain('Add retry logic');
      expect(text).toContain('92%');
      expect(text).toContain('undo');
    });

    it('formats profile change notification', () => {
      const text = AutonomySkill.formatProfileChanged('supervised', 'collaborative', 'User request');
      expect(text).toContain('supervised -> collaborative');
      expect(text).toContain('User request');
      expect(text).toContain('undo');
    });

    it('formats trust recovery message', () => {
      const text = AutonomySkill.formatTrustRecovery({
        incidentId: 'INC-123',
        service: 'email',
        operation: 'modify',
        previousLevel: 'log',
        currentLevel: 'approve-always',
        successCount: 10,
        message: 'Since the email modify incident, there have been 10 successful operations. Consider restoring trust to "log" level.',
      });
      expect(text).toContain('10 successful operations');
      expect(text).toContain('email');
    });
  });
});

import { describe, it, expect } from 'vitest';
import { DispatchScopeEnforcer } from '../../src/core/DispatchScopeEnforcer.js';
import type { Dispatch } from '../../src/core/DispatchManager.js';
import type { ActionStep } from '../../src/core/DispatchExecutor.js';
import type { AutonomyProfileLevel } from '../../src/core/types.js';

function makeDispatch(overrides: Partial<Dispatch> = {}): Dispatch {
  return {
    dispatchId: 'D-001',
    type: 'lesson',
    title: 'Test dispatch',
    content: '{}',
    priority: 'normal',
    createdAt: new Date().toISOString(),
    receivedAt: new Date().toISOString(),
    applied: false,
    ...overrides,
  };
}

describe('DispatchScopeEnforcer', () => {
  const enforcer = new DispatchScopeEnforcer();

  // ── Scope Tier Mapping ────────────────────────────────────────────

  describe('getScopeTier', () => {
    it('maps lesson to context tier', () => {
      expect(enforcer.getScopeTier('lesson')).toBe('context');
    });

    it('maps strategy to context tier', () => {
      expect(enforcer.getScopeTier('strategy')).toBe('context');
    });

    it('maps configuration to config tier', () => {
      expect(enforcer.getScopeTier('configuration')).toBe('config');
    });

    it('maps action to project tier', () => {
      expect(enforcer.getScopeTier('action')).toBe('project');
    });

    it('maps behavioral to behavior tier', () => {
      expect(enforcer.getScopeTier('behavioral')).toBe('behavior');
    });

    it('maps security to security tier', () => {
      expect(enforcer.getScopeTier('security')).toBe('security');
    });
  });

  // ── Scope Checking ────────────────────────────────────────────────

  describe('checkScope', () => {
    // Context-only dispatches (lesson, strategy)

    it('allows lesson dispatches at any profile', () => {
      const profiles: AutonomyProfileLevel[] = ['cautious', 'supervised', 'collaborative', 'autonomous'];
      for (const profile of profiles) {
        const result = enforcer.checkScope(makeDispatch({ type: 'lesson' }), profile);
        expect(result.allowed).toBe(true);
        expect(result.tier).toBe('context');
        expect(result.requiresApproval).toBe(false);
      }
    });

    it('allows strategy dispatches at any profile', () => {
      const profiles: AutonomyProfileLevel[] = ['cautious', 'supervised', 'collaborative', 'autonomous'];
      for (const profile of profiles) {
        const result = enforcer.checkScope(makeDispatch({ type: 'strategy' }), profile);
        expect(result.allowed).toBe(true);
        expect(result.tier).toBe('context');
      }
    });

    // Configuration dispatches

    it('blocks configuration at cautious profile', () => {
      const result = enforcer.checkScope(makeDispatch({ type: 'configuration' }), 'cautious');
      expect(result.allowed).toBe(false);
      expect(result.requiresApproval).toBe(true);
    });

    it('blocks configuration at supervised profile', () => {
      const result = enforcer.checkScope(makeDispatch({ type: 'configuration' }), 'supervised');
      expect(result.allowed).toBe(false);
      expect(result.requiresApproval).toBe(true);
    });

    it('allows configuration at collaborative profile', () => {
      const result = enforcer.checkScope(makeDispatch({ type: 'configuration' }), 'collaborative');
      expect(result.allowed).toBe(true);
      expect(result.requiresApproval).toBe(false);
    });

    it('allows configuration at autonomous profile', () => {
      const result = enforcer.checkScope(makeDispatch({ type: 'configuration' }), 'autonomous');
      expect(result.allowed).toBe(true);
    });

    // Action dispatches

    it('blocks action at cautious/supervised', () => {
      for (const profile of ['cautious', 'supervised'] as AutonomyProfileLevel[]) {
        const result = enforcer.checkScope(makeDispatch({ type: 'action' }), profile);
        expect(result.allowed).toBe(false);
        expect(result.requiresApproval).toBe(true);
      }
    });

    it('queues action for approval at collaborative', () => {
      const result = enforcer.checkScope(makeDispatch({ type: 'action' }), 'collaborative');
      expect(result.allowed).toBe(false);
      expect(result.requiresApproval).toBe(true);
      expect(result.reason).toContain('queue');
    });

    it('allows action at autonomous profile', () => {
      const result = enforcer.checkScope(makeDispatch({ type: 'action' }), 'autonomous');
      expect(result.allowed).toBe(true);
      expect(result.requiresApproval).toBe(false);
    });

    // Behavioral dispatches — always human

    it('blocks behavioral at all profiles', () => {
      const profiles: AutonomyProfileLevel[] = ['cautious', 'supervised', 'collaborative', 'autonomous'];
      for (const profile of profiles) {
        const result = enforcer.checkScope(makeDispatch({ type: 'behavioral' }), profile);
        expect(result.allowed).toBe(false);
        expect(result.requiresApproval).toBe(true);
        expect(result.tier).toBe('behavior');
      }
    });

    // Security dispatches — always human

    it('blocks security at all profiles', () => {
      const profiles: AutonomyProfileLevel[] = ['cautious', 'supervised', 'collaborative', 'autonomous'];
      for (const profile of profiles) {
        const result = enforcer.checkScope(makeDispatch({ type: 'security' }), profile);
        expect(result.allowed).toBe(false);
        expect(result.requiresApproval).toBe(true);
        expect(result.tier).toBe('security');
      }
    });
  });

  // ── Step Validation ───────────────────────────────────────────────

  describe('validateSteps', () => {
    it('rejects shell commands in context scope', () => {
      const steps: ActionStep[] = [{ type: 'shell', command: 'echo hello' }];
      const result = enforcer.validateSteps(steps, 'context');
      expect(result.valid).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]).toContain('shell');
    });

    it('rejects file writes in context scope', () => {
      const steps: ActionStep[] = [{ type: 'file_write', path: 'test.txt', content: 'hi' }];
      const result = enforcer.validateSteps(steps, 'context');
      expect(result.valid).toBe(false);
    });

    it('rejects config_merge in context scope', () => {
      const steps: ActionStep[] = [{ type: 'config_merge', path: 'config.json', merge: {} }];
      const result = enforcer.validateSteps(steps, 'context');
      expect(result.valid).toBe(false);
    });

    it('rejects agentic in context scope', () => {
      const steps: ActionStep[] = [{ type: 'agentic', prompt: 'do something' }];
      const result = enforcer.validateSteps(steps, 'context');
      expect(result.valid).toBe(false);
    });

    it('rejects shell commands in config scope', () => {
      const steps: ActionStep[] = [{ type: 'shell', command: 'npm install' }];
      const result = enforcer.validateSteps(steps, 'config');
      expect(result.valid).toBe(false);
    });

    it('allows config_merge on config files in config scope', () => {
      const steps: ActionStep[] = [{ type: 'config_merge', path: '.instar/config.json', merge: { key: 'value' } }];
      const result = enforcer.validateSteps(steps, 'config');
      expect(result.valid).toBe(true);
    });

    it('rejects non-config file writes in config scope', () => {
      const steps: ActionStep[] = [{ type: 'file_write', path: 'src/main.ts', content: 'code' }];
      const result = enforcer.validateSteps(steps, 'config');
      expect(result.valid).toBe(false);
      expect(result.violations[0]).toContain('outside config scope');
    });

    it('rejects behavioral files in config scope', () => {
      const steps: ActionStep[] = [{ type: 'file_write', path: 'CLAUDE.md', content: 'stuff' }];
      const result = enforcer.validateSteps(steps, 'config');
      expect(result.valid).toBe(false);
      expect(result.violations[0]).toContain('behavioral');
    });

    it('allows project files in project scope', () => {
      const steps: ActionStep[] = [
        { type: 'shell', command: 'npm test' },
        { type: 'file_write', path: 'src/main.ts', content: 'code' },
        { type: 'file_patch', path: 'src/utils.ts', find: 'old', replace: 'new' },
      ];
      const result = enforcer.validateSteps(steps, 'project');
      expect(result.valid).toBe(true);
    });

    it('rejects behavioral files in project scope', () => {
      const steps: ActionStep[] = [
        { type: 'file_write', path: '.instar/hooks/my-hook.sh', content: 'echo' },
      ];
      const result = enforcer.validateSteps(steps, 'project');
      expect(result.valid).toBe(false);
      expect(result.violations[0]).toContain('behavioral');
    });

    it('rejects CLAUDE.md in project scope', () => {
      const steps: ActionStep[] = [
        { type: 'file_patch', path: 'CLAUDE.md', find: 'old', replace: 'new' },
      ];
      const result = enforcer.validateSteps(steps, 'project');
      expect(result.valid).toBe(false);
    });

    it('reports multiple violations', () => {
      const steps: ActionStep[] = [
        { type: 'shell', command: 'rm -rf /' },
        { type: 'file_write', path: 'CLAUDE.md', content: 'hacked' },
        { type: 'agentic', prompt: 'do evil' },
      ];
      const result = enforcer.validateSteps(steps, 'context');
      expect(result.valid).toBe(false);
      expect(result.violations.length).toBe(3);
    });

    it('passes empty steps', () => {
      const result = enforcer.validateSteps([], 'context');
      expect(result.valid).toBe(true);
      expect(result.violations).toHaveLength(0);
    });
  });

  // ── Path Classification ───────────────────────────────────────────

  describe('isConfigPath', () => {
    it('matches .instar/config.json', () => {
      expect(enforcer.isConfigPath('.instar/config.json')).toBe(true);
    });

    it('matches .instar state files', () => {
      expect(enforcer.isConfigPath('.instar/state/trust.json')).toBe(true);
    });

    it('matches .env files', () => {
      expect(enforcer.isConfigPath('.env')).toBe(true);
      expect(enforcer.isConfigPath('.env.local')).toBe(true);
    });

    it('matches config/ directory', () => {
      expect(enforcer.isConfigPath('config/settings.json')).toBe(true);
    });

    it('rejects source files', () => {
      expect(enforcer.isConfigPath('src/main.ts')).toBe(false);
    });
  });

  describe('isBehavioralPath', () => {
    it('matches CLAUDE.md', () => {
      expect(enforcer.isBehavioralPath('CLAUDE.md')).toBe(true);
    });

    it('matches .instar/hooks/', () => {
      expect(enforcer.isBehavioralPath('.instar/hooks/my-hook.sh')).toBe(true);
    });

    it('matches .claude/', () => {
      expect(enforcer.isBehavioralPath('.claude/settings.json')).toBe(true);
    });

    it('rejects normal source files', () => {
      expect(enforcer.isBehavioralPath('src/index.ts')).toBe(false);
    });
  });
});

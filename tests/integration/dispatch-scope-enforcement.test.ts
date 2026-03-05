import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTempProject } from '../helpers/setup.js';
import type { TempProject } from '../helpers/setup.js';
import { DispatchScopeEnforcer } from '../../src/core/DispatchScopeEnforcer.js';
import { DispatchExecutor } from '../../src/core/DispatchExecutor.js';
import type { ActionPayload } from '../../src/core/DispatchExecutor.js';
import type { Dispatch } from '../../src/core/DispatchManager.js';
import type { AutonomyProfileLevel } from '../../src/core/types.js';
import fs from 'node:fs';
import path from 'node:path';

function makeDispatch(type: Dispatch['type']): Dispatch {
  return {
    dispatchId: `D-${Date.now().toString(36)}`,
    type,
    title: `Test ${type} dispatch`,
    content: '{}',
    priority: 'normal',
    createdAt: new Date().toISOString(),
    receivedAt: new Date().toISOString(),
    applied: false,
  };
}

describe('DispatchScopeEnforcer integration', () => {
  let project: TempProject;
  let enforcer: DispatchScopeEnforcer;
  let executor: DispatchExecutor;

  beforeEach(() => {
    project = createTempProject();
    enforcer = new DispatchScopeEnforcer();
    executor = new DispatchExecutor(project.dir);
  });

  afterEach(() => {
    project.cleanup();
  });

  describe('scope check -> execute pipeline', () => {
    it('allows and executes config dispatch at collaborative', async () => {
      const dispatch = makeDispatch('configuration');
      const check = enforcer.checkScope(dispatch, 'collaborative');
      expect(check.allowed).toBe(true);

      const payload: ActionPayload = {
        description: 'Update config',
        steps: [
          { type: 'config_merge', path: '.instar/config.json', merge: { newKey: 'value' } },
        ],
      };

      // Validate steps against scope
      const stepCheck = enforcer.validateSteps(payload.steps, check.tier);
      expect(stepCheck.valid).toBe(true);

      // Create .instar dir and config file
      fs.mkdirSync(path.join(project.dir, '.instar'), { recursive: true });
      fs.writeFileSync(path.join(project.dir, '.instar/config.json'), '{}');

      const result = await executor.execute(payload);
      expect(result.success).toBe(true);
    });

    it('blocks config dispatch steps that escape scope', () => {
      const dispatch = makeDispatch('configuration');
      const check = enforcer.checkScope(dispatch, 'collaborative');
      expect(check.allowed).toBe(true);

      // Try to sneak a shell command into a config dispatch
      const payload: ActionPayload = {
        description: 'Malicious config dispatch',
        steps: [
          { type: 'shell', command: 'echo pwned > /tmp/pwned' },
        ],
      };

      const stepCheck = enforcer.validateSteps(payload.steps, check.tier);
      expect(stepCheck.valid).toBe(false);
      expect(stepCheck.violations[0]).toContain('shell');
    });

    it('blocks action dispatch at supervised level', () => {
      const dispatch = makeDispatch('action');
      const check = enforcer.checkScope(dispatch, 'supervised');
      expect(check.allowed).toBe(false);
      expect(check.requiresApproval).toBe(true);
    });

    it('blocks behavioral file modification in project scope', async () => {
      const dispatch = makeDispatch('action');
      const check = enforcer.checkScope(dispatch, 'autonomous');
      expect(check.allowed).toBe(true);

      const payload: ActionPayload = {
        description: 'Try to modify CLAUDE.md',
        steps: [
          { type: 'file_write', path: 'CLAUDE.md', content: 'hacked' },
        ],
      };

      const stepCheck = enforcer.validateSteps(payload.steps, check.tier);
      expect(stepCheck.valid).toBe(false);
      expect(stepCheck.violations[0]).toContain('behavioral');
    });
  });

  describe('multi-step scope validation', () => {
    it('validates all steps, not just the first', () => {
      const steps = [
        { type: 'config_merge' as const, path: '.instar/config.json', merge: { a: 1 } },
        { type: 'shell' as const, command: 'echo test' },
        { type: 'file_write' as const, path: 'CLAUDE.md', content: 'bad' },
      ];

      const result = enforcer.validateSteps(steps, 'config');
      expect(result.valid).toBe(false);
      // Should catch both the shell command and the CLAUDE.md write
      expect(result.violations.length).toBe(2);
    });
  });

  describe('profile progression gates', () => {
    const profiles: AutonomyProfileLevel[] = ['cautious', 'supervised', 'collaborative', 'autonomous'];
    const types: Dispatch['type'][] = ['lesson', 'strategy', 'configuration', 'action', 'behavioral', 'security'];

    it('never allows behavioral or security to auto-execute', () => {
      for (const profile of profiles) {
        for (const type of ['behavioral', 'security'] as Dispatch['type'][]) {
          const result = enforcer.checkScope(makeDispatch(type), profile);
          expect(result.allowed).toBe(false);
          expect(result.requiresApproval).toBe(true);
        }
      }
    });

    it('allows context types at all profiles', () => {
      for (const profile of profiles) {
        for (const type of ['lesson', 'strategy'] as Dispatch['type'][]) {
          const result = enforcer.checkScope(makeDispatch(type), profile);
          expect(result.allowed).toBe(true);
        }
      }
    });

    it('configuration requires collaborative+', () => {
      expect(enforcer.checkScope(makeDispatch('configuration'), 'cautious').allowed).toBe(false);
      expect(enforcer.checkScope(makeDispatch('configuration'), 'supervised').allowed).toBe(false);
      expect(enforcer.checkScope(makeDispatch('configuration'), 'collaborative').allowed).toBe(true);
      expect(enforcer.checkScope(makeDispatch('configuration'), 'autonomous').allowed).toBe(true);
    });

    it('action auto-execute requires autonomous', () => {
      expect(enforcer.checkScope(makeDispatch('action'), 'cautious').allowed).toBe(false);
      expect(enforcer.checkScope(makeDispatch('action'), 'supervised').allowed).toBe(false);
      expect(enforcer.checkScope(makeDispatch('action'), 'collaborative').allowed).toBe(false);
      expect(enforcer.checkScope(makeDispatch('action'), 'autonomous').allowed).toBe(true);
    });
  });
});

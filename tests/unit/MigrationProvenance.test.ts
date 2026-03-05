import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTempProject } from '../helpers/setup.js';
import type { TempProject } from '../helpers/setup.js';
import { MigrationProvenance } from '../../src/core/MigrationProvenance.js';
import type { MigrationResult } from '../../src/core/PostUpdateMigrator.js';

function makeMigrationResult(overrides: Partial<MigrationResult> = {}): MigrationResult {
  return {
    upgraded: [
      'hooks/instar/session-start.sh (capability awareness)',
      'hooks/instar/dangerous-command-guard.sh',
      'CLAUDE.md section: Self-Discovery',
      'scripts/health-check.sh',
    ],
    skipped: ['hooks/instar/custom-hook.sh', 'scripts/existing.sh'],
    errors: [],
    ...overrides,
  };
}

describe('MigrationProvenance', () => {
  let project: TempProject;

  beforeEach(() => {
    project = createTempProject();
  });

  afterEach(() => {
    project.cleanup();
  });

  // ── Logging ─────────────────────────────────────────────────────

  describe('logMigration', () => {
    it('logs a migration and returns the entry', () => {
      const prov = new MigrationProvenance(project.stateDir);
      const result = makeMigrationResult();
      const entry = prov.logMigration('0.12.0', '0.13.0', result);

      expect(entry.fromVersion).toBe('0.12.0');
      expect(entry.toVersion).toBe('0.13.0');
      expect(entry.upgradedCount).toBe(4);
      expect(entry.skippedCount).toBe(2);
      expect(entry.errorCount).toBe(0);
      expect(entry.timestamp).toBeTruthy();
    });

    it('classifies changes correctly', () => {
      const prov = new MigrationProvenance(project.stateDir);
      const result = makeMigrationResult();
      const entry = prov.logMigration('0.12.0', '0.13.0', result);

      const hooks = entry.changes.filter(c => c.type === 'hook-regenerated');
      expect(hooks.length).toBe(2);
      expect(hooks[0].path).toBe('hooks/instar/session-start.sh');

      const claudeMd = entry.changes.filter(c => c.type === 'claude-md-patched');
      expect(claudeMd.length).toBe(1);
      expect(claudeMd[0].section).toBe('Self-Discovery');

      const scripts = entry.changes.filter(c => c.type === 'script-installed');
      expect(scripts.length).toBe(1);
    });

    it('records errors in the log', () => {
      const prov = new MigrationProvenance(project.stateDir);
      const result = makeMigrationResult({
        errors: ['session-start.sh: Permission denied'],
      });
      const entry = prov.logMigration('0.12.0', '0.13.0', result);

      expect(entry.errorCount).toBe(1);
      const errors = entry.changes.filter(c => c.type === 'error');
      expect(errors.length).toBe(1);
      expect(errors[0].detail).toContain('Permission denied');
    });

    it('persists across instances', () => {
      const prov1 = new MigrationProvenance(project.stateDir);
      prov1.logMigration('0.12.0', '0.13.0', makeMigrationResult());

      const prov2 = new MigrationProvenance(project.stateDir);
      const log = prov2.getLog();
      expect(log.length).toBe(1);
      expect(log[0].fromVersion).toBe('0.12.0');
    });

    it('accumulates multiple entries', () => {
      const prov = new MigrationProvenance(project.stateDir);
      prov.logMigration('0.12.0', '0.13.0', makeMigrationResult());
      prov.logMigration('0.13.0', '0.14.0', makeMigrationResult());

      const log = prov.getLog();
      expect(log.length).toBe(2);
      expect(log[1].fromVersion).toBe('0.13.0');
    });
  });

  // ── Reading Log ─────────────────────────────────────────────────

  describe('getLog', () => {
    it('returns empty array when no log exists', () => {
      const prov = new MigrationProvenance(project.stateDir);
      expect(prov.getLog()).toEqual([]);
    });
  });

  describe('getLatest', () => {
    it('returns null when no log exists', () => {
      const prov = new MigrationProvenance(project.stateDir);
      expect(prov.getLatest()).toBeNull();
    });

    it('returns the most recent entry', () => {
      const prov = new MigrationProvenance(project.stateDir);
      prov.logMigration('0.12.0', '0.13.0', makeMigrationResult());
      prov.logMigration('0.13.0', '0.14.0', makeMigrationResult());

      const latest = prov.getLatest();
      expect(latest?.fromVersion).toBe('0.13.0');
      expect(latest?.toVersion).toBe('0.14.0');
    });
  });

  // ── Notification ──────────────────────────────────────────────────

  describe('formatNotification', () => {
    it('includes version info', () => {
      const prov = new MigrationProvenance(project.stateDir);
      const entry = prov.logMigration('0.12.0', '0.13.0', makeMigrationResult());
      const notification = prov.formatNotification(entry);

      expect(notification).toContain('0.12.0');
      expect(notification).toContain('0.13.0');
    });

    it('lists upgraded items', () => {
      const prov = new MigrationProvenance(project.stateDir);
      const entry = prov.logMigration('0.12.0', '0.13.0', makeMigrationResult());
      const notification = prov.formatNotification(entry);

      expect(notification).toContain('4 items upgraded');
      expect(notification).toContain('session-start.sh');
    });

    it('includes error section when errors exist', () => {
      const prov = new MigrationProvenance(project.stateDir);
      const entry = prov.logMigration('0.12.0', '0.13.0', makeMigrationResult({
        errors: ['hook write failed'],
      }));
      const notification = prov.formatNotification(entry);

      expect(notification).toContain('1 errors');
      expect(notification).toContain('hook write failed');
    });

    it('includes skipped count', () => {
      const prov = new MigrationProvenance(project.stateDir);
      const entry = prov.logMigration('0.12.0', '0.13.0', makeMigrationResult());
      const notification = prov.formatNotification(entry);

      expect(notification).toContain('2 items already up to date');
    });
  });

  describe('shouldNotify', () => {
    it('returns true for cautious profile', () => {
      const prov = new MigrationProvenance(project.stateDir);
      expect(prov.shouldNotify('cautious')).toBe(true);
    });

    it('returns true for supervised profile', () => {
      const prov = new MigrationProvenance(project.stateDir);
      expect(prov.shouldNotify('supervised')).toBe(true);
    });

    it('returns false for collaborative profile', () => {
      const prov = new MigrationProvenance(project.stateDir);
      expect(prov.shouldNotify('collaborative')).toBe(false);
    });

    it('returns false for autonomous profile', () => {
      const prov = new MigrationProvenance(project.stateDir);
      expect(prov.shouldNotify('autonomous')).toBe(false);
    });
  });

  // ── Change Classification ─────────────────────────────────────────

  describe('change classification', () => {
    it('classifies config migrations', () => {
      const prov = new MigrationProvenance(project.stateDir);
      const entry = prov.logMigration('0.12.0', '0.13.0', makeMigrationResult({
        upgraded: ['Config: added autonomyProfile default'],
      }));

      expect(entry.changes[0].type).toBe('config-migrated');
    });

    it('classifies settings migrations', () => {
      const prov = new MigrationProvenance(project.stateDir);
      const entry = prov.logMigration('0.12.0', '0.13.0', makeMigrationResult({
        upgraded: ['settings.json: new defaults'],
      }));

      expect(entry.changes[0].type).toBe('settings-migrated');
    });

    it('classifies gitignore updates', () => {
      const prov = new MigrationProvenance(project.stateDir);
      const entry = prov.logMigration('0.12.0', '0.13.0', makeMigrationResult({
        upgraded: ['.gitignore: added state/ patterns'],
      }));

      expect(entry.changes[0].type).toBe('gitignore-updated');
    });
  });
});

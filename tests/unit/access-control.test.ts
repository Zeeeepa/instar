/**
 * Unit tests for AccessControl — Role-Based Access Control for multi-user sync.
 *
 * Tests:
 * - Role permissions: Admin has all 10, Maintainer has 6, Contributor has 4
 * - Permission checks: Each permission verified per role
 * - checkAll: All must pass for allowed=true
 * - checkAny: Any pass for allowed=true
 * - Role management: Admin can assign, non-admin cannot
 * - Default role: Unknown users get default (contributor)
 * - RBAC disabled: All permissions granted when enabled=false
 * - Suggestions: Denial messages include suggestions for contributor/maintainer
 */

import { describe, it, expect } from 'vitest';
import { AccessControl } from '../../src/core/AccessControl.js';
import type { Permission, UserRole } from '../../src/core/AccessControl.js';

// ── Test Helpers ─────────────────────────────────────────────────────

function createAC(config?: Partial<ConstructorParameters<typeof AccessControl>[0]>) {
  return new AccessControl({
    roles: [
      { userId: 'admin-user', role: 'admin', assignedAt: '2026-01-01T00:00:00Z', assignedBy: 'system' },
      { userId: 'maintainer-user', role: 'maintainer', assignedAt: '2026-01-01T00:00:00Z', assignedBy: 'system' },
      { userId: 'contributor-user', role: 'contributor', assignedAt: '2026-01-01T00:00:00Z', assignedBy: 'system' },
    ],
    ...config,
  });
}

const ALL_PERMISSIONS: Permission[] = [
  'code:modify',
  'code:merge-to-main',
  'config:read',
  'config:modify',
  'agent-state:modify',
  'conflict:force-resolve',
  'branch:create',
  'branch:merge',
  'ledger:write-own',
  'ledger:write-any',
];

// ── Role Permission Matrix ───────────────────────────────────────────

describe('AccessControl', () => {
  describe('Role Permission Matrix', () => {
    const ac = createAC();

    it('admin has all 10 permissions', () => {
      const perms = ac.getPermissionsForRole('admin');
      expect(perms).toHaveLength(10);
      for (const p of ALL_PERMISSIONS) {
        expect(perms).toContain(p);
      }
    });

    it('maintainer has exactly 6 permissions', () => {
      const perms = ac.getPermissionsForRole('maintainer');
      expect(perms).toHaveLength(6);
      expect(perms).toContain('code:modify');
      expect(perms).toContain('code:merge-to-main');
      expect(perms).toContain('config:read');
      expect(perms).toContain('branch:create');
      expect(perms).toContain('branch:merge');
      expect(perms).toContain('ledger:write-own');
    });

    it('maintainer does NOT have admin-only permissions', () => {
      const perms = ac.getPermissionsForRole('maintainer');
      expect(perms).not.toContain('config:modify');
      expect(perms).not.toContain('agent-state:modify');
      expect(perms).not.toContain('conflict:force-resolve');
      expect(perms).not.toContain('ledger:write-any');
    });

    it('contributor has exactly 4 permissions', () => {
      const perms = ac.getPermissionsForRole('contributor');
      expect(perms).toHaveLength(4);
      expect(perms).toContain('code:modify');
      expect(perms).toContain('config:read');
      expect(perms).toContain('branch:create');
      expect(perms).toContain('ledger:write-own');
    });

    it('contributor does NOT have elevated permissions', () => {
      const perms = ac.getPermissionsForRole('contributor');
      expect(perms).not.toContain('code:merge-to-main');
      expect(perms).not.toContain('config:modify');
      expect(perms).not.toContain('agent-state:modify');
      expect(perms).not.toContain('conflict:force-resolve');
      expect(perms).not.toContain('branch:merge');
      expect(perms).not.toContain('ledger:write-any');
    });
  });

  // ── Individual Permission Checks ────────────────────────────────────

  describe('Permission Checks (check)', () => {
    const ac = createAC();

    it('admin can do everything', () => {
      for (const perm of ALL_PERMISSIONS) {
        const result = ac.check('admin-user', perm);
        expect(result.allowed).toBe(true);
        expect(result.role).toBe('admin');
        expect(result.permission).toBe(perm);
      }
    });

    it('maintainer allowed for code:modify', () => {
      const result = ac.check('maintainer-user', 'code:modify');
      expect(result.allowed).toBe(true);
    });

    it('maintainer denied for config:modify', () => {
      const result = ac.check('maintainer-user', 'config:modify');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('config:modify');
    });

    it('contributor allowed for code:modify', () => {
      const result = ac.check('contributor-user', 'code:modify');
      expect(result.allowed).toBe(true);
    });

    it('contributor denied for code:merge-to-main', () => {
      const result = ac.check('contributor-user', 'code:merge-to-main');
      expect(result.allowed).toBe(false);
    });

    it('contributor denied for conflict:force-resolve', () => {
      const result = ac.check('contributor-user', 'conflict:force-resolve');
      expect(result.allowed).toBe(false);
    });

    it('denied result includes reason with role and permission', () => {
      const result = ac.check('contributor-user', 'config:modify');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('contributor');
      expect(result.reason).toContain('config:modify');
    });
  });

  // ── checkAll ────────────────────────────────────────────────────────

  describe('checkAll', () => {
    const ac = createAC();

    it('returns allowed=true when user has ALL requested permissions', () => {
      const result = ac.checkAll('admin-user', ['code:modify', 'config:modify', 'ledger:write-any']);
      expect(result.allowed).toBe(true);
      expect(result.results).toHaveLength(3);
    });

    it('returns allowed=false when user lacks any requested permission', () => {
      const result = ac.checkAll('contributor-user', ['code:modify', 'config:modify']);
      expect(result.allowed).toBe(false);
      // code:modify should pass, config:modify should fail
      const codeResult = result.results.find(r => r.permission === 'code:modify');
      const configResult = result.results.find(r => r.permission === 'config:modify');
      expect(codeResult?.allowed).toBe(true);
      expect(configResult?.allowed).toBe(false);
    });

    it('returns allowed=true for empty permission list', () => {
      const result = ac.checkAll('contributor-user', []);
      expect(result.allowed).toBe(true);
      expect(result.results).toHaveLength(0);
    });
  });

  // ── checkAny ────────────────────────────────────────────────────────

  describe('checkAny', () => {
    const ac = createAC();

    it('returns allowed=true when user has at least one permission', () => {
      const result = ac.checkAny('contributor-user', ['config:modify', 'code:modify']);
      expect(result.allowed).toBe(true);
    });

    it('returns allowed=false when user has none of the permissions', () => {
      const result = ac.checkAny('contributor-user', ['config:modify', 'ledger:write-any']);
      expect(result.allowed).toBe(false);
    });

    it('returns allowed=false for empty permission list', () => {
      const result = ac.checkAny('contributor-user', []);
      expect(result.allowed).toBe(false);
    });
  });

  // ── Role Management ─────────────────────────────────────────────────

  describe('Role Management', () => {
    it('admin can assign roles', () => {
      const ac = createAC();
      const result = ac.setUserRole('admin-user', 'new-user', 'maintainer');
      expect(result.success).toBe(true);
      expect(ac.getUserRole('new-user')).toBe('maintainer');
    });

    it('non-admin cannot assign roles', () => {
      const ac = createAC();
      const result = ac.setUserRole('contributor-user', 'new-user', 'admin');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Only admins');
    });

    it('maintainer cannot assign roles', () => {
      const ac = createAC();
      const result = ac.setUserRole('maintainer-user', 'new-user', 'contributor');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Only admins');
    });

    it('admin can change existing role', () => {
      const ac = createAC();
      expect(ac.getUserRole('contributor-user')).toBe('contributor');
      const result = ac.setUserRole('admin-user', 'contributor-user', 'maintainer');
      expect(result.success).toBe(true);
      expect(ac.getUserRole('contributor-user')).toBe('maintainer');
    });

    it('listRoles returns all role assignments', () => {
      const ac = createAC();
      const roles = ac.listRoles();
      expect(roles).toHaveLength(3);
      const userIds = roles.map(r => r.userId);
      expect(userIds).toContain('admin-user');
      expect(userIds).toContain('maintainer-user');
      expect(userIds).toContain('contributor-user');
    });

    it('newly assigned role appears in listRoles', () => {
      const ac = createAC();
      ac.setUserRole('admin-user', 'new-user', 'contributor');
      const roles = ac.listRoles();
      expect(roles).toHaveLength(4);
      const newEntry = roles.find(r => r.userId === 'new-user');
      expect(newEntry).toBeDefined();
      expect(newEntry!.role).toBe('contributor');
      expect(newEntry!.assignedBy).toBe('admin-user');
    });
  });

  // ── Default Role ────────────────────────────────────────────────────

  describe('Default Role', () => {
    it('unknown users get contributor role by default', () => {
      const ac = createAC();
      expect(ac.getUserRole('unknown-user')).toBe('contributor');
    });

    it('respects custom default role', () => {
      const ac = createAC({ defaultRole: 'maintainer' });
      expect(ac.getUserRole('unknown-user')).toBe('maintainer');
    });

    it('unknown user permissions match default role', () => {
      const ac = createAC();
      const result = ac.check('unknown-user', 'code:modify');
      expect(result.allowed).toBe(true);
      expect(result.role).toBe('contributor');

      const result2 = ac.check('unknown-user', 'config:modify');
      expect(result2.allowed).toBe(false);
      expect(result2.role).toBe('contributor');
    });
  });

  // ── RBAC Disabled ───────────────────────────────────────────────────

  describe('RBAC Disabled', () => {
    it('all permissions granted when enabled=false', () => {
      const ac = createAC({ enabled: false });
      for (const perm of ALL_PERMISSIONS) {
        const result = ac.check('contributor-user', perm);
        expect(result.allowed).toBe(true);
      }
    });

    it('unknown users also get all permissions when disabled', () => {
      const ac = createAC({ enabled: false });
      const result = ac.check('random-unknown', 'conflict:force-resolve');
      expect(result.allowed).toBe(true);
    });

    it('role assignment works even when RBAC is disabled', () => {
      const ac = createAC({ enabled: false });
      // When disabled, anyone can assign roles (admin check is skipped when not enabled)
      const result = ac.setUserRole('contributor-user', 'new-user', 'admin');
      expect(result.success).toBe(true);
    });

    it('isEnabled returns false', () => {
      const ac = createAC({ enabled: false });
      expect(ac.isEnabled()).toBe(false);
    });

    it('isEnabled returns true by default', () => {
      const ac = createAC();
      expect(ac.isEnabled()).toBe(true);
    });
  });

  // ── Denial Suggestions ──────────────────────────────────────────────

  describe('Denial Suggestions', () => {
    const ac = createAC();

    it('contributor denied code:merge-to-main gets task branch suggestion', () => {
      const result = ac.check('contributor-user', 'code:merge-to-main');
      expect(result.allowed).toBe(false);
      expect(result.suggestion).toBeDefined();
      expect(result.suggestion).toContain('task branch');
    });

    it('contributor denied config:modify gets admin suggestion', () => {
      const result = ac.check('contributor-user', 'config:modify');
      expect(result.allowed).toBe(false);
      expect(result.suggestion).toContain('admin');
    });

    it('maintainer denied config:modify gets admin suggestion', () => {
      const result = ac.check('maintainer-user', 'config:modify');
      expect(result.allowed).toBe(false);
      expect(result.suggestion).toContain('admin');
    });

    it('contributor denied conflict:force-resolve gets tiered resolution suggestion', () => {
      const result = ac.check('contributor-user', 'conflict:force-resolve');
      expect(result.allowed).toBe(false);
      expect(result.suggestion).toContain('tiered resolution');
    });

    it('contributor denied agent-state:modify gets admin-only suggestion', () => {
      const result = ac.check('contributor-user', 'agent-state:modify');
      expect(result.allowed).toBe(false);
      expect(result.suggestion).toContain('admin');
    });

    it('allowed results have no suggestion', () => {
      const result = ac.check('admin-user', 'config:modify');
      expect(result.allowed).toBe(true);
      expect(result.suggestion).toBeUndefined();
    });

    it('some denied permissions have no suggestion', () => {
      // ledger:write-any denied for contributor - may or may not have suggestion
      const result = ac.check('contributor-user', 'ledger:write-any');
      expect(result.allowed).toBe(false);
      // suggestion may be undefined for permissions without a defined suggestion
      expect(typeof result.suggestion === 'string' || result.suggestion === undefined).toBe(true);
    });
  });
});

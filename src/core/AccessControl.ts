/**
 * AccessControl — Role-Based Access Control for multi-user sync.
 *
 * Three roles with escalating permissions:
 *   - Contributor: code changes via branches only
 *   - Maintainer: code + limited config, direct branch merge
 *   - Admin: full control including force-resolve and config changes
 *
 * From INTELLIGENT_SYNC_SPEC Section 5.5 (Access Control).
 */

// ── Types ────────────────────────────────────────────────────────────

export type UserRole = 'admin' | 'maintainer' | 'contributor';

export type Permission =
  | 'code:modify'
  | 'code:merge-to-main'
  | 'config:read'
  | 'config:modify'
  | 'agent-state:modify'
  | 'conflict:force-resolve'
  | 'branch:create'
  | 'branch:merge'
  | 'ledger:write-own'
  | 'ledger:write-any';

export interface AccessCheckResult {
  /** Whether the action is allowed. */
  allowed: boolean;
  /** The user's role. */
  role: UserRole;
  /** The permission that was checked. */
  permission: Permission;
  /** Reason for denial, if not allowed. */
  reason?: string;
  /** Suggested alternative action. */
  suggestion?: string;
}

export interface UserRoleEntry {
  /** User ID. */
  userId: string;
  /** Assigned role. */
  role: UserRole;
  /** When the role was assigned. */
  assignedAt: string;
  /** Who assigned the role (userId or 'system'). */
  assignedBy: string;
}

export interface AccessControlConfig {
  /** User role assignments. */
  roles: UserRoleEntry[];
  /** Default role for unknown users (default: 'contributor'). */
  defaultRole?: UserRole;
  /** Whether RBAC is enabled (false = all permissions granted). */
  enabled?: boolean;
}

// ── Constants ────────────────────────────────────────────────────────

/**
 * Permission matrix per spec Section 5.5.
 */
const ROLE_PERMISSIONS: Record<UserRole, Set<Permission>> = {
  admin: new Set([
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
  ]),
  maintainer: new Set([
    'code:modify',
    'code:merge-to-main',
    'config:read',
    'branch:create',
    'branch:merge',
    'ledger:write-own',
  ]),
  contributor: new Set([
    'code:modify',
    'config:read',
    'branch:create',
    'ledger:write-own',
  ]),
};

/**
 * Human-readable permission descriptions for error messages.
 */
const PERMISSION_DESCRIPTIONS: Record<Permission, string> = {
  'code:modify': 'Modify code files',
  'code:merge-to-main': 'Merge directly to main branch',
  'config:read': 'Read configuration',
  'config:modify': 'Modify configuration',
  'agent-state:modify': 'Modify agent state',
  'conflict:force-resolve': 'Force-resolve conflicts (skip LLM resolution)',
  'branch:create': 'Create task branches',
  'branch:merge': 'Merge task branches',
  'ledger:write-own': 'Write own ledger entries',
  'ledger:write-any': "Write any machine's ledger entries",
};

/**
 * Suggestions for denied permissions.
 */
const DENIAL_SUGGESTIONS: Partial<Record<Permission, Partial<Record<UserRole, string>>>> = {
  'code:merge-to-main': {
    contributor: 'Use a task branch and submit through tiered resolution instead',
  },
  'config:modify': {
    contributor: 'Request an admin to make config changes',
    maintainer: 'Request an admin to make config changes',
  },
  'conflict:force-resolve': {
    contributor: 'Use the tiered resolution system (Tier 0 → Tier 2)',
    maintainer: 'Use the tiered resolution system (Tier 0 → Tier 2)',
  },
  'agent-state:modify': {
    contributor: 'Only admins can modify agent state',
    maintainer: 'Only admins can modify agent state',
  },
};

// ── AccessControl ────────────────────────────────────────────────────

export class AccessControl {
  private roles: Map<string, UserRoleEntry>;
  private defaultRole: UserRole;
  private enabled: boolean;

  constructor(config: AccessControlConfig) {
    this.roles = new Map();
    for (const entry of config.roles) {
      this.roles.set(entry.userId, entry);
    }
    this.defaultRole = config.defaultRole ?? 'contributor';
    this.enabled = config.enabled ?? true;
  }

  // ── Permission Checks ─────────────────────────────────────────────

  /**
   * Check if a user has a specific permission.
   */
  check(userId: string, permission: Permission): AccessCheckResult {
    // If RBAC is disabled, allow everything
    if (!this.enabled) {
      return {
        allowed: true,
        role: this.getUserRole(userId),
        permission,
      };
    }

    const role = this.getUserRole(userId);
    const allowed = ROLE_PERMISSIONS[role].has(permission);

    if (allowed) {
      return { allowed: true, role, permission };
    }

    const suggestion = DENIAL_SUGGESTIONS[permission]?.[role];

    return {
      allowed: false,
      role,
      permission,
      reason: `Role "${role}" does not have permission "${permission}" (${PERMISSION_DESCRIPTIONS[permission]})`,
      suggestion,
    };
  }

  /**
   * Check multiple permissions at once.
   * Returns true only if ALL permissions are granted.
   */
  checkAll(userId: string, permissions: Permission[]): {
    allowed: boolean;
    results: AccessCheckResult[];
  } {
    const results = permissions.map(p => this.check(userId, p));
    return {
      allowed: results.every(r => r.allowed),
      results,
    };
  }

  /**
   * Check if a user has ANY of the given permissions.
   */
  checkAny(userId: string, permissions: Permission[]): {
    allowed: boolean;
    results: AccessCheckResult[];
  } {
    const results = permissions.map(p => this.check(userId, p));
    return {
      allowed: results.some(r => r.allowed),
      results,
    };
  }

  // ── Role Management ───────────────────────────────────────────────

  /**
   * Get a user's role.
   */
  getUserRole(userId: string): UserRole {
    return this.roles.get(userId)?.role ?? this.defaultRole;
  }

  /**
   * Set a user's role (requires admin).
   */
  setUserRole(
    adminUserId: string,
    targetUserId: string,
    newRole: UserRole,
  ): { success: boolean; error?: string } {
    // Verify admin has permission
    if (this.enabled) {
      const adminRole = this.getUserRole(adminUserId);
      if (adminRole !== 'admin') {
        return { success: false, error: 'Only admins can assign roles' };
      }
    }

    this.roles.set(targetUserId, {
      userId: targetUserId,
      role: newRole,
      assignedAt: new Date().toISOString(),
      assignedBy: adminUserId,
    });

    return { success: true };
  }

  /**
   * List all role assignments.
   */
  listRoles(): UserRoleEntry[] {
    return [...this.roles.values()];
  }

  /**
   * Get all permissions for a role.
   */
  getPermissionsForRole(role: UserRole): Permission[] {
    return [...ROLE_PERMISSIONS[role]];
  }

  /**
   * Check if RBAC is enabled.
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}

/**
 * MigrationProvenance — audit trail for post-update migrations.
 *
 * Part of Phase 4 of the Adaptive Autonomy System (Improvement 6).
 *
 * Logs what changed during each PostUpdateMigrator run:
 * - Which hooks were regenerated
 * - Which CLAUDE.md sections were added
 * - Which scripts were installed
 *
 * At cautious/supervised profiles, sends Telegram summary.
 * At collaborative/autonomous profiles, log only.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { MigrationResult } from './PostUpdateMigrator.js';
import type { AutonomyProfileLevel } from './types.js';

// ── Types ────────────────────────────────────────────────────────────

export interface MigrationLogEntry {
  timestamp: string;
  fromVersion: string;
  toVersion: string;
  changes: MigrationChange[];
  /** Total items upgraded */
  upgradedCount: number;
  /** Total items skipped */
  skippedCount: number;
  /** Total errors */
  errorCount: number;
}

export interface MigrationChange {
  type: 'hook-regenerated' | 'claude-md-patched' | 'script-installed' | 'config-migrated' | 'settings-migrated' | 'gitignore-updated' | 'error';
  path?: string;
  section?: string;
  detail: string;
}

// ── Provenance Logger ─────────────────────────────────────────────────

export class MigrationProvenance {
  private logPath: string;

  constructor(stateDir: string) {
    const stateSubDir = path.join(stateDir, 'state');
    fs.mkdirSync(stateSubDir, { recursive: true });
    this.logPath = path.join(stateSubDir, 'migration-log.jsonl');
  }

  /**
   * Log a migration result with version context.
   */
  logMigration(
    fromVersion: string,
    toVersion: string,
    result: MigrationResult,
  ): MigrationLogEntry {
    const changes = this.parseChanges(result);

    const entry: MigrationLogEntry = {
      timestamp: new Date().toISOString(),
      fromVersion,
      toVersion,
      changes,
      upgradedCount: result.upgraded.length,
      skippedCount: result.skipped.length,
      errorCount: result.errors.length,
    };

    this.appendLog(entry);
    return entry;
  }

  /**
   * Read all migration log entries.
   */
  getLog(): MigrationLogEntry[] {
    if (!fs.existsSync(this.logPath)) return [];

    try {
      const content = fs.readFileSync(this.logPath, 'utf-8').trim();
      if (!content) return [];

      return content
        .split('\n')
        .map(line => {
          try {
            return JSON.parse(line) as MigrationLogEntry;
          } catch {
            return null;
          }
        })
        .filter((e): e is MigrationLogEntry => e !== null);
    } catch {
      // @silent-fallback-ok — empty log on read failure
      return [];
    }
  }

  /**
   * Get the most recent migration log entry.
   */
  getLatest(): MigrationLogEntry | null {
    const entries = this.getLog();
    return entries.length > 0 ? entries[entries.length - 1] : null;
  }

  /**
   * Format a migration log entry for Telegram notification.
   */
  formatNotification(entry: MigrationLogEntry): string {
    const lines: string[] = [];
    lines.push(`📦 Post-Update Migration: ${entry.fromVersion} → ${entry.toVersion}`);
    lines.push('');

    if (entry.upgradedCount > 0) {
      lines.push(`✅ ${entry.upgradedCount} items upgraded:`);
      for (const change of entry.changes) {
        if (change.type !== 'error') {
          lines.push(`  • ${change.detail}`);
        }
      }
    }

    if (entry.errorCount > 0) {
      lines.push('');
      lines.push(`⚠️ ${entry.errorCount} errors:`);
      for (const change of entry.changes) {
        if (change.type === 'error') {
          lines.push(`  • ${change.detail}`);
        }
      }
    }

    if (entry.skippedCount > 0) {
      lines.push('');
      lines.push(`⏭️ ${entry.skippedCount} items already up to date`);
    }

    return lines.join('\n');
  }

  /**
   * Determine whether a Telegram notification should be sent based on autonomy profile.
   * Cautious/supervised: always notify. Collaborative/autonomous: log only.
   */
  shouldNotify(profile: AutonomyProfileLevel): boolean {
    return profile === 'cautious' || profile === 'supervised';
  }

  // ── Private ─────────────────────────────────────────────────────────

  private parseChanges(result: MigrationResult): MigrationChange[] {
    const changes: MigrationChange[] = [];

    for (const item of result.upgraded) {
      const change = this.classifyChange(item);
      changes.push(change);
    }

    for (const error of result.errors) {
      changes.push({
        type: 'error',
        detail: error,
      });
    }

    return changes;
  }

  private classifyChange(item: string): MigrationChange {
    if (item.startsWith('hooks/')) {
      return {
        type: 'hook-regenerated',
        path: item.split(' (')[0],
        detail: item,
      };
    }

    if (item.startsWith('CLAUDE.md')) {
      const sectionMatch = item.match(/section: (.+)/);
      return {
        type: 'claude-md-patched',
        section: sectionMatch?.[1],
        detail: item,
      };
    }

    if (item.startsWith('scripts/')) {
      return {
        type: 'script-installed',
        path: item.split(' (')[0],
        detail: item,
      };
    }

    if (item.includes('config') || item.includes('Config')) {
      return {
        type: 'config-migrated',
        detail: item,
      };
    }

    if (item.includes('settings') || item.includes('Settings')) {
      return {
        type: 'settings-migrated',
        detail: item,
      };
    }

    if (item.includes('gitignore')) {
      return {
        type: 'gitignore-updated',
        detail: item,
      };
    }

    // Default classification
    return {
      type: 'config-migrated',
      detail: item,
    };
  }

  private appendLog(entry: MigrationLogEntry): void {
    try {
      fs.appendFileSync(this.logPath, JSON.stringify(entry) + '\n');
    } catch {
      // @silent-fallback-ok — provenance is non-critical
    }
  }
}

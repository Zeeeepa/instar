/**
 * WorkLedger — Per-machine work tracking for inter-agent awareness.
 *
 * Each machine writes only its own ledger file. The aggregate view is
 * computed by reading all files in the ledger directory. This eliminates
 * write contention entirely — conflicts on ledger files are structurally
 * impossible in single-user scenarios.
 *
 * From INTELLIGENT_SYNC_SPEC Section 6 (The Work Ledger) and Section 8
 * (Conflict Prevention Through Awareness).
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// ── Types ────────────────────────────────────────────────────────────

export type LedgerEntryStatus = 'active' | 'paused' | 'completed' | 'stale';

export interface LedgerEntry {
  /** Unique entry ID (work_<random>). */
  id: string;
  /** Machine that owns this entry. */
  machineId: string;
  /** User ID (for multi-user scenarios). */
  userId?: string;
  /** Session ID (e.g., AUT-150). */
  sessionId: string;
  /** When the work started. */
  startedAt: string;
  /** Last update timestamp. */
  updatedAt: string;
  /** Current status. */
  status: LedgerEntryStatus;
  /** Human-readable task description. */
  task: string;
  /** Files the agent plans to modify. */
  filesPlanned: string[];
  /** Files actually modified so far. */
  filesModified: string[];
  /** Branch name (if working on a task branch). */
  branch?: string;
  /** Estimated completion time. */
  estimatedCompletion?: string;
  /** Ed25519 signature (optional in Phase 2). */
  signature?: string;
  /** Fields included in the signature. */
  signedFields?: string[];
}

export interface MachineLedger {
  schemaVersion: number;
  machineId: string;
  lastUpdated: string;
  entries: LedgerEntry[];
  lastCleanup: string;
}

export type OverlapTier = 0 | 1 | 2 | 3;

export interface OverlapWarning {
  /** Severity tier (0=none, 1=planned, 2=active, 3=architectural). */
  tier: OverlapTier;
  /** The entry that overlaps with planned work. */
  entry: LedgerEntry;
  /** Files that overlap. */
  overlappingFiles: string[];
  /** Human-readable description. */
  message: string;
}

export interface WorkLedgerConfig {
  /** State directory (.instar). */
  stateDir: string;
  /** This machine's ID. */
  machineId: string;
  /** User ID (for multi-user scenarios). */
  userId?: string;
  /** Max age for completed entries before cleanup (ms, default: 24h). */
  completedMaxAgeMs?: number;
  /** Max age for stale detection (ms, default: 2h). */
  staleThresholdMs?: number;
  /** Max age for stale entries before removal (ms, default: 6h). */
  staleMaxAgeMs?: number;
}

// ── Constants ────────────────────────────────────────────────────────

const SCHEMA_VERSION = 1;
const DEFAULT_COMPLETED_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_STALE_THRESHOLD = 2 * 60 * 60 * 1000; // 2 hours
const DEFAULT_STALE_MAX_AGE = 6 * 60 * 60 * 1000; // 6 hours

// ── WorkLedger ───────────────────────────────────────────────────────

export class WorkLedger {
  private stateDir: string;
  private machineId: string;
  private userId?: string;
  private ledgerDir: string;
  private completedMaxAgeMs: number;
  private staleThresholdMs: number;
  private staleMaxAgeMs: number;

  constructor(config: WorkLedgerConfig) {
    this.stateDir = config.stateDir;
    this.machineId = config.machineId;
    this.userId = config.userId;
    this.ledgerDir = path.join(config.stateDir, 'state', 'ledger');
    this.completedMaxAgeMs = config.completedMaxAgeMs ?? DEFAULT_COMPLETED_MAX_AGE;
    this.staleThresholdMs = config.staleThresholdMs ?? DEFAULT_STALE_THRESHOLD;
    this.staleMaxAgeMs = config.staleMaxAgeMs ?? DEFAULT_STALE_MAX_AGE;

    // Ensure ledger directory exists
    if (!fs.existsSync(this.ledgerDir)) {
      fs.mkdirSync(this.ledgerDir, { recursive: true });
    }
  }

  // ── Session Lifecycle ────────────────────────────────────────────

  /**
   * Record the start of a work session. Returns the created entry.
   */
  startWork(opts: {
    sessionId: string;
    task: string;
    filesPlanned?: string[];
    branch?: string;
    estimatedCompletion?: string;
  }): LedgerEntry {
    const entry: LedgerEntry = {
      id: `work_${crypto.randomBytes(6).toString('hex')}`,
      machineId: this.machineId,
      userId: this.userId,
      sessionId: opts.sessionId,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'active',
      task: opts.task,
      filesPlanned: opts.filesPlanned ?? [],
      filesModified: [],
      branch: opts.branch,
      estimatedCompletion: opts.estimatedCompletion,
    };

    const ledger = this.readOwnLedger();
    ledger.entries.push(entry);
    this.writeOwnLedger(ledger);

    return entry;
  }

  /**
   * Update an active work entry (called periodically during work).
   */
  updateWork(entryId: string, updates: {
    task?: string;
    filesModified?: string[];
    filesPlanned?: string[];
    estimatedCompletion?: string;
  }): boolean {
    const ledger = this.readOwnLedger();
    const entry = ledger.entries.find(e => e.id === entryId);
    if (!entry || entry.status !== 'active') return false;

    if (updates.task !== undefined) entry.task = updates.task;
    if (updates.filesPlanned !== undefined) entry.filesPlanned = updates.filesPlanned;
    if (updates.estimatedCompletion !== undefined) entry.estimatedCompletion = updates.estimatedCompletion;

    // Merge filesModified (union, not replace)
    if (updates.filesModified) {
      const combined = new Set([...entry.filesModified, ...updates.filesModified]);
      entry.filesModified = [...combined];
    }

    entry.updatedAt = new Date().toISOString();
    this.writeOwnLedger(ledger);
    return true;
  }

  /**
   * End a work session (mark as completed or paused).
   */
  endWork(entryId: string, status: 'completed' | 'paused' = 'completed'): boolean {
    const ledger = this.readOwnLedger();
    const entry = ledger.entries.find(e => e.id === entryId);
    if (!entry) return false;

    entry.status = status;
    entry.updatedAt = new Date().toISOString();
    this.writeOwnLedger(ledger);
    return true;
  }

  // ── Reading ──────────────────────────────────────────────────────

  /**
   * Read this machine's ledger file.
   */
  readOwnLedger(): MachineLedger {
    const filePath = this.ledgerFilePath(this.machineId);
    return this.readLedgerFile(filePath);
  }

  /**
   * Get aggregate view of all active/paused entries across all machines.
   */
  getActiveEntries(): LedgerEntry[] {
    return this.readAllLedgers()
      .flatMap(l => l.entries)
      .filter(e => e.status === 'active' || e.status === 'paused');
  }

  /**
   * Get all entries across all machines (including completed/stale).
   */
  getAllEntries(): LedgerEntry[] {
    return this.readAllLedgers().flatMap(l => l.entries);
  }

  /**
   * Read all machine ledger files.
   */
  readAllLedgers(): MachineLedger[] {
    if (!fs.existsSync(this.ledgerDir)) return [];

    const files = fs.readdirSync(this.ledgerDir)
      .filter(f => f.endsWith('.json'));

    return files.map(f => {
      const filePath = path.join(this.ledgerDir, f);
      return this.readLedgerFile(filePath);
    });
  }

  // ── Overlap Detection ────────────────────────────────────────────

  /**
   * Check for overlap between planned files and active ledger entries.
   * Returns warnings sorted by severity (highest first).
   */
  detectOverlap(myPlannedFiles: string[]): OverlapWarning[] {
    if (myPlannedFiles.length === 0) return [];

    const activeEntries = this.getActiveEntries()
      // Exclude own machine's entries
      .filter(e => e.machineId !== this.machineId);

    const warnings: OverlapWarning[] = [];
    const plannedSet = new Set(myPlannedFiles);

    for (const entry of activeEntries) {
      // Check against both planned and modified files
      const entryFiles = new Set([...entry.filesPlanned, ...entry.filesModified]);
      const overlapping = myPlannedFiles.filter(f => entryFiles.has(f));

      if (overlapping.length === 0) continue;

      // Determine tier based on whether overlap is with planned or modified files
      const modifiedOverlap = overlapping.filter(f => entry.filesModified.includes(f));

      let tier: OverlapTier;
      let message: string;

      if (modifiedOverlap.length > 0) {
        // Active overlap — files are already being modified
        tier = 2;
        message = `Warning: Machine "${entry.machineId}" is actively modifying ${modifiedOverlap.join(', ')} that you also plan to change. Consider branching or waiting.`;
      } else {
        // Planned overlap — files are planned but not yet touched
        tier = 1;
        message = `Note: Machine "${entry.machineId}" is planning to modify ${overlapping.join(', ')}. Proceeding with awareness.`;
      }

      warnings.push({
        tier,
        entry,
        overlappingFiles: overlapping,
        message,
      });
    }

    // Sort by tier descending (highest severity first)
    return warnings.sort((a, b) => b.tier - a.tier);
  }

  // ── Cleanup ──────────────────────────────────────────────────────

  /**
   * Clean up this machine's ledger entries:
   * - Remove completed entries older than 24h
   * - Mark entries with stale updatedAt (>2h) as "stale"
   * - Remove stale entries older than 6h
   *
   * Returns the number of entries removed/modified.
   */
  cleanup(): { removed: number; markedStale: number } {
    const ledger = this.readOwnLedger();
    const now = Date.now();
    let removed = 0;
    let markedStale = 0;

    ledger.entries = ledger.entries.filter(entry => {
      const updatedAge = now - new Date(entry.updatedAt).getTime();

      // Remove completed entries older than threshold
      if (entry.status === 'completed' && updatedAge > this.completedMaxAgeMs) {
        removed++;
        return false;
      }

      // Remove stale entries older than max age
      if (entry.status === 'stale' && updatedAge > this.staleMaxAgeMs) {
        removed++;
        return false;
      }

      // Mark active entries as stale if updatedAt is too old
      if (entry.status === 'active' && updatedAge > this.staleThresholdMs) {
        entry.status = 'stale';
        markedStale++;
      }

      return true;
    });

    ledger.lastCleanup = new Date().toISOString();
    this.writeOwnLedger(ledger);

    return { removed, markedStale };
  }

  // ── Private Helpers ──────────────────────────────────────────────

  private ledgerFilePath(machineId: string): string {
    return path.join(this.ledgerDir, `${machineId}.json`);
  }

  private readLedgerFile(filePath: string): MachineLedger {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as MachineLedger;
    } catch {
      // File doesn't exist or is invalid — return empty ledger
      const machineId = path.basename(filePath, '.json');
      return {
        schemaVersion: SCHEMA_VERSION,
        machineId,
        lastUpdated: new Date().toISOString(),
        entries: [],
        lastCleanup: new Date().toISOString(),
      };
    }
  }

  private writeOwnLedger(ledger: MachineLedger): void {
    ledger.lastUpdated = new Date().toISOString();
    ledger.schemaVersion = SCHEMA_VERSION;
    ledger.machineId = this.machineId;

    const filePath = this.ledgerFilePath(this.machineId);
    fs.writeFileSync(filePath, JSON.stringify(ledger, null, 2));
  }
}

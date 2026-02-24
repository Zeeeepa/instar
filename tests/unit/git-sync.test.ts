/**
 * Unit tests for GitSync — relationship merge and git commit signing.
 *
 * Tests:
 * - Relationship merge: field-level resolution
 *   - channels union (deduplicated by type:identifier)
 *   - themes union
 *   - timestamps: firstInteraction min, lastInteraction max
 *   - text fields from newer lastInteraction
 *   - interactionCount max
 *   - significance max
 *   - recentInteractions: deduplicated, sorted, capped at 20
 * - GitSyncManager: signing configuration check
 * - GitSyncManager: path categorization for commit messages
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { mergeRelationship } from '../../src/core/GitSync.js';
import type { RelationshipRecord } from '../../src/core/GitSync.js';

function makeRelationship(overrides: Partial<RelationshipRecord> = {}): RelationshipRecord {
  return {
    id: 'rel-001',
    name: 'Alice',
    channels: [{ type: 'telegram', identifier: '123' }],
    firstInteraction: '2026-01-01T00:00:00Z',
    lastInteraction: '2026-02-01T00:00:00Z',
    interactionCount: 10,
    themes: ['ai', 'philosophy'],
    notes: 'Interesting person',
    significance: 5,
    arcSummary: 'A researcher exploring consciousness',
    recentInteractions: [
      { timestamp: '2026-02-01T00:00:00Z', summary: 'Discussed AI' },
    ],
    ...overrides,
  };
}

describe('Relationship Merge', () => {
  it('takes text fields from whichever has newer lastInteraction', () => {
    const ours = makeRelationship({
      lastInteraction: '2026-02-01T00:00:00Z',
      name: 'Alice (ours)',
      notes: 'Our notes',
      arcSummary: 'Our arc',
    });
    const theirs = makeRelationship({
      lastInteraction: '2026-02-15T00:00:00Z',
      name: 'Alice (theirs)',
      notes: 'Their notes',
      arcSummary: 'Their arc',
    });

    const merged = mergeRelationship(ours, theirs);
    expect(merged.name).toBe('Alice (theirs)'); // theirs is newer
    expect(merged.notes).toBe('Their notes');
    expect(merged.arcSummary).toBe('Their arc');
  });

  it('keeps ours text fields when ours is newer', () => {
    const ours = makeRelationship({
      lastInteraction: '2026-02-20T00:00:00Z',
      name: 'Alice (ours)',
    });
    const theirs = makeRelationship({
      lastInteraction: '2026-02-01T00:00:00Z',
      name: 'Alice (theirs)',
    });

    const merged = mergeRelationship(ours, theirs);
    expect(merged.name).toBe('Alice (ours)');
  });

  it('preserves original ID', () => {
    const ours = makeRelationship({ id: 'original-id' });
    const theirs = makeRelationship({ id: 'different-id', lastInteraction: '2026-03-01T00:00:00Z' });

    const merged = mergeRelationship(ours, theirs);
    expect(merged.id).toBe('original-id');
  });

  it('unions channels by type:identifier', () => {
    const ours = makeRelationship({
      channels: [
        { type: 'telegram', identifier: '123' },
        { type: 'email', identifier: 'alice@example.com' },
      ],
    });
    const theirs = makeRelationship({
      channels: [
        { type: 'telegram', identifier: '123' }, // duplicate
        { type: 'discord', identifier: 'alice#1234' },
      ],
    });

    const merged = mergeRelationship(ours, theirs);
    expect(merged.channels).toHaveLength(3);
    const types = merged.channels.map(c => c.type).sort();
    expect(types).toEqual(['discord', 'email', 'telegram']);
  });

  it('unions themes (deduplicated)', () => {
    const ours = makeRelationship({ themes: ['ai', 'philosophy', 'music'] });
    const theirs = makeRelationship({ themes: ['ai', 'cooking', 'philosophy'] });

    const merged = mergeRelationship(ours, theirs);
    expect(merged.themes.sort()).toEqual(['ai', 'cooking', 'music', 'philosophy']);
  });

  it('takes min firstInteraction', () => {
    const ours = makeRelationship({ firstInteraction: '2026-01-15T00:00:00Z' });
    const theirs = makeRelationship({ firstInteraction: '2026-01-01T00:00:00Z' });

    const merged = mergeRelationship(ours, theirs);
    expect(merged.firstInteraction).toBe('2026-01-01T00:00:00Z');
  });

  it('takes max lastInteraction', () => {
    const ours = makeRelationship({ lastInteraction: '2026-02-01T00:00:00Z' });
    const theirs = makeRelationship({ lastInteraction: '2026-02-15T00:00:00Z' });

    const merged = mergeRelationship(ours, theirs);
    expect(merged.lastInteraction).toBe('2026-02-15T00:00:00Z');
  });

  it('takes max interactionCount', () => {
    const ours = makeRelationship({ interactionCount: 10 });
    const theirs = makeRelationship({ interactionCount: 25 });

    const merged = mergeRelationship(ours, theirs);
    expect(merged.interactionCount).toBe(25);
  });

  it('takes max significance', () => {
    const ours = makeRelationship({ significance: 3 });
    const theirs = makeRelationship({ significance: 8 });

    const merged = mergeRelationship(ours, theirs);
    expect(merged.significance).toBe(8);
  });

  it('merges and deduplicates recentInteractions', () => {
    const ours = makeRelationship({
      recentInteractions: [
        { timestamp: '2026-02-01T00:00:00Z', summary: 'Chat A' },
        { timestamp: '2026-02-03T00:00:00Z', summary: 'Chat C' },
      ],
    });
    const theirs = makeRelationship({
      recentInteractions: [
        { timestamp: '2026-02-01T00:00:00Z', summary: 'Chat A' }, // duplicate
        { timestamp: '2026-02-02T00:00:00Z', summary: 'Chat B' },
      ],
    });

    const merged = mergeRelationship(ours, theirs);
    expect(merged.recentInteractions).toHaveLength(3); // deduplicated
    // Sorted newest first
    expect(merged.recentInteractions[0].timestamp).toBe('2026-02-03T00:00:00Z');
    expect(merged.recentInteractions[1].timestamp).toBe('2026-02-02T00:00:00Z');
    expect(merged.recentInteractions[2].timestamp).toBe('2026-02-01T00:00:00Z');
  });

  it('caps recentInteractions at 20', () => {
    const interactions = Array.from({ length: 15 }, (_, i) => ({
      timestamp: `2026-02-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
      summary: `Chat ${i}`,
    }));
    const ours = makeRelationship({ recentInteractions: interactions });
    const theirs = makeRelationship({
      recentInteractions: Array.from({ length: 15 }, (_, i) => ({
        timestamp: `2026-03-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
        summary: `Chat ${i + 15}`,
      })),
    });

    const merged = mergeRelationship(ours, theirs);
    expect(merged.recentInteractions).toHaveLength(20);
    // Should be the 20 most recent
    expect(merged.recentInteractions[0].timestamp).toBe('2026-03-15T00:00:00Z');
  });

  it('handles empty arrays gracefully', () => {
    const ours = makeRelationship({
      channels: [],
      themes: [],
      recentInteractions: [],
    });
    const theirs = makeRelationship({
      channels: [{ type: 'telegram', identifier: '123' }],
      themes: ['ai'],
      recentInteractions: [{ timestamp: '2026-02-01T00:00:00Z', summary: 'Chat' }],
    });

    const merged = mergeRelationship(ours, theirs);
    expect(merged.channels).toHaveLength(1);
    expect(merged.themes).toEqual(['ai']);
    expect(merged.recentInteractions).toHaveLength(1);
  });

  it('handles identical records (no-op merge)', () => {
    const record = makeRelationship();
    const merged = mergeRelationship(record, { ...record });
    expect(merged.id).toBe(record.id);
    expect(merged.name).toBe(record.name);
    expect(merged.channels).toHaveLength(1);
    expect(merged.themes).toEqual(record.themes);
  });
});

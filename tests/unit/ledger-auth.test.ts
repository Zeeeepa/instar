/**
 * Unit tests for LedgerAuth — Ed25519 authentication for work ledger entries.
 *
 * Tests:
 * - Signing: Canonicalization (alphabetical sort, key=value\n format), signature format
 * - Verification: Valid signature passes, tampered entry fails, unsigned entry handling
 * - Key resolution: key-not-found, key-revoked statuses
 * - signEntryInPlace: Mutates entry correctly
 * - verifyEntries: Groups trusted/untrusted correctly
 * - Edge cases: Missing private key, undefined fields in canonicalization
 */

import { describe, it, expect } from 'vitest';
import { LedgerAuth } from '../../src/core/LedgerAuth.js';
import { generateSigningKeyPair } from '../../src/core/MachineIdentity.js';
import type { LedgerEntry } from '../../src/core/WorkLedger.js';

// ── Test Helpers ─────────────────────────────────────────────────────

function createTestEntry(overrides?: Partial<LedgerEntry>): LedgerEntry {
  return {
    id: 'work_test001',
    machineId: 'm_testmachine001',
    userId: 'user-alice',
    sessionId: 'AUT-100',
    startedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T01:00:00.000Z',
    status: 'active',
    task: 'Implement feature X',
    filesPlanned: ['src/feature.ts'],
    filesModified: [],
    ...overrides,
  };
}

function createKeyPairAndResolver() {
  const keyPair = generateSigningKeyPair();
  const machineId = 'm_testmachine001';
  const keyResolver = (id: string) => {
    if (id === machineId) {
      return { publicKey: keyPair.publicKey, revoked: false, machineId };
    }
    return null;
  };
  return { keyPair, machineId, keyResolver };
}

// ── Signing ──────────────────────────────────────────────────────────

describe('LedgerAuth', () => {
  describe('Signing', () => {
    it('signs an entry successfully with a private key', () => {
      const { keyPair, machineId, keyResolver } = createKeyPairAndResolver();
      const auth = new LedgerAuth({
        scenario: 'same-user',
        privateKey: keyPair.privateKey,
        machineId,
        keyResolver,
      });

      const entry = createTestEntry();
      const result = auth.signEntry(entry);

      expect(result.success).toBe(true);
      expect(result.signature).toBeDefined();
      expect(result.signedFields).toBeDefined();
    });

    it('produces signature in ed25519:base64... format', () => {
      const { keyPair, machineId, keyResolver } = createKeyPairAndResolver();
      const auth = new LedgerAuth({
        scenario: 'same-user',
        privateKey: keyPair.privateKey,
        machineId,
        keyResolver,
      });

      const entry = createTestEntry();
      const result = auth.signEntry(entry);

      expect(result.signature).toMatch(/^ed25519:/);
      // After prefix, should be base64
      const base64Part = result.signature!.slice('ed25519:'.length);
      expect(base64Part.length).toBeGreaterThan(0);
      // Base64 pattern
      expect(base64Part).toMatch(/^[A-Za-z0-9+/]+=*$/);
    });

    it('uses default signed fields (alphabetically sorted in canonicalization)', () => {
      const { keyPair, machineId, keyResolver } = createKeyPairAndResolver();
      const auth = new LedgerAuth({
        scenario: 'same-user',
        privateKey: keyPair.privateKey,
        machineId,
        keyResolver,
      });

      const entry = createTestEntry();
      const result = auth.signEntry(entry);

      expect(result.signedFields).toContain('machineId');
      expect(result.signedFields).toContain('userId');
      expect(result.signedFields).toContain('sessionId');
      expect(result.signedFields).toContain('task');
      expect(result.signedFields).toContain('status');
      expect(result.signedFields).toContain('updatedAt');
    });

    it('allows custom fields for signing', () => {
      const { keyPair, machineId, keyResolver } = createKeyPairAndResolver();
      const auth = new LedgerAuth({
        scenario: 'same-user',
        privateKey: keyPair.privateKey,
        machineId,
        keyResolver,
      });

      const entry = createTestEntry();
      const result = auth.signEntry(entry, ['machineId', 'task']);

      expect(result.success).toBe(true);
      expect(result.signedFields).toEqual(['machineId', 'task']);
    });

    it('fails gracefully when no private key (same-user mode)', () => {
      const { machineId, keyResolver } = createKeyPairAndResolver();
      const auth = new LedgerAuth({
        scenario: 'same-user',
        machineId,
        keyResolver,
      });

      const entry = createTestEntry();
      const result = auth.signEntry(entry);

      expect(result.success).toBe(false);
      expect(result.error).toContain('optional');
    });

    it('fails with error when no private key (multi-user mode)', () => {
      const { machineId, keyResolver } = createKeyPairAndResolver();
      const auth = new LedgerAuth({
        scenario: 'multi-user',
        machineId,
        keyResolver,
      });

      const entry = createTestEntry();
      const result = auth.signEntry(entry);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Private key required');
    });
  });

  // ── Verification ────────────────────────────────────────────────────

  describe('Verification', () => {
    it('verifies a valid signed entry', () => {
      const { keyPair, machineId, keyResolver } = createKeyPairAndResolver();
      const auth = new LedgerAuth({
        scenario: 'same-user',
        privateKey: keyPair.privateKey,
        machineId,
        keyResolver,
      });

      const entry = createTestEntry();
      const signResult = auth.signEntry(entry);
      entry.signature = signResult.signature;
      entry.signedFields = signResult.signedFields;

      const verifyResult = auth.verifyEntry(entry);
      expect(verifyResult.status).toBe('valid');
      expect(verifyResult.trusted).toBe(true);
      expect(verifyResult.machineId).toBe(machineId);
    });

    it('detects tampered entry (modified task field)', () => {
      const { keyPair, machineId, keyResolver } = createKeyPairAndResolver();
      const auth = new LedgerAuth({
        scenario: 'same-user',
        privateKey: keyPair.privateKey,
        machineId,
        keyResolver,
      });

      const entry = createTestEntry();
      const signResult = auth.signEntry(entry);
      entry.signature = signResult.signature;
      entry.signedFields = signResult.signedFields;

      // Tamper with a signed field
      entry.task = 'TAMPERED: Delete everything';

      const verifyResult = auth.verifyEntry(entry);
      expect(verifyResult.status).toBe('invalid');
      expect(verifyResult.trusted).toBe(false);
      expect(verifyResult.message).toContain('tampering');
    });

    it('detects tampered entry (modified status field)', () => {
      const { keyPair, machineId, keyResolver } = createKeyPairAndResolver();
      const auth = new LedgerAuth({
        scenario: 'same-user',
        privateKey: keyPair.privateKey,
        machineId,
        keyResolver,
      });

      const entry = createTestEntry();
      const signResult = auth.signEntry(entry);
      entry.signature = signResult.signature;
      entry.signedFields = signResult.signedFields;

      entry.status = 'completed';

      const verifyResult = auth.verifyEntry(entry);
      expect(verifyResult.status).toBe('invalid');
      expect(verifyResult.trusted).toBe(false);
    });

    it('trusts unsigned entries in same-user mode', () => {
      const { machineId, keyResolver } = createKeyPairAndResolver();
      const auth = new LedgerAuth({
        scenario: 'same-user',
        machineId,
        keyResolver,
      });

      const entry = createTestEntry();
      // No signature
      const result = auth.verifyEntry(entry);
      expect(result.status).toBe('unsigned');
      expect(result.trusted).toBe(true);
      expect(result.message).toContain('accepted');
    });

    it('rejects unsigned entries in multi-user mode', () => {
      const { machineId, keyResolver } = createKeyPairAndResolver();
      const auth = new LedgerAuth({
        scenario: 'multi-user',
        machineId,
        keyResolver,
      });

      const entry = createTestEntry();
      const result = auth.verifyEntry(entry);
      expect(result.status).toBe('unsigned');
      expect(result.trusted).toBe(false);
      expect(result.message).toContain('rejected');
    });
  });

  // ── Key Resolution ──────────────────────────────────────────────────

  describe('Key Resolution', () => {
    it('returns key-not-found for unknown machine', () => {
      const { keyPair, machineId } = createKeyPairAndResolver();
      const auth = new LedgerAuth({
        scenario: 'same-user',
        privateKey: keyPair.privateKey,
        machineId,
        keyResolver: () => null, // Always returns null
      });

      const entry = createTestEntry();
      const signResult = auth.signEntry(entry);
      entry.signature = signResult.signature;
      entry.signedFields = signResult.signedFields;

      const verifyResult = auth.verifyEntry(entry);
      expect(verifyResult.status).toBe('key-not-found');
      expect(verifyResult.trusted).toBe(false);
      expect(verifyResult.message).toContain('not found');
    });

    it('returns key-revoked for revoked machine key', () => {
      const { keyPair, machineId } = createKeyPairAndResolver();
      const auth = new LedgerAuth({
        scenario: 'same-user',
        privateKey: keyPair.privateKey,
        machineId,
        keyResolver: (id) => {
          if (id === machineId) {
            return { publicKey: keyPair.publicKey, revoked: true, machineId };
          }
          return null;
        },
      });

      const entry = createTestEntry();
      const signResult = auth.signEntry(entry);
      entry.signature = signResult.signature;
      entry.signedFields = signResult.signedFields;

      const verifyResult = auth.verifyEntry(entry);
      expect(verifyResult.status).toBe('key-revoked');
      expect(verifyResult.trusted).toBe(false);
      expect(verifyResult.message).toContain('revoked');
    });
  });

  // ── signEntryInPlace ────────────────────────────────────────────────

  describe('signEntryInPlace', () => {
    it('mutates entry with signature and signedFields', () => {
      const { keyPair, machineId, keyResolver } = createKeyPairAndResolver();
      const auth = new LedgerAuth({
        scenario: 'same-user',
        privateKey: keyPair.privateKey,
        machineId,
        keyResolver,
      });

      const entry = createTestEntry();
      expect(entry.signature).toBeUndefined();
      expect(entry.signedFields).toBeUndefined();

      const success = auth.signEntryInPlace(entry);
      expect(success).toBe(true);
      expect(entry.signature).toMatch(/^ed25519:/);
      expect(entry.signedFields).toBeInstanceOf(Array);
      expect(entry.signedFields!.length).toBeGreaterThan(0);
    });

    it('returns false when signing fails (no private key)', () => {
      const { machineId, keyResolver } = createKeyPairAndResolver();
      const auth = new LedgerAuth({
        scenario: 'same-user',
        machineId,
        keyResolver,
      });

      const entry = createTestEntry();
      const success = auth.signEntryInPlace(entry);
      expect(success).toBe(false);
      expect(entry.signature).toBeUndefined();
    });

    it('signed-in-place entry passes verification', () => {
      const { keyPair, machineId, keyResolver } = createKeyPairAndResolver();
      const auth = new LedgerAuth({
        scenario: 'same-user',
        privateKey: keyPair.privateKey,
        machineId,
        keyResolver,
      });

      const entry = createTestEntry();
      auth.signEntryInPlace(entry);

      const result = auth.verifyEntry(entry);
      expect(result.status).toBe('valid');
      expect(result.trusted).toBe(true);
    });
  });

  // ── verifyEntries (Batch) ───────────────────────────────────────────

  describe('verifyEntries', () => {
    it('groups trusted and untrusted entries correctly', () => {
      const { keyPair, machineId, keyResolver } = createKeyPairAndResolver();
      const auth = new LedgerAuth({
        scenario: 'multi-user',
        privateKey: keyPair.privateKey,
        machineId,
        keyResolver,
      });

      // Signed entry (trusted)
      const signed = createTestEntry({ id: 'work_signed' });
      auth.signEntryInPlace(signed);

      // Unsigned entry (untrusted in multi-user)
      const unsigned = createTestEntry({ id: 'work_unsigned' });

      const result = auth.verifyEntries([signed, unsigned]);
      expect(result.trusted).toHaveLength(1);
      expect(result.untrusted).toHaveLength(1);
      expect(result.trusted[0].id).toBe('work_signed');
      expect(result.untrusted[0].id).toBe('work_unsigned');
      expect(result.results).toHaveLength(2);
    });

    it('all entries trusted when all are signed correctly', () => {
      const { keyPair, machineId, keyResolver } = createKeyPairAndResolver();
      const auth = new LedgerAuth({
        scenario: 'multi-user',
        privateKey: keyPair.privateKey,
        machineId,
        keyResolver,
      });

      const entries = [
        createTestEntry({ id: 'work_a' }),
        createTestEntry({ id: 'work_b' }),
      ];
      entries.forEach(e => auth.signEntryInPlace(e));

      const result = auth.verifyEntries(entries);
      expect(result.trusted).toHaveLength(2);
      expect(result.untrusted).toHaveLength(0);
    });

    it('handles empty entry list', () => {
      const { machineId, keyResolver } = createKeyPairAndResolver();
      const auth = new LedgerAuth({
        scenario: 'same-user',
        machineId,
        keyResolver,
      });

      const result = auth.verifyEntries([]);
      expect(result.trusted).toHaveLength(0);
      expect(result.untrusted).toHaveLength(0);
      expect(result.results).toHaveLength(0);
    });
  });

  // ── Configuration ───────────────────────────────────────────────────

  describe('Configuration', () => {
    it('isSigningRequired returns true for multi-user', () => {
      const { machineId, keyResolver } = createKeyPairAndResolver();
      const auth = new LedgerAuth({
        scenario: 'multi-user',
        machineId,
        keyResolver,
      });
      expect(auth.isSigningRequired()).toBe(true);
    });

    it('isSigningRequired returns false for same-user', () => {
      const { machineId, keyResolver } = createKeyPairAndResolver();
      const auth = new LedgerAuth({
        scenario: 'same-user',
        machineId,
        keyResolver,
      });
      expect(auth.isSigningRequired()).toBe(false);
    });

    it('getScenario returns the configured scenario', () => {
      const { machineId, keyResolver } = createKeyPairAndResolver();
      const auth = new LedgerAuth({
        scenario: 'multi-user',
        machineId,
        keyResolver,
      });
      expect(auth.getScenario()).toBe('multi-user');
    });
  });

  // ── Edge Cases ──────────────────────────────────────────────────────

  describe('Edge Cases', () => {
    it('handles undefined fields in entry during canonicalization', () => {
      const { keyPair, machineId, keyResolver } = createKeyPairAndResolver();
      const auth = new LedgerAuth({
        scenario: 'same-user',
        privateKey: keyPair.privateKey,
        machineId,
        keyResolver,
      });

      // Entry with undefined userId
      const entry = createTestEntry({ userId: undefined });
      const result = auth.signEntry(entry);
      expect(result.success).toBe(true);

      // The signature should still verify
      entry.signature = result.signature;
      entry.signedFields = result.signedFields;
      const verifyResult = auth.verifyEntry(entry);
      expect(verifyResult.status).toBe('valid');
    });

    it('produces different signatures for different entries', () => {
      const { keyPair, machineId, keyResolver } = createKeyPairAndResolver();
      const auth = new LedgerAuth({
        scenario: 'same-user',
        privateKey: keyPair.privateKey,
        machineId,
        keyResolver,
      });

      const entry1 = createTestEntry({ task: 'Task A' });
      const entry2 = createTestEntry({ task: 'Task B' });

      const sig1 = auth.signEntry(entry1);
      const sig2 = auth.signEntry(entry2);

      expect(sig1.signature).not.toBe(sig2.signature);
    });

    it('cross-machine verification works with correct key resolution', () => {
      const machine1Keys = generateSigningKeyPair();
      const machine2Keys = generateSigningKeyPair();

      const keyResolver = (id: string) => {
        if (id === 'm_machine1') {
          return { publicKey: machine1Keys.publicKey, revoked: false, machineId: 'm_machine1' };
        }
        if (id === 'm_machine2') {
          return { publicKey: machine2Keys.publicKey, revoked: false, machineId: 'm_machine2' };
        }
        return null;
      };

      // Machine 1 signs
      const auth1 = new LedgerAuth({
        scenario: 'multi-user',
        privateKey: machine1Keys.privateKey,
        machineId: 'm_machine1',
        keyResolver,
      });
      const entry = createTestEntry({ machineId: 'm_machine1' });
      auth1.signEntryInPlace(entry);

      // Machine 2 verifies
      const auth2 = new LedgerAuth({
        scenario: 'multi-user',
        privateKey: machine2Keys.privateKey,
        machineId: 'm_machine2',
        keyResolver,
      });
      const result = auth2.verifyEntry(entry);
      expect(result.status).toBe('valid');
      expect(result.trusted).toBe(true);
    });
  });
});

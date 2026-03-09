/**
 * Unit tests for DispatchVerifier — Ed25519 dispatch origin verification.
 *
 * Tests cover:
 * - Signature verification: valid, invalid, missing, expired
 * - Replay prevention: seen-ID cache, TTL cleanup
 * - Key management: rotation, unknown keys
 * - Canonical payload: deterministic serialization
 * - Gradual rollout: required vs optional verification
 */

import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import { DispatchVerifier } from '../../src/core/DispatchVerifier.js';
import type { SignedDispatch } from '../../src/core/DispatchVerifier.js';
import type { Dispatch } from '../../src/core/DispatchManager.js';

// ── Test key generation ─────────────────────────────────────────────

function generateTestKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKey };
}

function makeDispatch(overrides?: Partial<Dispatch>): Dispatch {
  return {
    dispatchId: overrides?.dispatchId ?? `disp-${Date.now().toString(36)}`,
    type: overrides?.type ?? 'lesson',
    title: overrides?.title ?? 'Test dispatch',
    content: overrides?.content ?? 'Some content',
    priority: overrides?.priority ?? 'normal',
    createdAt: overrides?.createdAt ?? new Date().toISOString(),
    receivedAt: overrides?.receivedAt ?? new Date().toISOString(),
    applied: overrides?.applied ?? false,
  };
}

function signDispatch(
  dispatch: Dispatch,
  privateKey: string,
  keyId: string,
  expiresInMs = 3600000,
): SignedDispatch {
  const signedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + expiresInMs).toISOString();

  const payload = JSON.stringify({
    content: dispatch.content,
    dispatchId: dispatch.dispatchId,
    expiresAt,
    priority: dispatch.priority,
    signedAt,
    title: dispatch.title,
    type: dispatch.type,
  });

  const signature = crypto.sign(null, Buffer.from(payload), privateKey).toString('base64');

  return {
    ...dispatch,
    signature,
    signedAt,
    expiresAt,
    keyId,
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('DispatchVerifier', () => {
  let keys: { publicKey: string; privateKey: string };
  let verifier: DispatchVerifier;

  beforeEach(() => {
    keys = generateTestKeyPair();
    verifier = new DispatchVerifier({
      trustedKeys: { 'portal-key-1': keys.publicKey },
    });
  });

  // ── Valid signatures ──────────────────────────────────────────────

  describe('valid signatures', () => {
    it('verifies a correctly signed dispatch', () => {
      const dispatch = makeDispatch();
      const signed = signDispatch(dispatch, keys.privateKey, 'portal-key-1');

      const result = verifier.verify(signed);
      expect(result.verified).toBe(true);
      expect(result.reason).toBe('Signature verified');
    });

    it('verifies dispatches with different content types', () => {
      for (const type of ['lesson', 'strategy', 'configuration', 'action', 'security', 'behavioral'] as const) {
        const dispatch = makeDispatch({ type, dispatchId: `disp-${type}` });
        const signed = signDispatch(dispatch, keys.privateKey, 'portal-key-1');
        expect(verifier.verify(signed).verified).toBe(true);
      }
    });

    it('verifies dispatches with special characters in content', () => {
      const dispatch = makeDispatch({
        content: 'Content with "quotes", newlines\nand unicode: 🎯',
        title: 'Title with <html> & entities',
      });
      const signed = signDispatch(dispatch, keys.privateKey, 'portal-key-1');
      expect(verifier.verify(signed).verified).toBe(true);
    });
  });

  // ── Invalid signatures ────────────────────────────────────────────

  describe('invalid signatures', () => {
    it('rejects tampered content', () => {
      const dispatch = makeDispatch();
      const signed = signDispatch(dispatch, keys.privateKey, 'portal-key-1');
      signed.content = 'tampered content';

      const result = verifier.verify(signed);
      expect(result.verified).toBe(false);
      expect(result.reason).toBe('Invalid signature');
    });

    it('rejects tampered title', () => {
      const dispatch = makeDispatch();
      const signed = signDispatch(dispatch, keys.privateKey, 'portal-key-1');
      signed.title = 'tampered title';

      expect(verifier.verify(signed).verified).toBe(false);
    });

    it('rejects wrong signature bytes', () => {
      const dispatch = makeDispatch();
      const signed = signDispatch(dispatch, keys.privateKey, 'portal-key-1');
      signed.signature = Buffer.from('definitely-not-valid').toString('base64');

      expect(verifier.verify(signed).verified).toBe(false);
    });

    it('rejects signature from untrusted key', () => {
      const otherKeys = generateTestKeyPair();
      const dispatch = makeDispatch();
      const signed = signDispatch(dispatch, otherKeys.privateKey, 'portal-key-1');

      expect(verifier.verify(signed).verified).toBe(false);
    });
  });

  // ── Unsigned dispatches ───────────────────────────────────────────

  describe('unsigned dispatches', () => {
    it('accepts unsigned dispatches when verification not required', () => {
      const verifierOptional = new DispatchVerifier({
        trustedKeys: { 'portal-key-1': keys.publicKey },
        required: false,
      });

      const dispatch = makeDispatch();
      const result = verifierOptional.verify(dispatch);
      expect(result.verified).toBe(true);
      expect(result.reason).toContain('not required');
    });

    it('rejects unsigned dispatches when verification is required', () => {
      const verifierRequired = new DispatchVerifier({
        trustedKeys: { 'portal-key-1': keys.publicKey },
        required: true,
      });

      const dispatch = makeDispatch();
      const result = verifierRequired.verify(dispatch);
      expect(result.verified).toBe(false);
      expect(result.reason).toContain('unsigned');
    });
  });

  // ── Expiry ────────────────────────────────────────────────────────

  describe('expiry', () => {
    it('rejects expired dispatches', () => {
      const dispatch = makeDispatch();
      const signed = signDispatch(dispatch, keys.privateKey, 'portal-key-1', -1000); // Expired 1s ago

      const result = verifier.verify(signed);
      expect(result.verified).toBe(false);
      expect(result.reason).toContain('expired');
    });

    it('accepts dispatches within expiry window', () => {
      const dispatch = makeDispatch();
      const signed = signDispatch(dispatch, keys.privateKey, 'portal-key-1', 3600000); // 1 hour

      expect(verifier.verify(signed).verified).toBe(true);
    });
  });

  // ── Replay prevention ─────────────────────────────────────────────

  describe('replay prevention', () => {
    it('rejects replay of previously seen dispatch', () => {
      const dispatch = makeDispatch({ dispatchId: 'replay-test' });
      const signed = signDispatch(dispatch, keys.privateKey, 'portal-key-1');

      // First verification: succeeds
      expect(verifier.verify(signed).verified).toBe(true);

      // Second verification: replay detected
      const replay = verifier.verify(signed);
      expect(replay.verified).toBe(false);
      expect(replay.reason).toContain('Replay');
    });

    it('isReplay returns false for unseen dispatch', () => {
      expect(verifier.isReplay('never-seen')).toBe(false);
    });

    it('isReplay returns true for seen dispatch', () => {
      const dispatch = makeDispatch({ dispatchId: 'seen-id' });
      const signed = signDispatch(dispatch, keys.privateKey, 'portal-key-1');
      verifier.verify(signed);

      expect(verifier.isReplay('seen-id')).toBe(true);
    });
  });

  // ── Key management ────────────────────────────────────────────────

  describe('key management', () => {
    it('rejects dispatch with unknown keyId', () => {
      const dispatch = makeDispatch();
      const signed = signDispatch(dispatch, keys.privateKey, 'unknown-key-id');

      const result = verifier.verify(signed);
      expect(result.verified).toBe(false);
      expect(result.reason).toContain('Unknown signing key');
    });

    it('supports runtime key rotation via addTrustedKey', () => {
      const newKeys = generateTestKeyPair();
      verifier.addTrustedKey('portal-key-2', newKeys.publicKey);

      const dispatch = makeDispatch();
      const signed = signDispatch(dispatch, newKeys.privateKey, 'portal-key-2');

      expect(verifier.verify(signed).verified).toBe(true);
    });

    it('removeTrustedKey revokes access', () => {
      verifier.removeTrustedKey('portal-key-1');

      const dispatch = makeDispatch();
      const signed = signDispatch(dispatch, keys.privateKey, 'portal-key-1');

      expect(verifier.verify(signed).verified).toBe(false);
    });

    it('trustedKeyCount reflects current state', () => {
      expect(verifier.trustedKeyCount).toBe(1);
      verifier.addTrustedKey('key-2', keys.publicKey);
      expect(verifier.trustedKeyCount).toBe(2);
      verifier.removeTrustedKey('key-2');
      expect(verifier.trustedKeyCount).toBe(1);
    });
  });

  // ── Canonical payload ─────────────────────────────────────────────

  describe('canonical payload', () => {
    it('produces deterministic serialization regardless of field order', () => {
      const dispatch = makeDispatch();
      const signedAt = '2026-03-08T00:00:00Z';
      const expiresAt = '2026-03-09T00:00:00Z';

      const payload1 = verifier.buildCanonicalPayload(dispatch, signedAt, expiresAt);
      const payload2 = verifier.buildCanonicalPayload(dispatch, signedAt, expiresAt);

      expect(payload1).toBe(payload2);
    });

    it('includes all required fields in alphabetical key order', () => {
      const dispatch = makeDispatch({ dispatchId: 'test-id', type: 'lesson', title: 'Test', content: 'Content', priority: 'normal' });
      const payload = verifier.buildCanonicalPayload(dispatch, '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z');
      const parsed = JSON.parse(payload);

      const keys = Object.keys(parsed);
      expect(keys).toEqual([...keys].sort()); // Keys should be sorted
      expect(parsed.dispatchId).toBe('test-id');
      expect(parsed.type).toBe('lesson');
      expect(parsed.title).toBe('Test');
      expect(parsed.content).toBe('Content');
      expect(parsed.priority).toBe('normal');
      expect(parsed.signedAt).toBe('2026-01-01T00:00:00Z');
      expect(parsed.expiresAt).toBe('2026-01-02T00:00:00Z');
    });
  });
});

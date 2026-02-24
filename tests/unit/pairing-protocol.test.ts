/**
 * Unit tests for PairingProtocol — Phase 2 of multi-machine spec.
 *
 * Tests:
 * - Pairing code generation and format
 * - Constant-time code comparison
 * - SAS derivation (deterministic, 6 symbols, 24-bit)
 * - Ephemeral key exchange (X25519 ECDH + HKDF)
 * - Authenticated encryption (ChaCha20-Poly1305)
 * - Pairing session lifecycle (create, validate, expire, rate-limit)
 * - Full pairing flow simulation
 */

import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import {
  generatePairingCode,
  comparePairingCodes,
  deriveSAS,
  generateEphemeralKeyPair,
  deriveSessionKey,
  encrypt,
  decrypt,
  createPairingSession,
  isPairingSessionValid,
  validatePairingCode,
} from '../../src/core/PairingProtocol.js';

// ── Pairing Code ─────────────────────────────────────────────────────

describe('Pairing Code', () => {
  describe('generatePairingCode', () => {
    it('generates WORD-WORD-NNNN format', () => {
      const code = generatePairingCode();
      expect(code).toMatch(/^[A-Z]+-[A-Z]+-\d{4}$/);
    });

    it('generates unique codes', () => {
      const codes = new Set(Array.from({ length: 50 }, () => generatePairingCode()));
      expect(codes.size).toBe(50);
    });

    it('words are uppercase', () => {
      const code = generatePairingCode();
      const parts = code.split('-');
      expect(parts[0]).toBe(parts[0].toUpperCase());
      expect(parts[1]).toBe(parts[1].toUpperCase());
    });

    it('digits are zero-padded to 4', () => {
      // Run many times to catch the edge case of small numbers
      for (let i = 0; i < 100; i++) {
        const code = generatePairingCode();
        const digits = code.split('-')[2];
        expect(digits).toHaveLength(4);
      }
    });
  });

  describe('comparePairingCodes', () => {
    it('returns true for matching codes', () => {
      expect(comparePairingCodes('WOLF-TIGER-3842', 'WOLF-TIGER-3842')).toBe(true);
    });

    it('is case-insensitive', () => {
      expect(comparePairingCodes('wolf-tiger-3842', 'WOLF-TIGER-3842')).toBe(true);
      expect(comparePairingCodes('Wolf-Tiger-3842', 'WOLF-TIGER-3842')).toBe(true);
    });

    it('returns false for different codes', () => {
      expect(comparePairingCodes('WOLF-TIGER-3842', 'WOLF-TIGER-3843')).toBe(false);
      expect(comparePairingCodes('WOLF-TIGER-3842', 'WOLF-EAGLE-3842')).toBe(false);
    });

    it('returns false for different lengths', () => {
      expect(comparePairingCodes('WOLF-TIGER-3842', 'WOLF-TIGER')).toBe(false);
    });
  });
});

// ── SAS ──────────────────────────────────────────────────────────────

describe('SAS (Short Authentication String)', () => {
  const sharedKey = crypto.randomBytes(32);
  const pubKeyA = 'MCowBQYDK2VwAyEAtest-key-alpha';
  const pubKeyB = 'MCowBQYDK2VwAyEAtest-key-bravo';

  describe('deriveSAS', () => {
    it('returns 6 symbols', () => {
      const sas = deriveSAS(sharedKey, pubKeyA, pubKeyB);
      expect(sas.symbols).toHaveLength(6);
    });

    it('each symbol has word and emoji', () => {
      const sas = deriveSAS(sharedKey, pubKeyA, pubKeyB);
      for (const symbol of sas.symbols) {
        expect(symbol.word).toBeTruthy();
        expect(symbol.emoji).toBeTruthy();
      }
    });

    it('is deterministic (same inputs → same output)', () => {
      const sas1 = deriveSAS(sharedKey, pubKeyA, pubKeyB);
      const sas2 = deriveSAS(sharedKey, pubKeyA, pubKeyB);
      expect(sas1.display).toBe(sas2.display);
    });

    it('is symmetric (order of public keys does not matter)', () => {
      const sas1 = deriveSAS(sharedKey, pubKeyA, pubKeyB);
      const sas2 = deriveSAS(sharedKey, pubKeyB, pubKeyA);
      expect(sas1.display).toBe(sas2.display);
    });

    it('different shared key → different SAS', () => {
      const otherKey = crypto.randomBytes(32);
      const sas1 = deriveSAS(sharedKey, pubKeyA, pubKeyB);
      const sas2 = deriveSAS(otherKey, pubKeyA, pubKeyB);
      expect(sas1.display).not.toBe(sas2.display);
    });

    it('different public keys → different SAS', () => {
      const sas1 = deriveSAS(sharedKey, pubKeyA, pubKeyB);
      const sas2 = deriveSAS(sharedKey, pubKeyA, 'MCowBQYDK2VwAyEAtest-key-charlie');
      expect(sas1.display).not.toBe(sas2.display);
    });

    it('display format is "word emoji - word emoji - ..."', () => {
      const sas = deriveSAS(sharedKey, pubKeyA, pubKeyB);
      expect(sas.display).toMatch(/.+ - .+ - .+ - .+ - .+ - .+/);
    });
  });
});

// ── Ephemeral Key Exchange ───────────────────────────────────────────

describe('Ephemeral Key Exchange', () => {
  describe('generateEphemeralKeyPair', () => {
    it('generates a key pair with public key as Buffer', () => {
      const pair = generateEphemeralKeyPair();
      expect(Buffer.isBuffer(pair.publicKey)).toBe(true);
      expect(pair.privateKey).toBeTruthy();
    });

    it('generates unique keys', () => {
      const pair1 = generateEphemeralKeyPair();
      const pair2 = generateEphemeralKeyPair();
      expect(pair1.publicKey.equals(pair2.publicKey)).toBe(false);
    });
  });

  describe('deriveSessionKey', () => {
    it('both sides derive the same session key', () => {
      const alice = generateEphemeralKeyPair();
      const bob = generateEphemeralKeyPair();
      const code = 'WOLF-TIGER-3842';

      const aliceKey = deriveSessionKey(alice.privateKey, bob.publicKey, code);
      const bobKey = deriveSessionKey(bob.privateKey, alice.publicKey, code);

      expect(aliceKey.equals(bobKey)).toBe(true);
    });

    it('different pairing codes produce different keys', () => {
      const alice = generateEphemeralKeyPair();
      const bob = generateEphemeralKeyPair();

      const key1 = deriveSessionKey(alice.privateKey, bob.publicKey, 'WOLF-TIGER-3842');
      const key2 = deriveSessionKey(alice.privateKey, bob.publicKey, 'WOLF-TIGER-3843');

      expect(key1.equals(key2)).toBe(false);
    });

    it('different key pairs produce different keys', () => {
      const alice1 = generateEphemeralKeyPair();
      const alice2 = generateEphemeralKeyPair();
      const bob = generateEphemeralKeyPair();
      const code = 'WOLF-TIGER-3842';

      const key1 = deriveSessionKey(alice1.privateKey, bob.publicKey, code);
      const key2 = deriveSessionKey(alice2.privateKey, bob.publicKey, code);

      expect(key1.equals(key2)).toBe(false);
    });

    it('returns a 32-byte key', () => {
      const alice = generateEphemeralKeyPair();
      const bob = generateEphemeralKeyPair();
      const key = deriveSessionKey(alice.privateKey, bob.publicKey, 'WOLF-TIGER-3842');
      expect(key.length).toBe(32);
    });

    it('code comparison is case-insensitive', () => {
      const alice = generateEphemeralKeyPair();
      const bob = generateEphemeralKeyPair();

      const key1 = deriveSessionKey(alice.privateKey, bob.publicKey, 'wolf-tiger-3842');
      const key2 = deriveSessionKey(alice.privateKey, bob.publicKey, 'WOLF-TIGER-3842');

      expect(key1.equals(key2)).toBe(true);
    });
  });
});

// ── Authenticated Encryption ─────────────────────────────────────────

describe('Authenticated Encryption (ChaCha20-Poly1305)', () => {
  const key = crypto.randomBytes(32);

  describe('encrypt / decrypt roundtrip', () => {
    it('roundtrips successfully', () => {
      const plaintext = Buffer.from('hello world');
      const { nonce, ciphertext, tag } = encrypt(plaintext, key);
      const decrypted = decrypt(ciphertext, key, nonce, tag);
      expect(decrypted.equals(plaintext)).toBe(true);
    });

    it('works with large payloads', () => {
      const plaintext = crypto.randomBytes(100_000);
      const { nonce, ciphertext, tag } = encrypt(plaintext, key);
      const decrypted = decrypt(ciphertext, key, nonce, tag);
      expect(decrypted.equals(plaintext)).toBe(true);
    });

    it('works with empty plaintext', () => {
      const plaintext = Buffer.alloc(0);
      const { nonce, ciphertext, tag } = encrypt(plaintext, key);
      const decrypted = decrypt(ciphertext, key, nonce, tag);
      expect(decrypted.length).toBe(0);
    });

    it('works with additional authenticated data (AAD)', () => {
      const plaintext = Buffer.from('secret');
      const aad = Buffer.from('machine-id:m_abc123');
      const { nonce, ciphertext, tag } = encrypt(plaintext, key, aad);
      const decrypted = decrypt(ciphertext, key, nonce, tag, aad);
      expect(decrypted.toString()).toBe('secret');
    });
  });

  describe('tamper detection', () => {
    it('rejects tampered ciphertext', () => {
      const { nonce, ciphertext, tag } = encrypt(Buffer.from('hello'), key);
      ciphertext[0] ^= 0xFF; // Flip bits
      expect(() => decrypt(ciphertext, key, nonce, tag)).toThrow();
    });

    it('rejects tampered tag', () => {
      const { nonce, ciphertext, tag } = encrypt(Buffer.from('hello'), key);
      tag[0] ^= 0xFF;
      expect(() => decrypt(ciphertext, key, nonce, tag)).toThrow();
    });

    it('rejects wrong key', () => {
      const { nonce, ciphertext, tag } = encrypt(Buffer.from('hello'), key);
      const wrongKey = crypto.randomBytes(32);
      expect(() => decrypt(ciphertext, wrongKey, nonce, tag)).toThrow();
    });

    it('rejects wrong nonce', () => {
      const { nonce, ciphertext, tag } = encrypt(Buffer.from('hello'), key);
      const wrongNonce = crypto.randomBytes(12);
      expect(() => decrypt(ciphertext, key, wrongNonce, tag)).toThrow();
    });

    it('rejects mismatched AAD', () => {
      const aad1 = Buffer.from('machine-a');
      const aad2 = Buffer.from('machine-b');
      const { nonce, ciphertext, tag } = encrypt(Buffer.from('hello'), key, aad1);
      expect(() => decrypt(ciphertext, key, nonce, tag, aad2)).toThrow();
    });

    it('rejects missing AAD when AAD was used', () => {
      const aad = Buffer.from('context');
      const { nonce, ciphertext, tag } = encrypt(Buffer.from('hello'), key, aad);
      expect(() => decrypt(ciphertext, key, nonce, tag)).toThrow();
    });
  });

  describe('uniqueness', () => {
    it('different nonces per encryption', () => {
      const plaintext = Buffer.from('same data');
      const result1 = encrypt(plaintext, key);
      const result2 = encrypt(plaintext, key);
      expect(result1.nonce.equals(result2.nonce)).toBe(false);
    });

    it('different ciphertexts per encryption (due to nonce)', () => {
      const plaintext = Buffer.from('same data');
      const result1 = encrypt(plaintext, key);
      const result2 = encrypt(plaintext, key);
      expect(result1.ciphertext.equals(result2.ciphertext)).toBe(false);
    });
  });
});

// ── Pairing Session ──────────────────────────────────────────────────

describe('Pairing Session', () => {
  describe('createPairingSession', () => {
    it('creates session with default values', () => {
      const session = createPairingSession();
      expect(session.code).toMatch(/^[A-Z]+-[A-Z]+-\d{4}$/);
      expect(session.failedAttempts).toBe(0);
      expect(session.maxAttempts).toBe(3);
      expect(session.consumed).toBe(false);
      expect(session.ephemeralKeys).toBeTruthy();
    });

    it('accepts custom code', () => {
      const session = createPairingSession({ code: 'WOLF-TIGER-3842' });
      expect(session.code).toBe('WOLF-TIGER-3842');
    });

    it('accepts custom expiry', () => {
      const session = createPairingSession({ expiryMs: 5000 });
      expect(session.expiryMs).toBe(5000);
    });
  });

  describe('isPairingSessionValid', () => {
    it('valid session returns true', () => {
      const session = createPairingSession();
      expect(isPairingSessionValid(session)).toBe(true);
    });

    it('consumed session returns false', () => {
      const session = createPairingSession();
      session.consumed = true;
      expect(isPairingSessionValid(session)).toBe(false);
    });

    it('expired session returns false', () => {
      const session = createPairingSession({ expiryMs: 1 });
      // Session created with 1ms expiry — should already be expired
      // Wait a tiny bit to ensure
      const start = Date.now();
      while (Date.now() - start < 5) { /* spin */ }
      expect(isPairingSessionValid(session)).toBe(false);
    });

    it('rate-limited session returns false', () => {
      const session = createPairingSession({ maxAttempts: 2 });
      session.failedAttempts = 2;
      expect(isPairingSessionValid(session)).toBe(false);
    });
  });

  describe('validatePairingCode', () => {
    it('accepts correct code', () => {
      const session = createPairingSession({ code: 'WOLF-TIGER-3842' });
      const result = validatePairingCode(session, 'WOLF-TIGER-3842');
      expect(result.valid).toBe(true);
    });

    it('accepts case-insensitive code', () => {
      const session = createPairingSession({ code: 'WOLF-TIGER-3842' });
      const result = validatePairingCode(session, 'wolf-tiger-3842');
      expect(result.valid).toBe(true);
    });

    it('rejects wrong code and increments attempts', () => {
      const session = createPairingSession({ code: 'WOLF-TIGER-3842' });
      const result = validatePairingCode(session, 'WRONG-CODE-0000');
      expect(result.valid).toBe(false);
      expect(session.failedAttempts).toBe(1);
      expect(result.reason).toContain('2 attempts remaining');
    });

    it('blocks after max attempts', () => {
      const session = createPairingSession({ code: 'WOLF-TIGER-3842', maxAttempts: 2 });

      validatePairingCode(session, 'WRONG-1');
      validatePairingCode(session, 'WRONG-2');

      const result = validatePairingCode(session, 'WOLF-TIGER-3842'); // correct but too late
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Too many attempts');
    });

    it('rejects consumed code', () => {
      const session = createPairingSession({ code: 'WOLF-TIGER-3842' });
      session.consumed = true;
      const result = validatePairingCode(session, 'WOLF-TIGER-3842');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('already used');
    });

    it('rejects expired code', () => {
      const session = createPairingSession({ code: 'WOLF-TIGER-3842', expiryMs: 1 });
      const start = Date.now();
      while (Date.now() - start < 5) { /* spin */ }
      const result = validatePairingCode(session, 'WOLF-TIGER-3842');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('expired');
    });

    it('shows correct remaining attempts', () => {
      const session = createPairingSession({ code: 'WOLF-TIGER-3842', maxAttempts: 3 });

      const r1 = validatePairingCode(session, 'WRONG');
      expect(r1.reason).toContain('2 attempts remaining');

      const r2 = validatePairingCode(session, 'WRONG');
      expect(r2.reason).toContain('1 attempt remaining');

      const r3 = validatePairingCode(session, 'WRONG');
      expect(r3.reason).toContain('Generate a new code');
    });
  });
});

// ── Full Pairing Flow Simulation ─────────────────────────────────────

describe('Full Pairing Flow', () => {
  it('two machines can complete a pairing exchange', () => {
    // Step 1: Machine A creates a pairing session
    const session = createPairingSession({ code: 'MAPLE-RIVER-7291' });

    // Step 2: Machine B generates its own ephemeral keys
    const machineB = generateEphemeralKeyPair();

    // Step 3: Both derive the same session key
    const sessionKeyA = deriveSessionKey(
      session.ephemeralKeys.privateKey,
      machineB.publicKey,
      session.code,
    );
    const sessionKeyB = deriveSessionKey(
      machineB.privateKey,
      session.ephemeralKeys.publicKey,
      session.code,
    );
    expect(sessionKeyA.equals(sessionKeyB)).toBe(true);

    // Step 4: Both derive the same SAS
    const pubKeyA = session.ephemeralKeys.publicKey.toString('base64');
    const pubKeyB = machineB.publicKey.toString('base64');

    const sasA = deriveSAS(sessionKeyA, pubKeyA, pubKeyB);
    const sasB = deriveSAS(sessionKeyB, pubKeyA, pubKeyB);
    expect(sasA.display).toBe(sasB.display);
    expect(sasA.symbols).toHaveLength(6);

    // Step 5: Machine A encrypts secrets with the session key
    const secrets = Buffer.from(JSON.stringify({
      telegram: { token: '123456:ABC-DEF' },
      authToken: 'sk-test-123',
    }));

    const { nonce, ciphertext, tag } = encrypt(secrets, sessionKeyA);

    // Step 6: Machine B decrypts
    const decrypted = decrypt(ciphertext, sessionKeyB, nonce, tag);
    const parsed = JSON.parse(decrypted.toString());
    expect(parsed.telegram.token).toBe('123456:ABC-DEF');
    expect(parsed.authToken).toBe('sk-test-123');
  });

  it('MITM produces different SAS on both sides', () => {
    // Machine A and B have their own key pairs
    const machineA = generateEphemeralKeyPair();
    const machineB = generateEphemeralKeyPair();

    // Attacker (Eve) generates her own key pairs and sits in the middle
    const eveToA = generateEphemeralKeyPair();
    const eveToB = generateEphemeralKeyPair();

    const code = 'MAPLE-RIVER-7291';

    // A thinks she's talking to B, but actually talking to Eve
    const sessionKeyA = deriveSessionKey(machineA.privateKey, eveToA.publicKey, code);
    // B thinks he's talking to A, but actually talking to Eve
    const sessionKeyB = deriveSessionKey(machineB.privateKey, eveToB.publicKey, code);

    // SAS derivation uses the public keys each side sees
    const sasA = deriveSAS(
      sessionKeyA,
      machineA.publicKey.toString('base64'),
      eveToA.publicKey.toString('base64'), // A sees Eve's key as B's
    );
    const sasB = deriveSAS(
      sessionKeyB,
      eveToB.publicKey.toString('base64'), // B sees Eve's key as A's
      machineB.publicKey.toString('base64'),
    );

    // The SAS strings should NOT match — this is how users detect MITM
    expect(sasA.display).not.toBe(sasB.display);
  });
});

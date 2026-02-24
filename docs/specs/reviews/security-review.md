# Security Review: Instar Multi-Machine Specification

**Reviewer**: Security Engineer (Dawn spec review agent)
**Date**: 2026-02-24
**Severity scale**: CRITICAL / HIGH / MEDIUM / LOW / INFO

---

## Critical Vulnerabilities

### CRIT-01: Pairing Code Entropy Is Dangerously Low

The pairing code (`WORD-WORD-NNNN`) has ~29.3 bits of entropy (~655 million combinations). This is used to derive a shared secret via HKDF that protects the entire key exchange including all agent secrets.

**The attack**: An attacker who captures a single pairing exchange (Cloudflare terminates TLS and can see the payload) can brute-force all 655M HKDF derivations offline in under a second on a GPU. The 5-minute window and 3-attempt rate limit only protect against online brute-force, NOT offline.

**Recommendation**: Use SPAKE2 or SRP (password-authenticated key exchange) which is specifically designed for low-entropy shared secrets without exposing them to offline attack. Alternatively, increase code to 128+ bits (6-word Diceware).

### CRIT-02: Ed25519 Cannot Do Asymmetric Encryption

The spec states "encrypt the secrets bundle with the target machine's Ed25519 public key." Ed25519 is a **signature** scheme, not encryption. You cannot encrypt with Ed25519 keys.

**Fix**: Either (a) convert Ed25519 to X25519 for ECDH key agreement using `crypto_sign_ed25519_pk_to_curve25519`, or (b) generate separate X25519 key pairs for encryption. Specify the exact AEAD cipher (XChaCha20-Poly1305 or AES-256-GCM).

### CRIT-03: No Forward Secrecy on Secret Sync

Secrets are encrypted directly to the recipient's long-term public key. If a machine's private key is ever compromised (machine theft), an attacker with recorded traffic can decrypt every past secret sync.

**Fix**: Use ephemeral key pairs for each sync operation. Consider Noise_KK pattern for ongoing communication.

---

## High Severity

### HIGH-01: Pairing Vulnerable to MITM Despite TLS

Cloudflare terminates TLS. A compromised TLS terminator can intercept the pairing exchange, substitute keys, and relay — classic MITM.

**Fix**: Add Short Authentication String (SAS) verification after key exchange — both machines display a fingerprint, user confirms they match. This is the Signal/WhatsApp pattern.

### HIGH-02: Git Lock Race Condition

Both machines can simultaneously see "unlocked," write the lock, and push. Git may auto-merge different lock file contents. Worse: retry logic can create livelock.

**Fix**: Use `--force-with-lease` push + read-after-write verification + exponential backoff with jitter. Add split-brain detection alert.

### HIGH-03: Revocation Is Not Effective in Practice

The revoked machine still has: a clone of the repo, its copy of config.secrets.json, the Telegram bot token. "Revoked" in registry.json only works if the revoked machine cooperates.

**Fix**: Mandate external secret rotation (new bot token via BotFather API, rotate API keys). Document that revocation prevents future access but all previously-synced secrets must be considered compromised.

### HIGH-04: No At-Rest Encryption for Secrets

`config.secrets.json` sits on disk in plaintext (0600 permissions only). Fails against: backup extraction, forensic imaging, cloud sync accidents.

**Fix**: Use OS keychain integration (macOS Keychain, Windows Credential Vault). Store a master key in keychain, encrypt the secrets file with AES-256-GCM.

---

## Medium Severity

- **MEDIUM-01**: Nonce storage for replay prevention is unspecified (memory-only = restart vulnerability)
- **MEDIUM-02**: Tunnel URL in git is a discoverable attack surface
- **MEDIUM-03**: HKDF salt and info parameters not specified
- **MEDIUM-04**: Machine ID has only 32 bits of entropy (use UUID/128 bits)
- **MEDIUM-05**: No rate limiting on non-pairing tunnel endpoints
- **MEDIUM-06**: No security audit log

## Low Severity

- **LOW-01**: Commit signing is optional (should be default-on)
- **LOW-02**: No key rotation for machine identity

---

## Recommendations (Ranked)

| Priority | Fix | Effort |
|----------|-----|--------|
| P0 | Use SPAKE2/PAKE instead of HKDF-from-code for pairing | Medium |
| P0 | Specify X25519 for encryption (Ed25519 is signing only) | Low |
| P0 | Add ephemeral keys for forward secrecy | Medium |
| P1 | Add SAS verification after pairing | Low |
| P1 | Fix git lock with force-with-lease + verification | Medium |
| P1 | Document revocation = external rotation required | Low |
| P1 | OS keychain for at-rest secrets encryption | Medium |
| P2 | Persist nonces, specify storage | Low |
| P2 | Don't commit tunnel URLs to git | Low |
| P2 | Increase machine ID to 128 bits | Trivial |

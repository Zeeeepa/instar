# Adversarial Security Review: Pairing Protocol

**Reviewer**: Penetration Tester (Dawn spec review agent)
**Date**: 2026-02-24

---

## Attack Vectors Summary

| # | Attack | Feasibility | Impact | Priority |
|---|--------|-------------|--------|----------|
| 5 | Tunnel URL poisoning via git | Moderate | Critical (full MITM) | **P0** |
| 7a | Social engineering (IT pretexting) | Trivial-Moderate | Critical (full secrets) | **P0** |
| 1 | Pairing code eavesdropping | Moderate | Critical (full secrets) | **P1** |
| 3 | Race condition (pairing request race) | Moderate (requires code) | Critical (full secrets) | **P1** |
| 7c | Shoulder surfing | Trivial | Critical (full secrets) | **P1** |
| 6 | Revoked machine persistence | Moderate | High (state poisoning) | **P1** |
| 8 | HKDF offline brute force | Hard | Critical (if TLS broken) | **P2** |
| 4 | Post-pairing replay | Hard | High (secrets replay) | **P2** |
| 2 | Online brute force | Impractical | N/A | **P3** |

---

## P0: Tunnel URL Poisoning via Git

**The attack**: Attacker with push access modifies `.instar/tunnel.json` to point to their server. Machine B reads the poisoned URL from git during pairing. All secrets are sent to the attacker.

**Why it's critical**: The tunnel URL is the only way Machine B finds Machine A. Poison it, and the entire pairing protocol is MITM'd.

**Fix**: Do NOT read the tunnel URL from git for pairing. Include it in the out-of-band channel (verbal, QR code) alongside the pairing code.

## P0: Social Engineering

**The attack**: "Hey, I'm setting up the new server. Can you run `instar pair` and give me the code?" The code format is specifically designed to be easy to say aloud.

**Fix**: Display a prominent security warning. Add post-pairing machine identity confirmation. Offer QR code option (requires physical proximity). Consider two-factor pairing via Telegram approval.

## P1: Eavesdropping + Race Condition

**Combined attack**: Overhear the code, race the legitimate machine to `POST /api/pair`.

**Fix**: Single-use codes (invalidate after first successful use). Post-pairing notification showing paired machine identity. Mutual SAS verification.

## P1: Revoked Machine Persistence

**The attack**: Between compromise and revocation, the machine can push malicious state to git (poisoned jobs, modified config, tampered tunnel.json). Post-revocation, it still has all previously-synced secrets.

**Fix**: Mandatory commit signing + signature verification on pull. Registry modifications require primary-only. Immediate secret invalidation (not just rotation).

---

## Top 3 Highest-Leverage Fixes

1. **Don't use git for tunnel URL discovery during pairing** — eliminates the most dangerous attack vector entirely
2. **Add post-pairing mutual verification (SAS)** — catches eavesdropping, race conditions, and social engineering
3. **Make commit signing mandatory** — transforms git from trust-everything to verified-authorship

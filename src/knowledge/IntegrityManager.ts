/**
 * IntegrityManager — HMAC-SHA256 integrity verification for context files.
 *
 * Signs context files and verifies them at tree traversal time.
 * Uses a dedicated signing key (NOT the auth token) that is per-agent
 * and auto-generated on first use.
 *
 * Manifest is stored at .instar/context/.integrity.json
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface IntegritySignature {
  hmac: string;
  signedAt: string;
  size: number;
}

export interface IntegrityManifest {
  version: string;
  signatures: Record<string, IntegritySignature>;
}

export interface VerifyResult {
  valid: boolean;
  reason?: string;
}

export class IntegrityManager {
  private signingKey: string;
  private _manifestPath: string;

  constructor(signingKey: string, stateDir: string) {
    this.signingKey = signingKey;
    const contextDir = path.join(stateDir, 'context');
    fs.mkdirSync(contextDir, { recursive: true });
    this._manifestPath = path.join(contextDir, '.integrity.json');
  }

  get manifestPath(): string {
    return this._manifestPath;
  }

  /**
   * Sign a file and store its HMAC in the manifest.
   * The filePath should be relative to the project/state dir for manifest keys,
   * but absolute for reading.
   */
  sign(filePath: string): void {
    const content = fs.readFileSync(filePath, 'utf-8');
    const hmac = this.computeHmac(content);
    const stat = fs.statSync(filePath);

    const manifest = this.loadManifest();
    manifest.signatures[filePath] = {
      hmac,
      signedAt: new Date().toISOString(),
      size: stat.size,
    };
    this.saveManifest(manifest);
  }

  /**
   * Sign all files in a directory recursively.
   */
  signDirectory(dirPath: string): void {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        // Skip hidden directories (like .integrity.json's parent)
        if (!entry.name.startsWith('.')) {
          this.signDirectory(fullPath);
        }
      } else if (entry.isFile()) {
        this.sign(fullPath);
      }
    }
  }

  /**
   * Verify a single file against its stored HMAC.
   */
  verify(filePath: string): VerifyResult {
    const manifest = this.loadManifest();
    const entry = manifest.signatures[filePath];

    if (!entry) {
      return { valid: false, reason: 'not_in_manifest' };
    }

    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      return { valid: false, reason: 'file_not_found' };
    }

    const hmac = this.computeHmac(content);
    if (hmac !== entry.hmac) {
      return { valid: false, reason: 'hmac_mismatch' };
    }

    return { valid: true };
  }

  private computeHmac(content: string): string {
    return crypto
      .createHmac('sha256', this.signingKey)
      .update(content)
      .digest('hex');
  }

  private loadManifest(): IntegrityManifest {
    try {
      const raw = fs.readFileSync(this._manifestPath, 'utf-8');
      return JSON.parse(raw) as IntegrityManifest;
    } catch {
      return { version: '1.0', signatures: {} };
    }
  }

  private saveManifest(manifest: IntegrityManifest): void {
    fs.writeFileSync(this._manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  }
}

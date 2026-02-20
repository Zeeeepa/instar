/**
 * Update Checker — detects when a newer version of Instar is available.
 *
 * Part of the Dawn → Agents push layer: when Dawn publishes an update,
 * agents detect it and notify their users with context about what changed.
 *
 * Uses `npm view instar version` to check the registry.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { UpdateInfo } from './types.js';

export class UpdateChecker {
  private stateDir: string;
  private stateFile: string;

  constructor(stateDir: string) {
    this.stateDir = stateDir;
    this.stateFile = path.join(stateDir, 'state', 'update-check.json');
  }

  /**
   * Check npm for the latest version and compare to installed.
   * Fully async — never blocks the event loop.
   */
  async check(): Promise<UpdateInfo> {
    const currentVersion = this.getInstalledVersion();
    let latestVersion: string;

    try {
      latestVersion = await this.execAsync('npm', ['view', 'instar', 'version'], 15000);
    } catch {
      // Offline or registry error — return last known state
      const lastState = this.getLastCheck();
      if (lastState) return lastState;

      return {
        currentVersion,
        latestVersion: currentVersion,
        updateAvailable: false,
        checkedAt: new Date().toISOString(),
      };
    }

    const info: UpdateInfo = {
      currentVersion,
      latestVersion,
      updateAvailable: this.isNewer(latestVersion, currentVersion),
      checkedAt: new Date().toISOString(),
      changelogUrl: `https://github.com/SageMindAI/instar/releases`,
    };

    // Persist last check
    this.saveState(info);

    return info;
  }

  /**
   * Get the last check result without hitting npm.
   */
  getLastCheck(): UpdateInfo | null {
    if (!fs.existsSync(this.stateFile)) return null;
    try {
      return JSON.parse(fs.readFileSync(this.stateFile, 'utf-8'));
    } catch {
      return null;
    }
  }

  /**
   * Get the currently installed version from package.json.
   */
  getInstalledVersion(): string {
    try {
      // Try to find instar's package.json relative to this module
      const pkgPath = path.resolve(
        new URL(import.meta.url).pathname,
        '..', '..', '..', 'package.json'
      );
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        return pkg.version || '0.0.0';
      }
    } catch { /* fallback below */ }

    return '0.0.0';
  }

  /**
   * Run a command asynchronously, returning trimmed stdout.
   */
  private execAsync(cmd: string, args: string[], timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = execFile(cmd, args, {
        encoding: 'utf-8',
        timeout: timeoutMs,
      }, (err, stdout) => {
        if (err) reject(err);
        else resolve((stdout || '').trim());
      });
      // Safety: ensure child doesn't leak if parent is GC'd
      child.unref?.();
    });
  }

  /**
   * Simple semver comparison — is `a` newer than `b`?
   */
  private isNewer(a: string, b: string): boolean {
    // Extract major.minor.patch, ignoring pre-release suffixes
    const semverRe = /^(\d+)\.(\d+)\.(\d+)/;
    const matchA = semverRe.exec(a);
    const matchB = semverRe.exec(b);
    if (!matchA || !matchB) return false;

    for (let i = 1; i <= 3; i++) {
      const va = Number(matchA[i]);
      const vb = Number(matchB[i]);
      if (va > vb) return true;
      if (va < vb) return false;
    }
    return false;
  }

  private saveState(info: UpdateInfo): void {
    const dir = path.dirname(this.stateFile);
    fs.mkdirSync(dir, { recursive: true });
    // Atomic write: unique temp filename to prevent concurrent corruption
    const tmpPath = this.stateFile + `.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(info, null, 2));
      fs.renameSync(tmpPath, this.stateFile);
    } catch (err) {
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
      throw err;
    }
  }
}

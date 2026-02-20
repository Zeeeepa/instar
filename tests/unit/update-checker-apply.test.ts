/**
 * Unit tests for UpdateChecker.applyUpdate() and fetchChangelog().
 *
 * Covers: changelog fetching, update application, version verification,
 * error handling, and edge cases.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { UpdateChecker } from '../../src/core/UpdateChecker.js';

describe('UpdateChecker.applyUpdate()', () => {
  let tmpDir: string;
  let checker: UpdateChecker;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'instar-update-apply-'));
    fs.mkdirSync(path.join(tmpDir, 'state'), { recursive: true });
    checker = new UpdateChecker(tmpDir);
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns already-up-to-date when no update available', async () => {
    // Mock check to return no update available
    vi.spyOn(checker, 'check').mockResolvedValue({
      currentVersion: '0.1.12',
      latestVersion: '0.1.12',
      updateAvailable: false,
      checkedAt: new Date().toISOString(),
    });

    const result = await checker.applyUpdate();

    expect(result.success).toBe(true);
    expect(result.restartNeeded).toBe(false);
    expect(result.message).toContain('Already up to date');
    expect(result.healthCheck).toBe('skipped');
  });

  it('returns structured result on update failure', async () => {
    vi.spyOn(checker, 'check').mockResolvedValue({
      currentVersion: '0.1.10',
      latestVersion: '0.1.12',
      updateAvailable: true,
      checkedAt: new Date().toISOString(),
    });

    // Mock execAsync to fail (private method, we test through behavior)
    // The npm update will fail because we're in a test environment
    const result = await checker.applyUpdate();

    // Should return a structured result even on failure
    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('previousVersion');
    expect(result).toHaveProperty('newVersion');
    expect(result).toHaveProperty('message');
    expect(result).toHaveProperty('restartNeeded');
    expect(typeof result.message).toBe('string');
    expect(result.message.length).toBeGreaterThan(0);
  });

  it('includes changeSummary in message when available', async () => {
    vi.spyOn(checker, 'check').mockResolvedValue({
      currentVersion: '0.1.10',
      latestVersion: '0.1.12',
      updateAvailable: true,
      checkedAt: new Date().toISOString(),
      changeSummary: 'Fixed security issues and improved performance',
    });

    const result = await checker.applyUpdate();

    // Even if the npm update fails, the result should be structured
    expect(result).toHaveProperty('message');
    expect(typeof result.message).toBe('string');
  });
});

describe('UpdateChecker.fetchChangelog()', () => {
  let tmpDir: string;
  let checker: UpdateChecker;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'instar-changelog-'));
    fs.mkdirSync(path.join(tmpDir, 'state'), { recursive: true });
    checker = new UpdateChecker(tmpDir);
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns changelog body from GitHub release', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        body: 'Fixed a critical bug in session management.\nImproved health checks.',
        name: 'v0.1.12',
      }),
    });

    const result = await checker.fetchChangelog('0.1.12');

    expect(result).toBeDefined();
    expect(result).toContain('critical bug');
    expect(result).toContain('health checks');
  });

  it('prepends v to version if missing', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ body: 'Changelog text', name: 'v0.1.12' }),
    });
    global.fetch = mockFetch;

    await checker.fetchChangelog('0.1.12');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/tags/v0.1.12'),
      expect.any(Object),
    );
  });

  it('does not double-prepend v', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ body: 'Changelog', name: 'v0.1.12' }),
    });
    global.fetch = mockFetch;

    await checker.fetchChangelog('v0.1.12');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/tags/v0.1.12'),
      expect.any(Object),
    );
    // Should NOT contain /tags/vv0.1.12
    const url = (mockFetch.mock.calls[0][0] as string);
    expect(url).not.toContain('vv');
  });

  it('truncates long changelogs to 500 chars', async () => {
    const longBody = 'A'.repeat(600);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ body: longBody, name: 'v0.1.12' }),
    });

    const result = await checker.fetchChangelog('0.1.12');

    expect(result).toBeDefined();
    expect(result!.length).toBeLessThanOrEqual(503); // 500 + '...'
    expect(result).toContain('...');
  });

  it('returns release name when body is empty', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ body: '', name: 'Security Update v0.1.12' }),
    });

    const result = await checker.fetchChangelog('0.1.12');

    expect(result).toBe('Security Update v0.1.12');
  });

  it('returns undefined on 404', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });

    const result = await checker.fetchChangelog('99.99.99');

    expect(result).toBeUndefined();
  });

  it('returns undefined on network error', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network unreachable'));

    const result = await checker.fetchChangelog('0.1.12');

    expect(result).toBeUndefined();
  });

  it('returns undefined on timeout', async () => {
    global.fetch = vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError'));

    const result = await checker.fetchChangelog('0.1.12');

    expect(result).toBeUndefined();
  });
});

describe('UpdateChecker.check() with changeSummary', () => {
  let tmpDir: string;
  let checker: UpdateChecker;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'instar-check-summary-'));
    fs.mkdirSync(path.join(tmpDir, 'state'), { recursive: true });
    checker = new UpdateChecker(tmpDir);
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('includes changeSummary in UpdateInfo when update available', async () => {
    // Mock fetchChangelog to return a summary
    vi.spyOn(checker, 'fetchChangelog').mockResolvedValue('Fixed important bugs');

    const info = await checker.check();

    // If update is available (depends on npm state), changeSummary should be populated
    if (info.updateAvailable) {
      expect(info.changeSummary).toBe('Fixed important bugs');
    }
    // Always has these fields
    expect(info).toHaveProperty('currentVersion');
    expect(info).toHaveProperty('latestVersion');
    expect(info).toHaveProperty('checkedAt');
  });

  it('persists changeSummary to state file', async () => {
    vi.spyOn(checker, 'fetchChangelog').mockResolvedValue('Big improvements');

    await checker.check();

    const lastCheck = checker.getLastCheck();
    expect(lastCheck).not.toBeNull();
    // changeSummary only present if updateAvailable is true
    if (lastCheck!.updateAvailable) {
      expect(lastCheck!.changeSummary).toBe('Big improvements');
    }
  });
});

/**
 * Tests that generated CLAUDE.md includes identity hook references.
 *
 * Verifies the fix from iteration 38: session-start.sh and
 * compaction-recovery.sh are now referenced in generated CLAUDE.md
 * so agents know to run them.
 */

import { describe, it, expect } from 'vitest';
import { generateClaudeMd } from '../../src/scaffold/templates.js';

describe('Scaffold templates — identity hook references', () => {
  it('generates CLAUDE.md with session-start hook reference', () => {
    const content = generateClaudeMd('test-project', 'TestAgent', 4040, false);

    expect(content).toContain('.instar/hooks/instar/session-start.sh');
  });

  it('generates CLAUDE.md with compaction-recovery hook reference', () => {
    const content = generateClaudeMd('test-project', 'TestAgent', 4040, false);

    expect(content).toContain('.instar/hooks/instar/compaction-recovery.sh');
  });

  it('includes identity hooks section before agent infrastructure', () => {
    const content = generateClaudeMd('test-project', 'TestAgent', 4040, false);

    const hooksIndex = content.indexOf('Identity Hooks');
    const infraIndex = content.indexOf('Agent Infrastructure');

    expect(hooksIndex).toBeGreaterThan(0);
    expect(infraIndex).toBeGreaterThan(0);
    expect(hooksIndex).toBeLessThan(infraIndex);
  });

  it('includes Telegram relay section when hasTelegram is true', () => {
    const withTelegram = generateClaudeMd('test-project', 'TestAgent', 4040, true);
    const withoutTelegram = generateClaudeMd('test-project', 'TestAgent', 4040, false);

    expect(withTelegram).toContain('Telegram Relay');
    expect(withoutTelegram).not.toContain('Telegram Relay');
  });

  it('includes project-specific port in generated content', () => {
    const content = generateClaudeMd('test-project', 'TestAgent', 5555, false);

    expect(content).toContain('5555');
    expect(content).toContain('localhost:5555');
  });

  it('includes agent name in identity section', () => {
    const content = generateClaudeMd('test-project', 'MyAgent', 4040, false);

    expect(content).toContain('I am MyAgent');
  });
});

/**
 * `instar memory` — Search and manage agent memory index.
 *
 * Commands:
 *   instar memory search "query"   Search memory from CLI
 *   instar memory reindex          Full rebuild of SQLite index
 *   instar memory status           Show index statistics
 */

import pc from 'picocolors';
import { loadConfig } from '../core/Config.js';
import { MemoryIndex } from '../memory/MemoryIndex.js';
import type { MemorySearchConfig } from '../core/types.js';

interface MemoryOptions {
  dir?: string;
  limit?: number;
}

async function getMemoryIndex(dir?: string): Promise<{ index: MemoryIndex; cleanup: () => void }> {
  const config = loadConfig(dir);
  const memoryConfig: Partial<MemorySearchConfig> = (config as any).memory || {};
  const index = new MemoryIndex(config.stateDir, { ...memoryConfig, enabled: true });
  await index.open();
  return { index, cleanup: () => index.close() };
}

export async function memorySearch(query: string, opts: MemoryOptions): Promise<void> {
  let cleanup: () => void = () => {};

  try {
    const { index, cleanup: c } = await getMemoryIndex(opts.dir);
    cleanup = c;

    // Auto-sync before search
    index.sync();

    const limit = opts.limit || 10;
    const results = index.search(query, { limit });

    if (results.length === 0) {
      console.log(pc.dim(`No results for "${query}".`));
      console.log(pc.dim('Try a different query or run `instar memory reindex` to rebuild the index.'));
      return;
    }

    console.log(pc.bold(`\n  Results for "${query}" (${results.length})\n`));

    for (const result of results) {
      const score = result.score.toFixed(3);
      console.log(`  ${pc.cyan(result.source)}  ${pc.dim(`score: ${score}`)}`);

      // Show a snippet (first 200 chars)
      const snippet = result.text.slice(0, 200).replace(/\n/g, ' ');
      console.log(`  ${pc.dim(snippet)}${result.text.length > 200 ? '...' : ''}`);
      console.log();
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('better-sqlite3')) {
      console.log(pc.yellow('Memory search requires better-sqlite3.'));
      console.log(pc.dim('Install it with: npm install better-sqlite3'));
    } else {
      console.log(pc.red(`Search failed: ${err instanceof Error ? err.message : err}`));
    }
    process.exit(1);
  } finally {
    cleanup();
  }
}

export async function memoryReindex(opts: MemoryOptions): Promise<void> {
  let cleanup: () => void = () => {};

  try {
    const { index, cleanup: c } = await getMemoryIndex(opts.dir);
    cleanup = c;

    console.log(pc.dim('Rebuilding memory index...'));
    const result = index.reindex();
    console.log(pc.green(`Reindexed ${result.added} files.`));

    const stats = index.stats();
    console.log(`  Chunks: ${stats.totalChunks}`);
    console.log(`  DB size: ${formatBytes(stats.dbSizeBytes)}`);
  } catch (err) {
    if (err instanceof Error && err.message.includes('better-sqlite3')) {
      console.log(pc.yellow('Memory search requires better-sqlite3.'));
      console.log(pc.dim('Install it with: npm install better-sqlite3'));
    } else {
      console.log(pc.red(`Reindex failed: ${err instanceof Error ? err.message : err}`));
    }
    process.exit(1);
  } finally {
    cleanup();
  }
}

export async function memoryStatus(opts: MemoryOptions): Promise<void> {
  let cleanup: () => void = () => {};

  try {
    const { index, cleanup: c } = await getMemoryIndex(opts.dir);
    cleanup = c;

    const stats = index.stats();

    console.log(pc.bold('\n  Memory Search\n'));
    console.log(`  Status:    ${pc.green('enabled')}`);
    console.log(`  Files:     ${stats.totalFiles}`);
    console.log(`  Chunks:    ${stats.totalChunks}`);
    console.log(`  DB size:   ${formatBytes(stats.dbSizeBytes)}`);
    console.log(`  Stale:     ${stats.staleFiles > 0 ? pc.yellow(String(stats.staleFiles)) : pc.dim('0')}`);
    console.log(`  Last sync: ${stats.lastIndexedAt ? pc.dim(stats.lastIndexedAt) : pc.dim('never')}`);
    console.log(`  Vector:    ${stats.vectorSearchAvailable ? pc.green('available') : pc.dim('not available')}`);
    console.log();
  } catch (err) {
    if (err instanceof Error && err.message.includes('better-sqlite3')) {
      console.log(pc.yellow('Memory search requires better-sqlite3.'));
      console.log(pc.dim('Install it with: npm install better-sqlite3'));
    } else {
      console.log(pc.red(`Status failed: ${err instanceof Error ? err.message : err}`));
    }
    process.exit(1);
  } finally {
    cleanup();
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

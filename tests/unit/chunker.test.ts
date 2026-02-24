/**
 * Unit tests for Chunker — file chunking for memory search.
 *
 * Tests:
 * - estimateTokens approximation
 * - Markdown: heading-aware chunking
 * - Markdown: respects chunk size limits
 * - Markdown: handles empty input
 * - Markdown: overlap between chunks
 * - JSON: array chunking
 * - JSON: object chunking
 * - JSON: invalid JSON fallback
 * - JSONL: one chunk per line
 * - JSONL: skips empty lines
 */

import { describe, it, expect } from 'vitest';
import {
  estimateTokens,
  chunkMarkdown,
  chunkJson,
  chunkJsonl,
} from '../../src/memory/Chunker.js';

describe('Chunker', () => {
  describe('estimateTokens', () => {
    it('estimates ~4 chars per token', () => {
      expect(estimateTokens('hello world')).toBe(3); // 11 chars / 4 = 2.75, ceil = 3
      expect(estimateTokens('')).toBe(0);
      expect(estimateTokens('a'.repeat(400))).toBe(100);
    });
  });

  describe('chunkMarkdown', () => {
    it('creates a single chunk for short text', () => {
      const chunks = chunkMarkdown('# Title\n\nHello world.');
      expect(chunks.length).toBe(1);
      expect(chunks[0].text).toContain('Title');
      expect(chunks[0].text).toContain('Hello world');
      expect(chunks[0].offset).toBe(0);
    });

    it('splits on headings', () => {
      const text = '## Section 1\n\nContent one.\n\n## Section 2\n\nContent two.';
      const chunks = chunkMarkdown(text, 400, 0);

      // Should create 2 chunks (one per heading)
      expect(chunks.length).toBe(2);
      expect(chunks[0].text).toContain('Section 1');
      expect(chunks[1].text).toContain('Section 2');
    });

    it('splits on size limit', () => {
      // Create text that exceeds chunk size
      const lines = [];
      for (let i = 0; i < 100; i++) {
        lines.push(`Line ${i}: ${'x'.repeat(50)}`);
      }
      const text = lines.join('\n');

      // Small chunk size to force splits
      const chunks = chunkMarkdown(text, 50, 0);
      expect(chunks.length).toBeGreaterThan(1);

      // Each chunk should be within size limits (approximately)
      for (const chunk of chunks) {
        expect(chunk.tokenCount).toBeLessThanOrEqual(60); // Allow some margin
      }
    });

    it('handles empty input', () => {
      const chunks = chunkMarkdown('');
      expect(chunks.length).toBe(0);
    });

    it('handles whitespace-only input', () => {
      const chunks = chunkMarkdown('   \n\n   ');
      expect(chunks.length).toBe(0);
    });

    it('preserves offset information', () => {
      const text = '## A\n\nAAA\n\n## B\n\nBBB';
      const chunks = chunkMarkdown(text, 400, 0);

      expect(chunks[0].offset).toBe(0);
      expect(chunks.length).toBe(2);
      // Second chunk offset should be after the first chunk
      expect(chunks[1].offset).toBeGreaterThan(0);
    });

    it('includes length and token count', () => {
      const chunks = chunkMarkdown('# Test\n\nSome content here.');
      expect(chunks[0].length).toBeGreaterThan(0);
      expect(chunks[0].tokenCount).toBeGreaterThan(0);
    });
  });

  describe('chunkJson', () => {
    it('chunks JSON arrays into elements', () => {
      const json = JSON.stringify([
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
      ]);
      const chunks = chunkJson(json);

      expect(chunks.length).toBe(2);
      expect(chunks[0].text).toContain('Alice');
      expect(chunks[1].text).toContain('Bob');
    });

    it('chunks JSON objects by top-level keys', () => {
      const json = JSON.stringify({
        name: 'Test Agent',
        memory: 'Some memories',
        settings: { theme: 'dark' },
      });
      const chunks = chunkJson(json);

      expect(chunks.length).toBe(3);
      expect(chunks[0].text).toContain('name');
      expect(chunks[1].text).toContain('memory');
      expect(chunks[2].text).toContain('settings');
    });

    it('handles invalid JSON gracefully', () => {
      const chunks = chunkJson('not valid json');
      expect(chunks.length).toBe(1);
      expect(chunks[0].text).toBe('not valid json');
    });

    it('handles primitive JSON', () => {
      const chunks = chunkJson('"just a string"');
      expect(chunks.length).toBe(1);
    });
  });

  describe('chunkJsonl', () => {
    it('creates one chunk per line', () => {
      const text = '{"a":1}\n{"b":2}\n{"c":3}';
      const chunks = chunkJsonl(text);

      expect(chunks.length).toBe(3);
      expect(chunks[0].text).toBe('{"a":1}');
      expect(chunks[1].text).toBe('{"b":2}');
      expect(chunks[2].text).toBe('{"c":3}');
    });

    it('skips empty lines', () => {
      const text = '{"a":1}\n\n{"b":2}\n\n';
      const chunks = chunkJsonl(text);

      expect(chunks.length).toBe(2);
    });

    it('tracks offsets correctly', () => {
      const text = '{"a":1}\n{"b":2}';
      const chunks = chunkJsonl(text);

      expect(chunks[0].offset).toBe(0);
      expect(chunks[1].offset).toBeGreaterThan(0);
    });
  });
});

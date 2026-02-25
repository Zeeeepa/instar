/**
 * Unit tests for TopicMemory — SQLite-backed conversational memory per topic.
 *
 * Tests:
 * - Database creation and schema initialization
 * - Message insertion (single and batch)
 * - Message deduplication (idempotent insert)
 * - Recent message retrieval
 * - Full-text search with FTS5
 * - Search scoped to a single topic
 * - Topic summary CRUD
 * - Summary update detection (threshold-based)
 * - Messages-since-summary retrieval
 * - Topic metadata tracking
 * - Topic listing
 * - JSONL import
 * - JSONL rebuild (destructive reimport)
 * - Context formatting for session injection
 * - Stats reporting
 * - Empty/edge cases
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { TopicMemory, type TopicMessage } from '../../src/memory/TopicMemory.js';

describe('TopicMemory', () => {
  let tmpDir: string;
  let topicMemory: TopicMemory;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'topic-memory-test-'));
    topicMemory = new TopicMemory(tmpDir);
    await topicMemory.open();
  });

  afterEach(() => {
    topicMemory.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Message Operations ──────────────────────────────────────

  describe('insertMessage', () => {
    it('inserts a single message', () => {
      topicMemory.insertMessage({
        messageId: 1,
        topicId: 100,
        text: 'Hello world',
        fromUser: true,
        timestamp: '2026-02-24T12:00:00Z',
        sessionName: null,
      });

      const messages = topicMemory.getRecentMessages(100);
      expect(messages).toHaveLength(1);
      expect(messages[0].text).toBe('Hello world');
      expect(messages[0].fromUser).toBe(true);
    });

    it('is idempotent — duplicate messageId+topicId is ignored', () => {
      const msg: TopicMessage = {
        messageId: 1,
        topicId: 100,
        text: 'Hello',
        fromUser: true,
        timestamp: '2026-02-24T12:00:00Z',
        sessionName: null,
      };

      topicMemory.insertMessage(msg);
      topicMemory.insertMessage(msg);

      const messages = topicMemory.getRecentMessages(100);
      expect(messages).toHaveLength(1);
    });

    it('updates topic metadata on insert', () => {
      topicMemory.insertMessage({
        messageId: 1,
        topicId: 100,
        text: 'Hello',
        fromUser: true,
        timestamp: '2026-02-24T12:00:00Z',
        sessionName: null,
      });

      const meta = topicMemory.getTopicMeta(100);
      expect(meta).not.toBeNull();
      expect(meta!.messageCount).toBe(1);
    });
  });

  describe('insertMessages (batch)', () => {
    it('batch-inserts messages', () => {
      const messages: TopicMessage[] = [];
      for (let i = 0; i < 50; i++) {
        messages.push({
          messageId: i,
          topicId: 100,
          text: `Message ${i}`,
          fromUser: i % 2 === 0,
          timestamp: new Date(Date.now() + i * 1000).toISOString(),
          sessionName: null,
        });
      }

      const count = topicMemory.insertMessages(messages);
      expect(count).toBe(50);

      const meta = topicMemory.getTopicMeta(100);
      expect(meta!.messageCount).toBe(50);
    });

    it('skips duplicates in batch', () => {
      const msg: TopicMessage = {
        messageId: 1,
        topicId: 100,
        text: 'Hello',
        fromUser: true,
        timestamp: '2026-02-24T12:00:00Z',
        sessionName: null,
      };

      topicMemory.insertMessage(msg);
      const count = topicMemory.insertMessages([msg, msg]);
      expect(count).toBe(0); // Both were duplicates
    });
  });

  describe('getRecentMessages', () => {
    it('returns messages in chronological order', () => {
      for (let i = 0; i < 5; i++) {
        topicMemory.insertMessage({
          messageId: i,
          topicId: 100,
          text: `Message ${i}`,
          fromUser: true,
          timestamp: new Date(2026, 0, 1, 12, i).toISOString(),
          sessionName: null,
        });
      }

      const messages = topicMemory.getRecentMessages(100, 5);
      expect(messages).toHaveLength(5);
      expect(messages[0].text).toBe('Message 0');
      expect(messages[4].text).toBe('Message 4');
    });

    it('respects limit parameter', () => {
      for (let i = 0; i < 10; i++) {
        topicMemory.insertMessage({
          messageId: i,
          topicId: 100,
          text: `Message ${i}`,
          fromUser: true,
          timestamp: new Date(2026, 0, 1, 12, i).toISOString(),
          sessionName: null,
        });
      }

      const messages = topicMemory.getRecentMessages(100, 3);
      expect(messages).toHaveLength(3);
      // Should return the LAST 3 messages
      expect(messages[0].text).toBe('Message 7');
      expect(messages[2].text).toBe('Message 9');
    });

    it('returns empty array for unknown topic', () => {
      const messages = topicMemory.getRecentMessages(999);
      expect(messages).toHaveLength(0);
    });

    it('only returns messages for the requested topic', () => {
      topicMemory.insertMessage({
        messageId: 1, topicId: 100, text: 'Topic 100', fromUser: true,
        timestamp: '2026-02-24T12:00:00Z', sessionName: null,
      });
      topicMemory.insertMessage({
        messageId: 2, topicId: 200, text: 'Topic 200', fromUser: true,
        timestamp: '2026-02-24T12:01:00Z', sessionName: null,
      });

      const messages100 = topicMemory.getRecentMessages(100);
      expect(messages100).toHaveLength(1);
      expect(messages100[0].text).toBe('Topic 100');

      const messages200 = topicMemory.getRecentMessages(200);
      expect(messages200).toHaveLength(1);
      expect(messages200[0].text).toBe('Topic 200');
    });
  });

  // ── Search ──────────────────────────────────────────────────

  describe('search', () => {
    beforeEach(() => {
      topicMemory.insertMessage({
        messageId: 1, topicId: 100, text: 'We should deploy the new dashboard feature',
        fromUser: true, timestamp: '2026-02-24T12:00:00Z', sessionName: null,
      });
      topicMemory.insertMessage({
        messageId: 2, topicId: 100, text: 'The dashboard is ready for deployment',
        fromUser: false, timestamp: '2026-02-24T12:01:00Z', sessionName: null,
      });
      topicMemory.insertMessage({
        messageId: 3, topicId: 200, text: 'The database migration failed last night',
        fromUser: true, timestamp: '2026-02-24T12:02:00Z', sessionName: null,
      });
    });

    it('finds messages by keyword', () => {
      const results = topicMemory.search('dashboard');
      expect(results.length).toBeGreaterThanOrEqual(2);
      expect(results.every(r => r.text.toLowerCase().includes('dashboard'))).toBe(true);
    });

    it('finds messages scoped to a topic', () => {
      const results = topicMemory.search('dashboard', { topicId: 100 });
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.every(r => r.topicId === 100)).toBe(true);
    });

    it('returns empty for no matches', () => {
      const results = topicMemory.search('zebra');
      expect(results).toHaveLength(0);
    });

    it('sanitizes FTS5 special syntax', () => {
      // These should not throw — special chars are stripped
      expect(() => topicMemory.search('AND OR NOT')).not.toThrow();
      expect(() => topicMemory.search('test*')).not.toThrow();
      expect(() => topicMemory.search('"quoted"')).not.toThrow();
    });

    it('returns empty for empty query', () => {
      const results = topicMemory.search('');
      expect(results).toHaveLength(0);
    });

    it('respects limit parameter', () => {
      const results = topicMemory.search('the', { limit: 1 });
      expect(results.length).toBeLessThanOrEqual(1);
    });

    it('includes highlight in results', () => {
      const results = topicMemory.search('dashboard');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].highlight).toBeDefined();
      expect(results[0].highlight).toContain('<b>');
    });
  });

  // ── Summaries ───────────────────────────────────────────────

  describe('summaries', () => {
    it('saves and retrieves a topic summary', () => {
      topicMemory.saveTopicSummary(100, 'This is a summary of the conversation.', 10, 50);

      const summary = topicMemory.getTopicSummary(100);
      expect(summary).not.toBeNull();
      expect(summary!.summary).toBe('This is a summary of the conversation.');
      expect(summary!.messageCountAtSummary).toBe(10);
      expect(summary!.lastMessageId).toBe(50);
    });

    it('updates an existing summary', () => {
      topicMemory.saveTopicSummary(100, 'Summary v1', 10, 50);
      topicMemory.saveTopicSummary(100, 'Summary v2', 20, 100);

      const summary = topicMemory.getTopicSummary(100);
      expect(summary!.summary).toBe('Summary v2');
      expect(summary!.messageCountAtSummary).toBe(20);
    });

    it('returns null for topic without summary', () => {
      const summary = topicMemory.getTopicSummary(999);
      expect(summary).toBeNull();
    });
  });

  describe('needsSummaryUpdate', () => {
    it('returns false when no messages exist', () => {
      expect(topicMemory.needsSummaryUpdate(100)).toBe(false);
    });

    it('returns true when messages exceed threshold and no summary exists', () => {
      for (let i = 0; i < 25; i++) {
        topicMemory.insertMessage({
          messageId: i, topicId: 100, text: `Msg ${i}`, fromUser: true,
          timestamp: new Date(2026, 0, 1, 12, i).toISOString(), sessionName: null,
        });
      }

      expect(topicMemory.needsSummaryUpdate(100, 20)).toBe(true);
    });

    it('returns false when messages are below threshold', () => {
      for (let i = 0; i < 5; i++) {
        topicMemory.insertMessage({
          messageId: i, topicId: 100, text: `Msg ${i}`, fromUser: true,
          timestamp: new Date(2026, 0, 1, 12, i).toISOString(), sessionName: null,
        });
      }

      expect(topicMemory.needsSummaryUpdate(100, 20)).toBe(false);
    });

    it('returns true when new messages since last summary exceed threshold', () => {
      for (let i = 0; i < 50; i++) {
        topicMemory.insertMessage({
          messageId: i, topicId: 100, text: `Msg ${i}`, fromUser: true,
          timestamp: new Date(2026, 0, 1, 12, i).toISOString(), sessionName: null,
        });
      }

      // Summary at message count 20
      topicMemory.saveTopicSummary(100, 'Old summary', 20, 19);

      // Now 50 total - 20 at summary = 30 new messages, exceeds threshold of 20
      expect(topicMemory.needsSummaryUpdate(100, 20)).toBe(true);
    });
  });

  describe('getMessagesSinceSummary', () => {
    it('returns all messages when no summary exists', () => {
      for (let i = 0; i < 5; i++) {
        topicMemory.insertMessage({
          messageId: i, topicId: 100, text: `Msg ${i}`, fromUser: true,
          timestamp: new Date(2026, 0, 1, 12, i).toISOString(), sessionName: null,
        });
      }

      const messages = topicMemory.getMessagesSinceSummary(100);
      expect(messages).toHaveLength(5);
    });

    it('returns only messages since last summary', () => {
      for (let i = 0; i < 10; i++) {
        topicMemory.insertMessage({
          messageId: i, topicId: 100, text: `Msg ${i}`, fromUser: true,
          timestamp: new Date(2026, 0, 1, 12, i).toISOString(), sessionName: null,
        });
      }

      // Summary covers through messageId 4
      topicMemory.saveTopicSummary(100, 'Summary', 5, 4);

      const messages = topicMemory.getMessagesSinceSummary(100);
      expect(messages).toHaveLength(5);
      expect(messages[0].messageId).toBe(5);
      expect(messages[4].messageId).toBe(9);
    });
  });

  // ── Topic Metadata ──────────────────────────────────────────

  describe('topic metadata', () => {
    it('tracks topic names', () => {
      topicMemory.setTopicName(100, 'Project Discussion');
      const meta = topicMemory.getTopicMeta(100);
      expect(meta).not.toBeNull();
      expect(meta!.topicName).toBe('Project Discussion');
    });

    it('lists all topics sorted by activity', () => {
      topicMemory.insertMessage({
        messageId: 1, topicId: 100, text: 'Old topic',
        fromUser: true, timestamp: '2026-02-23T12:00:00Z', sessionName: null,
      });
      topicMemory.insertMessage({
        messageId: 2, topicId: 200, text: 'New topic',
        fromUser: true, timestamp: '2026-02-24T12:00:00Z', sessionName: null,
      });

      const topics = topicMemory.listTopics();
      expect(topics).toHaveLength(2);
      // Most recent first
      expect(topics[0].topicId).toBe(200);
      expect(topics[1].topicId).toBe(100);
    });

    it('reports hasSummary correctly', () => {
      topicMemory.insertMessage({
        messageId: 1, topicId: 100, text: 'Hello',
        fromUser: true, timestamp: '2026-02-24T12:00:00Z', sessionName: null,
      });

      let meta = topicMemory.getTopicMeta(100);
      expect(meta!.hasSummary).toBe(false);

      topicMemory.saveTopicSummary(100, 'Summary', 1, 1);

      meta = topicMemory.getTopicMeta(100);
      expect(meta!.hasSummary).toBe(true);
    });
  });

  // ── JSONL Import ────────────────────────────────────────────

  describe('importFromJsonl', () => {
    it('imports messages from JSONL file', () => {
      const jsonlPath = path.join(tmpDir, 'messages.jsonl');
      const lines = [
        JSON.stringify({ messageId: 1, topicId: 100, text: 'Hello', fromUser: true, timestamp: '2026-02-24T12:00:00Z', sessionName: null }),
        JSON.stringify({ messageId: 2, topicId: 100, text: 'Hi there', fromUser: false, timestamp: '2026-02-24T12:01:00Z', sessionName: 'session-1' }),
        JSON.stringify({ messageId: 3, topicId: 200, text: 'Different topic', fromUser: true, timestamp: '2026-02-24T12:02:00Z', sessionName: null }),
      ];
      fs.writeFileSync(jsonlPath, lines.join('\n'));

      const count = topicMemory.importFromJsonl(jsonlPath);
      expect(count).toBe(3);

      const messages100 = topicMemory.getRecentMessages(100);
      expect(messages100).toHaveLength(2);

      const messages200 = topicMemory.getRecentMessages(200);
      expect(messages200).toHaveLength(1);
    });

    it('skips entries without topicId', () => {
      const jsonlPath = path.join(tmpDir, 'messages.jsonl');
      const lines = [
        JSON.stringify({ messageId: 1, topicId: null, text: 'No topic', fromUser: true, timestamp: '2026-02-24T12:00:00Z' }),
        JSON.stringify({ messageId: 2, topicId: 100, text: 'Has topic', fromUser: true, timestamp: '2026-02-24T12:01:00Z' }),
      ];
      fs.writeFileSync(jsonlPath, lines.join('\n'));

      const count = topicMemory.importFromJsonl(jsonlPath);
      expect(count).toBe(1);
    });

    it('is idempotent — reimport does not duplicate', () => {
      const jsonlPath = path.join(tmpDir, 'messages.jsonl');
      fs.writeFileSync(jsonlPath, JSON.stringify({ messageId: 1, topicId: 100, text: 'Hello', fromUser: true, timestamp: '2026-02-24T12:00:00Z' }));

      topicMemory.importFromJsonl(jsonlPath);
      const count2 = topicMemory.importFromJsonl(jsonlPath);
      expect(count2).toBe(0);

      expect(topicMemory.getRecentMessages(100)).toHaveLength(1);
    });

    it('returns 0 for missing file', () => {
      const count = topicMemory.importFromJsonl('/nonexistent/path.jsonl');
      expect(count).toBe(0);
    });
  });

  describe('rebuild', () => {
    it('clears existing messages and reimports', () => {
      // Insert a message directly
      topicMemory.insertMessage({
        messageId: 999, topicId: 100, text: 'Direct insert',
        fromUser: true, timestamp: '2026-02-24T12:00:00Z', sessionName: null,
      });

      // Create JSONL with different message
      const jsonlPath = path.join(tmpDir, 'messages.jsonl');
      fs.writeFileSync(jsonlPath, JSON.stringify({
        messageId: 1, topicId: 200, text: 'From JSONL', fromUser: true, timestamp: '2026-02-24T12:01:00Z',
      }));

      const count = topicMemory.rebuild(jsonlPath);
      expect(count).toBe(1);

      // Old message should be gone
      expect(topicMemory.getRecentMessages(100)).toHaveLength(0);
      // New message should be there
      expect(topicMemory.getRecentMessages(200)).toHaveLength(1);
    });

    it('preserves summaries across rebuild', () => {
      topicMemory.saveTopicSummary(100, 'Important summary', 10, 5);

      const jsonlPath = path.join(tmpDir, 'messages.jsonl');
      fs.writeFileSync(jsonlPath, '');
      topicMemory.rebuild(jsonlPath);

      const summary = topicMemory.getTopicSummary(100);
      expect(summary).not.toBeNull();
      expect(summary!.summary).toBe('Important summary');
    });
  });

  // ── Context Formatting ──────────────────────────────────────

  describe('formatContextForSession', () => {
    it('includes summary and recent messages', () => {
      topicMemory.setTopicName(100, 'Dev Chat');
      topicMemory.insertMessage({
        messageId: 1, topicId: 100, text: 'Hello agent',
        fromUser: true, timestamp: '2026-02-24T12:00:00Z', sessionName: null,
      });
      topicMemory.insertMessage({
        messageId: 2, topicId: 100, text: 'Hello user',
        fromUser: false, timestamp: '2026-02-24T12:01:00Z', sessionName: null,
      });
      topicMemory.saveTopicSummary(100, 'User and agent discussed greetings.', 2, 2);

      const context = topicMemory.formatContextForSession(100);
      expect(context).toContain('Dev Chat');
      expect(context).toContain('CONVERSATION SUMMARY');
      expect(context).toContain('User and agent discussed greetings');
      expect(context).toContain('RECENT MESSAGES');
      expect(context).toContain('Hello agent');
      expect(context).toContain('Hello user');
    });

    it('works without summary', () => {
      topicMemory.insertMessage({
        messageId: 1, topicId: 100, text: 'Hello',
        fromUser: true, timestamp: '2026-02-24T12:00:00Z', sessionName: null,
      });

      const context = topicMemory.formatContextForSession(100);
      expect(context).not.toContain('CONVERSATION SUMMARY');
      expect(context).toContain('RECENT MESSAGES');
      expect(context).toContain('Hello');
    });

    it('returns minimal context for empty topic', () => {
      const context = topicMemory.formatContextForSession(999);
      expect(context).toContain('TOPIC CONTEXT');
      expect(context).toContain('0 total messages');
    });
  });

  // ── Stats ───────────────────────────────────────────────────

  describe('stats', () => {
    it('reports correct statistics', () => {
      topicMemory.insertMessage({
        messageId: 1, topicId: 100, text: 'Hello',
        fromUser: true, timestamp: '2026-02-24T12:00:00Z', sessionName: null,
      });
      topicMemory.insertMessage({
        messageId: 2, topicId: 200, text: 'World',
        fromUser: true, timestamp: '2026-02-24T12:01:00Z', sessionName: null,
      });
      topicMemory.saveTopicSummary(100, 'Summary', 1, 1);

      const stats = topicMemory.stats();
      expect(stats.totalMessages).toBe(2);
      expect(stats.totalTopics).toBe(2);
      expect(stats.topicsWithSummaries).toBe(1);
      expect(stats.dbSizeBytes).toBeGreaterThan(0);
    });

    it('reports zeros for empty database', () => {
      const stats = topicMemory.stats();
      expect(stats.totalMessages).toBe(0);
      expect(stats.totalTopics).toBe(0);
      expect(stats.topicsWithSummaries).toBe(0);
    });
  });

  // ── getTopicContext ─────────────────────────────────────────

  describe('getTopicContext', () => {
    it('returns full context object', () => {
      topicMemory.setTopicName(100, 'Test Topic');
      topicMemory.insertMessage({
        messageId: 1, topicId: 100, text: 'Hello',
        fromUser: true, timestamp: '2026-02-24T12:00:00Z', sessionName: null,
      });
      topicMemory.saveTopicSummary(100, 'Summary text', 1, 1);

      const ctx = topicMemory.getTopicContext(100);
      expect(ctx.summary).toBe('Summary text');
      expect(ctx.recentMessages).toHaveLength(1);
      expect(ctx.totalMessages).toBe(1);
      expect(ctx.topicName).toBe('Test Topic');
    });

    it('returns nulls for unknown topic', () => {
      const ctx = topicMemory.getTopicContext(999);
      expect(ctx.summary).toBeNull();
      expect(ctx.recentMessages).toHaveLength(0);
      expect(ctx.totalMessages).toBe(0);
      expect(ctx.topicName).toBeNull();
    });
  });
});

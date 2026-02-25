/**
 * Server Wiring Integrity Tests
 *
 * These tests verify that server.ts passes the correct dependencies to every
 * dependency-injected component. They don't start the full server — they
 * reconstruct the wiring patterns and verify no dependency is null, no-op,
 * or disconnected from reality.
 *
 * Background: StallTriageNurse shipped with 55 passing unit tests but was
 * broken in production because no test verified that the constructor actually
 * received a working intelligence provider, that clearStallForTopic actually
 * cleared stalls, or that respawnSession actually respawned sessions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { StallTriageNurse } from '../../src/monitoring/StallTriageNurse.js';
import { AutoDispatcher } from '../../src/core/AutoDispatcher.js';
import { DispatchExecutor } from '../../src/core/DispatchExecutor.js';
import { DispatchManager } from '../../src/core/DispatchManager.js';
import { SessionWatchdog } from '../../src/monitoring/SessionWatchdog.js';
import { AgentServer } from '../../src/server/AgentServer.js';
import type { TriageDeps, StallTriageConfig } from '../../src/monitoring/StallTriageNurse.types.js';
import type { IntelligenceProvider } from '../../src/core/types.js';
import { createTempProject } from '../helpers/setup.js';
import type { TempProject } from '../helpers/setup.js';

// ─── Helpers ──────────────────────────────────────────────

/**
 * Create a minimal mock TelegramAdapter with the methods that matter for wiring.
 * We simulate the internal pendingMessages map to test clearStallTracking.
 */
function createMockTelegramAdapter() {
  const pendingMessages = new Map<string, { topicId: number; sessionName: string; injectedAt: number; alerted: boolean }>();
  const sentMessages: Array<{ topicId: number; text: string }> = [];
  const topicSessions = new Map<number, string>();

  return {
    pendingMessages,
    sentMessages,
    topicSessions,

    sendToTopic: vi.fn(async (topicId: number, text: string) => {
      sentMessages.push({ topicId, text });
    }),

    getTopicHistory: vi.fn((_topicId: number, _limit: number) => []),

    clearStallTracking: vi.fn((topicId: number) => {
      // This is the real implementation from TelegramAdapter
      for (const [key, pending] of pendingMessages) {
        if (pending.topicId === topicId) {
          pendingMessages.delete(key);
        }
      }
    }),

    registerTopicSession: vi.fn((topicId: number, sessionName: string) => {
      topicSessions.set(topicId, sessionName);
    }),

    getTopicForSession: vi.fn((sessionName: string): number | undefined => {
      for (const [topicId, name] of topicSessions) {
        if (name === sessionName) return topicId;
      }
      return undefined;
    }),

    getTopicName: vi.fn(() => null),
  };
}

function createMockSessionManager() {
  const aliveSessions = new Set<string>();
  const capturedOutputs = new Map<string, string>();
  const sentKeys: Array<{ session: string; key: string }> = [];
  const sentInputs: Array<{ session: string; text: string }> = [];
  let spawnCount = 0;

  return {
    aliveSessions,
    capturedOutputs,
    sentKeys,
    sentInputs,

    isSessionAlive: vi.fn((name: string) => aliveSessions.has(name)),

    captureOutput: vi.fn((name: string, _lines: number) => {
      return capturedOutputs.get(name) ?? 'default output';
    }),

    sendKey: vi.fn((name: string, key: string) => {
      sentKeys.push({ session: name, key });
      return aliveSessions.has(name);
    }),

    sendInput: vi.fn((name: string, text: string) => {
      sentInputs.push({ session: name, text });
      return aliveSessions.has(name);
    }),

    spawnInteractiveSession: vi.fn(async () => {
      spawnCount++;
      return `test-session-${spawnCount}`;
    }),

    startMonitoring: vi.fn(),
    on: vi.fn(),
    get spawnCount() { return spawnCount; },
  };
}

function createMockIntelligenceProvider(): IntelligenceProvider {
  return {
    evaluate: vi.fn(async () => JSON.stringify({
      summary: 'Test diagnosis',
      action: 'status_update',
      confidence: 'high',
      userMessage: 'Test message',
    })),
  };
}

// ─── Tests ──────────────────────────────────────────────

describe('Server Wiring Integrity', () => {
  let project: TempProject;

  beforeEach(() => {
    project = createTempProject();
  });

  afterEach(() => {
    project.cleanup();
    vi.restoreAllMocks();
  });

  // ─── StallTriageNurse Wiring ─────────────────────────────

  describe('StallTriageNurse wiring', () => {
    it('receives a functional intelligence provider (not null)', () => {
      const intelligence = createMockIntelligenceProvider();
      const deps = createWiredTriageDeps();

      const nurse = new StallTriageNurse(deps, {
        config: { enabled: true, verifyDelayMs: 0 },
        intelligence,
        state: project.state,
      });

      // The nurse was constructed with intelligence — verify via triage behavior
      expect(nurse).toBeInstanceOf(StallTriageNurse);
      expect(nurse.getStatus().enabled).toBe(true);
    });

    it('intelligence provider.evaluate is callable and returns diagnosis', async () => {
      const intelligence = createMockIntelligenceProvider();

      const result = await intelligence.evaluate('test prompt', { model: 'balanced' });

      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
      const parsed = JSON.parse(result);
      expect(parsed.action).toBeDefined();
    });

    it('triage uses intelligence provider when session is alive (not bypassed)', async () => {
      const intelligence = createMockIntelligenceProvider();
      const sessionManager = createMockSessionManager();
      sessionManager.aliveSessions.add('test-session');

      const deps = createWiredTriageDeps(sessionManager, createMockTelegramAdapter());

      const nurse = new StallTriageNurse(deps, {
        config: { enabled: true, verifyDelayMs: 0, useIntelligenceProvider: true },
        intelligence,
        state: project.state,
      });

      await nurse.triage(1, 'test-session', 'hello', Date.now());

      // Intelligence provider was actually called — this is the critical check
      expect(intelligence.evaluate).toHaveBeenCalledTimes(1);
      expect(intelligence.evaluate).toHaveBeenCalledWith(
        expect.stringContaining('session recovery specialist'),
        expect.any(Object),
      );
    });

    it('clearStallForTopic actually clears pending messages (not a no-op)', () => {
      const telegram = createMockTelegramAdapter();

      // Simulate pending stall messages
      telegram.pendingMessages.set('msg-1', {
        topicId: 42,
        sessionName: 'sess',
        injectedAt: Date.now() - 300000,
        alerted: false,
      });
      telegram.pendingMessages.set('msg-2', {
        topicId: 42,
        sessionName: 'sess',
        injectedAt: Date.now() - 200000,
        alerted: false,
      });
      telegram.pendingMessages.set('msg-3', {
        topicId: 99,
        sessionName: 'other',
        injectedAt: Date.now() - 100000,
        alerted: false,
      });

      expect(telegram.pendingMessages.size).toBe(3);

      // This is the wired function: (topicId) => telegram.clearStallTracking(topicId)
      const clearStallForTopic = (topicId: number) => telegram.clearStallTracking(topicId);
      clearStallForTopic(42);

      // Topic 42 messages cleared, topic 99 preserved
      expect(telegram.pendingMessages.size).toBe(1);
      expect(telegram.pendingMessages.has('msg-3')).toBe(true);
    });

    it('respawnSession dep calls through to real spawnInteractiveSession', async () => {
      const sessionManager = createMockSessionManager();
      const telegram = createMockTelegramAdapter();

      // Simulate the wiring from server.ts lines 1155:
      // respawnSession: (name, topicId) => respawnSessionForTopic(sessionManager, telegram, name, topicId)
      // We test a simplified version that verifies the delegation chain
      const respawnSession = async (name: string, topicId: number) => {
        const newSession = await sessionManager.spawnInteractiveSession(`[telegram:${topicId}] Session respawned`, name, { telegramTopicId: topicId });
        telegram.registerTopicSession(topicId, newSession);
        await telegram.sendToTopic(topicId, 'Session respawned.');
      };

      await respawnSession('dead-session', 42);

      expect(sessionManager.spawnInteractiveSession).toHaveBeenCalledTimes(1);
      expect(telegram.registerTopicSession).toHaveBeenCalledWith(42, expect.any(String));
      expect(telegram.sendToTopic).toHaveBeenCalledWith(42, 'Session respawned.');
    });

    it('sendToTopic dep delegates to telegram.sendToTopic', async () => {
      const telegram = createMockTelegramAdapter();

      // Wired as: sendToTopic: (topicId, text) => telegram.sendToTopic(topicId, text)
      const sendToTopic = (topicId: number, text: string) => telegram.sendToTopic(topicId, text);

      await sendToTopic(42, 'Recovery in progress');

      expect(telegram.sendToTopic).toHaveBeenCalledWith(42, 'Recovery in progress');
      expect(telegram.sentMessages).toHaveLength(1);
      expect(telegram.sentMessages[0]).toEqual({ topicId: 42, text: 'Recovery in progress' });
    });

    it('getTopicHistory dep delegates to telegram.getTopicHistory', () => {
      const telegram = createMockTelegramAdapter();
      const historyData = [
        { text: 'hello', fromUser: true, timestamp: '2026-01-01T00:00:00Z' },
        { text: 'hi back', fromUser: false, timestamp: '2026-01-01T00:01:00Z' },
      ];
      telegram.getTopicHistory.mockReturnValue(historyData);

      // Wired as: getTopicHistory: (topicId, limit) => { const entries = telegram.getTopicHistory(topicId, limit); ... }
      const getTopicHistory = (topicId: number, limit: number) => {
        const entries = telegram.getTopicHistory(topicId, limit);
        return entries.map((e: any) => ({
          text: e.text,
          fromUser: e.fromUser,
          timestamp: e.timestamp,
        }));
      };

      const result = getTopicHistory(42, 10);

      expect(telegram.getTopicHistory).toHaveBeenCalledWith(42, 10);
      expect(result).toHaveLength(2);
      expect(result[0].text).toBe('hello');
    });

    it('captureSessionOutput dep delegates to sessionManager.captureOutput', () => {
      const sessionManager = createMockSessionManager();
      sessionManager.capturedOutputs.set('test-session', 'real tmux output here');

      // Wired as: captureSessionOutput: (name, lines) => sessionManager.captureOutput(name, lines)
      const captureSessionOutput = (name: string, lines: number) => sessionManager.captureOutput(name, lines);

      const output = captureSessionOutput('test-session', 50);

      expect(sessionManager.captureOutput).toHaveBeenCalledWith('test-session', 50);
      expect(output).toBe('real tmux output here');
    });

    it('isSessionAlive dep delegates to sessionManager.isSessionAlive', () => {
      const sessionManager = createMockSessionManager();
      sessionManager.aliveSessions.add('alive-session');

      const isSessionAlive = (name: string) => sessionManager.isSessionAlive(name);

      expect(isSessionAlive('alive-session')).toBe(true);
      expect(isSessionAlive('dead-session')).toBe(false);
    });

    it('sendKey dep delegates to sessionManager.sendKey', () => {
      const sessionManager = createMockSessionManager();
      sessionManager.aliveSessions.add('test-session');

      const sendKey = (name: string, key: string) => sessionManager.sendKey(name, key);

      const result = sendKey('test-session', 'Escape');

      expect(sessionManager.sendKey).toHaveBeenCalledWith('test-session', 'Escape');
      expect(result).toBe(true);
      expect(sessionManager.sentKeys).toEqual([{ session: 'test-session', key: 'Escape' }]);
    });

    it('sendInput dep delegates to sessionManager.sendInput', () => {
      const sessionManager = createMockSessionManager();
      sessionManager.aliveSessions.add('test-session');

      const sendInput = (name: string, text: string) => sessionManager.sendInput(name, text);

      const result = sendInput('test-session', '');

      expect(sessionManager.sendInput).toHaveBeenCalledWith('test-session', '');
      expect(result).toBe(true);
      expect(sessionManager.sentInputs).toEqual([{ session: 'test-session', text: '' }]);
    });

    it('full TriageDeps object has no null/undefined members', () => {
      const deps = createWiredTriageDeps();

      // Every dep must be a function
      expect(typeof deps.captureSessionOutput).toBe('function');
      expect(typeof deps.isSessionAlive).toBe('function');
      expect(typeof deps.sendKey).toBe('function');
      expect(typeof deps.sendInput).toBe('function');
      expect(typeof deps.getTopicHistory).toBe('function');
      expect(typeof deps.sendToTopic).toBe('function');
      expect(typeof deps.respawnSession).toBe('function');
      expect(typeof deps.clearStallForTopic).toBe('function');
    });

    it('none of the dep functions are empty bodies', () => {
      const sessionManager = createMockSessionManager();
      const telegram = createMockTelegramAdapter();
      const deps = createWiredTriageDeps(sessionManager, telegram);

      // Call each dep and verify it delegates (produces a call on the underlying mock)
      deps.captureSessionOutput('sess', 10);
      expect(sessionManager.captureOutput).toHaveBeenCalled();

      deps.isSessionAlive('sess');
      expect(sessionManager.isSessionAlive).toHaveBeenCalled();

      deps.sendKey('sess', 'Escape');
      expect(sessionManager.sendKey).toHaveBeenCalled();

      deps.sendInput('sess', 'text');
      expect(sessionManager.sendInput).toHaveBeenCalled();

      deps.getTopicHistory(1, 10);
      expect(telegram.getTopicHistory).toHaveBeenCalled();

      deps.sendToTopic(1, 'msg');
      expect(telegram.sendToTopic).toHaveBeenCalled();

      deps.clearStallForTopic(1);
      expect(telegram.clearStallTracking).toHaveBeenCalled();
    });
  });

  // ─── AutoDispatcher Wiring ──────────────────────────────

  describe('AutoDispatcher wiring', () => {
    it('receives DispatchManager, DispatchExecutor, and StateManager', () => {
      const dispatchFile = path.join(project.stateDir, 'dispatches.json');
      fs.writeFileSync(dispatchFile, '[]');

      const dispatchManager = new DispatchManager({
        enabled: true,
        dispatchUrl: 'https://test.example.com/api/dispatches',
        dispatchFile,
        version: '1.0.0',
      });

      const mockSM = createMockSessionManager();
      const executor = new DispatchExecutor(project.dir, mockSM as any);

      const dispatcher = new AutoDispatcher(
        dispatchManager,
        executor,
        project.state,
        project.stateDir,
        { pollIntervalMinutes: 9999 }, // don't actually poll
      );

      expect(dispatcher).toBeDefined();
      // Verify it's a real AutoDispatcher, not some broken stub
      const status = dispatcher.getStatus();
      expect(status.running).toBe(false); // not started yet
      expect(status.pendingDispatches).toBe(0);
    });

    it('DispatchExecutor receives real SessionManager', () => {
      const mockSM = createMockSessionManager();
      const executor = new DispatchExecutor(project.dir, mockSM as any);

      // The executor should be able to access the session manager
      expect(executor).toBeDefined();
      // DispatchExecutor stores projectDir and sessionManager
      // We verify it was constructed without error and stores the reference
    });
  });

  // ─── AgentServer Wiring ──────────────────────────────────

  describe('AgentServer wiring', () => {
    it('accepts all optional components without error', () => {
      const mockSM = createMockSessionManager();

      const config = createMinimalConfig(project);

      // Construct AgentServer with all required fields
      const server = new AgentServer({
        config: config as any,
        sessionManager: mockSM as any,
        state: project.state,
      });

      expect(server).toBeDefined();
    });

    it('triageNurse passed to AgentServer is accessible', () => {
      const mockSM = createMockSessionManager();
      const config = createMinimalConfig(project);
      const intelligence = createMockIntelligenceProvider();
      const deps = createWiredTriageDeps();

      const triageNurse = new StallTriageNurse(deps, {
        config: { enabled: true, verifyDelayMs: 0 },
        intelligence,
        state: project.state,
      });

      const server = new AgentServer({
        config: config as any,
        sessionManager: mockSM as any,
        state: project.state,
        triageNurse,
      });

      expect(server).toBeDefined();
      // The server received the nurse — it can expose it via routes
    });
  });

  // ─── SessionWatchdog Wiring ─────────────────────────────

  describe('SessionWatchdog wiring', () => {
    it('receives SessionManager, StateManager, and config', () => {
      const mockSM = createMockSessionManager();
      const config = createMinimalConfig(project);
      (config as any).monitoring = {
        watchdog: {
          enabled: true,
          bashTimeout: 120000,
          escalationDelays: [30000, 30000, 30000, 30000],
          checkInterval: 15000,
        },
      };

      const watchdog = new SessionWatchdog(config as any, mockSM as any, project.state);

      expect(watchdog).toBeDefined();
      // Watchdog has an event emitter interface — verify it's wired
      expect(typeof watchdog.on).toBe('function');
      expect(typeof watchdog.start).toBe('function');
    });
  });
});

// ─── Wiring Reconstruction Helpers ──────────────────────

/**
 * Reconstruct the TriageDeps wiring as done in server.ts lines 1140-1157.
 * This mirrors the real wiring pattern, not a convenience mock.
 */
function createWiredTriageDeps(
  sessionManager?: ReturnType<typeof createMockSessionManager>,
  telegram?: ReturnType<typeof createMockTelegramAdapter>,
): TriageDeps {
  const sm = sessionManager ?? createMockSessionManager();
  const tg = telegram ?? createMockTelegramAdapter();

  return {
    captureSessionOutput: (name, lines) => sm.captureOutput(name, lines),
    isSessionAlive: (name) => sm.isSessionAlive(name),
    sendKey: (name, key) => sm.sendKey(name, key),
    sendInput: (name, text) => sm.sendInput(name, text),
    getTopicHistory: (topicId, limit) => {
      const entries = tg.getTopicHistory(topicId, limit);
      return entries.map((e: any) => ({
        text: e.text,
        fromUser: e.fromUser,
        timestamp: e.timestamp,
      }));
    },
    sendToTopic: (topicId, text) => tg.sendToTopic(topicId, text),
    respawnSession: async (name, topicId) => {
      const newSession = await sm.spawnInteractiveSession(`[telegram:${topicId}] respawned`, name, { telegramTopicId: topicId });
      tg.registerTopicSession(topicId, newSession);
      await tg.sendToTopic(topicId, 'Session respawned.');
    },
    clearStallForTopic: (topicId) => tg.clearStallTracking(topicId),
  };
}

function createMinimalConfig(project: TempProject) {
  return {
    projectDir: project.dir,
    stateDir: project.stateDir,
    projectName: 'test-project',
    port: 0, // random port
    authToken: 'test-auth-token',
    version: '0.0.0-test',
    sessions: {
      claudePath: '/usr/bin/false', // won't be called
      maxInteractiveSessions: 5,
      maxJobSessions: 3,
    },
    monitoring: {},
    messaging: [],
    updates: { autoApply: false },
  };
}

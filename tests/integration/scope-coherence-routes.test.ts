/**
 * Integration test — Scope Coherence API routes.
 *
 * Tests the HTTP API for scope coherence tracking:
 * - GET /scope-coherence — current state
 * - POST /scope-coherence/record — record tool actions
 * - GET /scope-coherence/check — checkpoint trigger evaluation
 * - POST /scope-coherence/reset — reset state
 * - GET /context/active-job — active job context
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { AgentServer } from '../../src/server/AgentServer.js';
import {
  createTempProject,
  createMockSessionManager,
} from '../helpers/setup.js';
import type { TempProject, MockSessionManager } from '../helpers/setup.js';
import type { InstarConfig } from '../../src/core/types.js';

describe('Scope Coherence API routes', () => {
  let project: TempProject;
  let mockSM: MockSessionManager;
  let server: AgentServer;
  let app: ReturnType<AgentServer['getApp']>;
  const AUTH_TOKEN = 'test-auth-scope';

  beforeAll(async () => {
    project = createTempProject();
    mockSM = createMockSessionManager();

    const config: InstarConfig = {
      projectName: 'test-scope-project',
      projectDir: project.dir,
      stateDir: project.stateDir,
      port: 0,
      authToken: AUTH_TOKEN,
      requestTimeoutMs: 5000,
      version: '0.9.11',
      sessions: {
        claudePath: '/usr/bin/echo',
        maxSessions: 3,
        defaultMaxDurationMinutes: 30,
        protectedSessions: [],
        monitorIntervalMs: 5000,
      },
      scheduler: { enabled: false, jobsFile: '', maxParallelJobs: 1 },
      messaging: [],
      monitoring: {},
      updates: {},
      users: [],
    };

    server = new AgentServer({
      config,
      sessionManager: mockSM as any,
      state: project.state,
    });

    await server.start();
    app = server.getApp();
  });

  afterAll(async () => {
    await server.stop();
    project.cleanup();
  });

  const auth = () => ({ Authorization: `Bearer ${AUTH_TOKEN}` });

  describe('GET /scope-coherence', () => {
    it('returns 200 with default state', async () => {
      const res = await request(app).get('/scope-coherence').set(auth());
      expect(res.status).toBe(200);
      expect(res.body.implementationDepth).toBe(0);
      expect(res.body.sessionDocsRead).toEqual([]);
    });
  });

  describe('POST /scope-coherence/record', () => {
    it('records an Edit action and increments depth', async () => {
      // Reset first
      await request(app).post('/scope-coherence/reset').set(auth());

      const res = await request(app)
        .post('/scope-coherence/record')
        .set(auth())
        .send({ toolName: 'Edit', toolInput: { file_path: 'src/app.ts' } });

      expect(res.status).toBe(200);
      expect(res.body.implementationDepth).toBe(1);
    });

    it('returns 400 when toolName is missing', async () => {
      const res = await request(app)
        .post('/scope-coherence/record')
        .set(auth())
        .send({ toolInput: {} });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('toolName');
    });

    it('reduces depth when recording a scope doc Read', async () => {
      // Reset and add some depth
      await request(app).post('/scope-coherence/reset').set(auth());
      for (let i = 0; i < 8; i++) {
        await request(app)
          .post('/scope-coherence/record')
          .set(auth())
          .send({ toolName: 'Edit', toolInput: { file_path: `src/f${i}.ts` } });
      }

      // Read a spec
      const res = await request(app)
        .post('/scope-coherence/record')
        .set(auth())
        .send({ toolName: 'Read', toolInput: { file_path: 'docs/specs/MY_SPEC.md' } });

      expect(res.status).toBe(200);
      expect(res.body.implementationDepth).toBe(0); // max(0, 8-10)
      expect(res.body.sessionDocsRead).toContain('docs/specs/MY_SPEC.md');
    });
  });

  describe('GET /scope-coherence/check', () => {
    it('returns trigger=false when below threshold', async () => {
      await request(app).post('/scope-coherence/reset').set(auth());

      const res = await request(app).get('/scope-coherence/check').set(auth());
      expect(res.status).toBe(200);
      expect(res.body.trigger).toBe(false);
      expect(res.body.skipReason).toBe('below_threshold');
    });

    it('returns jobContext=null when no active job', async () => {
      await request(app).post('/scope-coherence/reset').set(auth());

      const res = await request(app).get('/scope-coherence/check').set(auth());
      expect(res.status).toBe(200);
      expect(res.body.jobContext).toBeNull();
    });
  });

  describe('POST /scope-coherence/reset', () => {
    it('resets all state', async () => {
      // Add some depth
      await request(app)
        .post('/scope-coherence/record')
        .set(auth())
        .send({ toolName: 'Edit', toolInput: { file_path: 'src/a.ts' } });

      // Reset
      const resetRes = await request(app).post('/scope-coherence/reset').set(auth());
      expect(resetRes.status).toBe(200);
      expect(resetRes.body.reset).toBe(true);

      // Verify reset
      const stateRes = await request(app).get('/scope-coherence').set(auth());
      expect(stateRes.body.implementationDepth).toBe(0);
    });
  });

  describe('GET /context/active-job', () => {
    it('returns active=false when no job is running', async () => {
      const res = await request(app).get('/context/active-job').set(auth());
      expect(res.status).toBe(200);
      expect(res.body.active).toBe(false);
    });

    it('returns job info when a job is active', async () => {
      // Write active-job state directly
      project.state.set('active-job', {
        slug: 'test-job',
        name: 'Test Job',
        description: 'A test job for scope checking',
        priority: 'medium',
        sessionName: 'test-session-abc',
        triggeredBy: 'cron',
        startedAt: new Date().toISOString(),
      });

      const res = await request(app).get('/context/active-job').set(auth());
      expect(res.status).toBe(200);
      expect(res.body.active).toBe(true);
      expect(res.body.job.slug).toBe('test-job');
      expect(res.body.job.name).toBe('Test Job');
      expect(res.body.job.description).toBe('A test job for scope checking');

      // Clean up
      project.state.delete('active-job');
    });
  });

  describe('wiring integrity', () => {
    it('scope-coherence routes use the same StateManager as the server', async () => {
      // Record via API
      await request(app).post('/scope-coherence/reset').set(auth());
      await request(app)
        .post('/scope-coherence/record')
        .set(auth())
        .send({ toolName: 'Write', toolInput: { file_path: 'src/new.ts' } });

      // Read via API — should see the same state
      const res = await request(app).get('/scope-coherence').set(auth());
      expect(res.body.implementationDepth).toBe(1);

      // Read directly from StateManager — should also match
      const directState = project.state.get<{ implementationDepth: number }>('scope-coherence');
      expect(directState?.implementationDepth).toBe(1);
    });
  });
});

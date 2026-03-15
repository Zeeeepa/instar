import { describe, it, expect, vi } from 'vitest';
import { TreeTriage } from '../../src/knowledge/TreeTriage.js';
import type { SelfKnowledgeLayer, SelfKnowledgeNode } from '../../src/knowledge/types.js';

function makeNode(id: string, opts?: Partial<SelfKnowledgeNode>): SelfKnowledgeNode {
  return {
    id,
    name: id.split('.').pop()!,
    alwaysInclude: false,
    managed: true,
    depth: 'shallow',
    maxTokens: 500,
    sensitivity: 'internal',
    sources: [],
    ...opts,
  };
}

const MOCK_LAYERS: SelfKnowledgeLayer[] = [
  { id: 'identity', name: 'Identity', description: 'Who the agent is, values, voice, relationships', children: [] },
  { id: 'experience', name: 'Experience', description: 'What the agent has learned, knowledge, decisions', children: [] },
  { id: 'capabilities', name: 'Capabilities', description: 'What the agent can do, tools, platforms, limits', children: [] },
  { id: 'state', name: 'State', description: 'Current operational state, running jobs, health', children: [] },
  { id: 'evolution', name: 'Evolution', description: 'Growth trajectory, improvement patterns, goals', children: [] },
];

// Layers with child nodes for Stage 2 testing
const LAYERS_WITH_NODES: SelfKnowledgeLayer[] = [
  {
    id: 'identity', name: 'Identity',
    description: 'Who the agent is, values, voice, relationships',
    children: [makeNode('identity.core', { alwaysInclude: true, description: 'Core identity and values' })],
  },
  {
    id: 'capabilities', name: 'Capabilities',
    description: 'What the agent can do, tools, platforms, limits',
    children: [
      makeNode('capabilities.publishing', { description: 'Telegraph and private viewer publishing' }),
      makeNode('capabilities.jobs', { description: 'Job scheduler and cron tasks' }),
      makeNode('capabilities.tunnel', { description: 'Cloudflare tunnel for remote access' }),
      makeNode('capabilities.backups', { description: 'Backup and snapshot system' }),
      makeNode('capabilities.ci', { description: 'CI health and GitHub Actions' }),
      makeNode('capabilities.dashboard', { description: 'Dashboard and file viewer' }),
      makeNode('capabilities.telegram_api', { description: 'Telegram messaging API' }),
      makeNode('capabilities.feedback', { description: 'Bug reports and feature requests' }),
      makeNode('capabilities.git_sync', { description: 'Git synchronization across machines' }),
      makeNode('capabilities.sessions', { description: 'Claude Code session management' }),
    ],
  },
  {
    id: 'experience', name: 'Experience',
    description: 'What the agent has learned, knowledge, decisions',
    children: [
      makeNode('experience.lessons', { description: 'Lessons learned from past work' }),
      makeNode('experience.anti_patterns', { description: 'Anti-patterns and behavioral traps' }),
    ],
  },
  {
    id: 'state', name: 'State',
    description: 'Current operational state, running jobs, health',
    children: [
      makeNode('state.active_jobs', { description: 'Currently running jobs' }),
      makeNode('state.health', { description: 'Server health and uptime' }),
    ],
  },
  {
    id: 'evolution', name: 'Evolution',
    description: 'Growth trajectory, improvement patterns, goals',
    children: [
      makeNode('evolution.system', { description: 'Evolution system proposals' }),
      makeNode('evolution.playbook', { description: 'Playbook context engineering' }),
    ],
  },
];

describe('TreeTriage', () => {
  // Gate Test 1.7: Triage fallback activates when LLM unavailable
  it('falls back to rule-based when no intelligence provider', async () => {
    const triage = new TreeTriage(null);
    const result = await triage.triage('who am I?', MOCK_LAYERS);
    expect(result.mode).toBe('rule-based');
    expect(result.scores).toBeDefined();
  });

  it('falls back to rule-based when intelligence provider throws', async () => {
    const mockIntelligence = {
      evaluate: vi.fn().mockRejectedValue(new Error('LLM down')),
    };
    const triage = new TreeTriage(mockIntelligence);
    const result = await triage.triage('who am I?', MOCK_LAYERS);
    expect(result.mode).toBe('rule-based');
  });

  // Gate Test 1.8: Triage fallback keyword matching
  describe('rule-based fallback', () => {
    const triage = new TreeTriage(null);

    it('routes "who am I?" to identity layer', async () => {
      const result = await triage.triage('who am I?', MOCK_LAYERS);
      expect(result.scores['identity']).toBeGreaterThanOrEqual(0.3);
    });

    it('routes "what can I do?" to capabilities layer', async () => {
      const result = await triage.triage('what can I do?', MOCK_LAYERS);
      expect(result.scores['capabilities']).toBeGreaterThanOrEqual(0.3);
    });

    it('routes "how am I growing?" to evolution layer', async () => {
      const result = await triage.triage('how am I growing?', MOCK_LAYERS);
      expect(result.scores['evolution']).toBeGreaterThanOrEqual(0.3);
    });

    it('routes "what jobs are running?" to state layer', async () => {
      const result = await triage.triage('what jobs are running?', MOCK_LAYERS);
      expect(result.scores['state']).toBeGreaterThanOrEqual(0.3);
    });

    it('routes "what have I learned?" to experience layer', async () => {
      const result = await triage.triage('what have I learned?', MOCK_LAYERS);
      expect(result.scores['experience']).toBeGreaterThanOrEqual(0.3);
    });

    it('gives identity baseline for unknown queries', async () => {
      const result = await triage.triage('xyzzy foobar', MOCK_LAYERS);
      expect(result.scores['identity']).toBeGreaterThanOrEqual(0.4);
    });
  });

  // Gate Test 1.4/1.5/1.6: LLM triage routing (mocked)
  describe('LLM triage', () => {
    it('uses LLM as primary path when intelligence provider is available', async () => {
      const mockIntelligence = {
        evaluate: vi.fn().mockResolvedValue('{"identity": 0.9, "experience": 0.2, "capabilities": 0.1, "state": 0.0, "evolution": 0.1}'),
      };
      const triage = new TreeTriage(mockIntelligence);
      const result = await triage.triage('who am I?', MOCK_LAYERS);
      // LLM is primary — always used when available
      expect(result.mode).toBe('llm');
      expect(result.scores['identity']).toBeGreaterThanOrEqual(0.6);
      expect(mockIntelligence.evaluate).toHaveBeenCalled();
    });

    it('routes ambiguous queries via LLM intelligence', async () => {
      const mockIntelligence = {
        evaluate: vi.fn().mockResolvedValue('{"identity": 0.9, "experience": 0.0, "capabilities": 0.0, "state": 0.0, "evolution": 0.0}'),
      };
      const triage = new TreeTriage(mockIntelligence);
      const result = await triage.triage('arbitrary xyzzy foobar', MOCK_LAYERS);
      // LLM handles ambiguous queries that rules would misroute
      expect(result.mode).toBe('llm');
      expect(result.scores['identity']).toBeGreaterThanOrEqual(0.6);
    });

    it('handles malformed LLM JSON gracefully', async () => {
      const mockIntelligence = {
        evaluate: vi.fn().mockResolvedValue('Here is some text without JSON'),
      };
      const triage = new TreeTriage(mockIntelligence);
      // Should fall back to rule-based
      const result = await triage.triage('who am I?', MOCK_LAYERS);
      expect(result.mode).toBe('rule-based');
    });

    it('clamps scores to 0-1 range', async () => {
      const mockIntelligence = {
        evaluate: vi.fn().mockResolvedValue('{"identity": 5.0, "experience": -1.0, "capabilities": 0.5, "state": 0.3, "evolution": 0.1}'),
      };
      const triage = new TreeTriage(mockIntelligence);
      const result = await triage.triage('test', MOCK_LAYERS);
      expect(result.scores['identity']).toBeLessThanOrEqual(1);
      expect(result.scores['experience']).toBeGreaterThanOrEqual(0);
    });
  });

  describe('filterRelevantLayers', () => {
    const triage = new TreeTriage(null);

    it('filters layers above threshold', () => {
      const scores = { identity: 0.9, experience: 0.2, capabilities: 0.5, state: 0.1, evolution: 0.4 };
      const relevant = triage.filterRelevantLayers(MOCK_LAYERS, scores);
      const relevantIds = relevant.map(l => l.id);
      expect(relevantIds).toContain('identity');
      expect(relevantIds).toContain('capabilities');
      expect(relevantIds).toContain('evolution');
      expect(relevantIds).not.toContain('experience');
      expect(relevantIds).not.toContain('state');
    });
  });

  // ── Stage 2: Node-Level Scoring ────────────────────────────

  describe('Stage 2: Node-Level Scoring', () => {
    const triage = new TreeTriage(null);

    it('returns nodeScores in triage result', async () => {
      const result = await triage.triage('how do I publish something?', LAYERS_WITH_NODES);
      expect(result.nodeScores).toBeDefined();
      expect(typeof result.nodeScores).toBe('object');
    });

    it('scores publishing node highest for publishing queries', async () => {
      const result = await triage.triage('how do I publish something publicly via telegraph?', LAYERS_WITH_NODES);
      const ns = result.nodeScores!;
      expect(ns['capabilities.publishing']).toBeGreaterThan(0);
      expect(ns['capabilities.publishing']).toBeGreaterThan(ns['capabilities.ci'] ?? 0);
      expect(ns['capabilities.publishing']).toBeGreaterThan(ns['capabilities.backups'] ?? 0);
    });

    it('scores CI node highest for CI queries', async () => {
      const result = await triage.triage('check CI build status on github actions', LAYERS_WITH_NODES);
      const ns = result.nodeScores!;
      expect(ns['capabilities.ci']).toBeGreaterThan(0);
      expect(ns['capabilities.ci']).toBeGreaterThan(ns['capabilities.publishing'] ?? 0);
    });

    it('scores job node for scheduler queries', async () => {
      const result = await triage.triage('set up a recurring scheduled job', LAYERS_WITH_NODES);
      const ns = result.nodeScores!;
      expect(ns['capabilities.jobs']).toBeGreaterThan(0);
    });

    it('scores tunnel node for tunnel queries', async () => {
      const result = await triage.triage('expose the server via cloudflare tunnel', LAYERS_WITH_NODES);
      const ns = result.nodeScores!;
      expect(ns['capabilities.tunnel']).toBeGreaterThan(0);
    });

    it('scores backup node for backup queries', async () => {
      const result = await triage.triage('create a backup snapshot', LAYERS_WITH_NODES);
      const ns = result.nodeScores!;
      expect(ns['capabilities.backups']).toBeGreaterThan(0);
    });

    it('scores telegram node for messaging queries', async () => {
      const result = await triage.triage('send a telegram message', LAYERS_WITH_NODES);
      const ns = result.nodeScores!;
      expect(ns['capabilities.telegram_api']).toBeGreaterThan(0);
    });

    it('scores feedback node for bug report queries', async () => {
      const result = await triage.triage('report a bug in the feedback system', LAYERS_WITH_NODES);
      const ns = result.nodeScores!;
      expect(ns['capabilities.feedback']).toBeGreaterThan(0);
    });

    it('handles multi-capability queries by scoring multiple nodes', async () => {
      const result = await triage.triage('set up a job that checks CI and sends a telegram message', LAYERS_WITH_NODES);
      const ns = result.nodeScores!;
      expect(ns['capabilities.jobs']).toBeGreaterThan(0);
      expect(ns['capabilities.ci']).toBeGreaterThan(0);
      expect(ns['capabilities.telegram_api']).toBeGreaterThan(0);
    });

    it('gives alwaysInclude nodes a minimum score', async () => {
      const result = await triage.triage('random query', LAYERS_WITH_NODES);
      const ns = result.nodeScores!;
      // identity.core is alwaysInclude — should have a baseline score
      if (ns['identity.core'] !== undefined) {
        expect(ns['identity.core']).toBeGreaterThanOrEqual(0.5);
      }
    });

    it('does not score nodes in irrelevant layers', async () => {
      const result = await triage.triage('who am i?', LAYERS_WITH_NODES);
      // Identity should be relevant, capabilities should not
      expect(result.scores['identity']).toBeGreaterThanOrEqual(0.4);
      // Node scores should only contain nodes from relevant layers
      const ns = result.nodeScores!;
      // If capabilities layer is not relevant, its nodes shouldn't be scored
      if (result.scores['capabilities'] < 0.4) {
        expect(ns['capabilities.publishing']).toBeUndefined();
      }
    });
  });

  // ── Node Filtering ─────────────────────────────────────────

  describe('filterRelevantNodes', () => {
    const triage = new TreeTriage(null);

    it('returns only above-threshold nodes', () => {
      const nodes = LAYERS_WITH_NODES[1].children; // capabilities layer
      const nodeScores: Record<string, number> = {
        'capabilities.publishing': 0.75,
        'capabilities.jobs': 0.0,
        'capabilities.tunnel': 0.0,
        'capabilities.backups': 0.0,
        'capabilities.ci': 0.0,
        'capabilities.dashboard': 0.0,
        'capabilities.telegram_api': 0.0,
        'capabilities.feedback': 0.0,
        'capabilities.git_sync': 0.0,
        'capabilities.sessions': 0.0,
      };

      const filtered = triage.filterRelevantNodes(nodes, nodeScores);
      const ids = filtered.map(n => n.id);
      expect(ids).toContain('capabilities.publishing');
      expect(ids).not.toContain('capabilities.jobs');
      expect(ids).not.toContain('capabilities.ci');
    });

    it('always includes alwaysInclude nodes regardless of score', () => {
      const allNodes = LAYERS_WITH_NODES.flatMap(l => l.children);
      const nodeScores: Record<string, number> = {};
      for (const node of allNodes) {
        nodeScores[node.id] = 0;
      }

      const filtered = triage.filterRelevantNodes(allNodes, nodeScores);
      expect(filtered.some(n => n.id === 'identity.core')).toBe(true);
    });
  });

  // ── Query Sanitization ─────────────────────────────────────

  describe('Query Sanitization', () => {
    const triage = new TreeTriage(null);

    it('handles very long queries without crashing', async () => {
      const longQuery = 'a'.repeat(1000);
      const result = await triage.triage(longQuery, LAYERS_WITH_NODES);
      expect(result).toBeDefined();
      expect(result.scores).toBeDefined();
    });

    it('strips HTML tags from queries and still matches keywords', async () => {
      const result = await triage.triage('<b>how</b> do I <em>publish</em> something publicly?', LAYERS_WITH_NODES);
      expect(result).toBeDefined();
      // After stripping HTML: "how do I publish something publicly?"
      // "publish" is a node keyword for capabilities.publishing
      expect(result.nodeScores!['capabilities.publishing']).toBeGreaterThan(0);
    });

    it('handles control characters in queries', async () => {
      const result = await triage.triage('publish\x00\x01\x02something', LAYERS_WITH_NODES);
      expect(result).toBeDefined();
    });
  });

  // ── Node ID Validation ─────────────────────────────────────

  describe('validateNodeIds', () => {
    const triage = new TreeTriage(null);

    it('validates known node IDs', () => {
      const valid = triage.validateNodeIds(
        ['capabilities.publishing', 'capabilities.jobs', 'fake.node'],
        LAYERS_WITH_NODES,
      );
      expect(valid).toContain('capabilities.publishing');
      expect(valid).toContain('capabilities.jobs');
      expect(valid).not.toContain('fake.node');
    });

    it('returns empty for all unknown IDs', () => {
      const valid = triage.validateNodeIds(['fake.a', 'fake.b'], LAYERS_WITH_NODES);
      expect(valid).toHaveLength(0);
    });
  });

  // ── Rule-based Primary, LLM Fallback ───────────────────────

  describe('LLM-primary, rule-based fallback', () => {
    it('uses LLM for all queries when intelligence is available', async () => {
      const mockIntelligence = {
        evaluate: vi.fn().mockResolvedValue('{"identity": 0.1, "experience": 0.1, "capabilities": 0.9, "state": 0.1, "evolution": 0.1}'),
      };
      const triage = new TreeTriage(mockIntelligence);
      const result = await triage.triage('what tools can I use?', LAYERS_WITH_NODES);

      // LLM is always primary when available — even for clear keyword matches
      expect(result.mode).toBe('llm');
      expect(mockIntelligence.evaluate).toHaveBeenCalled();
    });

    it('falls back to rule-based when LLM throws', async () => {
      const mockIntelligence = {
        evaluate: vi.fn().mockRejectedValue(new Error('rate limited')),
      };
      const triage = new TreeTriage(mockIntelligence);
      const result = await triage.triage('arbitrary zqwxyz nonsense', LAYERS_WITH_NODES);
      // LLM failed — rule-based fallback provides identity baseline
      expect(result.mode).toBe('rule-based');
      expect(result.scores['identity']).toBeGreaterThanOrEqual(0.4);
    });
  });

  // ── Performance ────────────────────────────────────────────

  describe('Performance', () => {
    const triage = new TreeTriage(null);

    it('rule-based two-stage triage completes in under 5ms', async () => {
      const result = await triage.triage('how do I publish something?', LAYERS_WITH_NODES);
      expect(result.elapsedMs).toBeLessThan(5);
    });

    it('handles 50 nodes without performance degradation', async () => {
      const bigLayers = structuredClone(LAYERS_WITH_NODES);
      for (let i = 0; i < 40; i++) {
        bigLayers[1].children.push(makeNode(`capabilities.extra_${i}`));
      }

      const start = Date.now();
      const result = await triage.triage('publish something', bigLayers);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(10);
      expect(result.nodeScores).toBeDefined();
    });
  });
});

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { createRouterTransport, createClient, ConnectError, Code } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-node';
import { EventService } from '../../src/gen/fantasia/v1/events_pb.js';
import { registerRoutes, createFantasiaServer } from '../../src/server.js';
import { __setOrchestratorForTesting } from '../../src/bridge.js';
import { createMockOrchestrator, type MockOrchestrator } from '../helpers/mock-core.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function createInMemoryClient() {
  const transport = createRouterTransport(registerRoutes);
  return createClient(EventService, transport);
}

function createUdsClient(socketPath: string) {
  const transport = createConnectTransport({
    baseUrl: 'http://localhost',
    httpVersion: '1.1',
    nodeOptions: { socketPath },
  });
  return createClient(EventService, transport);
}

describe('EventService', () => {
  afterEach(() => {
    __setOrchestratorForTesting(null);
  });

  test('GetHistory returns events (in-memory)', async () => {
    const mock = await createMockOrchestrator();
    mock.events.emit({ type: 'orchestrator:ready' });
    mock.events.emit({ type: 'agent:spawned', agent: {
      id: 'a1',
      config: { role: 'mickey', name: 'Mickey', systemPrompt: 'hi', model: 'sonnet' },
      status: 'idle',
      startedAt: 1000,
      lastActivityAt: 1000,
    }});
    __setOrchestratorForTesting(mock as any);

    const client = createInMemoryClient();
    const response = await client.getHistory({ limit: 10 });
    expect(response.events.length).toBeGreaterThanOrEqual(2);
  });

  test('GetHistory fails when not initialized', async () => {
    const client = createInMemoryClient();
    try {
      await client.getHistory({});
      expect(true).toBe(false);
    } catch (err) {
      expect((err as ConnectError).code).toBe(Code.FailedPrecondition);
    }
  });

  // Streaming tests use a real HTTP server on a UDS
  describe('streaming (real server)', () => {
    let mock: MockOrchestrator;
    let socketPath: string;
    let server: Awaited<ReturnType<typeof createFantasiaServer>>;

    beforeEach(async () => {
      mock = await createMockOrchestrator();
      __setOrchestratorForTesting(mock as any);
      socketPath = join(tmpdir(), `fantasia-test-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`);
      server = createFantasiaServer(socketPath);
      await server.listen();
    });

    afterEach(async () => {
      await server.close();
      __setOrchestratorForTesting(null);
    });

    test('Subscribe streams live events', async () => {
      const client = createUdsClient(socketPath);
      const events: any[] = [];

      setTimeout(() => {
        mock.events.emit({ type: 'orchestrator:ready' });
        mock.events.emit({ type: 'agent:message', agentId: 'a1', content: 'hello', isPartial: false });
        mock.events.emit({ type: 'orchestrator:stopped' });
      }, 50);

      for await (const event of client.subscribe({ eventTypes: [], includeHistory: false })) {
        events.push(event);
        if (event.payload.case === 'orchestratorStopped') break;
      }

      expect(events.length).toBe(3);
      expect(events[0].payload.case).toBe('orchestratorReady');
      expect(events[1].payload.case).toBe('agentMessage');
      expect(events[2].payload.case).toBe('orchestratorStopped');
    });

    test('Subscribe with type filter', async () => {
      const client = createUdsClient(socketPath);
      const events: any[] = [];

      setTimeout(() => {
        mock.events.emit({ type: 'orchestrator:ready' });
        mock.events.emit({ type: 'agent:message', agentId: 'a1', content: 'hello', isPartial: false });
        mock.events.emit({ type: 'orchestrator:stopped' });
      }, 50);

      for await (const event of client.subscribe({ eventTypes: ['agentMessage', 'orchestratorStopped'], includeHistory: false })) {
        events.push(event);
        if (event.payload.case === 'orchestratorStopped') break;
      }

      expect(events.length).toBe(2);
      expect(events[0].payload.case).toBe('agentMessage');
      expect(events[1].payload.case).toBe('orchestratorStopped');
    });

    test('Subscribe with history replay', async () => {
      mock.events.emit({ type: 'orchestrator:ready' });
      mock.events.emit({ type: 'agent:spawned', agent: {
        id: 'a1',
        config: { role: 'mickey', name: 'Mickey', systemPrompt: '', model: 'sonnet' },
        status: 'idle',
        startedAt: 0,
        lastActivityAt: 0,
      }});

      const client = createUdsClient(socketPath);
      const events: any[] = [];

      setTimeout(() => {
        mock.events.emit({ type: 'orchestrator:stopped' });
      }, 50);

      for await (const event of client.subscribe({ eventTypes: [], includeHistory: true })) {
        events.push(event);
        if (event.payload.case === 'orchestratorStopped') break;
      }

      expect(events.length).toBe(3);
      expect(events[0].payload.case).toBe('orchestratorReady');
      expect(events[1].payload.case).toBe('agentSpawned');
      expect(events[2].payload.case).toBe('orchestratorStopped');
    });

    test('Subscribe sequence numbers are monotonic', async () => {
      const client = createUdsClient(socketPath);
      const sequences: bigint[] = [];

      setTimeout(() => {
        mock.events.emit({ type: 'orchestrator:ready' });
        mock.events.emit({ type: 'agent:message', agentId: 'a1', content: 'hi', isPartial: false });
        mock.events.emit({ type: 'orchestrator:stopped' });
      }, 50);

      for await (const event of client.subscribe({ eventTypes: [], includeHistory: false })) {
        sequences.push(event.sequence);
        if (event.payload.case === 'orchestratorStopped') break;
      }

      expect(sequences.length).toBe(3);
      for (let i = 1; i < sequences.length; i++) {
        expect(sequences[i]).toBeGreaterThan(sequences[i - 1]);
      }
    });
  });
});

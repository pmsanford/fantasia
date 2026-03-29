import { describe, test, expect, afterEach } from 'bun:test';
import { createRouterTransport, createClient } from '@connectrpc/connect';
import { MemoryService } from '../../src/gen/fantasia/v1/memory_pb.js';
import { AgentRole, MemoryType } from '../../src/gen/fantasia/v1/types_pb.js';
import { registerRoutes } from '../../src/server.js';
import { __setOrchestratorForTesting } from '../../src/bridge.js';
import { createMockOrchestrator } from '../helpers/mock-core.js';

function createTestClient() {
  const transport = createRouterTransport(registerRoutes);
  return createClient(MemoryService, transport);
}

describe('MemoryService', () => {
  afterEach(() => {
    __setOrchestratorForTesting(null);
  });

  test('Remember stores and returns entry', async () => {
    const mock = await createMockOrchestrator();
    __setOrchestratorForTesting(mock as any);

    const client = createTestClient();
    const response = await client.remember({
      agentRole: AgentRole.YEN_SID,
      type: MemoryType.LESSON,
      content: 'Always use integration tests',
      context: 'testing discussion',
      tags: ['testing', 'best-practice'],
    });

    expect(response.entry).toBeDefined();
    expect(response.entry?.content).toBe('Always use integration tests');
    expect(response.entry?.agentRole).toBe(AgentRole.YEN_SID);
    expect(response.entry?.type).toBe(MemoryType.LESSON);
    expect(response.entry?.tags).toEqual(['testing', 'best-practice']);
  });

  test('Recall returns matching memories', async () => {
    const mock = await createMockOrchestrator();
    await mock.memory.remember({
      agentRole: 'chernabog',
      type: 'rejection',
      content: 'No mocking the DB',
      context: 'review',
      tags: ['testing'],
    });
    __setOrchestratorForTesting(mock as any);

    const client = createTestClient();
    const response = await client.recall({
      role: AgentRole.CHERNABOG,
      tags: ['testing'],
    });

    expect(response.entries).toHaveLength(1);
    expect(response.entries[0].content).toBe('No mocking the DB');
  });

  test('Forget deletes a memory', async () => {
    const mock = await createMockOrchestrator();
    const entry = await mock.memory.remember({
      agentRole: 'yen-sid',
      type: 'pattern',
      content: 'Use factory pattern',
      context: 'design',
      tags: ['design'],
    });
    __setOrchestratorForTesting(mock as any);

    const client = createTestClient();
    const response = await client.forget({ id: entry.id });
    expect(response.deleted).toBe(true);

    const allResponse = await client.getAll({});
    expect(allResponse.entries).toHaveLength(0);
  });

  test('RecordApproval stores approval memory', async () => {
    const mock = await createMockOrchestrator();
    __setOrchestratorForTesting(mock as any);

    const client = createTestClient();
    const response = await client.recordApproval({
      agentRole: AgentRole.YEN_SID,
      planSummary: 'Auth module plan',
      tags: ['auth'],
    });

    expect(response.entry?.type).toBe(MemoryType.PATTERN);
  });

  test('RecordRejection stores rejection memory', async () => {
    const mock = await createMockOrchestrator();
    __setOrchestratorForTesting(mock as any);

    const client = createTestClient();
    const response = await client.recordRejection({
      agentRole: AgentRole.CHERNABOG,
      suggestion: 'Use Redux',
      reason: 'Too complex',
      tags: ['state'],
    });

    expect(response.entry?.type).toBe(MemoryType.REJECTION);
    expect(response.entry?.content).toContain('Use Redux');
  });

  test('GetAll returns all memories', async () => {
    const mock = await createMockOrchestrator();
    await mock.memory.remember({ agentRole: 'yen-sid', type: 'lesson', content: 'a', context: 'ctx', tags: [] });
    await mock.memory.remember({ agentRole: 'chernabog', type: 'pattern', content: 'b', context: 'ctx', tags: [] });
    __setOrchestratorForTesting(mock as any);

    const client = createTestClient();
    const response = await client.getAll({});
    expect(response.entries).toHaveLength(2);
  });
});

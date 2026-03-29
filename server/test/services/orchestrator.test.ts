import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { createRouterTransport, createClient, ConnectError, Code } from '@connectrpc/connect';
import { OrchestratorService } from '../../src/gen/fantasia/v1/orchestrator_pb.js';
import { registerRoutes } from '../../src/server.js';
import { __setOrchestratorForTesting } from '../../src/bridge.js';
import { createMockOrchestrator } from '../helpers/mock-core.js';
import { AgentRole, AgentStatus } from '../../src/gen/fantasia/v1/types_pb.js';

function createTestClient() {
  const transport = createRouterTransport(registerRoutes);
  return createClient(OrchestratorService, transport);
}

describe('OrchestratorService', () => {
  afterEach(() => {
    __setOrchestratorForTesting(null);
  });

  test('GetStatus returns agents and task counts', async () => {
    const mock = await createMockOrchestrator();
    __setOrchestratorForTesting(mock as any);

    const client = createTestClient();
    const response = await client.getStatus({});

    expect(response.running).toBe(true);
    expect(response.agents).toHaveLength(1);
    expect(response.agents[0].config?.role).toBe(AgentRole.MICKEY);
    expect(response.agents[0].status).toBe(AgentStatus.IDLE);
    expect(response.taskCounts?.total).toBe(0);
  });

  test('GetStatus fails when not initialized', async () => {
    const client = createTestClient();
    try {
      await client.getStatus({});
      expect(true).toBe(false); // should not reach
    } catch (err) {
      expect(err).toBeInstanceOf(ConnectError);
      expect((err as ConnectError).code).toBe(Code.FailedPrecondition);
    }
  });

  test('GetCost returns cost breakdown', async () => {
    const mock = await createMockOrchestrator();
    mock.context.addCost('agent-1', 0.5);
    mock.context.addCost('agent-2', 1.0);
    __setOrchestratorForTesting(mock as any);

    const client = createTestClient();
    const response = await client.getCost({});

    expect(response.cost?.totalCostUsd).toBe(1.5);
    expect(response.cost?.byAgent['agent-1']).toBe(0.5);
    expect(response.cost?.byAgent['agent-2']).toBe(1.0);
  });

  test('Submit calls orchestrator submit', async () => {
    const mock = await createMockOrchestrator();
    __setOrchestratorForTesting(mock as any);

    const client = createTestClient();
    await client.submit({ userMessage: 'hello' });
    // No error means success
  });

  test('Stop works when initialized', async () => {
    const mock = await createMockOrchestrator();
    __setOrchestratorForTesting(mock as any);

    const client = createTestClient();
    await client.stop({});
    // After stop, orchestrator should be null
    try {
      await client.getStatus({});
      expect(true).toBe(false);
    } catch (err) {
      expect((err as ConnectError).code).toBe(Code.FailedPrecondition);
    }
  });
});

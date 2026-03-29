import { describe, test, expect } from 'bun:test';
import {
  toProtoAgentRole,
  fromProtoAgentRole,
  toProtoAgentStatus,
  toProtoTaskStatus,
  fromProtoTaskStatus,
  toProtoTaskPriority,
  toProtoMemoryType,
  fromProtoMemoryType,
  toProtoAgentConfig,
  toProtoAgentInstance,
  toProtoTaskPlan,
  toProtoTaskReview,
  toProtoTaskResult,
  toProtoTask,
  toProtoMemoryEntry,
  toProtoTaskCounts,
  toProtoCostBreakdown,
  toProtoFantasiaEvent,
  fromProtoOrchestratorConfig,
} from '../src/convert.js';
import { create } from '@bufbuild/protobuf';
import {
  AgentRole,
  AgentStatus,
  TaskStatus,
  TaskPriority,
  MemoryType,
  EstimatedComplexity,
  OrchestratorConfigSchema,
} from '../src/gen/fantasia/v1/types_pb.js';
import type {
  AgentRole as CoreAgentRole,
  AgentInstance as CoreAgentInstance,
  Task as CoreTask,
  MemoryEntry as CoreMemoryEntry,
  FantasiaEvent as CoreFantasiaEvent,
} from '@fantasia/core';

describe('Agent Role conversion', () => {
  test('converts all roles to proto', () => {
    expect(toProtoAgentRole('mickey')).toBe(AgentRole.MICKEY);
    expect(toProtoAgentRole('yen-sid')).toBe(AgentRole.YEN_SID);
    expect(toProtoAgentRole('chernabog')).toBe(AgentRole.CHERNABOG);
    expect(toProtoAgentRole('broomstick')).toBe(AgentRole.BROOMSTICK);
    expect(toProtoAgentRole('imagineer')).toBe(AgentRole.IMAGINEER);
  });

  test('round-trips all roles', () => {
    const roles: CoreAgentRole[] = ['mickey', 'yen-sid', 'chernabog', 'broomstick', 'imagineer'];
    for (const role of roles) {
      expect(fromProtoAgentRole(toProtoAgentRole(role))).toBe(role);
    }
  });

  test('throws on unknown proto role', () => {
    expect(() => fromProtoAgentRole(99 as AgentRole)).toThrow('Unknown AgentRole');
  });
});

describe('Agent Status conversion', () => {
  test('converts all statuses', () => {
    expect(toProtoAgentStatus('idle')).toBe(AgentStatus.IDLE);
    expect(toProtoAgentStatus('working')).toBe(AgentStatus.WORKING);
    expect(toProtoAgentStatus('waiting')).toBe(AgentStatus.WAITING);
    expect(toProtoAgentStatus('error')).toBe(AgentStatus.ERROR);
    expect(toProtoAgentStatus('terminated')).toBe(AgentStatus.TERMINATED);
  });
});

describe('Task Status conversion', () => {
  test('round-trips all statuses including in-progress', () => {
    const statuses = ['pending', 'planning', 'reviewing', 'in-progress', 'blocked', 'completed', 'failed'] as const;
    for (const status of statuses) {
      expect(fromProtoTaskStatus(toProtoTaskStatus(status))).toBe(status);
    }
  });
});

describe('Memory Type conversion', () => {
  test('round-trips all types', () => {
    const types = ['lesson', 'rejection', 'preference', 'pattern'] as const;
    for (const type of types) {
      expect(fromProtoMemoryType(toProtoMemoryType(type))).toBe(type);
    }
  });
});

describe('Agent Config conversion', () => {
  test('converts config with string tools', () => {
    const config = toProtoAgentConfig({
      role: 'mickey',
      name: 'Mickey',
      systemPrompt: 'You are Mickey',
      model: 'sonnet',
      tools: ['Read', 'Write'],
    });
    expect(config.role).toBe(AgentRole.MICKEY);
    expect(config.name).toBe('Mickey');
    expect(config.tools).toEqual(['Read', 'Write']);
    expect(config.toolsPreset).toBeUndefined();
  });

  test('converts config with preset tools', () => {
    const config = toProtoAgentConfig({
      role: 'broomstick',
      name: 'Worker',
      systemPrompt: 'work',
      model: 'sonnet',
      tools: { type: 'preset', preset: 'claude_code' },
    });
    expect(config.tools).toEqual([]);
    expect(config.toolsPreset).toBe('claude_code');
  });
});

describe('Agent Instance conversion', () => {
  test('converts full instance', () => {
    const instance: CoreAgentInstance = {
      id: 'test-1',
      config: { role: 'yen-sid', name: 'Yen Sid', systemPrompt: 'plan', model: 'opus' },
      status: 'working',
      currentTaskId: 'task-1',
      sessionId: 'sess-1',
      startedAt: 1000,
      lastActivityAt: 2000,
      error: undefined,
    };
    const proto = toProtoAgentInstance(instance);
    expect(proto.id).toBe('test-1');
    expect(proto.config?.role).toBe(AgentRole.YEN_SID);
    expect(proto.status).toBe(AgentStatus.WORKING);
    expect(proto.currentTaskId).toBe('task-1');
    expect(proto.startedAt).toBe(1000n);
    expect(proto.lastActivityAt).toBe(2000n);
  });
});

describe('Task Plan conversion', () => {
  test('converts plan with subtasks', () => {
    const plan = toProtoTaskPlan({
      summary: 'Build auth',
      steps: ['step 1', 'step 2'],
      subtasks: [{ description: 'sub 1', dependencies: ['dep-1'] }],
      risks: ['risk 1'],
      estimatedComplexity: 'moderate',
    });
    expect(plan.summary).toBe('Build auth');
    expect(plan.steps).toEqual(['step 1', 'step 2']);
    expect(plan.subtasks).toHaveLength(1);
    expect(plan.subtasks[0].description).toBe('sub 1');
    expect(plan.estimatedComplexity).toBe(EstimatedComplexity.MODERATE);
  });
});

describe('Task conversion', () => {
  test('converts full task with metadata', () => {
    const task: CoreTask = {
      id: 'task-1',
      description: 'test task',
      status: 'in-progress',
      priority: 'high',
      createdBy: 'mickey',
      subtaskIds: ['sub-1'],
      createdAt: 1000,
      updatedAt: 2000,
      metadata: { key: 'value', nested: { a: 1 } },
    };
    const proto = toProtoTask(task);
    expect(proto.id).toBe('task-1');
    expect(proto.status).toBe(TaskStatus.IN_PROGRESS);
    expect(proto.priority).toBe(TaskPriority.HIGH);
    expect(proto.createdAt).toBe(1000n);
    const metadata = JSON.parse(new TextDecoder().decode(proto.metadataJson));
    expect(metadata.key).toBe('value');
    expect(metadata.nested.a).toBe(1);
  });
});

describe('Memory Entry conversion', () => {
  test('converts entry with relevance score', () => {
    const entry: CoreMemoryEntry = {
      id: 'mem-1',
      agentRole: 'chernabog',
      type: 'rejection',
      content: 'No mocks',
      context: 'testing',
      tags: ['test', 'mock'],
      timestamp: 5000,
      relevanceScore: 0.85,
    };
    const proto = toProtoMemoryEntry(entry);
    expect(proto.id).toBe('mem-1');
    expect(proto.agentRole).toBe(AgentRole.CHERNABOG);
    expect(proto.type).toBe(MemoryType.REJECTION);
    expect(proto.tags).toEqual(['test', 'mock']);
    expect(proto.timestamp).toBe(5000n);
    expect(proto.relevanceScore).toBe(0.85);
  });
});

describe('Task Counts conversion', () => {
  test('converts counts', () => {
    const counts = toProtoTaskCounts({ pending: 1, active: 2, completed: 3, failed: 0, total: 6 });
    expect(counts.pending).toBe(1);
    expect(counts.active).toBe(2);
    expect(counts.total).toBe(6);
  });
});

describe('Cost Breakdown conversion', () => {
  test('converts breakdown', () => {
    const cost = toProtoCostBreakdown(1.5, { 'agent-1': 0.5, 'agent-2': 1.0 });
    expect(cost.totalCostUsd).toBe(1.5);
    expect(cost.byAgent['agent-1']).toBe(0.5);
  });
});

describe('FantasiaEvent conversion', () => {
  test('converts agent:spawned event', () => {
    const event: CoreFantasiaEvent = {
      type: 'agent:spawned',
      agent: {
        id: 'a1',
        config: { role: 'mickey', name: 'Mickey', systemPrompt: 'hi', model: 'sonnet' },
        status: 'idle',
        startedAt: 1000,
        lastActivityAt: 1000,
      },
    };
    const proto = toProtoFantasiaEvent(event, 1);
    expect(proto.sequence).toBe(1n);
    expect(proto.payload.case).toBe('agentSpawned');
  });

  test('converts agent:status-changed event', () => {
    const event: CoreFantasiaEvent = {
      type: 'agent:status-changed',
      agentId: 'a1',
      oldStatus: 'idle',
      newStatus: 'working',
    };
    const proto = toProtoFantasiaEvent(event, 2);
    expect(proto.payload.case).toBe('agentStatusChanged');
    if (proto.payload.case === 'agentStatusChanged') {
      expect(proto.payload.value.agentId).toBe('a1');
      expect(proto.payload.value.oldStatus).toBe(AgentStatus.IDLE);
      expect(proto.payload.value.newStatus).toBe(AgentStatus.WORKING);
    }
  });

  test('converts orchestrator:error event', () => {
    const event: CoreFantasiaEvent = {
      type: 'orchestrator:error',
      error: new Error('something broke'),
    };
    const proto = toProtoFantasiaEvent(event, 3);
    expect(proto.payload.case).toBe('orchestratorError');
    if (proto.payload.case === 'orchestratorError') {
      expect(proto.payload.value.errorMessage).toBe('something broke');
    }
  });

  test('converts sdk:message event as opaque JSON', () => {
    const event: CoreFantasiaEvent = {
      type: 'sdk:message',
      agentId: 'a1',
      sdkMessage: { type: 'assistant', content: 'hello' } as any,
    };
    const proto = toProtoFantasiaEvent(event, 4);
    expect(proto.payload.case).toBe('sdkMessage');
    if (proto.payload.case === 'sdkMessage') {
      const decoded = JSON.parse(new TextDecoder().decode(proto.payload.value.sdkMessageJson));
      expect(decoded.content).toBe('hello');
    }
  });

  test('converts cost:update event', () => {
    const event: CoreFantasiaEvent = {
      type: 'cost:update',
      totalCostUsd: 2.5,
      breakdown: { 'agent-1': 1.0, 'agent-2': 1.5 },
    };
    const proto = toProtoFantasiaEvent(event, 5);
    expect(proto.payload.case).toBe('costUpdate');
    if (proto.payload.case === 'costUpdate') {
      expect(proto.payload.value.totalCostUsd).toBe(2.5);
      expect(proto.payload.value.breakdown['agent-1']).toBe(1.0);
    }
  });

  test('converts all event types without throwing', () => {
    const events: CoreFantasiaEvent[] = [
      { type: 'agent:spawned', agent: { id: 'a', config: { role: 'mickey', name: 'M', systemPrompt: '', model: 'm' }, status: 'idle', startedAt: 0, lastActivityAt: 0 } },
      { type: 'agent:status-changed', agentId: 'a', oldStatus: 'idle', newStatus: 'working' },
      { type: 'agent:terminated', agentId: 'a', reason: 'done' },
      { type: 'agent:message', agentId: 'a', content: 'hi', isPartial: false },
      { type: 'task:created', task: { id: 't', description: 'd', status: 'pending', priority: 'normal', createdBy: 'a', subtaskIds: [], createdAt: 0, updatedAt: 0, metadata: {} } },
      { type: 'task:status-changed', taskId: 't', oldStatus: 'pending', newStatus: 'planning' },
      { type: 'task:completed', taskId: 't', result: { success: true, output: 'done' } },
      { type: 'task:failed', taskId: 't', error: 'oops' },
      { type: 'orchestrator:ready' },
      { type: 'orchestrator:error', error: new Error('bad') },
      { type: 'orchestrator:stopped' },
      { type: 'user:input-needed', prompt: 'Choose one', taskId: 't' },
      { type: 'cost:update', totalCostUsd: 1, breakdown: {} },
      { type: 'sdk:message', agentId: 'a', sdkMessage: {} as any },
    ];
    for (let i = 0; i < events.length; i++) {
      const proto = toProtoFantasiaEvent(events[i], i + 1);
      expect(proto.payload.case).toBeDefined();
      expect(proto.sequence).toBe(BigInt(i + 1));
    }
  });
});

describe('OrchestratorConfig from proto', () => {
  test('converts full config', () => {
    const proto = create(OrchestratorConfigSchema, {
      model: 'opus',
      cwd: '/tmp',
      allowedTools: ['Read'],
      permissionMode: 'plan',
      maxConcurrentBroomsticks: 3,
      maxBudgetUsd: 10.0,
      memoryDir: '/tmp/mem',
      env: { FOO: 'bar' },
      modelOverrides: { 'yen-sid': 'opus' },
      enabledAgents: { 'imagineer': false },
    });
    const config = fromProtoOrchestratorConfig(proto);
    expect(config.model).toBe('opus');
    expect(config.cwd).toBe('/tmp');
    expect(config.allowedTools).toEqual(['Read']);
    expect(config.maxConcurrentBroomsticks).toBe(3);
    expect(config.maxBudgetUsd).toBe(10.0);
    expect(config.env).toEqual({ FOO: 'bar' });
    expect(config.modelOverrides?.['yen-sid']).toBe('opus');
    expect(config.enabledAgents?.['imagineer']).toBe(false);
  });

  test('returns empty config for defaults', () => {
    const proto = create(OrchestratorConfigSchema, {});
    const config = fromProtoOrchestratorConfig(proto);
    expect(config).toEqual({});
  });
});

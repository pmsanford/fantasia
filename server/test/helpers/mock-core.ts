import {
  FantasiaEventEmitter,
  TaskQueue,
  ContextStore,
  MemoryManager,
  MemoryStore,
  type Task,
  type AgentInstance,
  type AgentConfig,
  type BaseAgent,
} from '@fantasia/core';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface MockOrchestrator {
  events: FantasiaEventEmitter;
  taskQueue: TaskQueue;
  context: ContextStore;
  memory: MemoryManager;
  start(): Promise<void>;
  stop(): Promise<void>;
  submit(userMessage: string): Promise<void>;
  getAgents(): { instance: AgentInstance }[];
  getTask(id: string): Task | undefined;
  getTasks(): Task[];
}

function createMockAgentInstance(overrides?: Partial<AgentInstance>): AgentInstance {
  const config: AgentConfig = {
    role: 'mickey',
    name: 'Mickey',
    systemPrompt: 'test',
    model: 'sonnet',
    ...overrides?.config,
  };
  return {
    id: 'agent-1',
    config,
    status: 'idle',
    startedAt: Date.now(),
    lastActivityAt: Date.now(),
    subtaskIds: [],
    ...overrides,
  } as AgentInstance;
}

export async function createMockOrchestrator(): Promise<MockOrchestrator> {
  const events = new FantasiaEventEmitter();
  const taskQueue = new TaskQueue();
  const context = new ContextStore();
  const tempDir = await mkdtemp(join(tmpdir(), 'fantasia-test-'));
  const memoryStore = new MemoryStore(tempDir);
  await memoryStore.initialize();
  const memory = new MemoryManager(memoryStore);
  await memory.initialize();

  const agents: { instance: AgentInstance }[] = [
    { instance: createMockAgentInstance() },
  ];

  const tasks: Task[] = [];
  let submitCalls: string[] = [];

  return {
    events,
    taskQueue,
    context,
    memory,

    async start() {
      events.emit({ type: 'orchestrator:ready' });
    },

    async stop() {
      events.emit({ type: 'orchestrator:stopped' });
    },

    async submit(userMessage: string) {
      submitCalls.push(userMessage);
    },

    getAgents() {
      return agents;
    },

    getTask(id: string) {
      return taskQueue.get(id);
    },

    getTasks() {
      return taskQueue.getAll();
    },
  };
}

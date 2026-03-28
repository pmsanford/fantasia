import { describe, test, expect, beforeEach } from 'bun:test';
import { ImagineerAgent } from '../../src/agents/imagineer.js';
import type { HealthReport } from '../../src/agents/imagineer.js';
import { FantasiaEventEmitter } from '../../src/events/event-emitter.js';
import { MemoryManager } from '../../src/memory/memory-manager.js';
import { MemoryStore } from '../../src/memory/memory-store.js';
import { MockSdkAdapter } from '../fixtures/mock-sdk.js';

describe('ImagineerAgent', () => {
  let sdk: MockSdkAdapter;
  let events: FantasiaEventEmitter;
  let memory: MemoryManager;
  let imagineer: ImagineerAgent;

  beforeEach(async () => {
    sdk = new MockSdkAdapter();
    events = new FantasiaEventEmitter();
    const store = new MemoryStore(`/tmp/fantasia-test-${crypto.randomUUID()}`);
    memory = new MemoryManager(store);
    await memory.initialize();
    imagineer = new ImagineerAgent(sdk, events, memory);
  });

  test('has correct role', () => {
    expect(imagineer.instance.config.role).toBe('imagineer');
  });

  test('analyzeHealth returns no interventions for healthy agents', () => {
    const now = Date.now();
    const report: HealthReport = {
      agents: [
        { id: 'a1', role: 'mickey', name: 'Mickey', status: 'working', lastActivityAt: now - 1000 },
        { id: 'a2', role: 'broomstick', name: 'Broomstick-1', status: 'working', lastActivityAt: now - 30000 },
      ],
      taskCounts: { pending: 0, active: 2, completed: 1, failed: 0 },
      totalCostUsd: 0.5,
      timestamp: now,
    };

    const interventions = imagineer.analyzeHealth(report);
    expect(interventions).toHaveLength(0);
  });

  test('analyzeHealth detects error state agents', () => {
    const now = Date.now();
    const report: HealthReport = {
      agents: [
        { id: 'a1', role: 'broomstick', name: 'Broomstick-1', status: 'error', lastActivityAt: now - 1000, error: 'API timeout' },
      ],
      taskCounts: { pending: 0, active: 0, completed: 0, failed: 1 },
      totalCostUsd: 0.1,
      timestamp: now,
    };

    const interventions = imagineer.analyzeHealth(report);
    expect(interventions).toHaveLength(1);
    expect(interventions[0].agentId).toBe('a1');
    expect(interventions[0].action).toBe('restart');
    expect(interventions[0].reason).toContain('error state');
  });

  test('analyzeHealth detects stuck agents', () => {
    const now = Date.now();
    const sixMinutesAgo = now - 6 * 60 * 1000;
    const report: HealthReport = {
      agents: [
        { id: 'a1', role: 'broomstick', name: 'Broomstick-1', status: 'working', lastActivityAt: sixMinutesAgo },
      ],
      taskCounts: { pending: 0, active: 1, completed: 0, failed: 0 },
      totalCostUsd: 0.3,
      timestamp: now,
    };

    const interventions = imagineer.analyzeHealth(report);
    expect(interventions).toHaveLength(1);
    expect(interventions[0].action).toBe('restart');
    expect(interventions[0].reason).toContain('without activity');
  });

  test('analyzeHealth ignores idle agents', () => {
    const now = Date.now();
    const report: HealthReport = {
      agents: [
        { id: 'a1', role: 'mickey', name: 'Mickey', status: 'idle', lastActivityAt: now - 600000 },
      ],
      taskCounts: { pending: 0, active: 0, completed: 0, failed: 0 },
      totalCostUsd: 0,
      timestamp: now,
    };

    const interventions = imagineer.analyzeHealth(report);
    expect(interventions).toHaveLength(0);
  });

  test('analyzeHealth handles multiple issues', () => {
    const now = Date.now();
    const report: HealthReport = {
      agents: [
        { id: 'a1', role: 'broomstick', name: 'B1', status: 'error', lastActivityAt: now, error: 'crash' },
        { id: 'a2', role: 'broomstick', name: 'B2', status: 'working', lastActivityAt: now - 600000 },
        { id: 'a3', role: 'broomstick', name: 'B3', status: 'working', lastActivityAt: now - 10000 },
      ],
      taskCounts: { pending: 1, active: 2, completed: 0, failed: 1 },
      totalCostUsd: 1.0,
      timestamp: now,
    };

    const interventions = imagineer.analyzeHealth(report);
    expect(interventions).toHaveLength(2); // a1 (error) and a2 (stuck), not a3 (healthy)
  });
});

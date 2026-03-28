import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { MemoryManager } from '../../src/memory/memory-manager.js';
import { MemoryStore } from '../../src/memory/memory-store.js';
import { rm } from 'node:fs/promises';

describe('MemoryManager', () => {
  let manager: MemoryManager;
  let dir: string;

  beforeEach(async () => {
    dir = `/tmp/fantasia-mgr-test-${crypto.randomUUID()}`;
    const store = new MemoryStore(dir);
    manager = new MemoryManager(store);
    await manager.initialize();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('remember creates a memory entry', async () => {
    const entry = await manager.remember({
      agentRole: 'yen-sid',
      type: 'lesson',
      content: 'Always check for null',
      context: 'Null pointer exception',
      tags: ['error-handling'],
    });

    expect(entry.id).toBeTruthy();
    expect(entry.content).toBe('Always check for null');
    expect(entry.agentRole).toBe('yen-sid');
    expect(manager.size).toBe(1);
  });

  test('forget removes a memory', async () => {
    const entry = await manager.remember({
      agentRole: 'yen-sid',
      type: 'lesson',
      content: 'test',
      context: 'test',
    });

    expect(await manager.forget(entry.id)).toBe(true);
    expect(manager.size).toBe(0);
  });

  test('recall returns memories for a role', async () => {
    await manager.remember({
      agentRole: 'yen-sid',
      type: 'lesson',
      content: 'Yen Sid memory',
      context: 'test',
    });
    await manager.remember({
      agentRole: 'chernabog',
      type: 'lesson',
      content: 'Chernabog memory',
      context: 'test',
    });

    const yenSidMemories = manager.recall('yen-sid');
    expect(yenSidMemories).toHaveLength(1);
    expect(yenSidMemories[0].content).toBe('Yen Sid memory');
  });

  test('recall with tags scores by relevance', async () => {
    await manager.remember({
      agentRole: 'yen-sid',
      type: 'lesson',
      content: 'Auth lesson',
      context: 'test',
      tags: ['auth', 'security'],
    });
    await manager.remember({
      agentRole: 'yen-sid',
      type: 'lesson',
      content: 'Database lesson',
      context: 'test',
      tags: ['database'],
    });
    await manager.remember({
      agentRole: 'yen-sid',
      type: 'lesson',
      content: 'General lesson',
      context: 'test',
      tags: [],
    });

    const authMemories = manager.recall('yen-sid', ['auth']);
    // Auth lesson should come first (has matching tag)
    expect(authMemories[0].content).toBe('Auth lesson');
  });

  test('formatForPrompt generates readable output', async () => {
    await manager.remember({
      agentRole: 'yen-sid',
      type: 'lesson',
      content: 'Always validate input',
      context: 'test',
      tags: ['security'],
    });
    await manager.remember({
      agentRole: 'yen-sid',
      type: 'rejection',
      content: 'Rejected: using eval()',
      context: 'test',
      tags: ['security'],
    });

    const memories = manager.recall('yen-sid');
    const formatted = manager.formatForPrompt(memories);

    expect(formatted).toContain('Memories from Past Experience');
    expect(formatted).toContain('Lesson: Always validate input');
    expect(formatted).toContain('Rejected: Rejected: using eval()');
    expect(formatted).toContain('[security]');
  });

  test('formatForPrompt returns empty string for no memories', () => {
    expect(manager.formatForPrompt([])).toBe('');
  });

  test('formatForPrompt respects maxEntries', async () => {
    for (let i = 0; i < 30; i++) {
      await manager.remember({
        agentRole: 'yen-sid',
        type: 'lesson',
        content: `Memory ${i}`,
        context: 'test',
      });
    }

    const memories = manager.recall('yen-sid');
    const formatted = manager.formatForPrompt(memories, 5);
    const lines = formatted.split('\n').filter((l) => l.startsWith('- '));
    expect(lines).toHaveLength(5);
  });

  test('recordApproval creates a pattern memory', async () => {
    const entry = await manager.recordApproval(
      'yen-sid',
      'Use middleware pattern for auth',
      ['auth', 'architecture'],
    );

    expect(entry.type).toBe('pattern');
    expect(entry.content).toContain('Approved approach');
    expect(entry.tags).toContain('auth');
  });

  test('recordRejection creates a rejection memory', async () => {
    const entry = await manager.recordRejection(
      'yen-sid',
      'Store passwords in plaintext',
      'Security violation',
      ['auth', 'security'],
    );

    expect(entry.type).toBe('rejection');
    expect(entry.content).toContain('Rejected');
    expect(entry.content).toContain('Security violation');
  });

  test('recordLesson creates a lesson memory', async () => {
    const entry = await manager.recordLesson(
      'chernabog',
      'Plans that skip error handling always fail',
      'Multiple failed reviews',
      ['error-handling'],
    );

    expect(entry.type).toBe('lesson');
    expect(entry.agentRole).toBe('chernabog');
  });

  test('prune removes excess memories per role', async () => {
    for (let i = 0; i < 10; i++) {
      await manager.remember({
        agentRole: 'yen-sid',
        type: 'lesson',
        content: `Memory ${i}`,
        context: 'test',
      });
    }

    const pruned = await manager.prune(5);
    expect(pruned).toBe(5);
    expect(manager.getAll().filter((m) => m.agentRole === 'yen-sid')).toHaveLength(5);
  });

  test('prune keeps most recent memories', async () => {
    for (let i = 0; i < 10; i++) {
      await manager.remember({
        agentRole: 'yen-sid',
        type: 'lesson',
        content: `Memory ${i}`,
        context: 'test',
      });
      // Small delay to ensure distinct timestamps
      await new Promise((r) => setTimeout(r, 5));
    }

    await manager.prune(3);
    const remaining = manager.getAll();
    // Should keep the 3 most recent
    expect(remaining).toHaveLength(3);
    const contents = remaining.map((m) => m.content);
    expect(contents).toContain('Memory 9');
    expect(contents).toContain('Memory 8');
    expect(contents).toContain('Memory 7');
  });
});

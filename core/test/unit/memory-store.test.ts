import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { MemoryStore } from '../../src/memory/memory-store.js';
import { rm } from 'node:fs/promises';
import type { MemoryEntry } from '../../src/types.js';

describe('MemoryStore', () => {
  let store: MemoryStore;
  let dir: string;

  beforeEach(async () => {
    dir = `/tmp/fantasia-mem-test-${crypto.randomUUID()}`;
    store = new MemoryStore(dir);
    await store.initialize();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
    return {
      id: crypto.randomUUID(),
      agentRole: 'yen-sid',
      type: 'lesson',
      content: 'Test memory',
      context: 'test context',
      tags: ['test'],
      timestamp: Date.now(),
      ...overrides,
    };
  }

  test('save and get', async () => {
    const entry = makeEntry();
    await store.save(entry);
    expect(store.get(entry.id)).toEqual(entry);
  });

  test('get returns undefined for missing ID', () => {
    expect(store.get('nonexistent')).toBeUndefined();
  });

  test('delete removes entry', async () => {
    const entry = makeEntry();
    await store.save(entry);
    const deleted = await store.delete(entry.id);
    expect(deleted).toBe(true);
    expect(store.get(entry.id)).toBeUndefined();
  });

  test('delete returns false for missing entry', async () => {
    expect(await store.delete('nonexistent')).toBe(false);
  });

  test('getByRole filters correctly', async () => {
    await store.save(makeEntry({ agentRole: 'yen-sid' }));
    await store.save(makeEntry({ agentRole: 'chernabog' }));
    await store.save(makeEntry({ agentRole: 'yen-sid' }));

    expect(store.getByRole('yen-sid')).toHaveLength(2);
    expect(store.getByRole('chernabog')).toHaveLength(1);
    expect(store.getByRole('mickey')).toHaveLength(0);
  });

  test('getByTags matches any tag', async () => {
    await store.save(makeEntry({ tags: ['auth', 'security'] }));
    await store.save(makeEntry({ tags: ['database'] }));
    await store.save(makeEntry({ tags: ['auth', 'api'] }));

    expect(store.getByTags(['auth'])).toHaveLength(2);
    expect(store.getByTags(['database'])).toHaveLength(1);
    expect(store.getByTags(['auth', 'database'])).toHaveLength(3);
    expect(store.getByTags(['nonexistent'])).toHaveLength(0);
  });

  test('search matches content and context', async () => {
    await store.save(makeEntry({ content: 'Always validate JWT tokens' }));
    await store.save(makeEntry({ context: 'JWT expiry incident' }));
    await store.save(makeEntry({ content: 'Use transactions for batch operations' }));

    expect(store.search('JWT')).toHaveLength(2);
    expect(store.search('transactions')).toHaveLength(1);
    expect(store.search('nonexistent')).toHaveLength(0);
  });

  test('search is case insensitive', async () => {
    await store.save(makeEntry({ content: 'Use UPPERCASE patterns' }));

    expect(store.search('uppercase')).toHaveLength(1);
    expect(store.search('UPPERCASE')).toHaveLength(1);
  });

  test('size returns count', async () => {
    expect(store.size).toBe(0);
    await store.save(makeEntry());
    expect(store.size).toBe(1);
    await store.save(makeEntry());
    expect(store.size).toBe(2);
  });

  test('getAll returns all entries', async () => {
    await store.save(makeEntry());
    await store.save(makeEntry());
    expect(store.getAll()).toHaveLength(2);
  });

  test('persistence: reload from disk', async () => {
    const entry = makeEntry({ content: 'Persistent memory' });
    await store.save(entry);

    // Create a new store pointing at the same directory
    const store2 = new MemoryStore(dir);
    await store2.initialize();

    expect(store2.get(entry.id)).toEqual(entry);
    expect(store2.size).toBe(1);
  });

  test('update existing entry', async () => {
    const entry = makeEntry({ content: 'Original' });
    await store.save(entry);

    const updated = { ...entry, content: 'Updated' };
    await store.save(updated);

    expect(store.get(entry.id)?.content).toBe('Updated');
    expect(store.size).toBe(1);
  });
});

import { readdir, readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { MemoryEntry, AgentRole } from '../types.js';
import logger from '../logger.js';

const log = logger.child('memoryStore');

/**
 * File-backed persistent storage for agent memories.
 * Each memory entry is stored as a JSON file in the memory directory.
 */
export class MemoryStore {
  private dir: string;
  private cache: Map<string, MemoryEntry> = new Map();
  private loaded = false;

  constructor(dir: string) {
    this.dir = dir;
  }

  /**
   * Ensure the memory directory exists and load all entries into cache.
   */
  async initialize(): Promise<void> {
    log.info('Initializing memory store', { dir: this.dir });
    await mkdir(this.dir, { recursive: true });
    await this.loadAll();
    log.info('Memory store initialized', { entriesLoaded: this.cache.size });
  }

  /**
   * Save a memory entry to disk.
   */
  async save(entry: MemoryEntry): Promise<void> {
    log.debug('Saving memory entry', { id: entry.id, role: entry.agentRole, type: entry.type });
    const filePath = this.entryPath(entry.id);
    await writeFile(filePath, JSON.stringify(entry, null, 2), 'utf-8');
    this.cache.set(entry.id, entry);
  }

  /**
   * Get a memory entry by ID.
   */
  get(id: string): MemoryEntry | undefined {
    return this.cache.get(id);
  }

  /**
   * Delete a memory entry.
   */
  async delete(id: string): Promise<boolean> {
    log.debug('Deleting memory entry', { id });
    const existed = this.cache.delete(id);
    if (existed) {
      try {
        await unlink(this.entryPath(id));
      } catch {
        // File may already be gone
      }
    }
    return existed;
  }

  /**
   * Get all memories for a specific agent role.
   */
  getByRole(role: AgentRole): MemoryEntry[] {
    return Array.from(this.cache.values()).filter((e) => e.agentRole === role);
  }

  /**
   * Get all memories matching any of the given tags.
   */
  getByTags(tags: string[]): MemoryEntry[] {
    const tagSet = new Set(tags.map((t) => t.toLowerCase()));
    return Array.from(this.cache.values()).filter((e) =>
      e.tags.some((t) => tagSet.has(t.toLowerCase())),
    );
  }

  /**
   * Search memories by content substring.
   */
  search(query: string): MemoryEntry[] {
    const q = query.toLowerCase();
    return Array.from(this.cache.values()).filter(
      (e) =>
        e.content.toLowerCase().includes(q) ||
        e.context.toLowerCase().includes(q) ||
        e.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }

  /**
   * Get all memory entries.
   */
  getAll(): MemoryEntry[] {
    return Array.from(this.cache.values());
  }

  /**
   * Get the count of stored memories.
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Load all entries from disk into cache.
   */
  private async loadAll(): Promise<void> {
    this.cache.clear();
    try {
      const files = await readdir(this.dir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const content = await readFile(join(this.dir, file), 'utf-8');
          const entry: MemoryEntry = JSON.parse(content);
          this.cache.set(entry.id, entry);
        } catch (err) {
          log.warn('Skipping corrupt memory file', { file, error: String(err) });
        }
      }
    } catch {
      // Directory may not exist yet
    }
    this.loaded = true;
  }

  private entryPath(id: string): string {
    return join(this.dir, `${id}.json`);
  }
}

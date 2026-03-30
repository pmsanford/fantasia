import type { MemoryEntry, MemoryType, AgentRole } from '../types.js';
import { MemoryStore } from './memory-store.js';
import logger from '../logger.js';

const log = logger.child('memory');

/**
 * Higher-level memory manager that handles retrieval, prompt injection,
 * and lifecycle management for agent memories.
 */
export class MemoryManager {
  private store: MemoryStore;

  constructor(store: MemoryStore) {
    this.store = store;
  }

  /**
   * Initialize the underlying store.
   */
  async initialize(): Promise<void> {
    await this.store.initialize();
  }

  /**
   * Record a new memory.
   */
  async remember(params: {
    agentRole: AgentRole;
    type: MemoryType;
    content: string;
    context: string;
    tags?: string[];
  }): Promise<MemoryEntry> {
    const entry: MemoryEntry = {
      id: crypto.randomUUID(),
      agentRole: params.agentRole,
      type: params.type,
      content: params.content,
      context: params.context,
      tags: params.tags ?? [],
      timestamp: Date.now(),
    };
    await this.store.save(entry);
    log.debug('Memory remembered', { id: entry.id, role: params.agentRole, type: params.type });
    return entry;
  }

  /**
   * Forget a specific memory.
   */
  async forget(id: string): Promise<boolean> {
    log.debug('Forgetting memory', { id });
    return this.store.delete(id);
  }

  /**
   * Retrieve relevant memories for an agent, given optional context tags.
   * Returns memories sorted by relevance (tag overlap + recency).
   */
  recall(role: AgentRole, contextTags?: string[]): MemoryEntry[] {
    const roleMemories = this.store.getByRole(role);
    log.debug('Recall', { role, contextTags, found: roleMemories.length });

    if (!contextTags || contextTags.length === 0) {
      return this.sortByRecency(roleMemories);
    }

    // Score memories by tag overlap and recency
    const tagSet = new Set(contextTags.map((t) => t.toLowerCase()));
    const scored = roleMemories.map((entry) => {
      const tagOverlap = entry.tags.filter((t) => tagSet.has(t.toLowerCase())).length;
      const recencyScore = entry.timestamp / Date.now(); // 0-1, higher is more recent
      const score = tagOverlap * 10 + recencyScore;
      return { entry, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.map((s) => s.entry);
  }

  /**
   * Format memories for injection into an agent's system prompt.
   * Returns a string block that can be appended to the system prompt.
   */
  formatForPrompt(memories: MemoryEntry[], maxEntries = 20): string {
    if (memories.length === 0) return '';

    const entries = memories.slice(0, maxEntries);
    const lines = entries.map((m) => {
      const typeLabel = this.typeLabel(m.type);
      const tagStr = m.tags.length > 0 ? ` [${m.tags.join(', ')}]` : '';
      return `- ${typeLabel}: ${m.content}${tagStr}`;
    });

    return [
      '## Memories from Past Experience',
      '',
      'The following are lessons and patterns from previous work. Use these to inform your decisions:',
      '',
      ...lines,
    ].join('\n');
  }

  /**
   * Record a plan approval (positive pattern).
   */
  async recordApproval(agentRole: AgentRole, planSummary: string, tags: string[]): Promise<MemoryEntry> {
    return this.remember({
      agentRole,
      type: 'pattern',
      content: `Approved approach: ${planSummary}`,
      context: 'Plan was approved and executed successfully',
      tags,
    });
  }

  /**
   * Record a user rejection.
   */
  async recordRejection(agentRole: AgentRole, suggestion: string, reason: string, tags: string[]): Promise<MemoryEntry> {
    return this.remember({
      agentRole,
      type: 'rejection',
      content: `Rejected: ${suggestion}. Reason: ${reason}`,
      context: 'User rejected this suggestion',
      tags,
    });
  }

  /**
   * Record a lesson learned.
   */
  async recordLesson(agentRole: AgentRole, lesson: string, context: string, tags: string[]): Promise<MemoryEntry> {
    return this.remember({
      agentRole,
      type: 'lesson',
      content: lesson,
      context,
      tags,
    });
  }

  /**
   * Prune old or low-relevance memories.
   * Keeps at most `maxPerRole` memories per agent role.
   */
  async prune(maxPerRole = 50): Promise<number> {
    log.info('Pruning memories', { maxPerRole });
    let pruned = 0;
    const roles: AgentRole[] = ['mickey', 'yen-sid', 'chernabog', 'broomstick', 'imagineer', 'jacchus'];

    for (const role of roles) {
      const memories = this.sortByRecency(this.store.getByRole(role));
      if (memories.length > maxPerRole) {
        const toRemove = memories.slice(maxPerRole);
        for (const m of toRemove) {
          await this.store.delete(m.id);
          pruned++;
        }
      }
    }

    log.info('Prune completed', { pruned });
    return pruned;
  }

  /**
   * Get all memories (for debugging/inspection).
   */
  getAll(): MemoryEntry[] {
    return this.store.getAll();
  }

  /**
   * Get memory count.
   */
  get size(): number {
    return this.store.size;
  }

  private sortByRecency(memories: MemoryEntry[]): MemoryEntry[] {
    return [...memories].sort((a, b) => b.timestamp - a.timestamp);
  }

  private typeLabel(type: MemoryType): string {
    switch (type) {
      case 'lesson': return 'Lesson';
      case 'rejection': return 'Rejected';
      case 'preference': return 'Preference';
      case 'pattern': return 'Pattern';
    }
  }
}

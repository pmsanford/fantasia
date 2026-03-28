/**
 * Shared state that is accessible across agent runs within a session.
 * This is ephemeral state (not persisted to disk like memory).
 */
export class ContextStore {
  private data = new Map<string, unknown>();
  private costTracking = new Map<string, number>();

  /**
   * Set a value in the shared context.
   */
  set<T>(key: string, value: T): void {
    this.data.set(key, value);
  }

  /**
   * Get a value from the shared context.
   */
  get<T>(key: string): T | undefined {
    return this.data.get(key) as T | undefined;
  }

  /**
   * Check if a key exists.
   */
  has(key: string): boolean {
    return this.data.has(key);
  }

  /**
   * Delete a key.
   */
  delete(key: string): boolean {
    return this.data.delete(key);
  }

  /**
   * Track cost for an agent.
   */
  addCost(agentId: string, costUsd: number): void {
    const current = this.costTracking.get(agentId) ?? 0;
    this.costTracking.set(agentId, current + costUsd);
  }

  /**
   * Get cost breakdown by agent.
   */
  getCostBreakdown(): Record<string, number> {
    return Object.fromEntries(this.costTracking);
  }

  /**
   * Get total cost across all agents.
   */
  getTotalCost(): number {
    let total = 0;
    for (const cost of this.costTracking.values()) {
      total += cost;
    }
    return total;
  }

  /**
   * Clear all shared state.
   */
  clear(): void {
    this.data.clear();
    this.costTracking.clear();
  }
}

export class FantasiaError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'FantasiaError';
  }
}

export class AgentError extends FantasiaError {
  constructor(
    message: string,
    public readonly agentId: string,
    public readonly agentRole: string,
  ) {
    super(message, 'AGENT_ERROR');
    this.name = 'AgentError';
  }
}

export class TaskError extends FantasiaError {
  constructor(
    message: string,
    public readonly taskId: string,
  ) {
    super(message, 'TASK_ERROR');
    this.name = 'TaskError';
  }
}

export class OrchestratorError extends FantasiaError {
  constructor(message: string) {
    super(message, 'ORCHESTRATOR_ERROR');
    this.name = 'OrchestratorError';
  }
}

export class BudgetExceededError extends FantasiaError {
  constructor(
    public readonly currentCostUsd: number,
    public readonly maxBudgetUsd: number,
  ) {
    super(
      `Budget exceeded: $${currentCostUsd.toFixed(4)} / $${maxBudgetUsd.toFixed(4)}`,
      'BUDGET_EXCEEDED',
    );
    this.name = 'BudgetExceededError';
  }
}

export class MaxRetriesError extends FantasiaError {
  constructor(
    message: string,
    public readonly retries: number,
  ) {
    super(message, 'MAX_RETRIES');
    this.name = 'MaxRetriesError';
  }
}

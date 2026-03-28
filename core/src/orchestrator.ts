import type {
  OrchestratorConfig,
  SdkAdapter,
  Task,
  TaskPlan,
  TaskReview,
  TaskResult,
  AgentRole,
  AgentMessage,
  SDKUserMessage,
} from './types.js';
import { FantasiaEventEmitter } from './events/event-emitter.js';
import { MessageBus } from './messaging/message-bus.js';
import { TaskQueue } from './task/task-queue.js';
import { ContextStore } from './context/context-store.js';
import { MemoryStore } from './memory/memory-store.js';
import { MemoryManager } from './memory/memory-manager.js';
import { SessionPool } from './sdk/session-pool.js';
import { MickeyAgent } from './agents/mickey.js';
import { YenSidAgent } from './agents/yen-sid.js';
import { ChernabogAgent } from './agents/chernabog.js';
import { BroomstickAgent } from './agents/broomstick.js';
import { ImagineerAgent } from './agents/imagineer.js';
import type { HealthReport } from './agents/imagineer.js';
import { createFantasiaTools } from './tools/fantasia-tools.js';
import { createTask, transitionTask, setPlan, setReview, completeTask } from './task/task.js';
import { OrchestratorError, BudgetExceededError } from './errors.js';
import type { BaseAgent } from './agents/base-agent.js';

const MAX_PLAN_REVIEW_ITERATIONS = 2;
const HEALTH_CHECK_INTERVAL_MS = 30_000;

/**
 * The Fantasia orchestrator. Manages the full agent lifecycle:
 * Mickey receives user input -> Yen Sid plans -> Chernabog reviews -> Broomsticks execute.
 * Imagineer monitors everything.
 */
export class Orchestrator {
  readonly events: FantasiaEventEmitter;
  readonly messageBus: MessageBus;
  readonly taskQueue: TaskQueue;
  readonly context: ContextStore;
  readonly memory: MemoryManager;

  private sdk: SdkAdapter;
  private sessionPool: SessionPool;
  private config: Required<OrchestratorConfig>;
  private mickey: MickeyAgent | null = null;
  private imagineer: ImagineerAgent | null = null;
  private activeAgents = new Map<string, BaseAgent>();
  private running = false;
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;

  constructor(sdk: SdkAdapter, config: OrchestratorConfig = {}) {
    this.sdk = sdk;
    this.config = {
      model: config.model ?? 'claude-sonnet-4-6',
      cwd: config.cwd ?? process.cwd(),
      allowedTools: config.allowedTools ?? [],
      permissionMode: config.permissionMode ?? 'bypassPermissions',
      maxConcurrentBroomsticks: config.maxConcurrentBroomsticks ?? 5,
      maxBudgetUsd: config.maxBudgetUsd ?? 10,
      env: config.env ?? {},
      memoryDir: config.memoryDir ?? '.fantasia/memory',
      modelOverrides: config.modelOverrides ?? {},
      enabledAgents: config.enabledAgents ?? {},
    };

    this.events = new FantasiaEventEmitter();
    this.messageBus = new MessageBus();
    this.taskQueue = new TaskQueue(this.config.maxConcurrentBroomsticks);
    this.context = new ContextStore();
    this.sessionPool = new SessionPool(sdk);

    const memoryStore = new MemoryStore(this.config.memoryDir);
    this.memory = new MemoryManager(memoryStore);
  }

  /**
   * Start the orchestrator. Initializes memory and core agents.
   */
  async start(): Promise<void> {
    if (this.running) throw new OrchestratorError('Orchestrator is already running');

    await this.memory.initialize();

    this.mickey = new MickeyAgent(this.sdk, this.events, this.memory, {
      model: this.config.modelOverrides.mickey ?? this.config.model,
    });
    this.activeAgents.set(this.mickey.instance.id, this.mickey);
    this.events.emit({ type: 'agent:spawned', agent: this.mickey.instance });

    if (this.config.enabledAgents.imagineer !== false) {
      this.imagineer = new ImagineerAgent(this.sdk, this.events, this.memory, {
        model: this.config.modelOverrides.imagineer ?? this.config.model,
      });
      this.activeAgents.set(this.imagineer.instance.id, this.imagineer);
      this.events.emit({ type: 'agent:spawned', agent: this.imagineer.instance });

      this.healthCheckTimer = setInterval(() => this.runHealthCheck(), HEALTH_CHECK_INTERVAL_MS);
    }

    this.running = true;
    this.events.emit({ type: 'orchestrator:ready' });
  }

  /**
   * Stop the orchestrator and clean up all resources.
   */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    // Stop all active agents
    for (const agent of this.activeAgents.values()) {
      await agent.stop();
    }
    this.activeAgents.clear();

    this.sessionPool.closeAll();
    this.events.emit({ type: 'orchestrator:stopped' });
    this.events.stopStream();
  }

  /**
   * Submit a user message to Mickey.
   */
  async submit(userMessage: string): Promise<void> {
    if (!this.running || !this.mickey) {
      throw new OrchestratorError('Orchestrator is not running');
    }

    this.checkBudget();

    // Create Mickey's MCP tools
    const fantasiaTools = createFantasiaTools(this.sdk, {
      taskQueue: this.taskQueue,
      onDelegateTask: (description, priority) => this.handleDelegateTask(description, priority as any),
    });

    const result = await this.mickey.run({
      prompt: userMessage,
      cwd: this.config.cwd,
      env: this.config.env,
      extraSdkOptions: {
        mcpServers: { fantasia: fantasiaTools.server },
        allowedTools: [...fantasiaTools.toolNames, ...(this.config.allowedTools ?? [])],
      },
    });

    this.context.addCost(this.mickey.instance.id, result.costUsd);
    this.emitCostUpdate();
  }

  /**
   * Get all active agent instances.
   */
  getAgents(): BaseAgent[] {
    return Array.from(this.activeAgents.values());
  }

  /**
   * Get a specific task.
   */
  getTask(id: string): Task | undefined {
    return this.taskQueue.get(id);
  }

  /**
   * Get all tasks.
   */
  getTasks(): Task[] {
    return this.taskQueue.getAll();
  }

  // ─── Internal: Task Delegation Pipeline ───────────────────────

  /**
   * Handle a delegate_task call from Mickey.
   * Kicks off the Yen Sid -> Chernabog -> Broomstick pipeline.
   */
  private async handleDelegateTask(description: string, priority: 'critical' | 'high' | 'normal' | 'low'): Promise<string> {
    const task = createTask({
      id: crypto.randomUUID(),
      description,
      createdBy: this.mickey?.instance.id ?? 'orchestrator',
      priority,
    });
    this.taskQueue.add(task);
    this.events.emit({ type: 'task:created', task });

    // Run the pipeline asynchronously so Mickey isn't blocked
    this.runTaskPipeline(task.id).catch((error) => {
      this.events.emit({ type: 'orchestrator:error', error: error as Error });
    });

    return task.id;
  }

  /**
   * Full task pipeline: plan -> review -> execute.
   */
  private async runTaskPipeline(taskId: string): Promise<void> {
    let task = this.taskQueue.get(taskId);
    if (!task) return;

    try {
      // Phase 1: Planning (Yen Sid)
      task = transitionTask(task, 'planning');
      this.taskQueue.update(task);
      this.emitTaskStatusChange(task, 'pending');

      let plan = await this.requestPlan(task);
      task = setPlan(task, plan);
      this.taskQueue.update(task);

      // Phase 2: Review (Chernabog) with iteration
      task = transitionTask(task, 'reviewing');
      this.taskQueue.update(task);
      this.emitTaskStatusChange(task, 'planning');

      for (let iteration = 0; iteration < MAX_PLAN_REVIEW_ITERATIONS; iteration++) {
        const review = await this.requestReview(task);
        task = setReview(task, { ...review, iteration });
        this.taskQueue.update(task);

        if (review.approved) break;

        // If not approved and not at max iterations, revise the plan
        if (iteration < MAX_PLAN_REVIEW_ITERATIONS - 1) {
          task = transitionTask(task, 'planning');
          this.taskQueue.update(task);
          this.emitTaskStatusChange(task, 'reviewing');

          plan = await this.revisePlan(task, review);
          task = setPlan(task, plan);
          task = transitionTask(task, 'reviewing');
          this.taskQueue.update(task);
          this.emitTaskStatusChange(task, 'planning');
        }
      }

      // Phase 3: Execution (Broomsticks)
      task = transitionTask(task, 'in-progress');
      this.taskQueue.update(task);
      this.emitTaskStatusChange(task, 'reviewing');

      const result = await this.executePlan(task);
      task = completeTask(task, result);
      this.taskQueue.update(task);

      if (result.success) {
        this.events.emit({ type: 'task:completed', taskId: task.id, result });
        // Record positive pattern in memory
        if (task.plan) {
          await this.memory.recordApproval('yen-sid', task.plan.summary, this.extractTags(task));
        }
      } else {
        this.events.emit({ type: 'task:failed', taskId: task.id, error: result.output });
        // Record lesson in memory
        await this.memory.recordLesson(
          'yen-sid',
          `Plan failed: ${result.output}`,
          task.description,
          this.extractTags(task),
        );
      }
    } catch (error) {
      task = this.taskQueue.get(taskId) ?? task;
      const result: TaskResult = {
        success: false,
        output: `Pipeline error: ${error}`,
      };
      try {
        task = completeTask(task, result);
      } catch {
        // If transition fails, force the status
        task = { ...task, status: 'failed', result, updatedAt: Date.now() };
      }
      this.taskQueue.update(task);
      this.events.emit({ type: 'task:failed', taskId: task.id, error: String(error) });
    }
  }

  /**
   * Request a plan from Yen Sid.
   */
  private async requestPlan(task: Task): Promise<TaskPlan> {
    this.checkBudget();

    const yenSid = new YenSidAgent(this.sdk, this.events, this.memory, {
      model: this.config.modelOverrides['yen-sid'] ?? 'claude-opus-4-6',
    });
    this.activeAgents.set(yenSid.instance.id, yenSid);
    this.events.emit({ type: 'agent:spawned', agent: yenSid.instance });

    try {
      const prompt = [
        `Create a detailed implementation plan for the following task:`,
        '',
        task.description,
        '',
        'Return a JSON object with these fields:',
        '- summary: string (brief summary of the approach)',
        '- steps: string[] (ordered implementation steps)',
        '- subtasks: Array<{description: string, dependencies?: string[]}> (discrete work units that can be assigned to workers)',
        '- risks: string[] (potential issues)',
        '- estimatedComplexity: "trivial" | "simple" | "moderate" | "complex"',
      ].join('\n');

      const result = await yenSid.run({ prompt, cwd: this.config.cwd, env: this.config.env });
      this.context.addCost(yenSid.instance.id, result.costUsd);
      this.emitCostUpdate();

      return this.parsePlan(result.output);
    } finally {
      await yenSid.stop();
      this.activeAgents.delete(yenSid.instance.id);
    }
  }

  /**
   * Revise a plan based on Chernabog's review.
   */
  private async revisePlan(task: Task, review: TaskReview): Promise<TaskPlan> {
    this.checkBudget();

    const yenSid = new YenSidAgent(this.sdk, this.events, this.memory, {
      model: this.config.modelOverrides['yen-sid'] ?? 'claude-opus-4-6',
    });
    this.activeAgents.set(yenSid.instance.id, yenSid);
    this.events.emit({ type: 'agent:spawned', agent: yenSid.instance });

    try {
      const prompt = [
        `Revise your implementation plan based on the following review feedback:`,
        '',
        `## Original Task`,
        task.description,
        '',
        `## Previous Plan`,
        JSON.stringify(task.plan, null, 2),
        '',
        `## Review Feedback`,
        `Concerns: ${review.concerns.join('; ')}`,
        `Required Changes: ${review.requiredChanges.join('; ')}`,
        '',
        'Address all concerns and required changes. Return a revised JSON plan with the same schema.',
      ].join('\n');

      const result = await yenSid.run({ prompt, cwd: this.config.cwd, env: this.config.env });
      this.context.addCost(yenSid.instance.id, result.costUsd);
      this.emitCostUpdate();

      // Record the review feedback as a lesson
      await this.memory.recordLesson(
        'yen-sid',
        `Plan revision needed: ${review.concerns.join(', ')}`,
        task.description,
        this.extractTags(task),
      );

      return this.parsePlan(result.output);
    } finally {
      await yenSid.stop();
      this.activeAgents.delete(yenSid.instance.id);
    }
  }

  /**
   * Request a review from Chernabog.
   */
  private async requestReview(task: Task): Promise<TaskReview> {
    this.checkBudget();

    const chernabog = new ChernabogAgent(this.sdk, this.events, this.memory, {
      model: this.config.modelOverrides.chernabog ?? 'claude-opus-4-6',
    });
    this.activeAgents.set(chernabog.instance.id, chernabog);
    this.events.emit({ type: 'agent:spawned', agent: chernabog.instance });

    try {
      const prompt = [
        `Review the following implementation plan:`,
        '',
        `## Task`,
        task.description,
        '',
        `## Plan`,
        JSON.stringify(task.plan, null, 2),
        '',
        'Return a JSON object with these fields:',
        '- approved: boolean',
        '- concerns: string[] (issues found)',
        '- requiredChanges: string[] (mandatory changes before execution)',
        '- strengths: string[] (what the plan gets right)',
      ].join('\n');

      const result = await chernabog.run({ prompt, cwd: this.config.cwd, env: this.config.env });
      this.context.addCost(chernabog.instance.id, result.costUsd);
      this.emitCostUpdate();

      return this.parseReview(result.output);
    } finally {
      await chernabog.stop();
      this.activeAgents.delete(chernabog.instance.id);
    }
  }

  /**
   * Execute the plan using Broomstick workers.
   */
  private async executePlan(task: Task): Promise<TaskResult> {
    this.checkBudget();

    const plan = task.plan;
    if (!plan) {
      return { success: false, output: 'No plan available' };
    }

    // If the plan has subtasks, run them (potentially in parallel)
    if (plan.subtasks && plan.subtasks.length > 1) {
      return this.executeSubtasks(task, plan);
    }

    // Single broomstick for simple plans
    const planExcerpt = plan.steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
    const broomstick = new BroomstickAgent(
      this.sdk, this.events, this.memory,
      task.description, planExcerpt,
      { model: this.config.modelOverrides.broomstick ?? this.config.model },
    );
    this.activeAgents.set(broomstick.instance.id, broomstick);
    broomstick.instance.currentTaskId = task.id;
    this.events.emit({ type: 'agent:spawned', agent: broomstick.instance });

    try {
      const result = await broomstick.run({
        prompt: task.description,
        cwd: this.config.cwd,
        env: this.config.env,
      });
      this.context.addCost(broomstick.instance.id, result.costUsd);
      this.emitCostUpdate();

      return {
        success: result.success,
        output: result.output,
        costUsd: result.costUsd,
        durationMs: result.durationMs,
      };
    } finally {
      await broomstick.stop();
      this.activeAgents.delete(broomstick.instance.id);
    }
  }

  /**
   * Execute multiple subtasks, respecting dependencies and concurrency limits.
   */
  private async executeSubtasks(task: Task, plan: TaskPlan): Promise<TaskResult> {
    const subtasks = plan.subtasks!;
    const results: TaskResult[] = [];
    let allSuccess = true;

    // Simple approach: run subtasks without explicit dependencies in parallel,
    // sequential subtasks (those with deps) run after their deps complete
    // For now, run them all in parallel up to concurrency limit
    const promises = subtasks.map(async (subtask) => {
      this.checkBudget();

      const stepsPart = plan.steps.length > 0
        ? `\nOverall plan context:\n${plan.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
        : '';

      const broomstick = new BroomstickAgent(
        this.sdk, this.events, this.memory,
        subtask.description,
        stepsPart,
        { model: this.config.modelOverrides.broomstick ?? this.config.model },
      );
      this.activeAgents.set(broomstick.instance.id, broomstick);
      broomstick.instance.currentTaskId = task.id;
      this.events.emit({ type: 'agent:spawned', agent: broomstick.instance });

      try {
        const result = await broomstick.run({
          prompt: subtask.description,
          cwd: this.config.cwd,
          env: this.config.env,
        });
        this.context.addCost(broomstick.instance.id, result.costUsd);
        this.emitCostUpdate();

        const taskResult: TaskResult = {
          success: result.success,
          output: result.output,
          costUsd: result.costUsd,
          durationMs: result.durationMs,
        };
        if (!result.success) allSuccess = false;
        results.push(taskResult);
      } catch (error) {
        allSuccess = false;
        results.push({ success: false, output: String(error) });
      } finally {
        await broomstick.stop();
        this.activeAgents.delete(broomstick.instance.id);
      }
    });

    await Promise.all(promises);

    const totalCost = results.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
    const totalDuration = results.reduce((sum, r) => sum + (r.durationMs ?? 0), 0);
    const combinedOutput = results
      .map((r, i) => `[Subtask ${i + 1}] ${r.success ? 'SUCCESS' : 'FAILED'}: ${r.output}`)
      .join('\n\n');

    return {
      success: allSuccess,
      output: combinedOutput,
      costUsd: totalCost,
      durationMs: totalDuration,
    };
  }

  // ─── Health Monitoring ────────────────────────────────────────

  private runHealthCheck(): void {
    if (!this.imagineer || !this.running) return;

    const report: HealthReport = {
      agents: Array.from(this.activeAgents.values()).map((a) => ({
        id: a.instance.id,
        role: a.instance.config.role,
        name: a.instance.config.name,
        status: a.instance.status,
        currentTaskId: a.instance.currentTaskId,
        lastActivityAt: a.instance.lastActivityAt,
        error: a.instance.error,
      })),
      taskCounts: this.taskQueue.getCounts(),
      totalCostUsd: this.context.getTotalCost(),
      timestamp: Date.now(),
    };

    const interventions = this.imagineer.analyzeHealth(report);
    for (const intervention of interventions) {
      this.events.emit({
        type: 'agent:message',
        agentId: this.imagineer.instance.id,
        content: `Intervention: ${intervention.reason} -> ${intervention.action}`,
        isPartial: false,
      });

      // Handle the intervention
      if (intervention.action === 'abort') {
        const agent = this.activeAgents.get(intervention.agentId);
        if (agent) {
          agent.stop().catch(() => {});
        }
      }
    }
  }

  // ─── Utilities ────────────────────────────────────────────────

  private checkBudget(): void {
    const total = this.context.getTotalCost();
    if (total > this.config.maxBudgetUsd) {
      throw new BudgetExceededError(total, this.config.maxBudgetUsd);
    }
  }

  private emitCostUpdate(): void {
    this.events.emit({
      type: 'cost:update',
      totalCostUsd: this.context.getTotalCost(),
      breakdown: this.context.getCostBreakdown(),
    });
  }

  private emitTaskStatusChange(task: Task, oldStatus: string): void {
    this.events.emit({
      type: 'task:status-changed',
      taskId: task.id,
      oldStatus: oldStatus as any,
      newStatus: task.status,
    });
  }

  private parsePlan(output: string): TaskPlan {
    try {
      // Try to extract JSON from the output
      const jsonMatch = output.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          summary: parsed.summary ?? 'No summary provided',
          steps: parsed.steps ?? [],
          subtasks: parsed.subtasks,
          risks: parsed.risks,
          estimatedComplexity: parsed.estimatedComplexity ?? 'moderate',
        };
      }
    } catch {
      // Fall through to default
    }
    // If parsing fails, create a simple plan from the raw output
    return {
      summary: output.slice(0, 200),
      steps: [output],
      estimatedComplexity: 'moderate',
    };
  }

  private parseReview(output: string): TaskReview {
    try {
      const jsonMatch = output.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          approved: parsed.approved ?? false,
          concerns: parsed.concerns ?? [],
          requiredChanges: parsed.requiredChanges ?? [],
          strengths: parsed.strengths ?? [],
          iteration: 0,
        };
      }
    } catch {
      // Fall through to default
    }
    // If parsing fails, default to approved (conservative - don't block on parse errors)
    return {
      approved: true,
      concerns: ['Could not parse structured review'],
      requiredChanges: [],
      strengths: [],
      iteration: 0,
    };
  }

  private extractTags(task: Task): string[] {
    // Simple tag extraction from task description
    const words = task.description.toLowerCase().split(/\s+/);
    const keywords = ['auth', 'api', 'database', 'test', 'ui', 'deploy', 'security', 'performance', 'refactor', 'bug', 'feature'];
    return keywords.filter((kw) => words.some((w) => w.includes(kw)));
  }
}

import type {
  SDKMessage,
  SDKResultMessage,
  SDKAssistantMessage,
  SDKUserMessage,
  Options as SDKOptions,
  Query as SDKQuery,
  AgentDefinition as SDKAgentDefinition,
  McpSdkServerConfigWithInstance,
  SdkMcpToolDefinition,
  OutputFormat,
  PermissionMode,
  EffortLevel,
  NonNullableUsage,
  ModelUsage,
} from '@anthropic-ai/claude-agent-sdk';

// Re-export SDK types that consumers may need
export type {
  SDKMessage,
  SDKResultMessage,
  SDKAssistantMessage,
  SDKUserMessage,
  SDKOptions,
  SDKQuery,
  SDKAgentDefinition,
  McpSdkServerConfigWithInstance,
  SdkMcpToolDefinition,
  OutputFormat,
  PermissionMode,
  EffortLevel,
};

// ─── Agent Types ────────────────────────────────────────────────

export type AgentRole = 'mickey' | 'yen-sid' | 'chernabog' | 'broomstick' | 'imagineer' | 'jacchus';

export type AgentStatus = 'idle' | 'working' | 'waiting' | 'error' | 'terminated';

export interface AgentConfig {
  role: AgentRole;
  name: string;
  systemPrompt: string;
  model: string;
  tools?: string[] | { type: 'preset'; preset: 'claude_code' };
  disallowedTools?: string[];
  allowedTools?: string[];
  maxTurns?: number;
  maxBudgetUsd?: number;
  effort?: EffortLevel;
  outputFormat?: OutputFormat;
  persistSession?: boolean;
  permissionMode?: PermissionMode;
}

export interface AgentInstance {
  id: string;
  config: AgentConfig;
  status: AgentStatus;
  currentTaskId?: string;
  sessionId?: string;
  startedAt: number;
  lastActivityAt: number;
  error?: string;
}

// ─── Task Types ─────────────────────────────────────────────────

export type TaskPriority = 'critical' | 'high' | 'normal' | 'low';

export type TaskStatus =
  | 'pending'
  | 'planning'
  | 'reviewing'
  | 'in-progress'
  | 'blocked'
  | 'completed'
  | 'failed';

export interface Task {
  id: string;
  parentId?: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignedAgentId?: string;
  createdBy: string;
  plan?: TaskPlan;
  review?: TaskReview;
  recon?: ReconReport;
  result?: TaskResult;
  subtaskIds: string[];
  createdAt: number;
  updatedAt: number;
  metadata: Record<string, unknown>;
}

export interface TaskPlan {
  summary: string;
  steps: string[];
  /** Key context for workers: architectural decisions, relevant file paths, patterns to follow. */
  context?: string;
  /** Workstreams group related tasks for a single broomstick. Each workstream runs in parallel. */
  workstreams?: Array<{
    /** Name of this workstream (e.g. "API layer", "Frontend components"). */
    name: string;
    /** Full description of all work this broomstick should do, in order. */
    description: string;
    /** Other workstream names this depends on. */
    dependencies?: string[];
    /** Milestones this workstream will emit upon completing specific sub-tasks. */
    emits?: Array<{ id: string; description: string }>;
    /** Milestones this workstream must wait for before proceeding with dependent sub-tasks. */
    waitsFor?: Array<{ id: string; description: string }>;
  }>;
  risks?: string[];
  estimatedComplexity: 'trivial' | 'simple' | 'moderate' | 'complex';
}

export interface TaskReview {
  approved: boolean;
  concerns: string[];
  requiredChanges: string[];
  strengths: string[];
  iteration: number;
}

export interface ReconReport {
  sharedContext: {
    commonFiles: Array<{ path: string; purpose: string }>;
    patterns: string[];
    constraints: string[];
  };
  subtaskRecon: Array<{
    subtaskDescription: string;
    relevantFiles: Array<{ path: string; reason: string; keyLines?: string }>;
    references: Array<{ path: string; description: string }>;
    warnings: string[];
  }>;
  potentiallyStale: boolean;
}

export interface TaskResult {
  success: boolean;
  output: string;
  artifacts?: string[];
  costUsd?: number;
  tokenUsage?: NonNullableUsage;
  modelUsage?: Record<string, ModelUsage>;
  durationMs?: number;
}

// ─── Message Types (inter-agent) ────────────────────────────────

export type MessageType =
  | 'task-assignment'
  | 'task-result'
  | 'plan-request'
  | 'plan-response'
  | 'review-request'
  | 'review-response'
  | 'status-update'
  | 'health-check'
  | 'health-report'
  | 'intervention'
  | 'user-input'
  | 'user-output';

export interface AgentMessage {
  id: string;
  type: MessageType;
  from: string;
  to: string | 'broadcast';
  payload: unknown;
  timestamp: number;
  correlationId?: string;
}

// ─── Event Types (for UI integration) ───────────────────────────

export type FantasiaEvent =
  | { type: 'agent:spawned'; agent: AgentInstance }
  | { type: 'agent:status-changed'; agentId: string; oldStatus: AgentStatus; newStatus: AgentStatus }
  | { type: 'agent:terminated'; agentId: string; reason?: string }
  | { type: 'agent:message'; agentId: string; content: string; isPartial: boolean }
  | { type: 'task:created'; task: Task }
  | { type: 'task:status-changed'; taskId: string; oldStatus: TaskStatus; newStatus: TaskStatus }
  | { type: 'task:completed'; taskId: string; result: TaskResult }
  | { type: 'task:failed'; taskId: string; error: string }
  | { type: 'orchestrator:ready' }
  | { type: 'orchestrator:error'; error: Error }
  | { type: 'orchestrator:stopped' }
  | { type: 'user:input-needed'; prompt: string; taskId?: string }
  | { type: 'cost:update'; totalCostUsd: number; breakdown: Record<string, number> }
  | { type: 'sdk:message'; agentId: string; sdkMessage: SDKMessage }
  | { type: 'milestone:reached'; milestoneId: string; workstreamName: string };

export type FantasiaEventType = FantasiaEvent['type'];

// ─── Orchestrator Types ─────────────────────────────────────────

export interface OrchestratorConfig {
  /** Default model for agents */
  model?: string;
  /** Working directory */
  cwd?: string;
  /** Default allowed tools */
  allowedTools?: string[];
  /** Default permission mode */
  permissionMode?: PermissionMode;
  /** Maximum concurrent broomstick agents */
  maxConcurrentBroomsticks?: number;
  /** Maximum total budget in USD */
  maxBudgetUsd?: number;
  /** Environment variables passed to SDK */
  env?: Record<string, string | undefined>;
  /** Directory for persistent memory storage */
  memoryDir?: string;
  /** Model overrides per agent role */
  modelOverrides?: Partial<Record<AgentRole, string>>;
  /** Enable/disable specific agents */
  enabledAgents?: Partial<Record<AgentRole, boolean>>;
}

// ─── Memory Types ───────────────────────────────────────────────

export type MemoryType = 'lesson' | 'rejection' | 'preference' | 'pattern';

export interface MemoryEntry {
  id: string;
  agentRole: AgentRole;
  type: MemoryType;
  content: string;
  context: string;
  tags: string[];
  timestamp: number;
  relevanceScore?: number;
}

// ─── SDK Adapter Types ──────────────────────────────────────────

export interface SdkAdapter {
  query(params: { prompt: string | AsyncIterable<SDKUserMessage>; options?: SDKOptions }): SDKQuery;
  createMcpServer(options: { name: string; version?: string; tools?: Array<SdkMcpToolDefinition<any>> }): McpSdkServerConfigWithInstance;
  tool<Schema extends Record<string, any>>(
    name: string,
    description: string,
    inputSchema: Schema,
    handler: (args: any, extra: unknown) => Promise<any>,
    extras?: { annotations?: Record<string, boolean>; searchHint?: string; alwaysLoad?: boolean },
  ): SdkMcpToolDefinition<Schema>;
}

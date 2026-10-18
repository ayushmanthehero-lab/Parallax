/** Shared public contracts. Server derives tenant/graph scope from the session. */
export type TenantId = 'acme' | 'nova';
export type ScenarioId = 'trial' | 'beta' | 'threshold' | 'bundle' | 'equivalent' | 'unknown';
export type Scalar = number | string | boolean;
export type Inputs = Record<string, Scalar>;
export type Verdict = 'VIOLATED' | 'VALID_WITHIN_BOUND' | 'NOT_DISPROVED' | 'UNKNOWN';
export type Operator = 'add' | 'sub' | 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'and' | 'or' | 'not' | 'in';
export type Expression =
  | { op: 'const'; value: Scalar | Scalar[] }
  | { op: 'var'; name: string }
  | { op: Operator; args: Expression[] };
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string; details?: unknown } };
export type ApiResponse<T> = ApiResult<T>;

export interface Department { id: string; name: string; color?: string; description?: string; }
export interface Owner { id: string; name: string; role: string; departmentId: string; }
export interface Source {
  id: string; title: string; type: string; departmentId: string; text: string;
  version: number; reviewed: boolean; scenarioId?: string; revision?: number;
  createdAt?: string; updatedAt?: string; contentHash?: string;
}
export interface SourceRevision extends Source { sourceId: string; previousRevisionId?: string; }
export interface InputField {
  key: string; label: string; type: 'number' | 'boolean' | 'string'; unit: string | null;
  values: Scalar[]; defaultValue: Scalar;
}
export interface Rule {
  id: string; name: string; title: string; statement: string; departmentId: string;
  sourceId: string; scope: string; expression: Expression; reviewed: boolean;
  revision: number; unit?: string; scenarioId?: string;
}
export interface Obligation {
  id: string; text: string; expression: Expression; reviewed: boolean;
  revision: number; scope: string;
}
export interface Definition {
  id: string; term: string; meaning: string; departmentId: string; ruleId: string;
  sourceId: string; scope: string; revision: number; reviewed: boolean;
}
export interface EventType { id: string; name: string; meaning: string; producerId: string | null; departmentId: string; }
export interface Producer { id: string; name: string; departmentId: string; sourceId: string; reviewed: boolean; }
export interface TaskTemplate { title: string; departmentId: string; ownerId: string; description: string; }
export interface RuleUpdate {
  ruleId: string; expression: Expression; statement?: string; reviewed: boolean; reason: string;
}
export interface ResolutionChoice {
  id: string; label: string; description: string; ruleUpdates: RuleUpdate[]; taskTemplates: TaskTemplate[];
}
export interface Scenario {
  id: ScenarioId; title: string; subtitle: string; summary: string; category: string;
  term: string; scope: string; revision: number; tenant: TenantId; tenantTitle: string;
  synthetic: boolean; departmentIds: string[]; owners: Owner[]; promise: string;
  obligation: Obligation; rules: Rule[]; inputs: InputField[]; domain: Record<string, Scalar[]>;
  constraints: Expression[]; suggestedInputs: Inputs; sources: Source[];
  definitions: Definition[]; events: EventType[]; producers: Producer[];
  evidenceRequirements: Array<{ id: string; label: string; sourceId: string | null; reviewed: boolean }>;
  expectedVerdict: Verdict; resolution: { choices: ResolutionChoice[] };
  runs?: VerificationRun[]; cases?: ClarificationCase[]; latestRun?: VerificationRun | null;
  status?: string; stale?: boolean;
}

export interface EvaluationTrace {
  kind: 'constraint' | 'rule' | 'obligation'; id: string; label: string;
  expression: Expression; value: Scalar; outputName?: string; revision?: number; sourceId?: string;
}
export interface Counterexample {
  inputs: Inputs; outputs: Inputs; obligationValue: false; trace: EvaluationTrace[];
}
export interface VerificationResult {
  verdict: Verdict; complete: boolean; evaluatedCount: number; examinedCount: number;
  excludedCount: number; domainSize: number; witness: Counterexample | null;
  outputs: Inputs | null; explanation: string; trace: EvaluationTrace[];
  checkerVersion: string; startedAt: string;
  versions: {
    scenario: { id: string | null; revision: number | null; scope: string | null };
    obligation: { id: string | null; revision: number | null };
    rules: Array<{ id: string; name: string; revision: number; sourceId: string; expression: Expression }>;
    sources: Array<{ id: string; version: number; reviewed: boolean }>;
  };
  bounds: {
    declaredDomain: Record<string, Scalar[]>; effectiveDomain: Record<string, Scalar[]>;
    declaredSize?: number; maxEvaluations: number | null;
  };
}
export interface VerificationRun {
  id: string; scenarioId: string; result: VerificationResult; createdAt: string;
  revision?: number; status?: string; stale?: boolean; caseId?: string | null;
  mode?: AgentMode; toolCalls?: ToolCall[]; trace?: ToolCall[];
}

export type CaseStatus = 'open' | 'decision_proposed' | 'decision_approved' | 'implementation_pending' | 'verification_pending' | 'resolved';
export interface ClarificationCase {
  id: string; scenarioId: string; title: string; status: CaseStatus; revision: number;
  createdAt: string; updatedAt?: string; fingerprint?: string; description?: string;
  runId?: string; result?: VerificationResult; witness?: Counterexample; stale?: boolean;
  owners?: Owner[]; tasks?: HumanTask[]; decisions?: Decision[]; history?: AuditEvent[];
  choice?: string; note?: string; decisionId?: string;
}
export interface Decision {
  id: string; caseId: string; scenarioId: string; choice: string; note: string;
  approvedBy: string; createdAt: string; revision: number; scope?: string;
  ruleUpdates?: RuleUpdate[]; label?: string;
}
export type TaskState = 'pending' | 'in_progress' | 'completed' | 'blocked';
export interface HumanTask {
  id: string; caseId: string; scenarioId: string; title: string; description: string;
  ownerId: string; departmentId: string; state: TaskState; revision: number;
  createdAt: string; completedAt?: string; evidence?: string; owner?: Owner;
}
export interface Interpretation {
  id: string; scenarioId: string; departmentId: string; sourceId: string;
  text: string; status: 'proposed' | 'accepted' | 'rejected'; revision: number;
  proposedRule?: RuleUpdate; proposedRules?: RuleUpdate[]; createdAt: string;
  reviewedAt?: string; note?: string; expectedRevision?: number;
}
export type MemoryKind = 'episodic' | 'semantic' | 'procedural';
export interface Memory {
  id: string; kind: MemoryKind; title: string; body: string; scope: string;
  scenarioId?: string; createdAt: string; updatedAt?: string;
  conditions?: string[]; outcome?: string; stale?: boolean; applicable?: boolean;
  versions?: unknown; sourceId?: string; caseId?: string; decisionId?: string;
}
export type AgentMode = 'guided' | 'configured-model';
export interface Agent { id: string; name: string; role: string; description?: string; status?: string; }
export interface ToolCall {
  id: string; tool: string; args: Record<string, unknown>; result?: unknown;
  durationMs: number; status: 'success' | 'error' | 'running'; createdAt?: string;
  error?: string; agentId?: string; sequence?: number;
}
export interface AgentRun {
  id: string; scenarioId: string; agentId?: string; mode: AgentMode;
  status: 'running' | 'completed' | 'failed' | 'paused'; createdAt: string;
  completedAt?: string; steps?: ToolCall[]; toolCalls?: ToolCall[];
  checkpoint?: string; result?: unknown;
}
export interface ChatMessage {
  id: string; role: 'user' | 'assistant' | 'system'; body: string;
  createdAt: string; scenarioId?: string; mode?: AgentMode; toolCalls?: ToolCall[];
}
export interface AuditEvent {
  id: string; action: string; actor: string; timestamp: string;
  entityId?: string; scenarioId?: string; details?: Record<string, unknown>;
  title?: string; description?: string;
}

export interface GraphNode {
  id: string; label: string; type: string; properties?: Record<string, unknown>;
  scenarioId?: string; departmentId?: string; x?: number; y?: number;
}
export interface GraphEdge {
  id: string; source: string; target: string; label: string; type?: string;
  properties?: Record<string, unknown>;
}
export interface GraphData { nodes: GraphNode[]; edges: GraphEdge[]; }
export interface ConnectionStatus {
  connected: boolean; provider: 'falkordb'; mode?: 'remote' | 'local';
  latencyMs?: number; message?: string; graph?: string; version?: string;
}
export interface Health {
  status: 'ok' | 'degraded' | 'unavailable'; connection: ConnectionStatus;
  mode: AgentMode; modelConfigured: boolean; model?: string; checkedAt: string;
}
export interface Workspace {
  id: string; title: string; tenant: TenantId; revision: number;
  synthetic: boolean; createdAt?: string;
}
export interface Bootstrap {
  workspace: Workspace; scenarios: Scenario[]; departments: Department[];
  agents: Agent[]; counts: Record<string, number>; connection: ConnectionStatus;
  mode: AgentMode; model?: string; tenants?: Array<{ id: TenantId; title: string }>;
}
export interface InvestigationResponse {
  run: VerificationRun; result: VerificationResult; case?: ClarificationCase | null;
  caseId?: string | null; toolCalls: ToolCall[]; mode: AgentMode;
  memory?: Memory[]; owners?: Owner[];
}
export interface VerificationCheck {
  id: string; name: string; passed: boolean; durationMs?: number; details?: string;
}
export interface VerificationReport {
  status: 'not-run' | 'running' | 'passed' | 'failed'; createdAt?: string;
  checks: VerificationCheck[]; durationMs?: number;
  concurrency?: {
    workers: number; operations: number; acceptedWrites: number;
    rejectedStaleUpdates: number; duplicateCases: number; lostAcknowledgedWrites: number;
    latencyMs: { p50: number; p95: number; max: number };
  };
}

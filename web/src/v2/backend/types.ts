/**
 * 真实后端的对象形状。
 *
 * 逐字段对齐 `E:\Coding project\AgentDesk\src\backend\types.ts`（第 2 批 A 已实施）
 * 与 docs/BACKEND-API-DRAFT.md 的接口草案。这里是**契约**，不是演示数据形状：
 * 演示数据必须经适配器转换成本文件中的类型后再交给界面。
 *
 * 与真实后端不同名的部分，在本文件内用注释标注「前端补充」，并说明依据。
 */

/* ── 任务与运行 ───────────────────────────────────────────── */

/** 本批真实后端只产生前 5 个 */
export type TaskStatus = 'draft' | 'ready' | 'in_progress' | 'in_review' | 'accepted';

/** 后端保留的完整产品语义；本批不产生后三个 */
export type ReservedTaskStatus = 'integrated' | 'verified' | 'cancelled';

export type RunStatus = 'running' | 'succeeded' | 'failed' | 'aborted' | 'needs_recovery';

/** starting / executing / stopping / ended —— 避免把「请求中止」当终态 */
export type RunPhase = 'starting' | 'executing' | 'stopping' | 'ended';

export interface BackendTask {
  schemaVersion: 1;
  id: string;
  projectId: string;
  workspaceId: string;
  title: string;
  goal: string;
  acceptanceCriteria: string[];
  agentInstanceId: string;
  status: TaskStatus;
  latestRunId?: string;
  acceptedSnapshotId?: string;
  blockedReason?: string;
  version: number;
  createdAt: string;
}

export interface BackendRun {
  schemaVersion: 1;
  id: string;
  taskId: string;
  agentInstanceId: string;
  engineId: string;
  /** 执行前可为空 */
  model?: string;
  status: RunStatus;
  phase: RunPhase;
  outcomeReason?: string;
  startedAt: string;
  endedAt?: string;
  version: number;
}

/* ── 事件 ─────────────────────────────────────────────────── */

export interface EventEnvelope<T = Record<string, unknown>> {
  schemaVersion: 1;
  id: string;
  taskId: string;
  runId?: string;
  /** 每个任务从 1 递增；分页与 SSE 共用 */
  seq: number;
  occurredAt: string;
  type: EventType;
  data: T;
}

/** 草案中的已知联合；界面不得凭猜测的事件名改变任务状态 */
export type EventType =
  | 'task.created'
  | 'task.updated'
  | 'run.created'
  | 'run.status_changed'
  | 'message.delta'
  | 'message.completed'
  | 'activity.started'
  | 'activity.completed'
  | 'diagnostic.recorded'
  | 'changes.snapshot_created'
  | 'task.accepted'
  | 'task.acceptance_invalidated'
  | (string & {});

/* ── 审查：快照与检查 ─────────────────────────────────────── */

export type FileKind = 'text' | 'binary' | 'symlink' | 'submodule' | 'limited' | 'unreadable';

export interface ReviewFile {
  id: string;
  path: string;
  kind: FileKind;
  /** 统一 diff 文本；非 text 类型可为空 */
  diff?: string;
  stagedDiff?: string;
}

/**
 * 检查状态。真实后端当前**恒为** `not_run`，且没有检查执行能力。
 * 因此这里不是三态枚举，而是只有一个字面量 —— 让「检查通过」在类型层面
 * 就不可能被真实数据表达出来。
 */
export type ChecksState = 'not_run';

export interface Changes {
  baseHead: string;
  head: string;
  /** 内容摘要；接受与检查都要绑它，而不是只绑提交号 */
  contentDigest: string;
  files: ReviewFile[];
  completeness: 'complete' | 'unsupported' | 'limited';
  checks: ChecksState;
  lastCheckedAt: string;
}

export interface Snapshot extends Changes {
  schemaVersion: 1;
  id: string;
  taskId: string;
  runId: string;
  createdAt: string;
}

/** 人工接受记录。绑定 run + snapshot + digest，三者任一变化即失效 */
export interface Acceptance {
  schemaVersion: 1;
  id: string;
  taskId: string;
  runId: string;
  snapshotId: string;
  contentDigest: string;
  acceptedAt: string;
}

/* ── 能力与可用动作 ───────────────────────────────────────── */

export type AdapterSupport = 'implemented' | 'not_implemented';
export type Verification = 'verified' | 'unverified' | 'unsupported';

export interface Capability {
  name: string;
  adapterSupport: AdapterSupport;
  verification: Verification;
  /** 非敏感证据引用（平台 / 版本 / 传输条件） */
  evidenceRef?: string;
}

export interface ActionAvailability {
  allowed: boolean;
  /** 不允许时的可展示原因，例如 capability_unavailable */
  reason?: ErrorCode;
}

/**
 * 当前可用动作。真实后端作为 Task 读取响应的一部分返回；
 * 界面只渲染 allowed 的动作，不从能力布尔值自行推导。
 *
 * 前端补充：字段名待 Codex 确认（BACKEND-USAGE.md 只说明响应含 availableActions，
 * 未给出字段清单）。未列出的动作在本批一律视为不可用。
 */
export interface AvailableActions {
  startRun: ActionAvailability;
  /** 带 input 的反馈运行 */
  requestChanges: ActionAvailability;
  interrupt: ActionAvailability;
  refreshSnapshot: ActionAvailability;
  accept: ActionAvailability;
}

/** 本批后端**没有**业务 API 的能力。界面不得展示为可执行。 */
export const UNSUPPORTED_ACTIONS = [
  { key: 'approval', label: '审批请求' },
  { key: 'steer', label: '运行中补充指令' },
  { key: 'resume', label: '恢复会话' },
  { key: 'switchInstance', label: '更换实例' },
  { key: 'integrate', label: '集成变更' },
  { key: 'verify', label: '最终验收' },
  { key: 'checkRun', label: '执行检查' },
] as const;

/* ── 错误 ─────────────────────────────────────────────────── */

export type ErrorCode =
  | 'invalid_input'
  | 'unauthorized'
  | 'not_found'
  | 'version_conflict'
  | 'active_run'
  | 'snapshot_stale'
  | 'idempotency_conflict'
  | 'engine_not_integrated'
  | 'capability_unavailable'
  | 'storage_unavailable';

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; retryable: boolean; currentVersion?: number };
}

/** 机器错误码 → 中文展示。界面不直接显示 message 原文作为主文案。 */
export const ERROR_TEXT: Record<ErrorCode, string> = {
  invalid_input: '请求内容不合法',
  unauthorized: '未授权：请在连接设置中确认本机令牌',
  not_found: '对象不存在',
  version_conflict: '内容已被其他操作更新，请重新读取后再试',
  active_run: '已有正在进行的运行',
  snapshot_stale: '这一版改动已经变化，接受已失效',
  idempotency_conflict: '同一请求键被用于不同内容',
  engine_not_integrated: '该引擎尚未接入，不能执行',
  capability_unavailable: '当前能力不可用',
  storage_unavailable: '本机存储不可用',
};

/* ── 接受状态的有效性 ─────────────────────────────────────── */

export interface SnapshotIdentity {
  runId: string;
  snapshotId: string;
  contentDigest: string;
}

export type InvalidationReason = 'new_run' | 'snapshot_refreshed' | 'external_change' | 'no_snapshot';

export interface AcceptanceValidity {
  valid: boolean;
  reason?: InvalidationReason;
}

/**
 * 接受是否仍然有效。
 *
 * 规则（BACKEND-USAGE.md 步骤 9、草案状态规则）：
 *  - 只允许接受「当前成功运行」的、仍匹配磁盘的完整快照
 *  - 新运行、刷新出不同摘要、外部改动都会使其失效
 *
 * 注意：比较的不只是提交号。模型改动通常尚未提交，同一 HEAD 下工作区内容
 * 可以多次变化，所以必须比 snapshotId 与 contentDigest。
 */
export function acceptanceValidity(
  a: Acceptance,
  current: SnapshotIdentity | null,
  opts?: { externalChange?: boolean },
): AcceptanceValidity {
  if (opts?.externalChange) return { valid: false, reason: 'external_change' };
  if (!current) return { valid: false, reason: 'no_snapshot' };
  if (a.runId !== current.runId) return { valid: false, reason: 'new_run' };
  if (a.snapshotId !== current.snapshotId || a.contentDigest !== current.contentDigest) {
    return { valid: false, reason: 'snapshot_refreshed' };
  }
  return { valid: true };
}

export const INVALIDATION_TEXT: Record<InvalidationReason, string> = {
  new_run: '之后又产生了新的运行',
  snapshot_refreshed: '改动快照已更新',
  external_change: '工作区被外部修改',
  no_snapshot: '还没有可接受的快照',
};

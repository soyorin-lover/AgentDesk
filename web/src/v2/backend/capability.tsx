import type { ReactNode } from 'react';
import type { Acceptance, InvalidationReason } from './types.ts';

/* ─────────────────────────────────────────────────────────────
   演示 / 真实 数据来源
   演示数据必须经过适配层转成后端类型后才能进入界面，
   且界面在任何位置都要能回答「现在看的是哪一种」。
   ───────────────────────────────────────────────────────────── */

export type DataMode = 'demo' | 'live';

/** 当前前端是否已有真实后端连接。本批没有，因此恒为 demo。 */
export const LIVE_AVAILABLE = false;

export interface DataSource {
  mode: DataMode;
  /** 连接设置里的服务地址；演示模式下为空 */
  endpoint?: string;
  /** 上次成功读取后端的时间 */
  lastSyncAt?: string;
}

/* ── 能力门禁 ─────────────────────────────────────────────── */

/**
 * 后端本批真实支持的动作。其余一律不可执行 ——
 * 不因为第一批协议证据就展示第二批业务 API 不存在的操作。
 */
export interface BackendCapabilities {
  startRun: boolean;
  requestChanges: boolean;
  interrupt: boolean;
  refreshSnapshot: boolean;
  accept: boolean;
  /** 检查执行能力 */
  checks: boolean;
  approval: boolean;
  steer: boolean;
  resume: boolean;
  switchInstance: boolean;
  integrate: boolean;
  verify: boolean;
}

export const DEMO_CAPS: BackendCapabilities = {
  startRun: true,
  requestChanges: true,
  interrupt: true,
  refreshSnapshot: true,
  accept: true,
  checks: false,
  approval: false,
  steer: false,
  resume: false,
  switchInstance: false,
  integrate: false,
  verify: false,
};

/** 演示模式的可执行动作仍受真实能力边界约束：不展示本批后端没有的操作 */
export function actionDisabled(caps: BackendCapabilities, key: keyof BackendCapabilities) {
  return !caps[key];
}

/* ── 统一的接受状态 ───────────────────────────────────────── */

export interface AcceptanceRecord {
  /** 后端 Acceptance.id */
  id: string;
  taskId: string;
  runId: string;
  snapshotId: string;
  contentDigest: string;
  acceptedAt: string;
  /** 失效时保留历史，不删除；界面据此显示「已失效」而不是「未接受」 */
  invalidated?: InvalidationReason;
}

export function toAcceptanceRecord(a: Acceptance): AcceptanceRecord {
  return { ...a, invalidated: undefined };
}

/**
 * 按任务查找仍然有效的接受记录。
 *
 * 唯一权威来源：任务列表、概览、执行视图、审查视图都必须调用这个函数，
 * 不得各自维护状态。
 */
export function validAcceptance(
  records: readonly AcceptanceRecord[],
  taskId: string,
): AcceptanceRecord | undefined {
  return records.find((r) => r.taskId === taskId && !r.invalidated);
}

export function acceptanceFor(
  records: readonly AcceptanceRecord[],
  taskId: string,
): AcceptanceRecord | undefined {
  return records.find((r) => r.taskId === taskId);
}

/** 新运行产生、快照刷新、外部改动 → 旧接受失效（保留记录，标记原因） */
export function invalidateAcceptances(
  records: readonly AcceptanceRecord[],
  taskId: string,
  reason: InvalidationReason,
): AcceptanceRecord[] {
  return records.map((r) =>
    r.taskId === taskId && !r.invalidated ? { ...r, invalidated: reason } : r,
  );
}

export const INVALID_REASON_TEXT: Record<InvalidationReason, string> = {
  new_run: '之后产生了新的运行',
  snapshot_refreshed: '改动快照已更新',
  external_change: '工作区被外部修改',
  no_snapshot: '没有可接受的快照',
};

/* ── 检查状态：演示 / 真实 严格分开 ───────────────────────── */

export type CheckOutcome = 'passed' | 'failed' | 'not_run';

export interface Check {
  id: string;
  name: string;
  /** 真实模式必须为空：后端不返回命令，也不执行检查 */
  command: string | null;
  outcome: CheckOutcome;
  exit: number | null;
  duration: string | null;
  output: string | null;
  /** not_run 时的原因 */
  reason: string | null;
  /** 该检查结果对应的快照；用于判断「过时」 */
  snapshotId: string | null;
  runId: string | null;
  contentDigest: string | null;
  /** 是否属于演示数据 */
  demo: boolean;
}

/**
 * 真实模式下检查的唯一合法集合。
 * 后端 `checks` 恒为 `not_run`，因此这里只能产出 not_run，
 * 结构上不可能展示示例的「检查通过」。
 */
export function liveChecks(lastCheckedAt: string): Check[] {
  return [
    {
      id: 'backend-checks',
      name: '检查执行',
      command: null,
      outcome: 'not_run',
      exit: null,
      duration: null,
      output: null,
      reason: `后端未实现检查执行；lastCheckedAt ${lastCheckedAt}`,
      snapshotId: null,
      runId: null,
      contentDigest: null,
      demo: false,
    },
  ];
}

/** 检查结果是否对应最新快照；不是则必须标明「过时」 */
export function checkStale(c: Check, current: { snapshotId: string; contentDigest: string } | null): boolean {
  if (!current || c.outcome === 'not_run') return false;
  return c.snapshotId !== current.snapshotId || c.contentDigest !== current.contentDigest;
}

export const CHECK_TEXT: Record<CheckOutcome, string> = {
  passed: '通过',
  failed: '失败',
  not_run: '未运行',
};

/* ── 演示标记 ─────────────────────────────────────────────── */

export function ModeTag({ mode }: { mode: DataMode }): ReactNode {
  if (mode === 'demo') {
    return (
      <span className="tag tag--sim" title="全部为构造内容，不来自真实执行">
        演示数据
      </span>
    );
  }
  return (
    <span className="tag" title="来自本机后端">
      已连接后端
    </span>
  );
}

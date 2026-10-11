import type {
  ApprovalState,
  BlockReasonKind,
  CheckStatus,
  RunStatus,
  TaskStatus,
} from './types.ts';

/**
 * 状态 → 界面表现的单一映射表。
 *
 * 所有颜色/文案只能来自这里，避免同一状态在不同组件里被画成不同东西——
 * 这正是本项目最容易被破坏的地方（任务状态与运行状态混用）。
 */

export type Tone =
  | 'active'
  | 'wait'
  | 'review'
  | 'ok'
  | 'bad'
  | 'idle';

export interface StatusStyle {
  label: string;
  tone: Tone;
  /** 该状态的完整含义，用于 title / 帮助文案 */
  meaning: string;
  /** 是否应做脉冲动效（真实进行中） */
  live: boolean;
  /** 该状态下用户是否能操作 */
  actionable: boolean;
}

/* ── 任务级 ───────────────────────────────────────────────── */

export const TASK_STATUS: Record<TaskStatus, StatusStyle> = {
  draft: {
    label: '草稿',
    tone: 'idle',
    meaning: '只创建了标题，还缺少目标或验收条件，不能启动运行。',
    live: false,
    actionable: true,
  },
  ready: {
    label: '就绪',
    tone: 'idle',
    meaning: '目标与验收条件齐备，可以启动运行。',
    live: false,
    actionable: true,
  },
  inProgress: {
    label: '处理中',
    tone: 'active',
    meaning: '至少有一次运行在进行或等待用户。',
    live: true,
    actionable: false,
  },
  inReview: {
    label: '待审查',
    tone: 'review',
    meaning: '运行已产出结果，等待你查看 diff 与检查结果。',
    live: false,
    actionable: true,
  },
  accepted: {
    label: '已接受',
    tone: 'ok',
    meaning: '你已确认这次结果。代码尚未进入集成分支。',
    live: false,
    actionable: true,
  },
  integrated: {
    label: '已集成',
    tone: 'ok',
    meaning: '变更已进入集成分支。这本身不代表检查全部通过。',
    live: false,
    actionable: true,
  },
  verified: {
    label: '已验收',
    tone: 'ok',
    meaning: '最终验证通过，任务完成。',
    live: false,
    actionable: false,
  },
  cancelled: {
    label: '已取消',
    tone: 'idle',
    meaning: '任务被取消。已产生的改动仍然保留在工作区。',
    live: false,
    actionable: false,
  },
};

/* ── 运行级 ───────────────────────────────────────────────── */

export const RUN_STATUS: Record<RunStatus, StatusStyle> = {
  queued: {
    label: '排队',
    tone: 'idle',
    meaning: '请求已发出，服务端尚未开始处理。',
    live: false,
    actionable: false,
  },
  running: {
    label: '运行中',
    tone: 'active',
    meaning: '服务端正在执行本轮。关闭页面不会取消它。',
    live: true,
    actionable: true, // 可补充指令 / 中止
  },
  waitingUser: {
    label: '等待用户',
    tone: 'wait',
    meaning: '本轮暂停，需要你回答问题或处理一个审批请求。',
    live: true,
    actionable: true,
  },
  succeeded: {
    label: '成功',
    tone: 'ok',
    meaning: '本轮正常结束并产出了结果。结果尚未验收。',
    live: false,
    actionable: false,
  },
  failed: {
    label: '失败',
    tone: 'bad',
    meaning: '本轮以错误结束。已产生的改动仍保留在工作区。',
    live: false,
    actionable: true,
  },
  interrupted: {
    label: '已中止',
    tone: 'idle',
    meaning: '本轮被用户中止。中止不会回滚已经写入的改动。',
    live: false,
    actionable: true,
  },
  resumable: {
    label: '待恢复',
    tone: 'wait',
    meaning: '会话上下文仍在，但承载进程没有运行。恢复会话与重新执行不同。',
    live: false,
    actionable: true,
  },
};

/* ── 阻塞原因 ─────────────────────────────────────────────── */

export const BLOCK_REASON: Record<BlockReasonKind, { label: string; tone: Tone }> = {
  question: { label: '等待回答', tone: 'wait' },
  approval: { label: '等待审批', tone: 'active' },
  processExited: { label: '进程已退出', tone: 'bad' },
  connection: { label: '连接断开', tone: 'bad' },
  mergeConflict: { label: '合并冲突', tone: 'bad' },
  checkFailed: { label: '检查失败', tone: 'bad' },
};

/* ── 检查状态 ─────────────────────────────────────────────── */

export const CHECK_STATUS: Record<CheckStatus, StatusStyle> = {
  notRun: {
    label: '未运行',
    tone: 'idle',
    meaning: '这项检查还没有执行过。未运行不等于通过。',
    live: false,
    actionable: true,
  },
  running: {
    label: '执行中',
    tone: 'active',
    meaning: '检查正在执行。',
    live: true,
    actionable: false,
  },
  passed: {
    label: '通过',
    tone: 'ok',
    meaning: '命令以退出码 0 结束。',
    live: false,
    actionable: false,
  },
  failed: {
    label: '失败',
    tone: 'bad',
    meaning: '命令以非零退出码结束，见下方输出。',
    live: false,
    actionable: true,
  },
  error: {
    label: '无法执行',
    tone: 'bad',
    meaning: '命令没能跑起来，通常是环境或依赖问题，不是检查本身失败。',
    live: false,
    actionable: true,
  },
};

/* ── 审批 ─────────────────────────────────────────────────── */

export const APPROVAL_LABEL: Record<ApprovalState['kind'], string> = {
  pending: '等待你的决定',
  accepted: '已批准（本次）',
  acceptedForSession: '已批准（本次会话内同类操作不再询问）',
  declined: '已拒绝（本轮继续）',
  cancelled: '已拒绝并中止本轮',
};

export const toneClass = (tone: Tone): string => `chip--${tone}`;

export const toneVar = (tone: Tone): string => `var(--st-${tone})`;

/**
 * 由运行状态推导任务的「运行」维度展示。
 * 任务状态不由这个函数修改 —— 两者独立。
 */
export function isRunLive(status: RunStatus | null): boolean {
  return status === 'running' || status === 'waitingUser' || status === 'queued';
}

/** 任务是否需要在「待处理」区出现 */
export function needsAttention(task: {
  block: { kind: BlockReasonKind } | null;
  status: TaskStatus;
  latestRunStatus: RunStatus | null;
}): boolean {
  if (task.block) return true;
  if (task.status === 'inReview') return true;
  if (task.status === 'accepted') return true;
  if (task.status === 'draft') return true;
  return isRunLive(task.latestRunStatus) && task.block !== null;
}

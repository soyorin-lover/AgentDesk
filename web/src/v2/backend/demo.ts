import type {
  Acceptance,
  AvailableActions,
  BackendRun,
  BackendTask,
  Changes,
  EventEnvelope,
  RunPhase,
  RunStatus,
  Snapshot,
  TaskStatus,
} from './types.ts';
import { AGENTS, REVIEW_FILES, TASKS, TIMELINES, type Task as FixtureTask } from '../data.ts';
import type { Check } from './capability.tsx';

/* ─────────────────────────────────────────────────────────────
   演示数据 → 后端形状的适配层
   界面只消费本文件导出的类型。data.ts 保持为原始素材，
   接入真实接口时替换本文件即可，组件不需要改。
   ───────────────────────────────────────────────────────────── */

export interface DemoTask extends BackendTask {
  /* ── 展示用附加字段（后端没有的，前端按需推导） ── */
  /** 展示编号：后端不提供，前端从 id 推导 */
  ref: string;
  /** 上次活动时间的人类可读形式 */
  updated: string;
  branch: string;
  worktree: string;
  /** 验收条件逐条判定；后端只有字符串数组，判定属产品语义 */
  met: Array<boolean | null>;
  agentInstanceName: string;
  engineId: string;
  model?: string;
  /* ── 运行与快照 ── */
  runs: BackendRun[];
  /** 当前可接受的快照；null 表示还没有 */
  snapshot: DemoSnapshot | null;
  /** 运行中的实时说明（演示用） */
  liveElapsed?: string;
  liveNow?: string;
  /** 变更统计的摘要，避免每次遍历文件 */
  changeStat?: { files: number; add: number; del: number };
}

export interface DemoSnapshot extends Snapshot {
  /* 演示数据里不带完整 diff，逐行内容在 Panels 中按文件提供 */
  events: EventEnvelope[];
}

/* ── 确定性摘要：同一 (任务, 修订号) 永远得到同一摘要 ─────── */

function digest(taskId: string, revision: number): string {
  let h = 0x811c9dc5;
  const s = `${taskId}:${revision}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0').repeat(2).slice(0, 16);
}

/** 该任务当前的快照修订号。新运行会让它 +1，从而使用摘要变化。 */
const revision = new Map<string, number>();
export function bumpRevision(taskId: string): number {
  const next = (revision.get(taskId) ?? 1) + 1;
  revision.set(taskId, next);
  return next;
}
export function currentRevision(taskId: string): number {
  return revision.get(taskId) ?? 1;
}

/* ── 运行状态映射：演示字段 → 后端枚举 ───────────────────── */

const RUN_MAP: Record<string, { status: RunStatus; phase: RunPhase }> = {
  running: { status: 'running', phase: 'executing' },
  waitingUser: { status: 'running', phase: 'executing' },
  succeeded: { status: 'succeeded', phase: 'ended' },
  failed: { status: 'failed', phase: 'ended' },
  interrupted: { status: 'aborted', phase: 'ended' },
  resumable: { status: 'needs_recovery', phase: 'ended' },
  queued: { status: 'running', phase: 'starting' },
};

/** 演示字段 → 后端 TaskStatus。注意 waitingUser 仍属 in_progress。 */
const TASK_MAP: Record<string, TaskStatus> = {
  draft: 'draft',
  ready: 'ready',
  inProgress: 'in_progress',
  inReview: 'in_review',
  accepted: 'accepted',
  integrated: 'accepted',
  verified: 'accepted',
  cancelled: 'accepted',
};

function snapshotFor(t: FixtureTask, rev: number, status: TaskStatus): DemoSnapshot | null {
  // 只有产出过结果的运行才有可审查快照
  const hasResult = status === 'in_review' || status === 'accepted';
  if (!hasResult) return null;
  const runId = `run-${t.id}-1`;
  const d = digest(t.id, rev);
  const files =
    t.changes == null
      ? []
      : REVIEW_FILES.slice(0, Math.min(t.changes.files, REVIEW_FILES.length)).map((f) => ({
          id: `${t.id}-${f.path}`,
          path: f.path,
          kind: 'text' as const,
          // 生成标准统一 diff 文本：@@ -旧起,旧数 +新起,新数 @@ 函数签名
          // 解析器（backend/diff.ts）按这个格式读；演示与真实数据走同一条路径。
          diff: f.hunks
            .map((h) => {
              const oldCount = h.lines.filter((l) => !l.startsWith('+')).length;
              const newCount = h.lines.filter((l) => !l.startsWith('-')).length;
              const range =
                oldCount === 0
                  ? `-0,0 +${h.newStart},${newCount}`
                  : `-${h.oldStart},${oldCount} +${h.newStart},${newCount}`;
              const sec = h.header ? ` ${h.header}` : '';
              return [`@@ ${range} @@${sec}`, ...h.lines].join('\n');
            })
            .join('\n'),
        }));

  const changes: Changes = {
    baseHead: t.base,
    head: t.base,
    contentDigest: d,
    files,
    // 演示数据里有二进制 / 超限场景时可为 limited，这里恒为 complete
    completeness: 'complete',
    checks: 'not_run',
    lastCheckedAt: '2026-10-08T10:05:00+08:00',
  };

  return {
    ...changes,
    schemaVersion: 1,
    id: `snap-${t.id}-${rev}`,
    taskId: t.id,
    runId,
    createdAt: '2026-10-08T10:05:00+08:00',
    events: [],
  };
}

function runsFor(t: FixtureTask): BackendRun[] {
  return t.runs.map((r) => {
    const m = RUN_MAP[r.status] ?? { status: 'running' as RunStatus, phase: 'executing' as RunPhase };
    return {
      schemaVersion: 1 as const,
      id: `run-${t.id}-${r.n}`,
      taskId: t.id,
      agentInstanceId: t.agentId ?? 'codex-local',
      engineId: 'codex',
      model: AGENTS.find((a) => a.id === t.agentId)?.model,
      status: m.status,
      phase: m.phase,
      outcomeReason: r.note,
      startedAt: `2026-10-08T${r.at.padStart(5, '0')}:00+08:00`,
      endedAt: m.phase === 'ended' ? `2026-10-08T${r.at.padStart(5, '0')}:40+08:00` : undefined,
      version: 1,
    };
  });
}

/** 构建全部演示任务，作为界面唯一的任务来源 */
export function buildDemoTasks(): DemoTask[] {
  return TASKS.map((t) => {
    const status = TASK_MAP[t.status] ?? 'ready';
    const rev = currentRevision(t.id);
    const runs = runsFor(t);
    const a = AGENTS.find((x) => x.id === t.agentId);
    return {
      schemaVersion: 1 as const,
      id: t.id,
      projectId: 'proj-fin-sync',
      workspaceId: 'ws-fin-sync',
      title: t.title,
      goal: t.goal,
      acceptanceCriteria: t.acceptance.map((x) => x.text),
      agentInstanceId: t.agentId ?? 'codex-local',
      status,
      latestRunId: runs.at(-1)?.id,
      acceptedSnapshotId: undefined,
      blockedReason: t.run === 'failed' ? 'result_unknown' : undefined,
      version: 1,
      createdAt: '2026-10-08T09:00:00+08:00',
      ref: t.ref,
      updated: t.updated,
      branch: t.branch,
      worktree: t.worktree,
      met: t.acceptance.map((x) => x.met),
      agentInstanceName: a?.name ?? '未分派',
      engineId: 'codex',
      model: a?.model,
      runs,
      snapshot: snapshotFor(t, rev, status),
      liveElapsed: t.elapsed,
      liveNow: t.now,
      changeStat: t.changes,
    };
  });
}

/* ── 状态输入：任务状态 + 最近运行状态 ───────────────────── */

export function statusInputOf(t: DemoTask): { status: TaskStatus; run: RunStatus | null } {
  const r = t.runs.at(-1)?.status ?? null;
  // 已接受是任务级事实：接受后任务状态为 accepted，运行状态仍是它自己的终态
  return { status: t.status, run: r };
}

/* ── 快照身份：接受与检查都要绑这三个字段 ─────────────────── */

export function snapshotIdentity(t: DemoTask) {
  if (!t.snapshot) return null;
  return {
    runId: t.snapshot.runId,
    snapshotId: t.snapshot.id,
    contentDigest: t.snapshot.contentDigest,
  };
}

/* ── 演示检查：仍标注 demo，且绑定快照与摘要 ─────────────── */

export function demoChecksFor(t: DemoTask): Check[] {
  const id = snapshotIdentity(t);
  const base: Array<Omit<Check, 'snapshotId' | 'runId' | 'contentDigest'>> = [
    {
      id: `${t.id}-typecheck`,
      name: '类型检查',
      command: 'npm run typecheck',
      outcome: 'passed',
      exit: 0,
      duration: '4.1s',
      output: '> tsc --noEmit\n\n找到 0 个错误。',
      reason: null,
      demo: true,
    },
    {
      id: `${t.id}-unit`,
      name: '单元测试',
      command: 'npm test -- --run',
      outcome: 'passed',
      exit: 0,
      duration: '9.5s',
      output: '> vitest run\n\n Test Files  3 passed (3)\n      Tests  22 passed (22)',
      reason: null,
      demo: true,
    },
    {
      id: `${t.id}-integration`,
      name: '集成测试（真实账单 API）',
      command: 'npm run test:integration -- --live-api',
      outcome: 'not_run',
      exit: null,
      duration: null,
      output: null,
      reason: '本机未配置 BILLING_API_TOKEN',
      demo: true,
    },
    {
      id: `${t.id}-lint`,
      name: 'Lint',
      command: 'npm run lint',
      outcome: 'not_run',
      exit: null,
      duration: null,
      output: null,
      reason: '本轮没有执行',
      demo: true,
    },
  ];
  return base.map((c) => ({
    ...c,
    runId: id?.runId ?? null,
    snapshotId: id?.snapshotId ?? null,
    contentDigest: id?.contentDigest ?? null,
  }));
}

/* ── availableActions：严格按本批后端能力推导 ────────────── */

export function demoActionsFor(t: DemoTask): AvailableActions {
  const canReview = t.status === 'in_review' && t.snapshot !== null;
  const active = t.runs.at(-1)?.status === 'running';
  return {
    startRun: active
      ? { allowed: false, reason: 'active_run' }
      : { allowed: t.status === 'ready' || t.status === 'in_review' },
    requestChanges: active
      ? { allowed: false, reason: 'active_run' }
      : { allowed: canReview, reason: canReview ? undefined : 'capability_unavailable' },
    interrupt: active ? { allowed: true } : { allowed: false, reason: 'capability_unavailable' },
    refreshSnapshot: active
      ? { allowed: false, reason: 'active_run' }
      : { allowed: true },
    // needs_recovery 禁止接受
    accept:
      canReview && t.blockedReason === undefined
        ? { allowed: true }
        : { allowed: false, reason: canReview ? 'capability_unavailable' : 'snapshot_stale' },
  };
}

/* ── 演示接受记录：绑定 run + snapshot + digest ──────────── */

export function demoAcceptance(t: DemoTask, at = '2026-10-08T16:00:00+08:00'): Acceptance | null {
  const id = snapshotIdentity(t);
  if (!id) return null;
  return {
    schemaVersion: 1,
    id: `acc-${t.id}-${id.snapshotId}`,
    taskId: t.id,
    runId: id.runId,
    snapshotId: id.snapshotId,
    contentDigest: id.contentDigest,
    acceptedAt: at,
  };
}

/* ── 演示事件流（快照生成等），供事件面板使用 ───────────── */

export function demoEventsFor(t: DemoTask): EventEnvelope[] {
  const items = TIMELINES[t.id] ?? [];
  let seq = 0;
  const out: EventEnvelope[] = [];
  const at = '2026-10-08T10:00:00+08:00';
  for (const it of items) {
    seq += 1;
    const runId = t.latestRunId;
    if (it.k === 'agent') {
      out.push({
        schemaVersion: 1,
        id: `ev-${t.id}-${seq}`,
        taskId: t.id,
        runId,
        seq,
        occurredAt: at,
        type: 'message.completed',
        data: { messageId: `m-${seq}`, text: it.text },
      });
    } else if (it.k === 'activity') {
      for (const s of it.steps) {
        seq += 1;
        out.push({
          schemaVersion: 1,
          id: `ev-${t.id}-${seq}`,
          taskId: t.id,
          runId,
          seq,
          occurredAt: at,
          type: s.status === 'ok' ? 'activity.completed' : 'activity.started',
          data: { activityId: `a-${seq}`, category: s.kind, status: s.status },
        });
      }
    } else if (it.k === 'changes') {
      seq += 1;
      out.push({
        schemaVersion: 1,
        id: `ev-${t.id}-${seq}`,
        taskId: t.id,
        runId,
        seq,
        occurredAt: at,
        type: 'changes.snapshot_created',
        data: { snapshotId: t.snapshot?.id, completeness: 'complete', checks: 'not_run' },
      });
    }
  }
  if (t.snapshot) {
    seq += 1;
    out.push({
      schemaVersion: 1,
      id: `ev-${t.id}-${seq}`,
      taskId: t.id,
      runId: t.latestRunId,
      seq,
      occurredAt: t.snapshot.createdAt,
      type: 'changes.snapshot_created',
      data: { snapshotId: t.snapshot.id, completeness: t.snapshot.completeness, checks: 'not_run' },
    });
  }
  return out;
}

export { AGENTS, REVIEW_FILES, TASKS };

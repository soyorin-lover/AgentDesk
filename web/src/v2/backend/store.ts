import { useCallback, useMemo, useState } from 'react';
import type { Acceptance, InvalidationReason, SnapshotIdentity } from './types.ts';
import { acceptanceValidity } from './types.ts';
import type { DataMode } from './capability.tsx';
import {
  buildDemoTasks,
  bumpRevision,
  demoAcceptance,
  demoActionsFor,
  currentRevision,
  type DemoTask,
} from './demo.ts';

/* ─────────────────────────────────────────────────────────────
   应用状态
   唯一的接受来源：acceptances 数组。任务列表、概览、执行、审查
   都必须从这里读，不得各自持有 accepted 布尔值。
   ───────────────────────────────────────────────────────────── */

export interface AppState {
  mode: DataMode;
  tasks: DemoTask[];
  acceptances: Acceptance[];
  /** 已失效的历史接受（保留展示，不删除） */
  invalidated: Array<Acceptance & { reason: InvalidationReason }>;
}

/**
 * 种子状态。
 *
 * 关键不变式：任务显示「已接受」必须由一条接受记录支撑，不能只靠 fixture
 * 里写的状态。因此对演示数据中声明为 accepted 的任务，补一条绑定其快照的
 * 记录；没有快照的任务不会凭空变成「已接受」。
 */
function seed(): { tasks: DemoTask[]; acceptances: Acceptance[] } {
  const tasks = buildDemoTasks();
  const acceptances: Acceptance[] = [];
  for (const t of tasks) {
    if (t.status === 'accepted') {
      const a = demoAcceptance(t, t.snapshot?.createdAt ?? '2026-10-08T16:00:00+08:00');
      if (a) acceptances.push(a);
      else t.status = 'in_review';
    }
  }
  return { tasks, acceptances };
}

export function useAppState() {
  const [init] = useState(seed);
  const [tasks, setTasks] = useState<DemoTask[]>(init.tasks);
  const [acceptances, setAcceptances] = useState<Acceptance[]>(init.acceptances);
  const [invalidated, setInvalidated] = useState<Array<Acceptance & { reason: InvalidationReason }>>([]);

  /** 按任务取当前快照身份 —— 接受校验的唯一依据 */
  const identityOf = useCallback(
    (taskId: string): SnapshotIdentity | null => {
      const t = tasks.find((x) => x.id === taskId);
      if (!t?.snapshot) return null;
      return {
        runId: t.snapshot.runId,
        snapshotId: t.snapshot.id,
        contentDigest: t.snapshot.contentDigest,
      };
    },
    [tasks],
  );

  /**
   * 有效接受记录。逐任务按 snapshot 身份校验：
   * runId / snapshotId / contentDigest 任一变化即失效。
   */
  const validAcceptanceOf = useCallback(
    (taskId: string): Acceptance | undefined =>
      acceptances.find(
        (a) => a.taskId === taskId && acceptanceValidity(a, identityOf(taskId)).valid,
      ),
    [acceptances, identityOf],
  );

  const invalidatedOf = useCallback(
    (taskId: string) => invalidated.find((a) => a.taskId === taskId),
    [invalidated],
  );

  /** 使某任务的接受失效；保留记录并标记原因 */
  const invalidate = useCallback(
    (taskId: string, reason: InvalidationReason) => {
      setAcceptances((prev) => {
        const hit = prev.filter((a) => a.taskId === taskId);
        if (hit.length) {
          setInvalidated((v) => [
            ...hit.map((a) => ({ ...a, reason })),
            ...v.filter((x) => x.taskId !== taskId),
          ]);
        }
        return prev.filter((a) => a.taskId !== taskId);
      });
    },
    [],
  );

  /** 接受当前快照 */
  const accept = useCallback(
    (taskId: string) => {
      const t = tasks.find((x) => x.id === taskId);
      if (!t) return;
      const a = demoAcceptance(t);
      if (!a) return;
      setAcceptances((prev) => [...prev.filter((x) => x.taskId !== taskId), a]);
      setTasks((prev) =>
        prev.map((x) =>
          x.id === taskId ? { ...x, status: 'accepted', acceptedSnapshotId: a.snapshotId } : x,
        ),
      );
    },
    [tasks],
  );

  /**
   * 反馈修改：新建一次运行。
   * 关键语义：新运行使旧接受失效（草案状态规则）。
   */
  const requestChanges = useCallback(
    (taskId: string) => {
      invalidate(taskId, 'new_run');
      bumpRevision(taskId);
      setTasks((prev) =>
        prev.map((x) => {
          if (x.id !== taskId) return x;
          const n = x.runs.length + 1;
          return {
            ...x,
            status: 'in_progress',
            acceptedSnapshotId: undefined,
            latestRunId: `run-${x.id}-${n}`,
            runs: [
              ...x.runs,
              {
                schemaVersion: 1 as const,
                id: `run-${x.id}-${n}`,
                taskId: x.id,
                agentInstanceId: x.agentInstanceId,
                engineId: x.engineId,
                model: x.model,
                status: 'running' as const,
                phase: 'executing' as const,
                startedAt: new Date().toISOString(),
                version: 1,
              },
            ],
            // 新运行开始 ⇒ 旧快照不可再接受
            snapshot: null,
          };
        }),
      );
    },
    [invalidate],
  );

  /** 刷新快照：摘要变化 ⇒ 旧接受失效 */
  const refreshSnapshot = useCallback(
    (taskId: string) => {
      const rev = bumpRevision(taskId);
      invalidate(taskId, 'snapshot_refreshed');
      setTasks((prev) =>
        prev.map((x) => {
          if (x.id !== taskId || !x.snapshot) return x;
          return {
            ...x,
            snapshot: { ...x.snapshot, id: `snap-${x.id}-${rev}` },
          };
        }),
      );
    },
    [invalidate],
  );

  /** 模拟外部改动：工作区被别的进程改了 */
  const simulateExternalChange = useCallback(
    (taskId: string) => {
      invalidate(taskId, 'external_change');
      setTasks((prev) => prev.map((x) => (x.id === taskId ? { ...x, status: 'in_review' } : x)));
    },
    [invalidate],
  );

  const actionsOf = useCallback((t: DemoTask) => demoActionsFor(t), []);

  return useMemo(
    () => ({
      mode: 'demo' as DataMode,
      tasks,
      acceptances,
      invalidated,
      validAcceptanceOf,
      invalidatedOf,
      accept,
      requestChanges,
      refreshSnapshot,
      simulateExternalChange,
      identityOf,
      actionsOf,
      revisionOf: currentRevision,
    }),
    [
      tasks,
      acceptances,
      invalidated,
      validAcceptanceOf,
      invalidatedOf,
      accept,
      requestChanges,
      refreshSnapshot,
      simulateExternalChange,
      identityOf,
      actionsOf,
    ],
  );
}

export type App = ReturnType<typeof useAppState>;

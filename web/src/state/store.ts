import type {
  Check,
  Task,
  TimelineEvent,
  Run,
  QuestionEvent,
  ApprovalEvent,
  NextStep,
  Integration,
  Project,
  RunOutcome,
} from '../domain/types.ts';
import { seedProject, seedTasks } from '../mock/seed.ts';

/* ─────────────────────────────────────────────────────────────
   演示状态机
   ⚠️ 这是演示模式的前端状态，不连接任何真实执行。

   状态语义规则在此处强制，界面无法绕过：
   - succeeded 的运行不会自动把任务推进到「已验收」
   - acceptResult 只把任务推到「已接受」，不触发集成
   - integrate 独立于接受，且集成成功 ≠ 检查全通过
   - interrupt 不清空已产生的改动
   - 关闭页面不改变任何状态（状态只存在于内存，重载即回到种子态）
   ───────────────────────────────────────────────────────────── */

export interface AppState {
  project: Project;
  tasks: Task[];
  selectedTaskId: string;
  /** 演示操作记录，用于说明「刚才发生了什么」 */
  log: Array<{ id: string; atMs: number; text: string; tone: LogTone }>;
  ui: {
    tab: 'timeline' | 'changes' | 'checks';
    createOpen: boolean;
    /** 变更视图：只看未运行的检查 */
    onlyNotRun: boolean;
    /** 已接受任务的集成结果演示开关，见 IntegrateDialog */
    integrateOutcome: 'succeeded' | 'conflict' | 'checkFailed';
  };
}

type LogTone = 'info' | 'ok' | 'bad' | 'warn';

export type Action =
  | { type: 'selectTask'; taskId: string }
  | { type: 'setTab'; tab: AppState['ui']['tab'] }
  | { type: 'setOnlyNotRun'; value: boolean }
  | { type: 'setIntegrateOutcome'; value: AppState['ui']['integrateOutcome'] }
  | { type: 'openCreate' }
  | { type: 'closeCreate' }
  | {
      type: 'createTask';
      title: string;
      goal: string;
      acceptance: string[];
      startImmediately: boolean;
      repoPath: string;
      baseBranch: string;
    }
  | { type: 'startRun'; taskId: string }
  | {
      type: 'answerQuestion';
      taskId: string;
      eventId: string;
      answers: Record<string, string[]>;
    }
  | {
      type: 'resolveApproval';
      taskId: string;
      eventId: string;
      decision: 'accept' | 'acceptForSession' | 'decline' | 'cancel';
    }
  | { type: 'appendEvent'; taskId: string; runId: string; event: TimelineEvent }
  | { type: 'completeRun'; taskId: string; runId: string; outcome: RunOutcome }
  | { type: 'requestChanges'; taskId: string; text: string }
  | { type: 'acceptResult'; taskId: string }
  | { type: 'integrate'; taskId: string }
  | { type: 'interrupt'; taskId: string; runId: string }
  | { type: 'resume'; taskId: string }
  | { type: 'rerun'; taskId: string }
  | { type: 'dismissLog'; id: string };

/* ── 演示时钟 ─────────────────────────────────────────────── */

let nowMs = Date.parse('2026-10-08T09:12:00+08:00');

/** 演示时间线的当前时刻。随每次状态推进前进，保证时间显示连续。 */
export const demoNow = (): number => nowMs;

/** 推进演示时钟。事件追加时调用，让相对时间保持单调。 */
function tick(ms = 20_000): number {
  nowMs += ms;
  return nowMs;
}

/* ── 辅助 ─────────────────────────────────────────────────── */

const clone = <T,>(v: T): T => structuredClone(v);

const uid = (() => {
  let n = 0;
  return (p: string): string => `${p}-${++n}`;
})();

function withRun(task: Task, runId: string, fn: (run: Run) => Run): Task {
  return {
    ...task,
    runs: task.runs.map((r) => (r.id === runId ? fn(clone(r)) : r)),
  };
}

/** 任务的全部检查，含显式未运行的项。顺序：本轮 → 集成后。 */
export function allChecks(task: Task): Check[] {
  const seen = new Set<string>();
  const out: Check[] = [];
  for (const r of task.runs) {
    for (const c of r.outcome?.checks ?? []) {
      if (!seen.has(c.id)) {
        seen.add(c.id);
        out.push(c);
      }
    }
  }
  for (const c of task.integration.checks) {
    if (!seen.has(c.id)) {
      seen.add(c.id);
      out.push(c);
    }
  }
  return out;
}

/**
 * 依据任务现状推导后续可选操作。
 * 关键：不同操作的含义必须可区分，界面上要给出 hint 解释差异。
 */
export function nextStepFor(task: Task): NextStep[] {
  const run = task.runs.at(-1);
  const steps: NextStep[] = [];

  if (!run) {
    if (task.status === 'draft') {
      steps.push({
        id: 'complete',
        label: '补齐目标与验收条件',
        kind: 'review',
        hint: '草稿缺少目标或验收条件，补齐后才能启动运行。',
      });
    } else if (task.status === 'ready') {
      steps.push({ id: 'start', label: '启动运行', kind: 'rerun' });
    }
    return steps;
  }

  if (run.status === 'failed' || run.status === 'interrupted') {
    steps.push({
      id: 'resume',
      label: '恢复会话',
      kind: 'resume',
      hint: '沿用这次会话的上下文继续。不会恢复已经结束的系统进程。',
    });
    steps.push({
      id: 'rerun',
      label: '重新执行',
      kind: 'rerun',
      hint: '丢弃这次会话的上下文，从当前基准提交重新跑一遍。与「恢复」不同。',
    });
    steps.push({
      id: 'instruct',
      label: '补充指令后继续',
      kind: 'continueInstruction',
      hint: '把失败原因一并交回模型，要求修正后继续。仍然算同一次运行。',
    });
  }

  if (task.status === 'inReview' && run.status === 'succeeded') {
    steps.push({ id: 'review', label: '查看变更与检查', kind: 'review' });
    steps.push({
      id: 'instruct',
      label: '提出修改意见',
      kind: 'continueInstruction',
      hint: '在同一会话里继续修改，不产生新的运行记录。',
    });
  }

  if (task.status === 'accepted') {
    steps.push({
      id: 'integrate',
      label: `集成到 ${task.workspace.baseBranch}`,
      kind: 'integrate',
      hint: '把已接受的变更合并进目标分支。这一步与「接受结果」是两件事。',
    });
  }

  if (task.integration.status === 'conflict') {
    steps.unshift({
      id: 'instruct',
      label: '要求解决冲突',
      kind: 'continueInstruction',
      hint: '把冲突文件交回模型处理。是否接受它的解决方式仍由你决定。',
    });
  }

  return steps;
}

/* ── 初始状态 ─────────────────────────────────────────────── */

export function initialState(): AppState {
  return {
    project: seedProject(),
    tasks: seedTasks(),
    selectedTaskId: 't143', // 默认停在需要用户决策的任务上
    log: [],
    ui: {
      tab: 'timeline',
      createOpen: false,
      onlyNotRun: false,
      integrateOutcome: 'succeeded',
    },
  };
}

/* ── 创建任务 ─────────────────────────────────────────────── */

let refSeq = 147;

/* ── Reducer ──────────────────────────────────────────────── */

export function reducer(state: AppState, action: Action): AppState {
  const mapTask = (taskId: string, fn: (t: Task) => Task): AppState => ({
    ...state,
    tasks: state.tasks.map((t) => (t.id === taskId ? fn(clone(t)) : t)),
  });

  const logged = (
    s: AppState,
    text: string,
    tone: LogTone = 'info',
  ): AppState => ({
    ...s,
    log: [{ id: uid('log'), atMs: demoNow(), text, tone }, ...s.log].slice(0, 8),
  });

  switch (action.type) {
    case 'selectTask':
      return { ...state, selectedTaskId: action.taskId };

    case 'setTab':
      return { ...state, ui: { ...state.ui, tab: action.tab } };

    case 'setOnlyNotRun':
      return { ...state, ui: { ...state.ui, onlyNotRun: action.value } };

    case 'setIntegrateOutcome':
      return { ...state, ui: { ...state.ui, integrateOutcome: action.value } };

    case 'openCreate':
      return { ...state, ui: { ...state.ui, createOpen: true } };

    case 'closeCreate':
      return { ...state, ui: { ...state.ui, createOpen: false } };

    case 'dismissLog':
      return { ...state, log: state.log.filter((l) => l.id !== action.id) };

    /* ── 创建任务 ───────────────────────────────────────── */
    case 'createTask': {
      const clean = action.acceptance.map((t) => t.trim()).filter(Boolean);
      const title = action.title.trim();
      const goal = action.goal.trim();
      const ref = `T-${++refSeq}`;
      const id = uid('task');

      const task: Task = {
        id,
        ref,
        title: title || '未命名任务',
        goal,
        acceptance: clean.map((text, i) => ({ id: `ac${i + 1}`, text, met: null })),
        status: title && goal && clean.length > 0 ? 'ready' : 'draft',
        latestRunStatus: null,
        block: null,
        runs: [],
        changes: null,
        integration: {
          targetBranch: action.baseBranch,
          status: 'idle',
          mergedCommit: null,
          conflictFiles: [],
          checks: [],
          startedAtMs: null,
          finishedAtMs: null,
          message: null,
        },
        workspace: {
          repoPath: action.repoPath,
          worktreePath: '',
          branch: '',
          baseBranch: action.baseBranch,
          env: state.project.env,
          uncommitted: 0,
        },
        createdAtMs: demoNow(),
        updatedAtMs: demoNow(),
        demo: true,
      };

      let next: AppState = {
        ...state,
        tasks: [task, ...state.tasks],
        selectedTaskId: id,
        ui: { ...state.ui, createOpen: false, tab: 'timeline' },
      };

      if (task.status === 'draft') {
        const missing = [
          !title && '标题',
          !goal && '目标',
          clean.length === 0 && '验收条件',
        ].filter(Boolean);
        next = logged(
          next,
          `${ref} 已存为草稿：还缺 ${missing.join('、')}。补齐后才能启动运行。`,
          'warn',
        );
      } else {
        next = logged(next, `${ref} 已就绪，可启动运行。`, 'ok');
        if (action.startImmediately) {
          next = reducer(next, { type: 'startRun', taskId: id });
        }
      }
      return next;
    }

    /* ── 启动运行 ───────────────────────────────────────── */
    case 'startRun': {
      const task = state.tasks.find((t) => t.id === action.taskId);
      if (!task || task.status === 'draft') return state;

      tick();
      const index = task.runs.length + 1;
      const slug = task.ref.toLowerCase();
      const runId = uid('run');
      const turnId = uid('turn');
      const worktree = `${task.workspace.repoPath}\\.worktrees\\agentdesk-${slug}`;

      const run: Run = {
        id: runId,
        threadId: uid('thr'),
        turnId,
        index,
        status: 'queued',
        startedAtMs: demoNow(),
        finishedAtMs: null,
        model: 'gpt-5.4-codex',
        baseCommit: task.workspace.baseBranch,
        events: [
          {
            id: uid('ev'),
            kind: 'userMessage',
            atMs: demoNow(),
            runId,
            turnId,
            isSteer: false,
            text:
              `${task.goal}\n\n验收条件：\n` +
              task.acceptance.map((a, i) => `${i + 1}. ${a.text}`).join('\n'),
          },
          {
            id: uid('ev'),
            kind: 'reasoning',
            atMs: demoNow() + 500,
            runId,
            turnId,
            summary: [
              '先读仓库里与这个目标相关的模块，确认现有约定。',
              '再确定改动范围，避免顺手重构无关代码。',
            ],
          },
          {
            id: uid('ev'),
            kind: 'info',
            atMs: demoNow() + 900,
            runId,
            turnId,
            text: '演示模式：不会真的调用 Codex。后续事件按脚本推进，用于演示交互路径。',
          },
        ],
        outcome: null,
      };
      // 演示：短暂排队后立即进入运行中
      run.status = 'running';

      const next = mapTask(action.taskId, (t) => ({
        ...t,
        status: 'inProgress',
        latestRunStatus: 'running',
        block: null,
        runs: [...t.runs, run],
        changes: {
          baseRef: t.workspace.baseBranch,
          worktreePath: worktree,
          branch: `agentdesk/${slug}`,
          files: [],
          uncommitted: 0,
        },
        workspace: {
          ...t.workspace,
          worktreePath: worktree,
          branch: `agentdesk/${slug}`,
        },
        updatedAtMs: demoNow(),
      }));

      return logged(next, `${task.ref} 第 ${index} 次运行已启动（演示）`, 'info');
    }

    case 'appendEvent':
      tick(6_000);
      return mapTask(action.taskId, (t) =>
        withRun(t, action.runId, (r) => ({
          ...r,
          events: [...r.events, { ...action.event, atMs: demoNow() }],
        })),
      );

    /* ── 本轮结束 ───────────────────────────────────────── */
    case 'completeRun':
      tick();
      return logged(
        mapTask(action.taskId, (t) => {
          const next = withRun(t, action.runId, (r) => ({
            ...r,
            status: 'succeeded',
            finishedAtMs: demoNow(),
            events: r.events.map((e) => (e.pending ? { ...e, pending: false } : e)),
            outcome: { ...action.outcome, nextSteps: [] },
          }));
          return {
            ...next,
            // 运行成功 → 任务进入「待审查」。注意这仍然不是「已接受」，
            // 更不是「已验收」：需要人看过 diff 与检查结果才能往下走。
            status: t.status === 'draft' ? t.status : 'inReview',
            latestRunStatus: 'succeeded',
            block: null,
            updatedAtMs: demoNow(),
          };
        }),
        '本轮执行成功，任务进入「待审查」。执行成功不等于验收通过 —— 需要你查看变更与检查结果。',
        'ok',
      );
    /* ── 回答问题 ───────────────────────────────────────── */
    case 'answerQuestion':
      tick();
      return logged(
        mapTask(action.taskId, (t) => {
          const runId = t.runs.at(-1)?.id ?? '';
          const next = withRun(t, runId, (r) => ({
            ...r,
            events: r.events.map((e) =>
              e.id === action.eventId && e.kind === 'question'
                ? ({
                    ...e,
                    resolution: {
                      atMs: demoNow(),
                      answers: action.answers,
                      via: 'user',
                    },
                  } as QuestionEvent)
                : e,
            ),
          }));
          return {
            ...next,
            block: null,
            status: 'inProgress',
            latestRunStatus: 'running',
            updatedAtMs: demoNow(),
          };
        }),
        '已回答模型的问题，本轮继续。',
        'ok',
      );

    /* ── 审批 ───────────────────────────────────────────── */
    case 'resolveApproval':
      tick();
      return logged(
        mapTask(action.taskId, (t) => {
          const runId = t.runs.at(-1)?.id ?? '';
          const next = withRun(t, runId, (r) => ({
            ...r,
            status: action.decision === 'cancel' ? 'interrupted' : 'running',
            finishedAtMs: action.decision === 'cancel' ? demoNow() : null,
            events: r.events.map((e) => {
              if (e.id !== action.eventId || e.kind !== 'approval') return e;
              const st: ApprovalEvent['state'] =
                action.decision === 'accept'
                  ? { kind: 'accepted', atMs: demoNow(), scope: 'once' }
                  : action.decision === 'acceptForSession'
                    ? {
                        kind: 'acceptedForSession',
                        atMs: demoNow(),
                        scope: 'session',
                      }
                    : action.decision === 'decline'
                      ? { kind: 'declined', atMs: demoNow() }
                      : { kind: 'cancelled', atMs: demoNow() };
              return { ...e, state: st } as ApprovalEvent;
            }),
          }));

          if (action.decision === 'cancel') {
            return {
              ...next,
              status: 'inProgress',
              latestRunStatus: 'interrupted',
              block: {
                kind: 'approval',
                summary:
                  '操作被拒绝，本轮随之中止。已写入工作区的改动仍然保留，未回滚。',
                runId,
              },
              updatedAtMs: demoNow(),
            };
          }

          return {
            ...next,
            block: null,
            status: 'inProgress',
            latestRunStatus: 'running',
            updatedAtMs: demoNow(),
          };
        }),
        action.decision === 'decline'
          ? '已拒绝该操作。本轮继续，模型会换一种做法。'
          : action.decision === 'cancel'
            ? '已拒绝该操作并中止本轮。注意：中止不回滚已产生的改动。'
            : action.decision === 'acceptForSession'
              ? '已批准，且本次会话内同类操作不再询问。请留意这个授权范围比「仅本次」更大。'
              : '已批准本次操作。',
        action.decision === 'decline' || action.decision === 'cancel' ? 'warn' : 'ok',
      );

    /* ── 提出修改意见：同一运行内继续，不新建运行 ───────── */
    case 'requestChanges':
      tick();
      return logged(
        mapTask(action.taskId, (t) => {
          const runId = t.runs.at(-1)?.id ?? '';
          const next = withRun(t, runId, (r) => ({
            ...r,
            status: 'running',
            finishedAtMs: null,
            events: [
              ...r.events,
              {
                id: uid('ev'),
                kind: 'userMessage' as const,
                atMs: demoNow(),
                runId,
                turnId: r.turnId,
                isSteer: true,
                text: action.text,
              },
              {
                id: uid('ev'),
                kind: 'agentMessage' as const,
                atMs: demoNow() + 600,
                runId,
                turnId: r.turnId,
                phase: 'commentary' as const,
                pending: false,
                text:
                  '收到，按这个意见改。改动会记在同一轮里，改完我会重新跑检查和 diff。\n\n' +
                  '（演示模式：这里不会真的继续执行。可用「重新执行」演示一个新运行，' +
                  '或在变更视图查看同一批文件的 diff。）',
              },
            ],
          }));
          return {
            ...next,
            status: 'inProgress',
            latestRunStatus: 'running',
            block: null,
            updatedAtMs: demoNow(),
          };
        }),
        '修改意见已作为同一轮运行的补充指令发出。这不会产生新的运行记录。',
        'info',
      );

    /* ── 接受结果：只到「已接受」，绝不自动集成 ─────────── */
    case 'acceptResult':
      tick();
      return logged(
        mapTask(action.taskId, (t) => ({
          ...t,
          status: 'accepted',
          block: null,
          acceptance: t.acceptance.map((a) =>
            a.met === null ? { ...a, met: true } : a,
          ),
          updatedAtMs: demoNow(),
        })),
        '结果已接受。代码还没有进入目标分支 —— 集成是单独的一步。',
        'ok',
      );

    /* ── 集成：独立操作，三种结局 ───────────────────────── */
    case 'integrate': {
      const task = state.tasks.find((t) => t.id === action.taskId);
      if (!task) return state;
      tick(4_000);

      const head = () => `demo${(nowMs % 0xfffff).toString(16)}`;
      const base = task.workspace.baseBranch;
      const started = demoNow();

      let integration: Integration;
      let status: Task['status'] = task.status;
      let block: Task['block'] = null;
      let tone: LogTone = 'ok';
      let text = '';

      if (state.ui.integrateOutcome === 'succeeded') {
        integration = {
          targetBranch: base,
          status: 'succeeded',
          mergedCommit: head(),
          conflictFiles: [],
          checks: [
            {
              id: uid('chk'),
              name: '集成后类型检查',
              command: 'npm run typecheck',
              status: 'passed',
              exitCode: 0,
              durationMs: 4_100,
              output: '> tsc --noEmit\n\n找到 0 个错误。',
              runId: null,
              startedAtMs: started + 1_000,
            },
            {
              id: uid('chk'),
              name: '集成后单元测试',
              command: 'npm test -- --run',
              status: 'passed',
              exitCode: 0,
              durationMs: 9_900,
              output:
                '> vitest run\n\n Test Files  3 passed (3)\n      Tests  22 passed (22)',
              runId: null,
              startedAtMs: started + 2_000,
            },
            {
              id: uid('chk'),
              name: 'Linux CI 单元测试',
              command: 'npm test -- --run',
              status: 'notRun',
              exitCode: null,
              durationMs: null,
              output: null,
              runId: null,
              startedAtMs: null,
            },
          ],
          startedAtMs: started,
          finishedAtMs: started + 4_000,
          message: `已合并到 ${base}（${head()}）。Linux CI 尚未运行。`,
        };
        status = 'integrated';
        text = '集成成功。注意：集成成功不等于最终验收通过。';
      } else if (state.ui.integrateOutcome === 'conflict') {
        integration = {
          targetBranch: base,
          status: 'conflict',
          mergedCommit: null,
          conflictFiles: ['src/sync/loop.ts', 'src/store/schema.ts'],
          checks: [],
          startedAtMs: started,
          finishedAtMs: started + 2_000,
          message: `${base} 上有新的提交改了同两个文件，合并已停止，没有产生合并提交。工作区仍是接受结果时的状态。`,
        };
        status = 'accepted';
        block = { kind: 'mergeConflict', summary: '集成时遇到合并冲突，未产生合并提交' };
        tone = 'bad';
        text = '集成遇到合并冲突。没有部分合并，工作区保持接受时的状态。';
      } else {
        integration = {
          targetBranch: base,
          status: 'checkFailed',
          mergedCommit: head(),
          conflictFiles: [],
          checks: [
            {
              id: uid('chk'),
              name: '集成后类型检查',
              command: 'npm run typecheck',
              status: 'failed',
              exitCode: 2,
              durationMs: 3_800,
              output:
                '> tsc --noEmit\n\n' +
                "src/sync/loop.ts(28,7): error TS2304: Cannot find name 'cursor'.\n\n" +
                '找到 1 个错误。',
              runId: null,
              startedAtMs: started + 1_000,
            },
            {
              id: uid('chk'),
              name: '集成后单元测试',
              command: 'npm test -- --run',
              status: 'notRun',
              exitCode: null,
              durationMs: null,
              output: null,
              runId: null,
              startedAtMs: null,
            },
          ],
          startedAtMs: started,
          finishedAtMs: started + 4_000,
          message: `变更已合并到 ${base}（${head()}），但集成后的检查未通过。合并提交仍在，需要追加修复提交。`,
        };
        status = 'integrated';
        block = { kind: 'checkFailed', summary: '集成后的检查未通过，需要追加修复' };
        tone = 'bad';
        text = '变更已在目标分支上，但集成检查失败。需要修复后追加提交。';
      }

      return logged(
        mapTask(action.taskId, (t) => ({
          ...t,
          integration,
          status,
          block,
          updatedAtMs: demoNow(),
        })),
        text,
        tone,
      );
    }

    /* ── 中止：保留改动 ─────────────────────────────────── */
    case 'interrupt':
      tick();
      return logged(
        mapTask(action.taskId, (t) => ({
          ...withRun(t, action.runId, (r) => ({
            ...r,
            status: 'interrupted',
            finishedAtMs: demoNow(),
            events: [
              ...r.events.map((e) => (e.pending ? { ...e, pending: false } : e)),
              {
                id: uid('ev'),
                kind: 'interrupted' as const,
                atMs: demoNow(),
                runId: r.id,
                turnId: r.turnId,
                reason: '用户中止了本轮。正在执行的命令进程已终止。',
                changesPreserved: true,
              },
            ],
          })),
          status: 'inReview',
          latestRunStatus: 'interrupted',
          updatedAtMs: demoNow(),
        })),
        '运行已中止。中止不会回滚已经写入工作区的改动。',
        'warn',
      );

    /* ── 恢复会话：不恢复已结束的进程 ────────────────────── */
    case 'resume':
      tick();
      return logged(
        mapTask(action.taskId, (t) => {
          const runId = t.runs.at(-1)?.id ?? '';
          const next = withRun(t, runId, (r) => ({
            ...r,
            status: 'running',
            finishedAtMs: null,
            events: [
              ...r.events,
              {
                id: uid('ev'),
                kind: 'info' as const,
                atMs: demoNow(),
                runId: r.id,
                turnId: r.turnId,
                text: '已恢复这次会话的上下文，在同一轮内继续。',
              },
            ],
          }));
          return {
            ...next,
            status: 'inProgress',
            latestRunStatus: 'running',
            block: null,
            updatedAtMs: demoNow(),
          };
        }),
        '已恢复会话上下文。恢复的是会话，不是已经结束的系统进程。',
        'info',
      );

    /* ── 重新执行：新运行，丢弃上下文 ────────────────────── */
    case 'rerun': {
      const next = logged(
        state,
        '已请求重新执行：丢弃本次会话上下文，从当前基准提交重新开始（演示）',
        'info',
      );
      return reducer(next, { type: 'startRun', taskId: action.taskId });
    }

    default:
      return state;
  }
}

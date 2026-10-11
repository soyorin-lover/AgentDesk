import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type Dispatch,
  type ReactNode,
} from 'react';
import {
  allChecks,
  demoNow,
  initialState,
  nextStepFor,
  reducer,
  type Action,
  type AppState,
} from './store.ts';
import type { ApprovalEvent, Check, QuestionEvent, Run, Task } from '../domain/types.ts';
import { demoSteps } from '../mock/script142.ts';

interface PendingQuestion {
  run: Run;
  event: QuestionEvent;
}
interface PendingApproval {
  run: Run;
  event: ApprovalEvent;
}

interface Ctx {
  state: AppState;
  dispatch: Dispatch<Action>;
  /** 演示时间的当前值 */
  now: number;
  task: Task | null;
  run: Run | null;
  checks: Check[];
  steps: ReturnType<typeof nextStepFor>;
  pendingQuestion: PendingQuestion | null;
  pendingApproval: PendingApproval | null;
  /** 该任务是否正在由演示脚本推进 */
  streaming: boolean;
}

function findQuestion(task: Task | null): PendingQuestion | null {
  if (!task) return null;
  for (let i = task.runs.length - 1; i >= 0; i--) {
    const run = task.runs[i];
    for (let j = run.events.length - 1; j >= 0; j--) {
      const e = run.events[j];
      if (e.kind === 'question' && e.resolution === null) {
        return { run, event: e };
      }
    }
  }
  return null;
}

function findApproval(task: Task | null): PendingApproval | null {
  if (!task) return null;
  for (let i = task.runs.length - 1; i >= 0; i--) {
    const run = task.runs[i];
    for (let j = run.events.length - 1; j >= 0; j--) {
      const e = run.events[j];
      if (e.kind === 'approval' && e.state.kind === 'pending') {
        return { run, event: e };
      }
    }
  }
  return null;
}

const StoreCtx = createContext<Ctx | null>(null);

/** 演示推进节拍。真实接入后由事件流取代，见 docs 迁移说明。 */
const STEP_MS = 2_400;

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);

  /* 记录已经推进到脚本的哪一步，按「任务+运行」分别计数 */
  const progress = useRef<Map<string, number>>(new Map());

  /**
   * 演示：当有一条运行处于「运行中」且没有阻塞时，
   * 按节拍从脚本取下一个事件追加进去，直到本轮结束。
   *
   * 这里刻意只在「运行中且无待处理项」时推进 ——
   * 让「等待用户」的暂停是真的暂停，而不是被脚本覆盖过去。
   */
  const tickKey = state.tasks
    .map((t) => `${t.id}:${t.runs.at(-1)?.id ?? '-'}:${t.latestRunStatus}:${t.block ? 1 : 0}`)
    .join('|');

  useEffect(() => {
    const active = state.tasks.find(
      (t) => t.latestRunStatus === 'running' && !t.block && t.runs.length > 0,
    );
    if (!active) return;

    const run = active.runs[active.runs.length - 1];
    const script = demoSteps(demoNow);
    const key = `${active.id}:${run.id}`;
    // 只有从界面新启动的运行（无产出）才走脚本；种子任务停在既有状态
    if (active.id !== 't142' && run.events.length < 4) return;
    if (active.id === 't142') {
      const done = progress.current.get(key) ?? 0;
      if (done >= script.length) return;

      const timer = window.setTimeout(() => {
        const step = script[done];
        progress.current.set(key, done + 1);
        dispatch({
          type: 'appendEvent',
          taskId: active.id,
          runId: run.id,
          event: step.event,
        });
        if (step.status === 'succeeded' && step.outcome) {
          dispatch({
            type: 'completeRun',
            taskId: active.id,
            runId: run.id,
            outcome: { ...step.outcome, nextSteps: [] },
          });
        }
      }, STEP_MS);
      return () => window.clearTimeout(timer);
    }

    /* 用户新建的运行：走一段通用脚本后自动结束，让路径走完 */
    const done = progress.current.get(key) ?? 0;
    const GENERIC = 3;
    if (done >= GENERIC) {
      const timer = window.setTimeout(() => {
        dispatch({
          type: 'completeRun',
          taskId: active.id,
          runId: run.id,
          outcome: {
            summary:
              '演示脚本结束：本轮视为成功，等待你查看变更与检查结果。' +
              '演示模式不产生真实改动，变更视图会显示为空。',
            changedFiles: 0,
            additions: 0,
            deletions: 0,
            checks: [
              {
                id: `chk-gen-typecheck-${run.id}`,
                name: '类型检查',
                command: 'npm run typecheck',
                status: 'notRun',
                exitCode: null,
                durationMs: null,
                output: null,
                runId: null,
                startedAtMs: null,
              },
            ],
            nextSteps: [],
          },
        });
      }, STEP_MS);
      return () => window.clearTimeout(timer);
    }

    const timer = window.setTimeout(() => {
      progress.current.set(key, done + 1);
      dispatch({
        type: 'appendEvent',
        taskId: active.id,
        runId: run.id,
        event: {
          id: `ev-gen-${key}-${done}`,
          kind: 'agentMessage',
          atMs: demoNow(),
          runId: run.id,
          turnId: run.turnId,
          phase: 'commentary',
          pending: false,
          text:
            done === 0
              ? '已读取仓库结构与相关模块，正在确定改动范围。'
              : done === 1
                ? '改动方案已确定，开始实现；过程中会运行类型检查与单元测试。'
                : '实现完成，正在整理本轮结论。',
        },
      });
    }, STEP_MS);
    return () => window.clearTimeout(timer);
  }, [tickKey, state.tasks]);

  const task = useMemo(
    () => state.tasks.find((t) => t.id === state.selectedTaskId) ?? null,
    [state.tasks, state.selectedTaskId],
  );

  const value: Ctx = useMemo(() => {
    const run = task && task.runs.length > 0 ? task.runs[task.runs.length - 1] : null;
    return {
      state,
      dispatch,
      now: demoNow(),
      task,
      run,
      checks: task ? allChecks(task) : [],
      steps: task ? nextStepFor(task) : [],
      pendingQuestion: findQuestion(task),
      pendingApproval: findApproval(task),
      streaming: Boolean(task) && !task?.block && task?.latestRunStatus === 'running',
    };
  }, [state, task]);

  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}

export function useStore(): Ctx {
  const ctx = useContext(StoreCtx);
  if (!ctx) throw new Error('useStore 必须在 StoreProvider 内使用');
  return ctx;
}

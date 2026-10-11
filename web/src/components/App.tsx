import { useCallback, useEffect, useState } from 'react';
import { StoreProvider, useStore } from '../state/context.tsx';
import { TaskRail } from './TaskRail.tsx';
import { TaskHeader } from './TaskHeader.tsx';
import { TimelineView } from './TimelineView.tsx';
import { ChangesView, ChecksView } from './ChangesView.tsx';
import { PendingPanel } from './PendingPanel.tsx';
import { CreateTaskDialog } from './CreateTaskDialog.tsx';
import { IntegrateDialog } from './IntegrateDialog.tsx';
import { Btn, DemoMark } from './primitives.tsx';
import { Icon } from './Icons.tsx';
import type { NextStep } from '../domain/types.ts';

export function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}

function Shell() {
  const { state, dispatch, task, now, checks, steps } = useStore();
  const [integrateOpen, setIntegrateOpen] = useState(false);
  const [jumpTo, setJumpTo] = useState<'timeline' | 'changes' | 'checks' | null>(null);

  /* 待处理面板点击后要跳到具体标签页 */
  useEffect(() => {
    if (jumpTo) {
      dispatch({ type: 'setTab', tab: jumpTo });
      setJumpTo(null);
    }
  }, [jumpTo, dispatch]);

  /* 全局快捷键：c 创建，1/2/3 切标签 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing =
        t &&
        (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'c') {
        e.preventDefault();
        dispatch({ type: 'openCreate' });
      } else if (e.key === '1') {
        dispatch({ type: 'setTab', tab: 'timeline' });
      } else if (e.key === '2') {
        dispatch({ type: 'setTab', tab: 'changes' });
      } else if (e.key === '3') {
        dispatch({ type: 'setTab', tab: 'checks' });
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [dispatch]);

  const onJump = useCallback(
    (taskId: string, where: 'timeline' | 'changes' | 'checks') => {
      dispatch({ type: 'selectTask', taskId });
      setJumpTo(where);
    },
    [dispatch],
  );

  if (!task) {
    return <div className="pad-6">没有选中的任务。</div>;
  }

  const run = task.runs.at(-1) ?? null;
  const showInstructBox = task.status === 'inReview' || run?.status === 'failed' || run?.status === 'interrupted';

  return (
    <div className="app">
      {/* 顶栏 */}
      <header className="topbar">
        <span className="topbar__brand">
          <span className="topbar__brand-mark">◆</span>
          AgentDesk
        </span>
        <span className="topbar__sep" />
        <span className="fs-sm sec truncate" title={state.project.repoPath}>
          {state.project.name}
        </span>
        <span className="topbar__spacer" />
        <DemoMark what="交互原型" />
        <span className="topbar__sep" />
        <span className="fs-xs dim nowrap" title="本批不接入真实 Codex 执行">
          未接入执行引擎
        </span>
      </header>

      {/* 演示说明条 */}
      <div className="demo-strip">
        <Icon name="warn" size={12} />
        <span>
          <strong>演示模式</strong>：全部数据为构造数据，操作只改变前端演示状态。
          不会调用真实 Codex，不产生真实代码改动，也不代表任何真实的工时、Token
          或成功率节省。界面中标注「设计假设」的能力尚未经 Codex 验证。
        </span>
      </div>

      <div className={`app-body ${''}`}>
        {/* 左栏 */}
        <TaskRail
          project={state.project}
          tasks={state.tasks}
          selectedId={task.id}
          now={now}
          onSelect={(id) => dispatch({ type: 'selectTask', taskId: id })}
          onCreate={() => dispatch({ type: 'openCreate' })}
        />

        {/* 中栏 */}
        <main className="main">
          <TaskHeader
            task={task}
            now={now}
            dispatch={dispatch}
            onOpenChanges={() => dispatch({ type: 'setTab', tab: 'changes' })}
          />

          <div className="tabs" role="tablist">
            <button
              type="button"
              role="tab"
              className="tab"
              aria-selected={state.ui.tab === 'timeline'}
              onClick={() => dispatch({ type: 'setTab', tab: 'timeline' })}
            >
              <Icon name="terminal" size={12} />
              执行时间线
              <span className="chip chip--plain-dim" style={{ height: 16 }}>
                {run?.events.length ?? 0}
              </span>
            </button>
            <button
              type="button"
              role="tab"
              className="tab"
              aria-selected={state.ui.tab === 'changes'}
              onClick={() => dispatch({ type: 'setTab', tab: 'changes' })}
            >
              <Icon name="diff" size={12} />
              变更
              {task.changes && task.changes.files.length > 0 ? (
                <span className="chip chip--plain-dim" style={{ height: 16 }}>
                  {task.changes.files.length}
                </span>
              ) : null}
            </button>
            <button
              type="button"
              role="tab"
              className="tab"
              aria-selected={state.ui.tab === 'checks'}
              onClick={() => dispatch({ type: 'setTab', tab: 'checks' })}
            >
              <Icon name="check" size={12} />
              检查
              {checks.filter((c) => c.status === 'notRun').length > 0 ? (
                <span className="tab__badge">
                  {checks.filter((c) => c.status === 'notRun').length}
                </span>
              ) : null}
            </button>
          </div>

          <div className="main__scroll">
            {state.ui.tab === 'timeline' ? (
              <TimelineView
                task={task}
                now={now}
                dispatch={dispatch}
                streaming={task.latestRunStatus === 'running'}
              />
            ) : state.ui.tab === 'changes' ? (
              <ChangesView task={task} dispatch={dispatch} />
            ) : (
              <ChecksView task={task} dispatch={dispatch} />
            )}

            {/* 后续操作区：失败 / 中止 / 待审查时出现 */}
            {steps.length > 0 && state.ui.tab === 'timeline' ? (
              <div className="pad-6" style={{ maxWidth: 1080, margin: '0 auto', width: '100%' }}>
                <NextSteps task={task} steps={steps} dispatch={dispatch} onIntegrate={() => setIntegrateOpen(true)} />
              </div>
            ) : null}

            {showInstructBox && state.ui.tab === 'changes' ? (
              <div className="pad-6" style={{ maxWidth: 1080, margin: '0 auto', width: '100%' }}>
                <NextSteps task={task} steps={steps} dispatch={dispatch} onIntegrate={() => setIntegrateOpen(true)} />
              </div>
            ) : null}

            {/* 演示推进日志：让「刚才发生了什么」可见 */}
            {state.log.length > 0 ? (
              <div
                className="pad-6"
                style={{ maxWidth: 1080, margin: '0 auto', width: '100%', paddingTop: 0 }}
              >
                <div className="col gap-3">
                  <div className="fs-xs dim">演示操作记录（最新的在前）</div>
                  {state.log.map((l) => (
                    <div
                      key={l.id}
                      className="row gap-3 fs-xs"
                      style={{
                        padding: 'var(--sp-3) var(--sp-4)',
                        borderLeft: `2px solid var(--st-${l.tone === 'ok' ? 'ok' : l.tone === 'bad' ? 'bad' : l.tone === 'warn' ? 'wait' : 'idle'})`,
                        background: 'var(--bg-panel)',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      <span className="grow">{l.text}</span>
                      <button
                        type="button"
                        className="copy"
                        onClick={() => dispatch({ type: 'dismissLog', id: l.id })}
                        aria-label="关闭这条记录"
                      >
                        <Icon name="x" size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </main>

        {/* 右栏 */}
        <PendingPanel
          tasks={state.tasks}
          selectedId={task.id}
          now={now}
          dispatch={dispatch}
          onJump={onJump}
        />
      </div>

      <CreateTaskDialog
        open={state.ui.createOpen}
        dispatch={dispatch}
        onClose={() => dispatch({ type: 'closeCreate' })}
      />

      {integrateOpen ? (
        <IntegrateDialog
          task={task}
          dispatch={dispatch}
          onClose={() => setIntegrateOpen(false)}
        />
      ) : null}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   后续操作区
   每个按钮都附带一句说明它与相邻操作的差别 ——
   用户最容易搞混的就是「恢复」「重跑」「继续」这三件事。
   ───────────────────────────────────────────────────────────── */

function NextSteps({
  task,
  steps,
  dispatch,
  onIntegrate,
}: {
  task: ReturnType<typeof useStore>['task'];
  steps: NextStep[];
  dispatch: ReturnType<typeof useStore>['dispatch'];
  onIntegrate: () => void;
}) {
  if (!task) return null;

  const handle = (s: NextStep) => {
    switch (s.kind) {
      case 'resume':
        dispatch({ type: 'resume', taskId: task.id });
        break;
      case 'rerun':
        dispatch({ type: 'rerun', taskId: task.id });
        break;
      case 'continueInstruction':
        dispatch({ type: 'setTab', tab: 'timeline' });
        document.querySelector<HTMLTextAreaElement>('.textarea')?.focus();
        break;
      case 'review':
        dispatch({ type: 'setTab', tab: 'changes' });
        break;
      case 'integrate':
        onIntegrate();
        break;
    }
  };

  /* 接受结果：独立按钮，只在待审查时出现 */
  const canAccept = task.status === 'inReview' && task.runs.at(-1)?.status === 'succeeded';

  return (
    <div className="card card--raised">
      <header className="card__head">
        <Icon name="arrowRight" size={13} />
        <span className="card__title">接下来可以做什么</span>
        <span className="grow" />
        <span className="fs-xs dim">
          这些操作含义不同，按钮上写清了差别
        </span>
      </header>

      <div className="card__body col gap-5">
        {canAccept ? (
          <div className="col gap-4">
            <div className="row gap-4 row--wrap">
              <Btn
                variant="primary"
                icon="check"
                onClick={() =>
                  dispatch({ type: 'acceptResult', taskId: task.id })
                }
              >
                接受这次结果
              </Btn>
              <span className="fs-xs dim" style={{ maxWidth: '52ch' }}>
                接受表示你认可这次产出。它不会把代码集成到目标分支 ——
                集成是接下来单独的一步。
              </span>
            </div>
            <div className="fs-xs" style={{ color: 'var(--st-wait)' }}>
              <Icon name="warn" size={11} /> 接受结果 ≠ 代码已集成 ≠ 验收通过
            </div>
          </div>
        ) : null}

        <div className="col gap-3">
          {steps.map((s) => (
            <div key={s.id} className="row gap-4 row--wrap" style={{ alignItems: 'flex-start' }}>
              <div style={{ minWidth: 190 }}>
                <Btn
                  icon={
                    s.kind === 'resume'
                      ? 'play'
                      : s.kind === 'rerun'
                        ? 'refresh'
                        : s.kind === 'integrate'
                          ? 'arrowRight'
                          : s.kind === 'review'
                            ? 'diff'
                            : 'arrowRight'
                  }
                  variant={s.kind === 'integrate' ? 'ok' : 'default'}
                  disabled={s.disabled}
                  title={s.disabledReason}
                  onClick={() => handle(s)}
                >
                  {s.label}
                </Btn>
              </div>
              {s.hint ? (
                <span
                  className="grow fs-xs sec"
                  style={{ lineHeight: 'var(--lh-body)', paddingTop: 6, maxWidth: '64ch' }}
                >
                  {s.hint}
                </span>
              ) : (
                <span className="grow" />
              )}
            </div>
          ))}
        </div>

        {/* 失败 / 中止任务的结果保留说明 */}
        {(task.runs.at(-1)?.status === 'failed' ||
          task.runs.at(-1)?.status === 'interrupted') &&
        task.changes?.files.length ? (
          <div className="banner">
            <span className="banner__ico">
              <Icon name="info" size={13} />
            </span>
            <div className="banner__body">
              失败/中止前的改动仍然保留在{' '}
              <span className="mono sec">{task.changes.files.length} 个文件</span> 中，
              可以在「变更」标签页查看。中止不会回滚这些改动。
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

import { useEffect, useRef, useState, type Dispatch } from 'react';
import type { Task } from '../domain/types.ts';
import type { Action } from '../state/store.ts';
import { Btn, Card, PathText } from './primitives.tsx';
import { Icon } from './Icons.tsx';
import { CheckList } from './CheckList.tsx';
import { stamp } from '../lib/format.ts';

/* ─────────────────────────────────────────────────────────────
   集成对话框
   这一步最容易被误解成「接受结果就完事了」，所以对话框
   必须把三件事讲清：目标分支、会发生什么、失败会怎样。
   ───────────────────────────────────────────────────────────── */

export function IntegrateDialog({
  task,
  dispatch,
  onClose,
}: {
  task: Task;
  dispatch: Dispatch<Action>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const integ = task.integration;
  const running = integ.status === 'running';

  const outcomeLabel =
    integ.status === 'succeeded'
      ? '集成成功'
      : integ.status === 'conflict'
        ? '合并冲突'
        : integ.status === 'checkFailed'
          ? '集成后检查失败'
          : null;

  return (
    <div
      className="overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="int-title" ref={ref}>
        <header className="modal__head">
          <h2 className="modal__title" id="int-title">
            集成变更
          </h2>
          <span className="chip chip--demo">演示模式</span>
          <Btn size="sm" variant="ghost" icon="x" onClick={onClose} ariaLabel="关闭" />
        </header>

        <div className="modal__body">
          {/* 集成前的确认 */}
          {integ.status === 'idle' ? (
            <>
              <div className="banner banner--info">
                <span className="banner__ico">
                  <Icon name="arrowRight" size={14} />
                </span>
                <div className="banner__body">
                  <div className="banner__title">
                    把 {task.workspace.branch} 合并进 {integ.targetBranch}
                  </div>
                  <div className="sec">
                    接受结果只是「你认可这次产出」，集成才是把代码放进目标分支。
                    这两件事分开，是为了让你能在接受之后、集成之前再看一眼。
                  </div>
                </div>
              </div>

              <Card title="将要发生什么">
                <ol className="col gap-4 fs-sm sec" style={{ margin: 0, paddingLeft: 18, lineHeight: 'var(--lh-body)' }}>
                  <li>把任务分支合并进 {integ.targetBranch}，产生一个合并提交</li>
                  <li>在合并结果上重新运行类型检查与单元测试</li>
                  <li>若发生冲突则停止，不产生部分合并，工作区保持现状</li>
                  <li>不推送、不部署 —— 这一步只在本机仓库内完成</li>
                </ol>
              </Card>

              <div className="col gap-3 fs-xs dim">
                <div className="row gap-3" style={{ minWidth: 0 }}>
                  <span className="nowrap">工作区分支</span>
                  <span className="mono sec truncate" title={task.workspace.branch}>
                    {task.workspace.branch}
                  </span>
                </div>
                <div className="row gap-3" style={{ minWidth: 0 }}>
                  <span className="nowrap">目标分支</span>
                  <span className="mono sec">{integ.targetBranch}</span>
                </div>
                <div className="row gap-3" style={{ minWidth: 0 }}>
                  <span className="nowrap">工作区路径</span>
                  <PathText path={task.workspace.worktreePath} full />
                </div>
              </div>

              {task.workspace.uncommitted > 0 ? (
                <div className="banner banner--warn">
                  <span className="banner__ico">
                    <Icon name="warn" size={13} />
                  </span>
                  <div className="banner__body">
                    工作区里还有 <strong>{task.workspace.uncommitted}</strong> 个未提交改动。
                    集成通常需要先提交它们，否则这些改动不会进入目标分支。
                  </div>
                </div>
              ) : null}

              {/* 演示用：选择集成结局，让三种结果都能被演示 */}
              <DemoOutcomePicker dispatch={dispatch} />
            </>
          ) : running ? (
            <div className="col gap-5">
              <div className="loadbar" />
              <div className="row gap-4 fs-sm sec">
                <Icon name="spinner" size={14} />
                正在合并并运行集成后的检查…
              </div>
            </div>
          ) : (
            <>
              <div
                className={`banner ${integ.status === 'succeeded' ? '' : 'banner--bad'}`}
                style={
                  integ.status === 'succeeded'
                    ? { borderColor: 'var(--st-ok-border)', background: 'var(--st-ok-bg)' }
                    : undefined
                }
              >
                <span className="banner__ico">
                  <Icon
                    name={integ.status === 'succeeded' ? 'check' : 'x'}
                    size={14}
                  />
                </span>
                <div className="banner__body">
                  <div className="banner__title">{outcomeLabel}</div>
                  <div className="sec">{integ.message}</div>
                </div>
              </div>

              {integ.mergedCommit ? (
                <div className="row gap-4 fs-sm">
                  <Icon name="branch" size={12} />
                  <span className="sec">合并提交</span>
                  <span className="mono">{integ.mergedCommit}</span>
                  <span className="dim">在 {integ.targetBranch} 上</span>
                </div>
              ) : null}

              {integ.conflictFiles.length > 0 ? (
                <Card title="冲突文件">
                  <div className="col gap-3">
                    {integ.conflictFiles.map((f) => (
                      <div key={f} className="row gap-3">
                        <Icon name="warn" size={11} />
                        <span className="mono fs-sm" style={{ color: 'var(--st-bad)' }}>
                          {f}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="fs-sm sec mt-5" style={{ lineHeight: 'var(--lh-body)' }}>
                    没有一个冲突被自动解决 —— 自动解决冲突正是本版明确不做的事情之一。
                    可以把这些文件交回模型处理，但它的解决方案同样需要你过一眼。
                  </p>
                </Card>
              ) : null}

              {integ.checks.length > 0 ? (
                <Card flush>
                  <header className="card__head">
                    <span className="card__title">集成后的检查</span>
                    <span className="grow" />
                    <span className="fs-xs dim">这一批检查属于集成，不属于本轮运行</span>
                  </header>
                  <CheckList checks={integ.checks} />
                </Card>
              ) : null}

              {integ.finishedAtMs ? (
                <div className="fs-xs dim">完成于 {stamp(integ.finishedAtMs)}</div>
              ) : null}

              {integ.status !== 'succeeded' ? (
                <div className="banner banner--warn">
                  <span className="banner__ico">
                    <Icon name="info" size={13} />
                  </span>
                  <div className="banner__body">
                    集成失败不会撤销你已经做的「接受」决定 —— 结果是保留的，
                    只是还没有干净地进入目标分支。修正后可以再集成一次。
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>

        <footer className="modal__foot">
          {integ.status === 'idle' ? (
            <>
              <Btn
                variant="primary"
                icon="arrowRight"
                onClick={() => dispatch({ type: 'integrate', taskId: task.id })}
              >
                执行集成
              </Btn>
              <span className="fs-xs dim">集成不推送、不部署</span>
            </>
          ) : running ? (
            <span className="fs-xs dim">执行中…</span>
          ) : (
            <>
              {integ.status !== 'succeeded' ? (
                <Btn
                  variant="primary"
                  icon="refresh"
                  onClick={() => dispatch({ type: 'integrate', taskId: task.id })}
                >
                  重新集成
                </Btn>
              ) : null}
              <Btn icon="check" onClick={onClose}>
                关闭
              </Btn>
            </>
          )}
          <span className="modal__foot-spacer" />
          {integ.status === 'succeeded' ? (
            <span className="fs-xs" style={{ color: 'var(--st-wait)' }}>
              <Icon name="warn" size={11} /> 集成完成 ≠ 已验收
            </span>
          ) : null}
        </footer>
      </div>
    </div>
  );
}

/** 只改演示结局的选择项 */
export function DemoOutcomePicker({ dispatch }: { dispatch: Dispatch<Action> }) {
  const [current, setCurrent] = useState<'succeeded' | 'conflict' | 'checkFailed'>(
    'succeeded',
  );
  return (
    <Card title="演示：选择集成的结果">
      <p className="fs-xs dim mb-5">
        真实集成结果由 Git 与检查决定。演示模式让你手动选择要走哪条路径，
        三条路径都要能被检查到。
      </p>
      <div className="col gap-3">
        {(
          [
            {
              value: 'succeeded',
              label: '集成成功',
              desc: '合并完成，集成后的检查通过（Linux CI 仍显示未运行）。',
            },
            {
              value: 'conflict',
              label: '合并冲突',
              desc: '目标分支上有冲突改动，合并停止且不产生合并提交。',
            },
            {
              value: 'checkFailed',
              label: '集成后检查失败',
              desc: '合并提交已产生，但类型检查失败 —— 变更已在目标分支上。',
            },
          ] as const
        ).map((o) => (
          <button
            key={o.value}
            type="button"
            className="option"
            aria-pressed={current === o.value}
            onClick={() => {
              setCurrent(o.value);
              dispatch({ type: 'setIntegrateOutcome', value: o.value });
            }}
          >
            <span
              aria-hidden
              style={{
                width: 13,
                height: 13,
                borderRadius: 999,
                border: `1.5px solid ${current === o.value ? 'var(--accent)' : 'var(--border-strong)'}`,
                marginTop: 3,
                flex: 'none',
                background: current === o.value ? 'var(--accent)' : 'transparent',
              }}
            />
            <span style={{ minWidth: 0 }}>
              <div className="option__label">{o.label}</div>
              <div className="option__desc">{o.desc}</div>
            </span>
          </button>
        ))}
      </div>
    </Card>
  );
}

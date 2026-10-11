import { useState, type Dispatch } from 'react';
import type { Task } from '../domain/types.ts';
import type { Action } from '../state/store.ts';
import { Icon } from './Icons.tsx';
import { Btn, Card, Empty, PathText } from './primitives.tsx';
import { DiffList, FileTable } from './DiffView.tsx';
import { InstructBox } from './TimelineView.tsx';
import { CheckList } from './CheckList.tsx';
import { num } from '../lib/format.ts';

/* ─────────────────────────────────────────────────────────────
   变更与检查视图
   这是「接受还是继续改」的决策现场，所以三件事必须同屏可及：
   改了什么（diff）、验证了什么（检查）、还差什么（未运行）。
   ───────────────────────────────────────────────────────────── */

export function ChangesView({
  task,
  dispatch,
}: {
  task: Task;
  dispatch: Dispatch<Action>;
}) {
  const [mode, setMode] = useState<'list' | 'tree' | 'checks'>('list');
  const [focusPath, setFocusPath] = useState<string | null>(null);
  const changes = task.changes;
  const files = changes?.files ?? [];
  const run = task.runs.at(-1);

  const notRun = task.runs
    .flatMap((r) => r.outcome?.checks ?? [])
    .concat(task.integration.checks)
    .filter((c) => c.status === 'notRun').length;

  if (!changes || files.length === 0) {
    return (
      <div className="pad-6">
        <Empty
          title={run ? '本轮没有文件改动' : '还没有变更记录'}
          desc={
            run
              ? '这次运行只产生了消息和命令，没有写入文件。如果你期望有改动，可以在时间线里检查是否被中止或失败。'
              : '启动一次运行后，这里会显示修改的文件、逐行差异与检查结果。'
          }
        />
      </div>
    );
  }

  const add = files.reduce((n, f) => n + f.additions, 0);
  const del = files.reduce((n, f) => n + f.deletions, 0);

  return (
    <div className="pad-6 col gap-6">
      {/* 概览 */}
      <div className="row row--wrap gap-5 fs-sm">
        <span className="row gap-2">
          <Icon name="diff" size={12} />
          <strong>{num(files.length)}</strong> 个文件
        </span>
        <span className="stat stat--add">+{num(add)} 行</span>
        <span className="stat stat--del">−{num(del)} 行</span>
        <span className="dim">|</span>
        <span className="row gap-2 dim" style={{ minWidth: 0 }}>
          <Icon name="branch" size={11} />
          <span className="mono truncate" title={changes.branch}>
            {changes.branch}
          </span>
        </span>
        <span className="dim">base</span>
        <span className="mono dim">{changes.baseRef}</span>
        <span className="grow" />
        {notRun > 0 ? (
          <button
            type="button"
            className="chip chip--idle"
            style={{ cursor: 'pointer' }}
            onClick={() => setMode('checks')}
            title="跳转到检查视图"
          >
            <Icon name="warn" size={10} />
            {notRun} 项检查未运行
          </button>
        ) : null}
      </div>

      {/* 视图切换 */}
      <div className="row gap-3">
        <Btn
          size="sm"
          variant={mode === 'list' ? 'default' : 'ghost'}
          icon="diff"
          onClick={() => setMode('list')}
        >
          逐行差异
        </Btn>
        <Btn
          size="sm"
          variant={mode === 'tree' ? 'default' : 'ghost'}
          icon="file"
          onClick={() => setMode('tree')}
        >
          文件列表
        </Btn>
        <Btn
          size="sm"
          variant={mode === 'checks' ? 'default' : 'ghost'}
          icon="check"
          onClick={() => setMode('checks')}
        >
          检查结果
        </Btn>
      </div>

      {mode === 'list' ? (
        <DiffList files={files} autoOpen={2} />
      ) : mode === 'tree' ? (
        <Card flush>
          <FileTable
            files={files}
            onPick={(p) => {
              setFocusPath(p);
              setMode('list');
              // 滚动到对应 diff：用 id 锚点，保持无副作用
              window.requestAnimationFrame(() => {
                document
                  .querySelector(`[data-diff="${CSS.escape(p)}"]`)
                  ?.scrollIntoView({ block: 'start' });
              });
            }}
          />
          {focusPath ? (
            <div
              className="fs-xs"
              style={{ padding: 'var(--sp-4) var(--sp-6)', color: 'var(--text-muted)' }}
            >
              已定位到 <span className="mono">{focusPath}</span>
            </div>
          ) : null}
        </Card>
      ) : (
        <Card flush>
          <CheckList checks={allChecksOf(task)} />
        </Card>
      )}

      {/* 修改意见入口 */}
      {task.status === 'inReview' ? (
        <Card title="提出修改意见">
          <p className="fs-sm sec mb-5" style={{ lineHeight: 'var(--lh-body)' }}>
            意见会作为同一次运行的补充指令发出。它不会创建新的运行，也不会自动重跑检查 ——
            改完之后需要重新查看这里的 diff 与检查结果。
          </p>
          <InstructBox task={task} dispatch={dispatch} />
        </Card>
      ) : null}
    </div>
  );
}

function allChecksOf(task: Task) {
  const out = task.runs.flatMap((r) => r.outcome?.checks ?? []);
  return [...out, ...task.integration.checks];
}

/* ─────────────────────────────────────────────────────────────
   检查视图（独立标签页）
   ───────────────────────────────────────────────────────────── */

export function ChecksView({
  task,
}: {
  task: Task;
  dispatch: Dispatch<Action>;
}) {
  const checks = allChecksOf(task);
  const run = task.runs.at(-1);

  return (
    <div className="pad-6 col gap-6">
      <Card flush>
        <header className="card__head">
          <span className="card__title">检查证据</span>
          <span className="grow" />
          <span className="fs-xs dim">
            每项检查展示真实命令、退出结果与输出；未运行的检查显式标注「未运行」。
          </span>
        </header>
        <CheckList checks={checks} />
      </Card>

      {/* 集成后的检查单独成组：它们属于集成，不属于本轮运行 */}
      {task.integration.checks.length > 0 ? (
        <Card flush>
          <header className="card__head">
            <span className="card__title">集成后的检查</span>
            <span className="grow" />
            <span className="fs-xs dim">
              这些检查在执行集成之后运行，与「本轮运行」的检查是两批证据。
            </span>
          </header>
          <CheckList checks={task.integration.checks} />
        </Card>
      ) : null}

      {run?.outcome ? (
        <Card title="本轮结果摘要">
          <p className="sec mb-5" style={{ lineHeight: 'var(--lh-body)' }}>
            {run.outcome.summary}
          </p>
          <div className="row row--wrap gap-5 fs-sm">
            <span>
              <strong>{run.outcome.changedFiles}</strong> 个文件变更
            </span>
            <span className="stat stat--add">+{run.outcome.additions}</span>
            <span className="stat stat--del">−{run.outcome.deletions}</span>
          </div>
          <div className="mt-5 fs-xs dim" style={{ minWidth: 0 }}>
            <PathText path={task.workspace.worktreePath} full />
          </div>
        </Card>
      ) : null}
    </div>
  );
}

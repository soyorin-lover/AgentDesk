import type { Task } from '../domain/types.ts';
import { TASK_STATUS } from '../domain/status.ts';
import { Icon } from './Icons.tsx';
import { BlockChip, RunStatusChip, TaskStatusChip } from './StatusChips.tsx';
import { Assumption, Btn, PathText } from './primitives.tsx';
import { relTime } from '../lib/format.ts';
import type { Dispatch } from 'react';
import type { Action } from '../state/store.ts';

/* ─────────────────────────────────────────────────────────────
   任务头部
   信息优先级：标题 → 两条状态（任务/运行）+ 阻塞 → 目标 →
   验收条件（折叠）→ 工作区与基准。
   ───────────────────────────────────────────────────────────── */

export function TaskHeader({
  task,
  now,
  onOpenChanges,
}: {
  task: Task;
  now: number;
  dispatch: Dispatch<Action>;
  onOpenChanges: () => void;
}) {
  const met = task.acceptance.filter((a) => a.met === true).length;
  const failed = task.acceptance.filter((a) => a.met === false).length;
  const unknown = task.acceptance.filter((a) => a.met === null).length;
  const run = task.runs.at(-1);

  return (
    <header className="taskhead">
      <div className="taskhead__top">
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row gap-3 mb-3">
            <span className="task-item__id">{task.ref}</span>
            <span className="fs-xs dim">{relTime(task.updatedAtMs, now)}更新</span>
            {task.demo ? (
              <span className="chip chip--demo" title="演示数据，非真实 Codex 执行结果">
                演示
              </span>
            ) : null}
            <span className="grow" />
          </div>

          <h1 className="taskhead__title">{task.title}</h1>

          {/* 两条状态维度并排，但视觉上可区分 */}
          <div className="taskhead__chips">
            <TaskStatusChip status={task.status} />
            <RunStatusChip status={run?.status ?? null} />
            {task.block ? <BlockChip block={task.block} /> : null}
          </div>
        </div>

        <div className="row gap-3" style={{ flex: 'none' }}>
          <Btn size="sm" icon="diff" onClick={onOpenChanges}>
            变更
          </Btn>
        </div>
      </div>

      {task.goal ? (
        <p className="taskhead__goal">{task.goal}</p>
      ) : (
        <p className="taskhead__goal" style={{ color: 'var(--st-wait)' }}>
          <Icon name="warn" size={12} /> 这个任务还没有写目标。没有明确目标就无法判断什么算完成。
        </p>
      )}

      {task.acceptance.length > 0 ? (
        <details className="accept" open={task.acceptance.length <= 5}>
          <summary className="accept__summary">
            验收条件 · {task.acceptance.length} 条
            <span className="grow" />
            {met > 0 ? <span className="stat stat--add">{met} 已满足</span> : null}
            {failed > 0 ? <span className="stat stat--del">{failed} 未满足</span> : null}
            {unknown > 0 ? <span className="fs-xs dim">{unknown} 未判定</span> : null}
          </summary>
          <ul className="accept__list">
            {task.acceptance.map((a) => (
              <li key={a.id} className="accept__item">
                <span
                  className={`accept__mark ${
                    a.met === true ? 'accept__mark--ok' : a.met === false ? 'accept__mark--no' : 'accept__mark--unk'
                  }`}
                  title={
                    a.met === true
                      ? '已满足'
                      : a.met === false
                        ? '未满足'
                        : '未判定 —— 尚无证据'
                  }
                >
                  <Icon name={a.met === true ? 'check' : a.met === false ? 'x' : 'clock'} size={12} />
                </span>
                <span className="grow">{a.text}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : (
        <div className="accept">
          <div className="accept__summary" style={{ cursor: 'default', color: 'var(--st-wait)' }}>
            <Icon name="warn" size={12} />
            没有验收条件。草稿状态无法启动运行 —— 先想清楚「怎么算做完」。
          </div>
        </div>
      )}

      {/* 工作区与环境 */}
      <div className="row row--wrap gap-5 mt-5 fs-xs">
        <span className="row gap-2" style={{ minWidth: 0 }}>
          <Icon name="branch" size={11} />
          <span className="mono sec truncate" title={task.workspace.branch || '（尚未创建）'}>
            {task.workspace.branch || '（尚未创建工作区）'}
          </span>
        </span>
        <span className="row gap-2" style={{ minWidth: 0 }}>
          <Icon name="folder" size={11} />
          {task.workspace.worktreePath ? (
            <PathText path={task.workspace.worktreePath} tail={2} />
          ) : (
            <span className="dim">启动运行时会创建隔离工作区</span>
          )}
        </span>
        {task.workspace.uncommitted > 0 ? (
          <span className="chip chip--plain-dim" title="工作区中尚未提交的改动数">
            {task.workspace.uncommitted} 个未提交改动
          </span>
        ) : null}
        <span className="grow" />
        <Assumption of="并行工作区隔离" />
      </div>

      {/* 阻塞详情：单独一行，不与状态混在一起 */}
      {task.block ? (
        <div className="banner banner--warn mt-5">
          <span className="banner__ico">
            <Icon name="warn" size={13} />
          </span>
          <div className="banner__body">
            <div className="banner__title">阻塞原因（与上面的状态是两个维度）</div>
            <div className="sec">{task.block.summary}</div>
          </div>
        </div>
      ) : null}

      {/* 失败任务的额外说明 */}
      {run?.status === 'failed' ? (
        <div className="banner banner--bad mt-5">
          <span className="banner__ico">
            <Icon name="x" size={13} />
          </span>
          <div className="banner__body">
            <div className="banner__title">本轮失败，但结果仍然保留</div>
            <div className="sec">
              失败前的文件改动都还在工作区里。可以在下方查看它们，
              也可以选择恢复会话、补充指令或重新执行 —— 这三个操作含义不同。
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}

export { TASK_STATUS };

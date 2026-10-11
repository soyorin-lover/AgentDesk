import { useEffect, useRef, useState } from 'react';
import type { Task } from '../domain/types.ts';
import type { Action } from '../state/store.ts';
import type { Dispatch } from 'react';
import { Timeline, TurnDivider } from './Timeline.tsx';
import { Icon } from './Icons.tsx';
import { Btn } from './primitives.tsx';

/* ─────────────────────────────────────────────────────────────
   时间线视图
   负责：把多次运行按轮次分段；把「本轮结论」固定在下方；
   提供补充指令入口（同一运行内，不新建运行）。
   ───────────────────────────────────────────────────────────── */

export function TimelineView({
  task,
  now,
  dispatch,
  streaming,
}: {
  task: Task;
  now: number;
  dispatch: Dispatch<Action>;
  streaming: boolean;
}) {
  const run = task.runs.at(-1) ?? null;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);

  /* 流式推进时自动跟随到底部；用户手动上滚则停止跟随 */
  useEffect(() => {
    if (!follow) return;
    const el = scrollRef.current?.querySelector('.main__scroll');
    if (el) el.scrollTop = el.scrollHeight;
  }, [run?.events.length, follow, streaming]);

  if (!run) {
    return (
      <div className="empty">
        <Icon name="play" size={22} />
        <div className="empty__title">
          {task.status === 'draft' ? '任务还是草稿' : '还没有运行记录'}
        </div>
        <div className="empty__desc">
          {task.status === 'draft'
            ? '补齐目标与验收条件后即可启动运行。没有验收条件的话，「完成」就没有判据。'
            : '启动一次运行后，这里会显示 Codex 的消息、命令与文件变更。'}
        </div>
        <Btn
          variant="primary"
          icon="play"
          disabled={task.status === 'draft'}
          onClick={() => dispatch({ type: 'startRun', taskId: task.id })}
        >
          启动运行
        </Btn>
      </div>
    );
  }

  const events = [...run.events].sort((a, b) => a.atMs - b.atMs);
  void events; // 单轮运行的事件直接交给 Timeline 渲染，这里只用于长度判断

  return (
    <div ref={scrollRef} style={{ display: 'contents' }}>
      <div className="timeline">
        {task.runs.map((r, i) => (
          <div key={r.id}>
            <TurnDivider
              index={r.index}
              model={r.model}
              baseCommit={r.baseCommit}
              atMs={r.startedAtMs}
              now={now}
              extra={
                i === task.runs.length - 1 ? null : (
                  <span className="chip chip--plain-dim">历史运行</span>
                )
              }
            />
            <Timeline
              events={[...r.events].sort((a, b) => a.atMs - b.atMs)}
              now={now}
              dispatch={dispatch}
              taskId={task.id}
              canInteract={i === task.runs.length - 1}
            />
          </div>
        ))}
      </div>

      {/* 运行中的控制条 */}
      {task.latestRunStatus === 'running' && !task.block ? (
        <div
          className="row gap-4"
          style={{
            padding: 'var(--sp-5) var(--sp-6)',
            borderTop: '1px solid var(--border)',
            background: 'var(--bg-panel)',
          }}
        >
          <span className="row gap-3 fs-sm" style={{ color: 'var(--st-active)' }}>
            <span className="pulse" />
            运行中
          </span>
          <span className="fs-xs dim">
            <Icon name="info" size={11} /> 关闭页面不会取消这次运行。
          </span>
          <span className="grow" />
          <label className="row gap-2 fs-xs sec" style={{ cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={follow}
              onChange={(e) => setFollow(e.target.checked)}
            />
            自动跟随
          </label>
          <Btn
            size="sm"
            variant="danger"
            icon="stop"
            onClick={() =>
              dispatch({ type: 'interrupt', taskId: task.id, runId: run.id })
            }
          >
            中止本轮
          </Btn>
        </div>
      ) : null}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   补充指令输入框（同一运行内继续）
   ───────────────────────────────────────────────────────────── */

export function InstructBox({
  task,
  dispatch,
  disabled,
  disabledReason,
  seed,
}: {
  task: Task;
  dispatch: Dispatch<Action>;
  disabled?: boolean;
  disabledReason?: string;
  seed?: string;
}) {
  const [text, setText] = useState(seed ?? '');

  useEffect(() => {
    if (seed !== undefined) setText(seed);
  }, [seed]);

  if (disabled) {
    return (
      <div className="banner mt-5" style={{ background: 'var(--bg-panel)' }}>
        <span className="banner__ico">
          <Icon name="lock" size={13} />
        </span>
        <div className="banner__body sec">{disabledReason}</div>
      </div>
    );
  }

  return (
    <div className="col gap-4 mt-5">
      <textarea
        className="textarea"
        placeholder="在同一会话里补充指令，例如：把 upsert 的批量粒度改回逐条，并说明为什么。"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        aria-label="补充指令"
      />
      <div className="row gap-4">
        <Btn
          variant="primary"
          icon="arrowRight"
          disabled={text.trim().length === 0}
          onClick={() => {
            dispatch({ type: 'requestChanges', taskId: task.id, text: text.trim() });
            setText('');
          }}
        >
          发送补充指令
        </Btn>
        <span className="fs-xs dim">
          这会记入同一次运行，不会产生新的运行记录。补充指令不保证模型一定照做。
        </span>
      </div>
    </div>
  );
}

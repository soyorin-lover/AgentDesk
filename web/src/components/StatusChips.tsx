import type { BlockReason, RunStatus, TaskStatus } from '../domain/types.ts';
import { BLOCK_REASON, RUN_STATUS, TASK_STATUS, toneClass } from '../domain/status.ts';
import { Icon } from './Icons.tsx';

/**
 * 任务状态与运行状态是两条时间轴，芯片样式刻意不同：
 * 任务状态用圆角实心芯片，运行状态用方角描边芯片，
 * 即使在灰度打印下也能区分，避免读者把两者当成同一个状态。
 */

export function TaskStatusChip({ status }: { status: TaskStatus }) {
  const s = TASK_STATUS[status];
  return (
    <span className={`chip ${toneClass(s.tone)}`} title={s.meaning}>
      {s.label}
    </span>
  );
}

export function RunStatusChip({ status }: { status: RunStatus | null }) {
  if (!status) {
    return (
      <span className="chip chip--plain-dim" title="还没有任何运行记录">
        无运行
      </span>
    );
  }
  const s = RUN_STATUS[status];
  return (
    <span
      className={`chip ${toneClass(s.tone)}`}
      title={s.meaning}
      style={{ borderRadius: 'var(--r-sm)' }}
    >
      {s.live ? <span className="pulse" aria-hidden /> : null}
      运行 · {s.label}
    </span>
  );
}

export function BlockChip({
  block,
  onClick,
}: {
  block: BlockReason;
  onClick?: () => void;
}) {
  const b = BLOCK_REASON[block.kind];
  const content = (
    <>
      <Icon name="warn" size={11} />
      {b.label}
    </>
  );
  const cls = `chip ${toneClass(b.tone)}`;
  return onClick ? (
    <button
      type="button"
      className={cls}
      title={block.summary}
      onClick={onClick}
      style={{ cursor: 'pointer' }}
    >
      {content}
    </button>
  ) : (
    <span className={cls} title={block.summary}>
      {content}
    </span>
  );
}

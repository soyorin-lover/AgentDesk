import type { Dispatch } from 'react';
import type { Task } from '../domain/types.ts';
import type { Action } from '../state/store.ts';
import { Icon, type IconName } from './Icons.tsx';
import { Btn } from './primitives.tsx';
import { BlockChip, RunStatusChip, TaskStatusChip } from './StatusChips.tsx';
import { relTime } from '../lib/format.ts';

/* ─────────────────────────────────────────────────────────────
   右栏：待处理队列
   目的很单一：让用户一眼看出「现在需要我做什么」。
   每个条目都说明：哪个任务、为什么需要你、点击后跳到哪。
   ───────────────────────────────────────────────────────────── */

interface Item {
  task: Task;
  kind: 'question' | 'approval' | 'review' | 'failed' | 'conflict' | 'checkFailed' | 'accepted' | 'draft' | 'none';
  title: string;
  why: string;
  cta: string;
}

const KIND_META: Record<
  Item['kind'],
  { label: string; tone: string; icon: IconName }
> = {
  question: { label: '等待回答', tone: 'wait', icon: 'question' },
  approval: { label: '等待审批', tone: 'active', icon: 'shield' },
  review: { label: '等待审查', tone: 'review', icon: 'diff' },
  failed: { label: '执行失败', tone: 'bad', icon: 'x' },
  conflict: { label: '合并冲突', tone: 'bad', icon: 'warn' },
  checkFailed: { label: '检查失败', tone: 'bad', icon: 'warn' },
  accepted: { label: '待集成', tone: 'ok', icon: 'arrowRight' },
  draft: { label: '草稿待补全', tone: 'idle', icon: 'file' },
  none: { label: '无', tone: 'idle', icon: 'info' },
};

function collect(tasks: Task[]): Item[] {
  const items: Item[] = [];

  for (const task of tasks) {
    const run = task.runs.at(-1);

    if (task.block?.kind === 'question') {
      items.push({
        task,
        kind: 'question',
        title: task.title,
        why: task.block.summary,
        cta: '去回答',
      });
      continue;
    }
    if (task.block?.kind === 'approval') {
      items.push({
        task,
        kind: 'approval',
        title: task.title,
        why: task.block.summary,
        cta: '去处理',
      });
      continue;
    }
    if (task.block?.kind === 'mergeConflict') {
      items.push({
        task,
        kind: 'conflict',
        title: task.title,
        why: task.block.summary,
        cta: '查看集成结果',
      });
      continue;
    }
    if (task.block?.kind === 'checkFailed') {
      items.push({
        task,
        kind: 'checkFailed',
        title: task.title,
        why: task.block.summary,
        cta: '查看检查',
      });
      continue;
    }

    // 同一任务上可能同时有提问与审批。
    // 用局部变量记录已收录的类型，而不是从 task.block 反推 ——
    // task.block 只记录一个原因，但一个任务可能同时有提问和审批两件待办。
    const collected = new Set(items.filter((i) => i.task.id === task.id).map((i) => i.kind));
    if (run) {
      const hasApproval = run.events.some(
        (e) => e.kind === 'approval' && e.state.kind === 'pending',
      );
      const hasQuestion = run.events.some(
        (e) => e.kind === 'question' && e.resolution === null,
      );
      if (hasApproval && !collected.has('question') && !collected.has('approval')) {
        items.push({
          task,
          kind: 'approval',
          title: task.title,
          why: '有操作请求等待你批准或拒绝',
          cta: '去处理',
        });
      }
      if (hasQuestion && !collected.has('question') && !collected.has('approval')) {
        items.push({
          task,
          kind: 'question',
          title: task.title,
          why: '模型在等你回答一个问题',
          cta: '去回答',
        });
      }
    }

    if (run?.status === 'failed' && !collected.has('failed')) {
      items.push({
        task,
        kind: 'failed',
        title: task.title,
        why: '本轮以失败结束，结果已保留，需要决定下一步',
        cta: '查看后续入口',
      });
      continue;
    }

    if (task.status === 'inReview' && run?.status === 'succeeded') {
      items.push({
        task,
        kind: 'review',
        title: task.title,
        why: '运行已结束，等待你查看变更与检查结果',
        cta: '去审查',
      });
      continue;
    }

    if (task.status === 'accepted') {
      items.push({
        task,
        kind: 'accepted',
        title: task.title,
        why: '结果已接受，但代码还没有集成到目标分支',
        cta: '去集成',
      });
      continue;
    }

    if (task.status === 'draft') {
      items.push({
        task,
        kind: 'draft',
        title: task.title,
        why: '缺少目标或验收条件，补齐后才能启动运行',
        cta: '去补全',
      });
    }
  }

  // 提问/审批排最前，其余按更新时间
  const rank: Record<Item['kind'], number> = {
    question: 0,
    approval: 1,
    conflict: 2,
    checkFailed: 3,
    failed: 4,
    review: 5,
    accepted: 6,
    draft: 7,
    none: 9,
  };
  return items.sort(
    (a, b) => rank[a.kind] - rank[b.kind] || b.task.updatedAtMs - a.task.updatedAtMs,
  );
}

export function PendingPanel({
  tasks,
  selectedId,
  now,
  dispatch,
  onJump,
}: {
  tasks: Task[];
  selectedId: string;
  now: number;
  dispatch: Dispatch<Action>;
  onJump: (taskId: string, where: 'timeline' | 'changes' | 'checks') => void;
}) {
  const items = collect(tasks);

  return (
    <aside className="pending" aria-label="待处理">
      <header className="pending__head">
        <Icon name="dot" size={11} />
        <span>待处理</span>
        <span className="chip chip--plain-dim">{items.length}</span>
        <span className="grow" />
        <span className="fs-xs" style={{ textTransform: 'none', letterSpacing: 0 }}>
          按紧急度排序
        </span>
      </header>

      <div className="pending__scroll">
        {items.length === 0 ? (
          <div className="empty">
            <Icon name="check" size={20} />
            <div className="empty__title">没有待处理事项</div>
            <div className="empty__desc">
              所有运行都不需要你介入。可以创建新任务，或查看已完成任务的记录。
            </div>
          </div>
        ) : (
          items.map((it, i) => {
            const meta = KIND_META[it.kind];
            const selected = it.task.id === selectedId;
            return (
              <div
                key={`${it.task.id}-${it.kind}-${i}`}
                className={`attention ${it.kind === 'approval' ? 'attention--approval' : it.kind === 'question' ? 'attention--input' : ''}`}
                style={selected ? { boxShadow: '0 0 0 1px var(--accent-border)' } : undefined}
              >
                <div className="attention__head" style={{ paddingBottom: 'var(--sp-4)' }}>
                  <div className="row gap-3" style={{ minWidth: 0 }}>
                    <span
                      className={`chip chip--${meta.tone}`}
                      style={{ height: 19, borderRadius: 'var(--r-sm)' }}
                    >
                      <Icon name={meta.icon} size={10} />
                      {meta.label}
                    </span>
                    <span className="grow" />
                    <span className="fs-xs dim nowrap">
                      {relTime(it.task.updatedAtMs, now)}
                    </span>
                  </div>

                  <div className="row gap-3" style={{ minWidth: 0 }}>
                    <span className="task-item__id nowrap">{it.task.ref}</span>
                    <span className="fs-sm fw-6 truncate" title={it.title}>
                      {it.title}
                    </span>
                  </div>

                  <div className="fs-xs sec" style={{ lineHeight: 'var(--lh-body)' }}>
                    {it.why}
                  </div>

                  <div className="row gap-3">
                    <TaskStatusChip status={it.task.status} />
                    <RunStatusChip status={it.task.runs.at(-1)?.status ?? null} />
                    {it.task.block ? <BlockChip block={it.task.block} /> : null}
                  </div>
                </div>

                <div className="attention__foot" style={{ padding: 'var(--sp-4) var(--sp-5)' }}>
                  <Btn
                    size="sm"
                    variant={meta.tone === 'wait' || meta.tone === 'active' ? 'primary' : 'default'}
                    icon="arrowRight"
                    onClick={() => {
                      dispatch({ type: 'selectTask', taskId: it.task.id });
                      onJump(
                        it.task.id,
                        it.kind === 'review'
                          ? 'changes'
                          : it.kind === 'conflict' || it.kind === 'checkFailed'
                            ? 'checks'
                            : 'timeline',
                      );
                    }}
                  >
                    {it.cta}
                  </Btn>
                  {selected ? (
                    <span className="fs-xs dim">当前任务</span>
                  ) : (
                    <span className="fs-xs dim">点击会切换到该任务</span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}

export { collect };

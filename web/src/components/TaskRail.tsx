import type { Task } from '../domain/types.ts';
import { RUN_STATUS } from '../domain/status.ts';
import { Icon } from './Icons.tsx';
import { RunStatusChip, TaskStatusChip } from './StatusChips.tsx';
import { relTime, num } from '../lib/format.ts';

/* ─────────────────────────────────────────────────────────────
   左栏：项目 + 任务列表
   排序：需要用户处理的排前面，其余按最近更新。
   ───────────────────────────────────────────────────────────── */

type Group = {
  key: string;
  label: string;
  attention: boolean;
  tasks: Task[];
};

function group(tasks: Task[]): Group[] {
  const attn: Task[] = [];
  const active: Task[] = [];
  const waiting: Task[] = [];
  const closed: Task[] = [];

  for (const t of tasks) {
    if (t.block || t.status === 'inReview' || t.status === 'draft' || t.status === 'accepted') {
      attn.push(t);
    } else if (t.status === 'inProgress') {
      active.push(t);
    } else if (t.status === 'ready') {
      waiting.push(t);
    } else {
      closed.push(t);
    }
  }

  return [
    { key: 'attn', label: '需要你处理', attention: true, tasks: attn },
    { key: 'active', label: '进行中', attention: false, tasks: active },
    { key: 'ready', label: '待启动', attention: false, tasks: waiting },
    {
      key: 'closed',
      label: '已交付',
      attention: false,
      tasks: closed.sort((a, b) => b.updatedAtMs - a.updatedAtMs),
    },
  ].filter((g) => g.tasks.length > 0);
}

/** 为什么这个任务出现在「需要你处理」里 —— 一行说明 */
function whyAttention(t: Task): string {
  if (t.block) return t.block.summary;
  switch (t.status) {
    case 'inReview':
      return t.latestRunStatus === 'failed'
        ? '运行失败，查看保留的结果与后续入口'
        : '运行结束，等待查看变更与检查';
    case 'draft':
      return '草稿：补齐目标与验收条件后才能启动';
    case 'accepted':
      return '结果已接受，代码尚未集成';
    default:
      return '';
  }
}

function TaskRow({
  task,
  selected,
  now,
  onSelect,
}: {
  task: Task;
  selected: boolean;
  now: number;
  onSelect: () => void;
}) {
  const needs = Boolean(task.block) || ['inReview', 'draft', 'accepted'].includes(task.status);
  const run = task.runs.at(-1);

  return (
    <button
      type="button"
      className={`task-item ${needs ? 'task-item--attn' : ''}`}
      aria-current={selected}
      onClick={onSelect}
    >
      <div className="task-item__title">{task.title}</div>

      <div className="task-item__meta">
        <span className="task-item__id">{task.ref}</span>
        <TaskStatusChip status={task.status} />
        {run ? <RunStatusChip status={run.status} /> : null}
        <span className="grow" />
        <span className="fs-xs dim nowrap">{relTime(task.updatedAtMs, now)}</span>
      </div>

      {needs && whyAttention(task) ? (
        <div
          className="fs-xs mt-3"
          style={{
            color: 'var(--st-wait)',
            lineHeight: 'var(--lh-body)',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {whyAttention(task)}
        </div>
      ) : null}
    </button>
  );
}

export function TaskRail({
  project,
  tasks,
  selectedId,
  now,
  onSelect,
  onCreate,
}: {
  project: { name: string; repoPath: string; branch: string; env: Task['workspace']['env'] };
  tasks: Task[];
  selectedId: string;
  now: number;
  onSelect: (id: string) => void;
  onCreate: () => void;
}) {
  const groups = group(tasks);
  const attnCount = groups.find((g) => g.key === 'attn')?.tasks.length ?? 0;

  return (
    <nav className="rail" aria-label="任务列表">
      {/* 项目与环境 */}
      <div className="rail__project">
        <div className="row gap-3">
          <Icon name="folder" size={13} />
          <span className="fw-6 truncate" title={project.repoPath}>
            {project.name}
          </span>
          <span className="grow" />
          <span className="chip chip--plain-dim" title="当前分支">
            <Icon name="branch" size={10} />
            {project.branch}
          </span>
        </div>

        <div className="row gap-3 mt-3 fs-xs dim" style={{ minWidth: 0 }}>
          <span className="truncate mono" title={project.repoPath}>
            {project.repoPath}
          </span>
        </div>

        <div className="row gap-3 mt-3 fs-xs">
          <EnvDot ok={project.env.connection === 'connected'} />
          <span className="dim">Codex {project.env.codexVersion}</span>
          <span className="dim">·</span>
          <span className="dim">{project.env.os}</span>
          <span className="grow" />
          <span className="dim" title="本批只在 Windows 上验证过初始化握手，Linux 未实测">
            Linux 未验证
          </span>
        </div>

        <div className="row gap-3 mt-5">
          <button type="button" className="btn btn--primary btn--sm grow" onClick={onCreate}>
            <Icon name="plus" size={12} />
            创建任务
          </button>
        </div>
      </div>

      {/* 任务分组 */}
      <div className="rail__scroll">
        {groups.map((g) => (
          <div key={g.key}>
            <div className={`rail__group-head ${g.attention ? 'rail__group-head--attn' : ''}`}>
              <span>{g.label}</span>
              <span className="chip chip--plain-dim">{num(g.tasks.length)}</span>
            </div>
            {g.tasks.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                selected={t.id === selectedId}
                now={now}
                onSelect={() => onSelect(t.id)}
              />
            ))}
          </div>
        ))}
      </div>

      {/* 底部统计 */}
      <div className="rail__foot">
        <span className="fs-xs dim">
          共 {num(tasks.length)} 个任务
          {attnCount > 0 ? ` · ${attnCount} 项待处理` : ' · 无待处理'}
        </span>
        <span className="grow" />
        <span className="chip chip--demo" title="演示模式：全部数据为构造数据">
          演示
        </span>
      </div>
    </nav>
  );
}

function EnvDot({ ok }: { ok: boolean }) {
  return (
    <span
      title={ok ? 'Codex App Server 连接正常（演示）' : '连接断开（演示）'}
      style={{
        width: 6,
        height: 6,
        borderRadius: 999,
        background: ok ? 'var(--st-ok)' : 'var(--st-bad)',
        flex: 'none',
      }}
    />
  );
}

/** 运行状态图例：状态语义是本产品的核心，值得在界面上说明一次 */
export function StatusLegend() {
  return (
    <div className="col gap-3 fs-xs sec">
      {(Object.keys(RUN_STATUS) as Array<keyof typeof RUN_STATUS>).map((k) => (
        <div key={k} className="row gap-3">
          <span className={`chip ${'chip--' + RUN_STATUS[k].tone}`} style={{ minWidth: 68, justifyContent: 'center' }}>
            {RUN_STATUS[k].label}
          </span>
          <span className="grow" style={{ lineHeight: 'var(--lh-body)' }}>
            {RUN_STATUS[k].meaning}
          </span>
        </div>
      ))}
    </div>
  );
}

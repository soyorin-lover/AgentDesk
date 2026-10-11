import { AGENTS, ENGINES, agentById, engineById } from './data.ts';
import { statusInputOf, type DemoTask } from './backend/demo.ts';
import { I, EngineMark } from './icons.tsx';
import { href, type Route } from './layout.tsx';
import { primaryStatus } from './bits.tsx';

/* 侧栏：项目切换 + 少量导航 + 当前进行的任务。
   收起时变为图标轨，待处理数用圆点提示。 */

/**
 * 待处理计数：只统计需要用户动作的事项。
 * 本批后端的可动作集合 = 结果未知 / 执行失败 / 待审查。
 */
export function inboxCount(tasks: DemoTask[]): number {
  let n = 0;
  for (const t of tasks) {
    const r = t.runs.at(-1)?.status;
    if (r === 'needs_recovery' || r === 'failed') n++;
    else if (t.status === 'in_review') n++;
  }
  return n;
}

export function Sidebar({
  route,
  rail,
  width,
  onToggle,
  tasks,
}: {
  route: Route;
  rail: boolean;
  width: number;
  onToggle: () => void;
  resolved: Set<string>;
  tasks: DemoTask[];
}) {
  const inbox = inboxCount(tasks);
  const active = tasks.filter((t) => t.status === 'in_progress');
  const cur = (p: Route['page'], id?: string) =>
    route.page === p && (!id || (route.page === 'task' && route.id === id)) ? 'page' : undefined;

  return (
    <aside className={`side ${rail ? 'side--rail' : ''}`} style={{ width }} aria-label="导航">
      <div className="side__top">
        <span className="brand">
          <span className="brand__mark">A</span>
          <span>AgentDesk</span>
        </span>
        {!rail ? <span style={{ flex: 1 }} /> : null}
        {!rail ? (
          <button className="icon-btn icon-btn--sm" onClick={onToggle} aria-label="收起导航" title="收起导航 (Ctrl+\)">
            <I n="sidebar" />
          </button>
        ) : null}
      </div>

      {rail ? (
        <button className="nav__item" onClick={onToggle} aria-label="展开导航" title="展开导航 (Ctrl+\)" style={{ marginTop: 6 }}>
          <I n="sidebar" />
        </button>
      ) : (
        <button className="proj-switch" title="切换项目">
          <I n="folder" />
          <span className="proj-switch__name">
            fin-sync
            <span className="proj-switch__sub">E:\Projects\fin-sync · main</span>
          </span>
          <I n="chevD" s={14} />
        </button>
      )}

      <nav className="nav">
        <a className="nav__item" href={href({ page: 'overview' })} aria-current={cur('overview')} title="概览">
          <I n="home" />
          <span className="txt">概览</span>
        </a>
        <a className="nav__item" href={href({ page: 'tasks' })} aria-current={cur('tasks')} title="任务">
          <I n="list" />
          <span className="txt">任务</span>
          <span className="nav__count">{tasks.length}</span>
        </a>
        <a
          className="nav__item rail-badge"
          href={href({ page: 'inbox' })}
          aria-current={cur('inbox')}
          title={`待处理 ${inbox} 项`}
          data-n={rail && inbox ? inbox : undefined}
        >
          <I n="inbox" />
          <span className="txt">待处理</span>
          {inbox ? <span className="nav__count nav__count--attn">{inbox}</span> : null}
        </a>
        <a className="nav__item" href={href({ page: 'tasks' })} title="交付">
          <I n="merge" />
          <span className="txt">交付</span>
          <span className="nav__count">1</span>
        </a>

        <div className="nav__label">进行中</div>
        {active.map((t) => {
          const a = agentById(t.agentInstanceId);
          const s = primaryStatus(statusInputOf(t));
          return (
            <a
              key={t.id}
              className="nav__item nav__task"
              href={href({ page: 'task', id: t.id, view: 'run' })}
              aria-current={cur('task', t.id)}
              title={`${t.title}\n${s.label}${a ? ` · ${engineById(a.engine).name} ${a.name}` : ''}`}
            >
              <span className={`st ${s.cls}`} style={{ width: 16, justifyContent: 'center' }} />
              <span className="txt">{t.title}</span>
            </a>
          );
        })}
      </nav>

      <div className="side__grow" />

      <div className="side__foot">
        <a className="nav__item" href={href({ page: 'agents' })} aria-current={cur('agents')} title="智能体">
          <I n="agents" />
          <span className="txt">智能体</span>
          <span className="nav__count" style={{ display: 'flex', gap: 3 }}>
            {ENGINES.map((e) => (
              <span
                key={e.id}
                title={`${e.name}${e.integrated ? `：${AGENTS.filter((x) => x.engine === e.id).length} 个实例` : '：未接入'}`}
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 9,
                  background: e.integrated ? 'var(--ok)' : 'var(--line-strong)',
                }}
              />
            ))}
          </span>
        </a>
        <a
          className="nav__item"
          href={href({ page: 'workbench' })}
          aria-current={cur('workbench') ?? cur('connect')}
          title="真实后端工作台：任务 / 工作区 / 执行 / 检查 / 接受"
        >
          <I n="terminal" />
          <span className="txt">真实工作台</span>
        </a>
        <button className="nav__item" title="设置">
          <I n="settings" />
          <span className="txt">设置</span>
        </button>
        <div className="demo-note" title="以下页面（概览 / 任务 / 待处理 / 智能体）仍为构造内容；真实链路在「真实工作台」">
          <span className="tag tag--sim" style={{ height: 18 }}>
            演示
          </span>
          <span>
            <b>演示数据</b> · 真实链路见「真实工作台」
          </span>
        </div>
      </div>
    </aside>
  );
}

export { EngineMark };

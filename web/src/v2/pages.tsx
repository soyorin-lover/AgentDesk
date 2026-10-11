import { useState } from 'react';
import { AGENTS, CODEX_CAPS, ENGINES, agentById, engineById } from './data.ts';
import type { App } from './backend/store.ts';
import { statusInputOf, type DemoTask } from './backend/demo.ts';
import { I, EngineMark, Spinner } from './icons.tsx';
import { Status, primaryStatus } from './bits.tsx';
import { href } from './layout.tsx';

function AgentLabel({ id }: { id: string | null }) {
  const a = agentById(id);
  if (!a) return <span className="meta">未分派</span>;
  const e = engineById(a.engine);
  return (
    <span className="agent-chip" title={`${e.name} · ${a.name} · ${a.model}`}>
      <EngineMark mark={e.mark} />
      {e.name} · {a.name}
    </span>
  );
}

function TaskRow({ t, app }: { t: DemoTask; app: App }) {
  const acc = app.validAcceptanceOf(t.id);
  const stale = app.invalidatedOf(t.id);
  return (
    <a className="row-item" href={href({ page: 'task', id: t.id, view: t.snapshot ? 'review' : 'run' })}>
      <span className="ref">{t.ref}</span>
      <span className="row-item__main">
        <span className="row-item__title" title={t.title} style={{ display: 'block' }}>
          {t.title}
        </span>
      </span>
      <span className="row-item__side">
        <span style={{ width: 168, display: 'flex' }}>
          <AgentLabel id={t.agentInstanceId} />
        </span>
        <span style={{ width: 168 }}>
          <Status t={statusInputOf(t)} />
          {acc ? (
            <span className="accept-badge accept-badge--valid" style={{ marginLeft: 8 }}>
              <I n="check" s={13} />
              已接受
            </span>
          ) : stale ? (
            <span className="accept-badge accept-badge--stale" style={{ marginLeft: 8 }}>
              <I n="warn" s={13} />
              接受已失效
            </span>
          ) : null}
        </span>
        <span className="meta" style={{ width: 64, textAlign: 'right' }}>
          {t.updated}
        </span>
      </span>
    </a>
  );
}

/* ── 项目概览 ─────────────────────────────────────────────── */

export function Overview({ app }: { resolved: Set<string>; app: App }) {
  const TASKS = app.tasks;
  const cont = TASKS.find((t) => t.id === 't142') ?? TASKS[0];
  const needs = TASKS.filter((t) => {
    const r = t.runs.at(-1)?.status;
    return r === 'failed' || r === 'needs_recovery' || t.status === 'in_review';
  });
  const others = TASKS.filter(
    (t) => !needs.includes(t) && t !== cont && t.status !== 'accepted',
  ).slice(0, 3);

  return (
    <div className="scroll">
      <div className="page">
        <div className="meta">项目</div>
        <h1 className="h1" style={{ marginTop: 2 }}>
          fin-sync
        </h1>
        <p className="lead">个人账单同步工具。本周重点：让增量同步可靠，减少重复写入与无限重试。</p>

        <a className="resume" href={href({ page: 'task', id: cont.id, view: 'run' })}>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span className="meta" style={{ display: 'block', marginBottom: 4 }}>
              继续上次的工作
            </span>
            <span className="resume__title" style={{ display: 'block' }}>
              {cont.title}
            </span>
            <span className="resume__now">
              <span style={{ color: 'var(--accent)' }}>
                <Spinner s={13} />
              </span>
              {cont.liveNow ?? ''}{cont.liveElapsed ? ` · 已运行 ${cont.liveElapsed}` : ''}
              <span className="meta">·</span>
              <AgentLabel id={cont.agentInstanceId} />
            </span>
          </span>
          <I n="arrowR" />
        </a>

        <div className="sec-head">
          <h2 className="h2">需要你处理</h2>
          <a className="link" href={href({ page: 'inbox' })}>
            全部待处理
          </a>
        </div>
        <div className="rows">
          {needs.map((t) => (
            <a
              key={t.id}
              className="row-item"
              href={href({ page: 'task', id: t.id, view: t.snapshot ? 'review' : 'run' })}
            >
              <span className="ref">{t.ref}</span>
              <span className="row-item__main">
                <span className="row-item__title" style={{ display: 'block' }} title={t.title}>
                  {t.title}
                </span>
                <span className="row-item__sub" style={{ display: 'block' }}>
                  {needLine(t)}
                </span>
              </span>
              <span className="row-item__side">
                <Status t={statusInputOf(t)} />
                <I n="chevR" s={14} className="meta" />
              </span>
            </a>
          ))}
        </div>

        <div className="sec-head">
          <h2 className="h2">其他任务</h2>
          <a className="link" href={href({ page: 'tasks' })}>
            查看全部 {TASKS.length} 个任务
          </a>
        </div>
        <div className="rows">
          {others.map((t) => (
            <TaskRow key={t.id} t={t} app={app} />
          ))}
        </div>

        <p className="meta" style={{ marginTop: 28 }}>
          {TASKS.filter((t) => app.validAcceptanceOf(t.id)).length} 个结果已接受（未集成、未验收）
        </p>
      </div>
    </div>
  );
}

function needLine(t: DemoTask): string {
  const r = t.runs.at(-1);
  if (r?.status === 'running') return `执行中 · ${t.liveNow ?? ''}`;
  if (r?.status === 'failed') return r.outcomeReason ?? '运行失败，改动保留在工作区';
  if (r?.status === 'needs_recovery') return '结果未知，需要人工恢复；本批没有恢复接口';
  if (t.status === 'in_review') return `${t.snapshot?.files.length ?? 0} 个文件变更 · 检查未运行`;
  return '';
}

/* ── 任务列表 ─────────────────────────────────────────────── */

const FILTERS = [
  {
    id: 'active',
    label: '进行中',
    f: (t: DemoTask) => ['draft', 'ready', 'in_progress', 'in_review'].includes(t.status),
  },
  { id: 'all', label: '全部', f: () => true },
  // 本批后端只到 accepted；integrated / verified 尚未提供
  { id: 'done', label: '已接受', f: (t: DemoTask) => t.status === 'accepted' },
];

export function TaskList({ app }: { app: App }) {
  const [f, setF] = useState('active');
  const TASKS = app.tasks;
  const list = TASKS.filter(FILTERS.find((x) => x.id === f)!.f);
  return (
    <div className="scroll">
      <div className="page page--wide">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 className="h1" style={{ flex: 1 }}>
            任务
          </h1>
          <button className="btn btn--primary">
            <I n="plus" s={14} />
            新建任务
          </button>
        </div>
        <div className="filters" role="group" aria-label="筛选">
          {FILTERS.map((x) => (
            <button key={x.id} aria-pressed={f === x.id} onClick={() => setF(x.id)}>
              {x.label}
              <span className="n">{TASKS.filter(x.f).length}</span>
            </button>
          ))}
        </div>
        <div className="rows">
          {list.map((t) => (
            <TaskRow key={t.id} t={t} app={app} />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── 待处理（收件箱）────────────────────────────────────── */

export function Inbox({ app }: { resolved: Set<string>; app: App }) {
  const TASKS = app.tasks;
  const groups = [
    {
      title: '结果未知',
      items: TASKS.filter((t) => t.runs.at(-1)?.status === 'needs_recovery'),
      line: (t: DemoTask) => t.runs.at(-1)?.outcomeReason ?? '需要人工核对；本批没有恢复接口',
    },
    {
      title: '执行失败',
      items: TASKS.filter((t) => t.runs.at(-1)?.status === 'failed'),
      line: (t: DemoTask) => t.runs.at(-1)?.outcomeReason ?? '改动已保留',
    },
    {
      title: '等待审查',
      items: TASKS.filter((t) => t.status === 'in_review'),
      line: (t: DemoTask) => `${t.snapshot?.files.length ?? 0} 个文件 · 检查未运行`,
    },
    {
      title: '结果已接受',
      items: TASKS.filter((t) => app.validAcceptanceOf(t.id)),
      line: () => '已接受，尚未集成与验收',
    },
  ].filter((g) => g.items.length);

  return (
    <div className="scroll">
      <div className="page">
        <h1 className="h1">待处理</h1>
        <p className="lead">只列出需要你作决定的事项。普通执行事件留在各自任务里。</p>
        {groups.length === 0 ? (
          <p className="lead" style={{ marginTop: 40 }}>
            现在没有需要你处理的事项。
          </p>
        ) : null}
        {groups.map((g) => (
          <section key={g.title}>
            <div className="sec-head">
              <h2 className="h2">{g.title}</h2>
              <span className="meta">{g.items.length}</span>
            </div>
            <div className="rows">
              {g.items.map((t) => (
                <a
                  key={t.id}
                  className="row-item"
                  href={href({ page: 'task', id: t.id, view: t.snapshot ? 'review' : 'run' })}
                >
                  <span className="row-item__main">
                    <span className="row-item__title" style={{ display: 'block' }}>
                      {t.title}
                    </span>
                    <span className="row-item__sub" style={{ display: 'block' }}>
                      fin-sync · {t.ref} · {g.line(t)}
                    </span>
                  </span>
                  <span className="row-item__side">
                    <span className="meta">{t.updated}</span>
                    <I n="chevR" s={14} className="meta" />
                  </span>
                </a>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

/* ── 智能体 ───────────────────────────────────────────────── */

export function Agents({ app }: { app: App }) {
  const [sel, setSel] = useState<string | null>(AGENTS[0].id);
  const tasks = app.tasks;
  const codex = ENGINES[0];
  const planned = ENGINES.filter((e) => !e.integrated);
  const a = agentById(sel);
  const assigned = (id: string) =>
    tasks.filter((t) => t.agentInstanceId === id && t.status === 'in_progress');

  return (
    <div className="scroll">
      <div className="page page--wide">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 className="h1" style={{ flex: 1 }}>
            智能体
          </h1>
          <button className="btn">
            <I n="plus" s={14} />
            新增实例
          </button>
        </div>
        <p className="lead">实例是对某个引擎的一份具体配置（程序、模型、默认偏好）。任务分派给实例。</p>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 380px)', gap: 32, alignItems: 'start' }}>
          <div>
            <section className="engine">
              <div className="engine__head">
                <EngineMark mark={codex.mark} />
                <span className="engine__name">{codex.name}</span>
                <span className="tag tag--ok">已接入</span>
                <span className="meta">版本 {codex.version} · Windows</span>
              </div>
              {AGENTS.map((x) => {
                const n = assigned(x.id).length;
                return (
                  <button key={x.id} className="inst" aria-pressed={sel === x.id} onClick={() => setSel(x.id)}>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: 'block', fontWeight: 600 }}>{x.name}</span>
                      <span className="meta">
                        {x.model} · {x.transport}
                      </span>
                    </span>
                    <span className={`st ${x.status === 'ready' ? 'st--ok' : 'st--wait'}`}>{x.statusText}</span>
                    <span className="meta" style={{ textAlign: 'right' }}>
                      {n ? `${n} 个任务进行中` : '空闲'}
                    </span>
                  </button>
                );
              })}
            </section>

            <section className="engine">
              <div className="engine__head">
                <span className="engine__name" style={{ fontSize: 14, color: 'var(--text-2)' }}>
                  规划中的引擎
                </span>
              </div>
              <p className="engine__note">尚未核验接入方式与能力，不能分派任务。接入会在独立批次完成并逐项验证。</p>
              {planned.map((e) => (
                <div key={e.id} className="planned">
                  <EngineMark mark={e.mark} muted />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 560, color: 'var(--text)' }}>{e.name}</span>
                    <span className="meta">未接入 · 产品版本与协议待核验</span>
                  </span>
                  <span className="meta" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <I n="lock" s={14} />
                    暂不可用
                  </span>
                </div>
              ))}
            </section>
          </div>

          {a ? (
            <aside style={{ position: 'sticky', top: 0, paddingTop: 28 }}>
              <div className="inline-card" style={{ marginBottom: 0 }}>
                <div className="inline-card__head" style={{ paddingBottom: 4 }}>
                  <EngineMark mark={engineById(a.engine).mark} />
                  <span className="inline-card__title">
                    {engineById(a.engine).name} · {a.name}
                  </span>
                </div>
                <div className="inline-card__body">
                  <dl className="dl" style={{ marginTop: 8 }}>
                    <dt>状态</dt>
                    <dd>
                      <span className={`st ${a.status === 'ready' ? 'st--ok' : 'st--wait'}`}>{a.statusText}</span>
                      <div className="meta" style={{ marginTop: 4, lineHeight: 1.6 }}>
                        {a.statusNote}
                      </div>
                    </dd>
                    <dt>模型</dt>
                    <dd className="mono">{a.model}</dd>
                    <dt>传输</dt>
                    <dd>{a.transport}</dd>
                    <dt>最近检查</dt>
                    <dd>{a.lastCheck}</dd>
                  </dl>

                  <div className="pane-h" style={{ marginTop: 20 }}>
                    能力验证 · 属于 Codex 引擎
                  </div>
                  <ul className="caps">
                    {CODEX_CAPS.map((c) => (
                      <li key={c.name}>
                        <span className="cn">
                          {c.name}
                          {c.note ? (
                            <span className="meta" style={{ display: 'block' }}>
                              {c.note}
                            </span>
                          ) : null}
                        </span>
                        <span
                          className="cs"
                          style={{
                            color: c.state === 'verified' ? 'var(--ok)' : c.state === 'partial' ? 'var(--warn)' : 'var(--text-3)',
                          }}
                        >
                          {c.state === 'verified' ? '已验证' : c.state === 'partial' ? '部分验证' : '未验证'}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="meta" style={{ marginTop: 12, lineHeight: 1.6 }}>
                    依据：CODEX-BATCH-01-RESULTS.md 的真实运行记录。握手成功或已安装不等于可执行。
                  </p>
                </div>
              </div>
            </aside>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export { primaryStatus };

import { useState } from 'react';
import { FILE_CONTENT, TREE, agentById, engineById, type TreeNode } from './data.ts';
import type { Check } from './backend/capability.tsx';
import { demoChecksFor, type DemoTask } from './backend/demo.ts';
import { I, EngineMark } from './icons.tsx';
import { MdPreview } from './bits.tsx';
import type { AuxTab } from './layout.tsx';

/* ─────────────────────────────────────────────────────────────
   辅助面板：同一个容器，按需切换「详情 / 文件 / 变更 / 检查」。
   一次只开一个，避免多个侧栏同时挤压主区。
   ───────────────────────────────────────────────────────────── */

export function AuxPanel({
  task,
  tab,
  tabs,
  onTab,
  onClose,
  onOpenReview,
}: {
  task: DemoTask;
  tab: AuxTab;
  tabs: AuxTab[];
  onTab: (t: AuxTab) => void;
  onClose: () => void;
  onOpenReview: () => void;
}) {
  const LABEL: Record<AuxTab, string> = { details: '详情', files: '文件', changes: '变更', checks: '检查' };
  return (
    <>
      <div className="aux__head">
        <div className="tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => onTab(t)}>
              {LABEL[t]}
            </button>
          ))}
        </div>
        <button className="icon-btn icon-btn--sm" onClick={onClose} aria-label="关闭面板" title="关闭面板 (Ctrl+.)">
          <I n="x" s={14} />
        </button>
      </div>
      <div className="aux__body">
        {tab === 'details' ? <Details task={task} /> : null}
        {tab === 'files' ? <Files /> : null}
        {tab === 'changes' ? <ChangesSummary task={task} onOpenReview={onOpenReview} /> : null}
        {tab === 'checks' ? <Checks checks={demoChecksFor(task)} /> : null}
      </div>
    </>
  );
}

function Details({ task }: { task: DemoTask }) {
  const a = agentById(task.agentInstanceId);
  return (
    <div className="pane-pad">
      <div className="pane-h">目标</div>
      <p style={{ margin: 0, lineHeight: 1.7, fontSize: 14 }}>{task.goal || '尚未填写目标。'}</p>

      <div className="pane-h">验收条件</div>
      <ul className="ac">
        {task.acceptanceCriteria.map((text, i) => ({
          text,
          met: task.met[i],
        })).map((c) => (
          <li key={c.text}>
            <span className={`mk ${c.met ? 'mk--ok' : ''}`}>
              <I n={c.met ? 'check' : 'circle'} s={13} />
            </span>
            <span>
              {c.text}
              {c.met === null ? <span className="meta"> · 未判定</span> : null}
            </span>
          </li>
        ))}
      </ul>

      <div className="pane-h">执行</div>
      <dl className="dl">
        <dt>智能体</dt>
        <dd>
          {a ? (
            <span className="agent-chip">
              <EngineMark mark={engineById(a.engine).mark} />
              {engineById(a.engine).name} · {a.name}
            </span>
          ) : (
            '未分派'
          )}
        </dd>
        <dt>模型</dt>
        <dd className="mono">{a?.model ?? '—'}</dd>
        <dt>分支</dt>
        <dd className="mono">{task.branch}</dd>
        <dt>工作区</dt>
        <dd className="mono" style={{ fontSize: 12 }}>
          {task.worktree}
        </dd>
        <dt>基准</dt>
        <dd className="mono">{task.snapshot?.baseHead ?? task.branch}</dd>
      </dl>

      <div className="pane-h">运行记录</div>
      <ul className="ac">
        {task.runs.map((r, i) => (
          <li key={r.id}>
            <span className="mk mono">#{i + 1}</span>
            <span style={{ flex: 1 }}>{r.outcomeReason ?? r.status}</span>
            <span className="meta">{r.startedAt.slice(11, 19)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TreeView({
  nodes,
  depth,
  cur,
  onPick,
}: {
  nodes: TreeNode[];
  depth: number;
  cur: string;
  onPick: (p: string) => void;
}) {
  const CHANGED = new Set(['src/sync/cursor.ts', 'src/sync/loop.ts']);
  return (
    <>
      {nodes.map((n) => (
        <div key={n.path}>
          <button
            style={{ paddingLeft: 8 + depth * 14 }}
            aria-current={cur === n.path}
            onClick={() => !n.children && onPick(n.path)}
          >
            <I n={n.children ? 'folder' : n.path.endsWith('.md') ? 'doc' : 'file'} s={14} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.name}</span>
            {CHANGED.has(n.path) ? <span className="changed" title="本任务修改过" /> : null}
          </button>
          {n.children ? <TreeView nodes={n.children} depth={depth + 1} cur={cur} onPick={onPick} /> : null}
        </div>
      ))}
    </>
  );
}

function Files() {
  const [cur, setCur] = useState('docs/同步设计说明.md');
  const text = FILE_CONTENT[cur] ?? '';
  return (
    <div className="split-pane">
      <div className="tree">
        <TreeView nodes={TREE} depth={0} cur={cur} onPick={setCur} />
      </div>
      <div className="preview-h">
        <I n={cur.endsWith('.md') ? 'doc' : 'file'} s={14} />
        <span className="p" title={cur}>
          {cur}
        </span>
        <span className="meta">只读</span>
      </div>
      <div className="preview">
        {cur.endsWith('.md') ? <MdPreview text={text} /> : <pre className="code-view">{text}</pre>}
      </div>
    </div>
  );
}

function ChangesSummary({ task, onOpenReview }: { task: DemoTask; onOpenReview: () => void }) {
  const files = task.snapshot?.files ?? [];
  return (
    <div className="pane-pad">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span style={{ fontWeight: 600, flex: 1 }}>当前工作区的改动</span>
        <span className="meta">{files.length} 个文件</span>
      </div>
      <div className="inline-card" style={{ marginBottom: 14 }}>
        <ul className="flist">
          {files.map((f) => (
            <li key={f.id}>
              <span className="p" title={f.path}>
                {f.path}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <p className="meta" style={{ lineHeight: 1.6, margin: '0 0 14px' }}>
        执行仍在进行，改动可能继续变化。完整审查请在执行结束后进行。
      </p>
      <button className="btn btn--sm" onClick={onOpenReview}>
        在审查视图中打开
        <I n="arrowR" s={13} />
      </button>
    </div>
  );
}

export function Checks({ checks, compact }: { checks: Check[]; compact?: boolean }) {
  return (
    <div>
      {checks.map((c) => (
        <CheckItem key={c.id} c={c} compact={compact} />
      ))}
    </div>
  );
}

function CheckItem({ c, compact }: { c: Check; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="check">
      <div className="check__top">
        <span style={{ color: c.outcome === 'passed' ? 'var(--ok)' : c.outcome === 'failed' ? 'var(--bad)' : 'var(--text-3)' }}>
          <I n={c.outcome === 'passed' ? 'check' : c.outcome === 'failed' ? 'x' : 'circle'} s={14} />
        </span>
        <span className="check__name">{c.name}</span>
        {c.outcome === 'not_run' ? (
          <span className="notrun">未运行</span>
        ) : (
          <span className="meta">
            exit {c.exit} · {c.duration}
          </span>
        )}
      </div>
      {c.command ? <div className="check__cmd">{c.command}</div> : null}
      {c.reason ? <div className="check__note">{c.reason}</div> : null}
      {c.output && !compact ? (
        <div style={{ margin: '6px 0 0 18px' }}>
          <button className="step-btn" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? '收起输出' : '查看输出'}
          </button>
          {open ? <pre className="out" style={{ marginTop: 6 }}>{c.output}</pre> : null}
        </div>
      ) : null}
    </div>
  );
}

/* 审查视图（diff 渲染与文件列表）见 backend/Review.tsx */

export { parseUnifiedDiff } from './backend/diff.ts';

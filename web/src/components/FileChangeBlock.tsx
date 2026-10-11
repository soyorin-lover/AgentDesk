import type { FileChangeEvent, TimelineEvent } from '../domain/types.ts';
import { Icon } from './Icons.tsx';
import { DiffView } from './DiffView.tsx';

/* ─────────────────────────────────────────────────────────────
   文件变更事件
   只给摘要 + 可展开的逐行差异。摘要必须包含「改了几个文件、
   增删多少行」，这样用户不用展开就能判断要不要看。
   ───────────────────────────────────────────────────────────── */

export function FileChangeBlock({ event }: { event: FileChangeEvent }) {
  const add = event.changes.reduce((n, c) => n + c.additions, 0);
  const del = event.changes.reduce((n, c) => n + c.deletions, 0);

  const status = (() => {
    switch (event.status) {
      case 'inProgress':
        return { tone: 'active', label: '写入中' };
      case 'completed':
        return { tone: 'ok', label: '已完成' };
      case 'failed':
        return { tone: 'bad', label: '写入失败' };
    }
  })();

  return (
    <div className="card card--raised">
      <header className="row gap-4" style={{ padding: 'var(--sp-5) var(--sp-6)' }}>
        <Icon name="diff" size={13} />
        <span className="fs-sm fw-6">
          {event.changes.length} 个文件变更
        </span>
        <span className="stat stat--add">+{add}</span>
        <span className="stat stat--del">−{del}</span>
        <span className={`chip chip--${status.tone}`} style={{ height: 18 }}>
          {event.status === 'inProgress' ? <span className="pulse" /> : null}
          {status.label}
        </span>
      </header>

      <div className="col gap-4" style={{ padding: '0 var(--sp-6) var(--sp-6)' }}>
        {event.changes.map((c) => {
          const hasLines = c.hunks.length > 0;
          if (hasLines) {
            return (
              <DiffView
                key={c.path}
                file={{
                  path: c.path,
                  kind: c.kind,
                  additions: c.additions,
                  deletions: c.deletions,
                  hunks: c.hunks,
                }}
                open={false}
              />
            );
          }
          return (
            <div
              key={c.path}
              className="row gap-3"
              style={{
                padding: 'var(--sp-3) var(--sp-5)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--r-md)',
                background: 'var(--bg-panel)',
              }}
            >
              <Icon name={c.kind === 'add' ? 'plus' : 'diff'} size={11} />
              <span className="mono fs-sm truncate grow" title={c.path}>
                {c.path}
              </span>
              <span className="stat stat--add">+{c.additions}</span>
              <span className="stat stat--del">−{c.deletions}</span>
              <span className="fs-xs dim">逐行差异见「变更」视图</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export type { TimelineEvent };

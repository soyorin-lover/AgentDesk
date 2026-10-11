import { useState } from 'react';
import type { CommandEvent } from '../domain/types.ts';
import { Icon } from './Icons.tsx';
import { duration } from '../lib/format.ts';
import { APPROVAL_LABEL } from '../domain/status.ts';

/* ─────────────────────────────────────────────────────────────
   命令事件
   规则：命令行与退出结果始终可见；原始输出默认折叠。
   运行中的输出不折叠，且带淡出遮罩提示「还在增长」。
   ───────────────────────────────────────────────────────────── */

const OUTPUT_LIMIT = 40; // 超过这么多行，折叠视图只显示尾部

export function CommandBlock({ event }: { event: CommandEvent }) {
  const lines = event.output ? event.output.split('\n') : [];
  const long = lines.length > OUTPUT_LIMIT;
  const [expandAll, setExpandAll] = useState(false);

  const shown = expandAll || !long ? event.output : lines.slice(-OUTPUT_LIMIT).join('\n');
  const hiddenCount = long && !expandAll ? lines.length - OUTPUT_LIMIT : 0;

  const status = (() => {
    if (event.pending) return { tone: 'active' as const, label: '执行中', icon: 'spinner' as const };
    if (event.exitCode === 0) return { tone: 'ok' as const, label: '退出码 0', icon: 'check' as const };
    if (event.exitCode === null)
      return { tone: 'idle' as const, label: '无退出码（被中止）', icon: 'stop' as const };
    return { tone: 'bad' as const, label: `退出码 ${event.exitCode}`, icon: 'x' as const };
  })();

  return (
    <div className="fold" style={{ overflow: 'visible' }}>
      {/* 命令行：始终可见 */}
      <div
        className="row gap-4"
        style={{
          padding: 'var(--sp-4) var(--sp-5)',
          background: 'var(--bg-panel)',
          borderBottom: '1px solid var(--border-subtle)',
          alignItems: 'flex-start',
        }}
      >
        <span style={{ color: 'var(--text-faint)', marginTop: 2 }}>
          <Icon name="terminal" size={12} />
        </span>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="cmdline">
            <span className="cmdline__prompt">$</span>
            <span className="grow">{event.command}</span>
          </div>
          <div className="row gap-3 mt-3 fs-xs dim">
            <span className="mono truncate" title={event.cwd}>
              {event.cwd}
            </span>
            <span>·</span>
            <span className={`chip chip--${status.tone}`} style={{ height: 18 }}>
              <Icon name={status.icon} size={10} />
              {status.label}
            </span>
            <span>{duration(event.durationMs)}</span>
          </div>
        </div>
      </div>

      {/* 输出 */}
      {event.output ? (
        <>
          <details open={Boolean(event.pending) || undefined}>
            <summary className="fold__summary">
              <span className="fold__title">输出</span>
              <span className="dim fs-xs">{lines.length} 行</span>
            </summary>
            <div className="fold__body">
              {hiddenCount > 0 ? (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm mb-3"
                  onClick={() => setExpandAll(true)}
                >
                  <Icon name="chevronDown" size={11} />
                  显示前面 {hiddenCount} 行
                </button>
              ) : null}
              <div className="term__wrap">
                <pre className="term">{shown}</pre>
                {event.pending ? <div className="term__fade" /> : null}
              </div>
            </div>
          </details>
        </>
      ) : (
        <div className="fold__summary" style={{ cursor: 'default', color: 'var(--text-faint)' }}>
          <Icon name="info" size={11} />
          这条命令没有输出
        </div>
      )}

      {/* 该命令自身的审批结果（若发生在这条命令之前，由审批卡片承载） */}
      {event.approval && event.approval.kind !== 'pending' ? (
        <div
          className="fs-xs"
          style={{
            padding: 'var(--sp-4) var(--sp-5)',
            borderTop: '1px solid var(--border-subtle)',
            background: 'var(--bg-inset)',
            color: 'var(--text-secondary)',
          }}
        >
          <Icon name="shield" size={11} /> 审批：{APPROVAL_LABEL[event.approval.kind]}
        </div>
      ) : null}
    </div>
  );
}

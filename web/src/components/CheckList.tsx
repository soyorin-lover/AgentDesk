import type { Check } from '../domain/types.ts';
import { CHECK_STATUS } from '../domain/status.ts';
import { Icon } from './Icons.tsx';
import { Fold } from './primitives.tsx';
import { duration, stamp } from '../lib/format.ts';

/* ─────────────────────────────────────────────────────────────
   检查证据列表
   核心规则：没有检查就显示「尚无检查」；有检查但没跑就显示「未运行」。
   绝不留空、绝不省略、绝不把未运行画成通过的样子。
   ───────────────────────────────────────────────────────────── */

const TONE_ICON = {
  ok: 'check',
  bad: 'x',
  active: 'spinner',
  wait: 'clock',
  review: 'dot',
  idle: 'clock',
} as const;

export function CheckRow({ check }: { check: Check }) {
  const s = CHECK_STATUS[check.status];
  const notRun = check.status === 'notRun';

  return (
    <div className={`check ${notRun ? 'check--notrun' : ''}`}>
      <div className="check__row">
        <span style={{ color: `var(--st-${s.tone})`, marginTop: 1 }}>
          <Icon name={TONE_ICON[s.tone]} size={14} />
        </span>

        <span className="check__grow">
          <div className="check__name">{check.name}</div>
          {check.command ? (
            <div className="check__cmd" title={check.command}>
              {check.command}
            </div>
          ) : (
            <div className="check__cmd" style={{ fontStyle: 'italic' }}>
              尚未执行，没有可展示的命令与结果
            </div>
          )}
        </span>

        {/* 结果列：未运行时刻意不显示退出码 */}
        <span className="row gap-3">
          {check.exitCode !== null ? (
            <span className="chip chip--plain-dim" title="进程退出码">
              exit {check.exitCode}
            </span>
          ) : null}
          {check.durationMs !== null ? (
            <span className="fs-xs dim nowrap">{duration(check.durationMs)}</span>
          ) : null}
          <span className={`chip chip--${s.tone}`} title={s.meaning}>
            {s.label}
          </span>
        </span>
      </div>

      {!notRun && check.output ? (
        <div className="check__detail">
          <Fold icon="terminal" title="查看输出" meta={`${check.output.split('\n').length} 行`}>
            <pre className="term">{check.output}</pre>
            {check.startedAtMs ? (
              <div className="fs-xs dim mt-3">开始于 {stamp(check.startedAtMs)}</div>
            ) : null}
          </Fold>
        </div>
      ) : null}
    </div>
  );
}

export function CheckList({ checks }: { checks: Check[] }) {
  if (checks.length === 0) {
    return (
      <div className="empty">
        <Icon name="clock" size={22} />
        <div className="empty__title">尚无检查记录</div>
        <div className="empty__desc">
          这次运行没有留下任何检查项。这不是「全部通过」，而是「没有任何证据」——
          在没有检查的情况下不应接受结果。
        </div>
      </div>
    );
  }

  const notRun = checks.filter((c) => c.status === 'notRun').length;

  return (
    <div>
      {notRun > 0 ? (
        <div
          className="row gap-3 fs-sm"
          style={{
            padding: 'var(--sp-5) var(--sp-6)',
            borderBottom: '1px solid var(--border)',
            background: 'var(--bg-canvas)',
            color: 'var(--text-secondary)',
          }}
        >
          <Icon name="warn" size={13} />
          <span>
            有 <strong>{notRun}</strong> 项检查尚未运行。未运行不等于通过，
            接受结果前请确认这些检查是否必要。
          </span>
        </div>
      ) : null}
      {checks.map((c) => (
        <CheckRow key={c.id} check={c} />
      ))}
    </div>
  );
}

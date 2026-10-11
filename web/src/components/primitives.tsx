import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icons.tsx';
import { toneClass, type Tone } from '../domain/status.ts';
import { clockShort, relTime } from '../lib/format.ts';

/* ── 状态芯片 ─────────────────────────────────────────────── */

export function Chip({
  tone = 'idle',
  dot = false,
  live = false,
  children,
  title,
  plain = false,
}: {
  tone?: Tone;
  dot?: boolean;
  live?: boolean;
  children: ReactNode;
  title?: string;
  plain?: boolean;
}) {
  return (
    <span
      className={`chip ${plain ? 'chip--plain-dim' : toneClass(tone)} ${dot ? 'chip--dot' : ''}`}
      title={title}
    >
      {live ? <span className="pulse" aria-hidden /> : null}
      {children}
    </span>
  );
}

/* ── 按钮 ─────────────────────────────────────────────────── */

interface BtnProps {
  children?: ReactNode;
  onClick?: () => void;
  variant?: 'default' | 'primary' | 'ok' | 'danger' | 'ghost';
  size?: 'md' | 'sm';
  icon?: IconName;
  disabled?: boolean;
  title?: string;
  block?: boolean;
  type?: 'button' | 'submit';
  ariaLabel?: string;
}

export function Btn({
  children,
  onClick,
  variant = 'default',
  size = 'md',
  icon,
  disabled,
  title,
  block,
  type = 'button',
  ariaLabel,
}: BtnProps) {
  const cls = [
    'btn',
    variant !== 'default' ? `btn--${variant}` : '',
    size === 'sm' ? 'btn--sm' : '',
    !children && icon ? 'btn--icon' : '',
    block ? 'btn--block' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      type={type}
      className={cls}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
    >
      {icon ? <Icon name={icon} size={size === 'sm' ? 12 : 13} /> : null}
      {children}
    </button>
  );
}

/* ── 卡片 ─────────────────────────────────────────────────── */

export function Card({
  title,
  head,
  children,
  flush,
  raised,
  id,
  className,
}: {
  title?: ReactNode;
  head?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  raised?: boolean;
  id?: string;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={`card ${raised ? 'card--raised' : ''} ${className ?? ''}`}
    >
      {head ?? (title ? (
        <header className="card__head">
          <span className="card__title">{title}</span>
        </header>
      ) : null)}
      <div className={`card__body ${flush ? 'card__body--flush' : ''}`}>{children}</div>
    </section>
  );
}

/* ── 折叠 ─────────────────────────────────────────────────── */

export function Fold({
  title,
  children,
  open,
  icon,
  meta,
  mono,
}: {
  title: ReactNode;
  children: ReactNode;
  open?: boolean;
  icon?: IconName;
  meta?: ReactNode;
  mono?: boolean;
}) {
  return (
    <details className="fold" open={open}>
      <summary className="fold__summary">
        {icon ? <Icon name={icon} size={12} /> : null}
        <span className={`fold__title ${mono ? 'mono' : ''}`} title={typeof title === 'string' ? title : undefined}>
          {title}
        </span>
        {meta ? <span className="grow center dim fs-xs">{meta}</span> : <span className="grow" />}
      </summary>
      <div className="fold__body">{children}</div>
    </details>
  );
}

/* ── 空状态 / 提示条 ──────────────────────────────────────── */

export function Empty({
  title,
  desc,
  action,
}: {
  title: string;
  desc?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <Icon name="layers" size={22} />
      <div className="empty__title">{title}</div>
      {desc ? <div className="empty__desc">{desc}</div> : null}
      {action}
    </div>
  );
}

export function Banner({
  kind = 'info',
  title,
  children,
  icon = 'info',
}: {
  kind?: 'info' | 'warn' | 'bad';
  title?: ReactNode;
  children?: ReactNode;
  icon?: IconName;
}) {
  return (
    <div className={`banner ${kind === 'info' ? '' : `banner--${kind}`}`}>
      <span className="banner__ico">
        <Icon name={icon} size={14} />
      </span>
      <div className="banner__body">
        {title ? <div className="banner__title">{title}</div> : null}
        {children ? <div className="sec">{children}</div> : null}
      </div>
    </div>
  );
}

/* ── 表单字段 ─────────────────────────────────────────────── */

export function Field({
  label,
  hint,
  error,
  children,
  required,
  htmlFor,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  required?: boolean;
  htmlFor?: string;
}) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={htmlFor}>
        {label}
        {required ? <span style={{ color: 'var(--st-bad)' }}> *</span> : null}
      </label>
      {hint ? <div className="field__hint">{hint}</div> : null}
      {children}
      {error ? <div className="field__err">{error}</div> : null}
    </div>
  );
}

/* ── 路径：中间截断 + 悬停完整 + 复制 ─────────────────────── */

export function PathText({
  path,
  tail = 3,
  full = false,
  copyable = true,
}: {
  path: string;
  tail?: number;
  full?: boolean;
  copyable?: boolean;
}) {
  const display = (() => {
    if (full) return path;
    const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
    return parts.length <= tail ? path : `…/${parts.slice(-tail).join('/')}`;
  })();

  return (
    <span className="row gap-2" style={{ minWidth: 0 }}>
      <span className={`path ${full ? 'path--full' : ''}`} title={path}>
        {display}
      </span>
      {copyable ? (
        <button
          type="button"
          className="copy"
          title={`复制完整路径：${path}`}
          aria-label="复制完整路径"
          onClick={() => {
            void navigator.clipboard?.writeText(path);
          }}
        >
          <Icon name="copy" size={11} />
        </button>
      ) : null}
    </span>
  );
}

/* ── 键值列表 ─────────────────────────────────────────────── */

export function KV({ rows }: { rows: Array<[ReactNode, ReactNode]> }) {
  return (
    <div className="kv">
      {rows.map(([k, v], i) => (
        <div key={i} className="contents" style={{ display: 'contents' }}>
          <div className="kv__k">{k}</div>
          <div className="kv__v">{v}</div>
        </div>
      ))}
    </div>
  );
}

/* ── 键值列表（紧凑，用于卡片内） ─────────────────────────── */

export function MetaRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="row gap-3" style={{ minWidth: 0 }}>
      <span className="dim fs-xs nowrap" style={{ minWidth: 52 }}>
        {label}
      </span>
      <span className="grow fs-sm sec" style={{ minWidth: 0 }}>
        {children}
      </span>
    </div>
  );
}

/* ── 相对/绝对时间 ────────────────────────────────────────── */

export function TimeText({ ms, now }: { ms: number; now: number }) {
  return (
    <span
      className="ev__time nowrap"
      title={new Date(ms).toLocaleString('zh-CN')}
    >
      {clockShort(ms)}
      <span style={{ margin: '0 4px' }}>·</span>
      {relTime(ms, now)}
    </span>
  );
}

/* ── 演示模式标记 ─────────────────────────────────────────── */

export function DemoMark({ what }: { what?: string }) {
  return (
    <span className="chip chip--demo" title="演示模式：此处为构造数据，不来自真实 Codex 执行">
      演示{what ? ` · ${what}` : ''}
    </span>
  );
}

/** 标记「未经 Codex 验证的设计假设」 */
export function Assumption({ of }: { of: string }) {
  return (
    <span
      className="assumption"
      title={`设计假设：${of}。Windows 上仅验证过 App Server 初始化握手，此能力尚未实测，将依 Codex 验证结果调整。`}
    >
      <Icon name="warn" size={10} />
      设计假设
    </span>
  );
}

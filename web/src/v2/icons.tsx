import {brandIcons} from './brand-icons.ts';
/* 线性图标：16 视框、1.5 线宽、圆角端点，全站统一 */

const P: Record<string, string> = {
  back: 'M10 3L5 8l5 5M5 8h9',
  sidebar: 'M2.5 3.5h11v9h-11zM6 3.5v9',
  panel: 'M2.5 3.5h11v9h-11zM10 3.5v9',
  home: 'M2.8 7.2 8 3l5.2 4.2M4.2 6.2v6.3h7.6V6.2',
  list: 'M5.5 4.5h8M5.5 8h8M5.5 11.5h8M2.6 4.5h.2M2.6 8h.2M2.6 11.5h.2',
  inbox: 'M2.5 9l1.7-5.5h7.6L13.5 9v3.5h-11zM2.5 9h3.2l.8 1.5h3l.8-1.5h3.2',
  agents: 'M4 5.5h8v6.5H4zM8 3v2.5M6.2 8.2h.1M9.7 8.2h.1M2.5 8v2M13.5 8v2',
  merge: 'M4.5 2.8v10.4M4.5 5.2c0 3 6.8 2 6.8 6M11.3 11.2v2M4.5 2.8h0',
  settings:
    'M8 10.1a2.1 2.1 0 100-4.2 2.1 2.1 0 000 4.2zM8 1.9v1.6M8 12.5v1.6M3.7 3.7l1.1 1.1M11.2 11.2l1.1 1.1M1.9 8h1.6M12.5 8h1.6M3.7 12.3l1.1-1.1M11.2 4.8l1.1-1.1',
  search: 'M7.2 12a4.8 4.8 0 100-9.6 4.8 4.8 0 000 9.6zM10.6 10.6l3 3',
  plus: 'M8 3.2v9.6M3.2 8h9.6',
  more: 'M3.5 8h.1M8 8h.1M12.5 8h.1',
  chevR: 'M6.2 3.6 10.6 8l-4.4 4.4',
  chevD: 'M3.6 6.2 8 10.6l4.4-4.4',
  chevL: 'M9.8 3.6 5.4 8l4.4 4.4',
  folder: 'M2.2 4.2h4l1.4 1.6h6.2v6.6H2.2z',
  file: 'M9.2 2.2H4.2v11.6h7.6V4.8zM9.2 2.2v2.6h2.6',
  doc: 'M9.2 2.2H4.2v11.6h7.6V4.8zM9.2 2.2v2.6h2.6M6 8h4M6 10.5h4',
  diff: 'M4 2.6v6M1 5.6h6M9 12.4h6M11 2.5l-6 11',
  details: 'M2.8 3.5h10.4M2.8 6.5h10.4M2.8 9.5h6.5M2.8 12.5h6.5',
  check: 'M3.2 8.4l3.2 3.2 6.4-6.8',
  x: 'M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6',
  warn: 'M8 2.4l6 10.6H2zM8 6.6v3M8 11.4v.1',
  info: 'M8 14a6 6 0 100-12 6 6 0 000 12zM8 7.4v3.8M8 5v.1',
  dot: 'M8 9.6a1.6 1.6 0 100-3.2 1.6 1.6 0 000 3.2z',
  circle: 'M8 13.5a5.5 5.5 0 100-11 5.5 5.5 0 000 11z',
  arrowUp: 'M8 13V3.4M3.8 7.4 8 3.2l4.2 4.2',
  arrowR: 'M3 8h9.6M8.8 4.2 12.6 8l-3.8 3.8',
  stop: 'M5 5h6v6H5z',
  play: 'M5 3.4v9.2L12.4 8z',
  refresh: 'M13 8a5 5 0 11-1.6-3.7M13 2.6v3h-3',
  terminal: 'M3.2 5l3 3-3 3M7.8 11.2h5',
  read: 'M2.2 8s2.2-4.2 5.8-4.2S13.8 8 13.8 8s-2.2 4.2-5.8 4.2S2.2 8 2.2 8zM8 9.6a1.6 1.6 0 100-3.2 1.6 1.6 0 000 3.2z',
  edit: 'M10.6 2.8l2.6 2.6-7.6 7.6H3v-2.6z',
  shield: 'M8 2l5 2v3.8c0 3-2.1 5.2-5 6.2-2.9-1-5-3.2-5-6.2V4z',
  clock: 'M8 14a6 6 0 100-12 6 6 0 000 12zM8 4.8V8l2.2 1.4',
  branch: 'M5 2.8v10.4M11 5.4a1.6 1.6 0 100-3.2 1.6 1.6 0 000 3.2zM11 5.4c0 3-6 2.6-6 5.4',
  copy: 'M5.6 5.6h7.4v7.4H5.6zM3 10.4V3h7.4',
  split: 'M2.5 3.5h11v9h-11zM8 3.5v9',
  unified: 'M2.5 3.5h11v9h-11zM2.5 8h11',
  external: 'M9 2.8h4.2V7M13.2 2.8 7.4 8.6M11.4 9.4v3.8H2.8V4.6h3.8',
  lock: 'M4.2 7.2h7.6v6H4.2zM5.8 7.2V5.4a2.2 2.2 0 014.4 0v1.8',
  plug: 'M6 2.4v3M10 2.4v3M4.4 5.4h7.2v2.4a3.6 3.6 0 01-7.2 0zM8 11.4v2.2',
  wrap: 'M3 4.6h10M3 8h7.4a1.8 1.8 0 010 3.6H8.6M10.4 10.2l-1.4 1.4 1.4 1.4M3 12.2h2.4',
};

export type IconName = keyof typeof P;

export function I({
  n,
  s = 16,
  className,
  label,
}: {
  n: IconName;
  s?: number;
  className?: string;
  label?: string;
}) {
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
      focusable="false"
      style={{ flex: 'none', display: 'block' }}
    >
      <path d={P[n]} />
    </svg>
  );
}

export function Spinner({ s = 14 }: { s?: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 16 16" className="spin" aria-hidden style={{ flex: 'none' }}>
      <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeOpacity=".22" strokeWidth="1.6" />
      <path d="M8 2.5a5.5 5.5 0 015.5 5.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** 引擎标识：中性的字母方块，不使用三套品牌色 */
export function EngineMark({ mark, muted }: { mark: string; muted?: boolean }) {
  return (
    <span className={`emark ${muted ? 'emark--muted' : ''}`} aria-hidden>
      {(['G','C','D','Cx','CC','DS'].includes(mark)) ? <span className="brand-icon" dangerouslySetInnerHTML={{__html:brandIcons[(mark === 'G' || mark === 'Cx') ? 'codex' : (mark === 'C' || mark === 'CC') ? 'claude' : 'deepseek']}}/> : mark}
    </span>
  );
}

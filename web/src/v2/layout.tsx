import { useCallback, useEffect, useRef, useState } from 'react';

/* ─────────────────────────────────────────────────────────────
   布局偏好：按视图分别记住，刷新后恢复。
   样稿截图（?shot=1）用 URL 参数覆盖，且不写回本地。
   ───────────────────────────────────────────────────────────── */

export type Mode = 'page' | 'run' | 'review';
export type AuxTab = 'details' | 'files' | 'changes' | 'checks';

export interface Layout {
  nav: Record<Mode, 'full' | 'rail'>;
  aux: Record<'run' | 'review', { open: boolean; tab: AuxTab; w: number }>;
  files: { open: boolean; w: number };
  diff: 'unified' | 'split';
  /** 长行折行显示；关闭时水平滚动（默认关闭，保证长行可完整横向阅读） */
  diffWrap: boolean;
  navW: number;
}

const DEFAULT: Layout = {
  nav: { page: 'full', run: 'full', review: 'rail' },
  aux: {
    run: { open: false, tab: 'details', w: 400 },
    review: { open: false, tab: 'checks', w: 380 },
  },
  files: { open: true, w: 264 },
  diff: 'split',
  diffWrap: false,
  navW: 236,
};

const KEY = 'agentdesk.layout.v2';
const q = new URLSearchParams(window.location.search);
export const SHOT = q.has('shot');

function fromUrl(base: Layout): Layout {
  const l: Layout = structuredClone(base);
  const nav = q.get('nav');
  if (nav === 'rail' || nav === 'full') {
    l.nav.page = l.nav.run = l.nav.review = nav;
  }
  const aux = q.get('aux');
  if (aux) {
    const open = aux !== 'none';
    for (const m of ['run', 'review'] as const) {
      l.aux[m].open = open;
      if (open) l.aux[m].tab = aux as AuxTab;
    }
  }
  const w = Number(q.get('auxw'));
  if (w) l.aux.run.w = l.aux.review.w = w;
  if (q.get('files') === '0') l.files.open = false;
  const d = q.get('diff');
  if (d === 'split' || d === 'unified') l.diff = d;
  return l;
}

function load(): Layout {
  if (SHOT) return fromUrl(DEFAULT);
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT;
    const saved = JSON.parse(raw) as Partial<Layout>;
    return { ...DEFAULT, ...saved, aux: { ...DEFAULT.aux, ...saved.aux }, nav: { ...DEFAULT.nav, ...saved.nav } };
  } catch {
    return DEFAULT;
  }
}

export function useLayout() {
  const [layout, setLayout] = useState<Layout>(load);
  useEffect(() => {
    if (!SHOT) localStorage.setItem(KEY, JSON.stringify(layout));
  }, [layout]);
  const update = useCallback((fn: (l: Layout) => void) => {
    setLayout((prev) => {
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
  }, []);
  return [layout, update] as const;
}

export function useWindowWidth(): number {
  const [w, setW] = useState(window.innerWidth);
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return w;
}

/* ── 路由（hash）───────────────────────────────────────────── */

export type Route =
  | { page: 'overview' }
  | { page: 'tasks' }
  | { page: 'inbox' }
  | { page: 'agents' }
  | { page: 'connect' }
  | { page: 'workbench' }
  | { page: 'task'; id: string; view: 'run' | 'review' };

function parse(hash: string): Route {
  const parts = hash.replace(/^#\/?(?:demo\/?)?/, '').split('/').filter(Boolean);
  if (parts[0] === 'task' && parts[1]) {
    return { page: 'task', id: parts[1], view: parts[2] === 'review' ? 'review' : 'run' };
  }
  if (
    parts[0] === 'tasks' ||
    parts[0] === 'inbox' ||
    parts[0] === 'agents' ||
    parts[0] === 'connect' ||
    parts[0] === 'workbench'
  )
    return { page: parts[0] };
  return { page: 'overview' };
}

export function href(r: Route): string {
  if (r.page === 'task') return `#/demo/task/${r.id}${r.view === 'review' ? '/review' : ''}`;
  if (r.page === 'overview') return '#/demo/';
  return `#/demo/${r.page}`;
}

export function useRoute(): Route {
  const [r, setR] = useState(() => parse(window.location.hash));
  useEffect(() => {
    const on = () => setR(parse(window.location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return r;
}

/* ── 可拖动分隔线 ─────────────────────────────────────────── */

export function Resizer({
  value,
  min,
  max,
  onChange,
  side,
  label,
  inner,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  /** 面板在分隔线的哪一侧：决定拖动方向 */
  side: 'left' | 'right';
  label: string;
  inner?: boolean;
}) {
  const [active, setActive] = useState(false);
  const start = useRef<{ x: number; v: number } | null>(null);
  const clamp = (v: number) => Math.round(Math.min(max, Math.max(min, v)));

  return (
    <button
      type="button"
      className={`resizer ${inner ? 'resizer--inner' : ''}`}
      data-active={active}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      title="拖动调整宽度，双击恢复默认"
      onPointerDown={(e) => {
        start.current = { x: e.clientX, v: value };
        setActive(true);
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        document.body.classList.add('dragging');
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        const dx = e.clientX - start.current.x;
        onChange(clamp(start.current.v + (side === 'left' ? dx : -dx)));
      }}
      onPointerUp={() => {
        start.current = null;
        setActive(false);
        document.body.classList.remove('dragging');
      }}
      onDoubleClick={() => onChange(clamp(side === 'left' ? 264 : 400))}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 48 : 16;
        const grow = side === 'left' ? 'ArrowRight' : 'ArrowLeft';
        const shrink = side === 'left' ? 'ArrowLeft' : 'ArrowRight';
        if (e.key === grow) onChange(clamp(value + step));
        else if (e.key === shrink) onChange(clamp(value - step));
        else return;
        e.preventDefault();
      }}
    />
  );
}

/* ── 本机草稿 ─────────────────────────────────────────────── */

export function useDraft(taskId: string): [string, (v: string) => void] {
  const key = `agentdesk.draft.${taskId}`;
  const [v, setV] = useState(() => (SHOT ? '' : localStorage.getItem(key) ?? ''));
  useEffect(() => {
    setV(SHOT ? '' : localStorage.getItem(key) ?? '');
  }, [key]);
  const set = useCallback(
    (next: string) => {
      setV(next);
      if (SHOT) return;
      if (next) localStorage.setItem(key, next);
      else localStorage.removeItem(key);
    },
    [key],
  );
  return [v, set];
}

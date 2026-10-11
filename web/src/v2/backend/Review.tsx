import { useLayoutEffect, useRef, useState } from 'react';
import type { ReviewFile } from './types.ts';
import { parseUnifiedDiff, type DiffRow, type ParsedDiff } from './diff.ts';
import { I } from '../icons.tsx';

/* ─────────────────────────────────────────────────────────────
   Diff 渲染
   硬要求：并排与统一视图都必须能**完整读到长行**。
   做法：
     - 代码单元格永不 overflow:hidden / text-overflow:ellipsis
     - 默认保留水平滚动（长行不被截断）
     - 提供「长行换行」开关，切换为折行显示，便于窄窗口逐行读
     - 并排视图左右两栏横向滚动同步
   ───────────────────────────────────────────────────────────── */

export interface DiffPrefs {
  mode: 'unified' | 'split';
  /** 长行换行显示；关闭时水平滚动 */
  wrap: boolean;
}

const HUNK_PREFIX = '@@';

function RowCells({ r, side }: { r: DiffRow; side: 'unified' | 'left' | 'right' }) {
  const cls = r.kind === 'add' ? 'add' : r.kind === 'del' ? 'del' : '';
  if (side === 'right') {
    return (
      <>
        <td className={`ln ${r.kind === 'add' ? 'add' : ''}`}>{r.newNo ?? ''}</td>
        <td className={`code ${cls}`}>{r.text || ' '}</td>
      </>
    );
  }
  if (side === 'left') {
    return (
      <>
        <td className={`ln ${r.kind === 'del' ? 'del' : ''}`}>{r.oldNo ?? ''}</td>
        <td className={`code ${cls}`}>{r.text || ' '}</td>
      </>
    );
  }
  return (
    <>
      <td className="ln">{r.oldNo ?? ''}</td>
      <td className="ln">{r.newNo ?? ''}</td>
      <td className={`sg ${cls}`}>{r.kind === 'add' ? '+' : r.kind === 'del' ? '−' : ''}</td>
      <td className={`code ${cls}`}>{r.text || ' '}</td>
    </>
  );
}

/** 统一视图：一个横向滚动容器，长行完整可读 */
function Unified({ parsed, wrap }: { parsed: ParsedDiff; wrap: boolean }) {
  return (
    <table className={`difftable ${wrap ? 'difftable--wrap' : ''}`}>
      <tbody>
        {parsed.hunks.map((h, hi) => (
          <HunkRows key={hi} hunk={h} view="unified" />
        ))}
      </tbody>
    </table>
  );
}

function HunkRows({
  hunk,
  view,
}: {
  hunk: ParsedDiff['hunks'][number];
  view: 'unified' | 'split';
}) {
  if (view === 'unified') {
    return (
      <>
        <tr className="hunk-h">
          <td colSpan={4}>
            {hunk.header}
            {hunk.section ? <span className="hunk-sec"> {hunk.section}</span> : null}
          </td>
        </tr>
        {hunk.rows.map((r, i) => (
          <tr key={i} className={r.kind === 'add' ? 'add' : r.kind === 'del' ? 'del' : ''}>
            <RowCells r={r} side="unified" />
          </tr>
        ))}
      </>
    );
  }
  return null;
}

/** 把连续 del/add 配对成左右两行，便于并排阅读 */
function pairRows(rows: DiffRow[]): Array<{ l?: DiffRow; r?: DiffRow }> {
  const out: Array<{ l?: DiffRow; r?: DiffRow }> = [];
  let i = 0;
  while (i < rows.length) {
    const r = rows[i];
    if (r.kind === 'ctx') {
      out.push({ l: r, r });
      i++;
      continue;
    }
    const dels: DiffRow[] = [];
    const adds: DiffRow[] = [];
    while (i < rows.length && rows[i].kind === 'del') dels.push(rows[i++]);
    while (i < rows.length && rows[i].kind === 'add') adds.push(rows[i++]);
    if (!dels.length && !adds.length) {
      i++;
      continue;
    }
    for (let k = 0; k < Math.max(dels.length, adds.length); k++) {
      out.push({ l: dels[k], r: adds[k] });
    }
  }
  return out;
}

/**
 * 并排视图：左右各一个横向滚动容器，滚动位置同步。
 * 窄窗口下每个 pane 独立可滚，长行不会被截断。
 */
function Split({ parsed, wrap }: { parsed: ParsedDiff; wrap: boolean }) {
  const left = useRef<HTMLDivElement>(null);
  const right = useRef<HTMLDivElement>(null);
  const lock = useRef(false);

  const sync = (from: 'l' | 'r') => () => {
    if (lock.current) return;
    lock.current = true;
    const a = from === 'l' ? left.current : right.current;
    const b = from === 'l' ? right.current : left.current;
    if (a && b) b.scrollLeft = a.scrollLeft;
    requestAnimationFrame(() => {
      lock.current = false;
    });
  };

  // 换行模式无横向滚动，重置位置避免残留
  useLayoutEffect(() => {
    if (!wrap) return;
    if (left.current) left.current.scrollLeft = 0;
    if (right.current) right.current.scrollLeft = 0;
  }, [wrap]);

  return (
    <div className={`splitview ${wrap ? 'splitview--wrap' : ''}`}>
      <div className="splitpane" ref={left} onScroll={sync('l')}>
        <table className={`difftable ${wrap ? 'difftable--wrap' : ''}`}>
          <tbody>
            {parsed.hunks.map((h, hi) => (
              <SplitHunks key={hi} hunk={h} side="left" />
            ))}
          </tbody>
        </table>
      </div>
      <div className="splitpane" ref={right} onScroll={sync('r')}>
        <table className={`difftable ${wrap ? 'difftable--wrap' : ''}`}>
          <tbody>
            {parsed.hunks.map((h, hi) => (
              <SplitHunks key={hi} hunk={h} side="right" />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SplitHunks({
  hunk,
  side,
}: {
  hunk: ParsedDiff['hunks'][number];
  side: 'left' | 'right';
}) {
  const pairs = pairRows(hunk.rows);
  const count = side === 'left' ? hunk.rows.filter((r) => r.kind !== 'add').length : hunk.rows.filter((r) => r.kind !== 'del').length;
  return (
    <>
      <tr className="hunk-h">
        <td colSpan={2}>
          {side === 'left' ? hunk.header : `+${hunk.header.replace(/^@@ -[\d,]+ \+/, '@@ +')}`}
          {side === 'left' && hunk.section ? <span className="hunk-sec"> {hunk.section}</span> : null}
          <span className="hunk-sec" style={{ float: 'right' }}>{count} 行</span>
        </td>
      </tr>
      {pairs.map((p, i) => {
        const r = side === 'left' ? p.l : p.r;
        if (!r) {
          return (
            <tr key={i} className="paired-empty">
              <td className="ln empty" />
              <td className="code empty" />
            </tr>
          );
        }
        return (
          <tr key={i} className={r.kind === 'add' ? 'add' : r.kind === 'del' ? 'del' : ''}>
            <RowCells r={r} side={side} />
          </tr>
        );
      })}
    </>
  );
}

/* ── 文件列表 ─────────────────────────────────────────────── */

export function ReviewFileList({
  files,
  cur,
  onPick,
  onClose,
}: {
  files: ReviewFile[];
  cur: string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const list = files.filter((f) => f.path.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <div className="files__head">
        <span style={{ fontWeight: 600, flex: 1 }}>{files.length} 个文件</span>
        <button className="icon-btn icon-btn--sm" onClick={onClose} aria-label="收起文件列表" title="收起文件列表">
          <I n="chevL" s={14} />
        </button>
      </div>
      <label className="files__search">
        <I n="search" s={13} />
        <input placeholder="筛选文件" value={q} onChange={(e) => setQ(e.target.value)} aria-label="筛选文件" />
      </label>
      <div className="files__list">
        {list.length === 0 ? <p className="meta" style={{ padding: '8px 10px' }}>没有匹配的文件</p> : null}
        {list.map((f) => {
          const name = f.path.slice(f.path.lastIndexOf('/') + 1);
          const dir = f.path.slice(0, f.path.lastIndexOf('/'));
          const p = parseUnifiedDiff(f.diff);
          const nonText = f.kind !== 'text';
          return (
            <button
              key={f.id}
              className="file-btn"
              aria-current={cur === f.id}
              onClick={() => onPick(f.id)}
              title={f.path}
            >
              <span className="file-btn__name">
                <span>{name}</span>
                {nonText ? (
                  <span className="tag" style={{ height: 17, fontSize: 11 }}>
                    {KIND_LABEL[f.kind]}
                  </span>
                ) : null}
                {p.additions ? <span className="plus">+{p.additions}</span> : null}
                {p.deletions ? <span className="minus">−{p.deletions}</span> : null}
              </span>
              <span className="file-btn__dir" style={{ display: 'block' }}>
                {dir}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

const KIND_LABEL: Record<string, string> = {
  text: '文本',
  binary: '二进制',
  symlink: '符号链接',
  submodule: '子模块',
  limited: '超出上限',
  unreadable: '无法读取',
};

/* ── diff 面板 ────────────────────────────────────────────── */

export function ReviewDiff({
  file,
  files,
  prefs,
  onPrefs,
  index,
  onStep,
  filesOpen,
  onOpenFiles,
  longLineWidth,
}: {
  file: ReviewFile;
  files: ReviewFile[];
  prefs: DiffPrefs;
  onPrefs: (p: Partial<DiffPrefs>) => void;
  index: number;
  onStep: (d: 1 | -1) => void;
  filesOpen: boolean;
  onOpenFiles: () => void;
  /** 可用代码宽度，用于判断是否需要提示长行 */
  longLineWidth: number;
}) {
  const parsed = parseUnifiedDiff(file.diff);
  const nonText = file.kind !== 'text';
  const long = parsed.hunks.some((h) => h.rows.some((r) => r.text.length > 110));
  const charW = 7.5;
  const overflowPx = Math.max(0, Math.round(longLineWidth / charW) - 0);
  const needsScroll = !prefs.wrap && long && overflowPx < 200;

  return (
    <div className="diffcol">
      <div className="diffbar">
        {!filesOpen ? (
          <button className="btn btn--quiet btn--sm" onClick={onOpenFiles} title="展开文件列表">
            <I n="sidebar" s={14} />
            {files.length} 个文件
          </button>
        ) : null}
        <span className="diffbar__path" title={file.path}>
          {file.path}
        </span>
        {!nonText ? (
          <>
            <span className="plus">+{parsed.additions}</span>
            <span className="minus">−{parsed.deletions}</span>
          </>
        ) : null}
        <span className="meta nowrap">
          {index + 1} / {files.length}
        </span>
        <button className="icon-btn icon-btn--sm" onClick={() => onStep(-1)} aria-label="上一个文件" title="上一个文件 (K)">
          <I n="chevL" s={14} />
        </button>
        <button className="icon-btn icon-btn--sm" onClick={() => onStep(1)} aria-label="下一个文件" title="下一个文件 (J)">
          <I n="chevR" s={14} />
        </button>
        <button
          className="icon-btn icon-btn--sm"
          aria-pressed={prefs.wrap}
          onClick={() => onPrefs({ wrap: !prefs.wrap })}
          title={prefs.wrap ? '长行折行显示中，点击改为水平滚动' : '长行水平滚动中，点击改为折行显示'}
          aria-label="长行换行"
        >
          <I n="wrap" s={14} />
        </button>
        <div className="seg" role="tablist" aria-label="差异显示方式">
          <button role="tab" aria-selected={prefs.mode === 'unified'} onClick={() => onPrefs({ mode: 'unified' })}>
            统一
          </button>
          <button role="tab" aria-selected={prefs.mode === 'split'} onClick={() => onPrefs({ mode: 'split' })}>
            并排
          </button>
        </div>
      </div>

      {nonText ? (
        <div className="diff-note">
          <I n="warn" s={14} />
          <span>
            这个文件是「{KIND_LABEL[file.kind]}」，后端不提供逐行差异。
            {file.kind === 'limited' ? ' 内容超出单文件上限，不能接受。' : null}
          </span>
        </div>
      ) : (
        <>
          {needsScroll ? (
            <div className="diff-note">
              <I n="arrowR" s={14} />
              <span>本文件有较长代码行。水平滚动可完整阅读，或切换为折行显示。</span>
            </div>
          ) : null}
          <div className={`diff ${prefs.wrap ? 'diff--wrap' : ''}`}>
            {parsed.hunks.length === 0 ? (
              <p className="meta" style={{ padding: '14px 18px' }}>
                {parsed.unparsed.length
                  ? '这个文件的差异不是标准统一格式，无法逐行解析。'
                  : '没有逐行差异（文件内容与基线相同）。'}
              </p>
            ) : prefs.mode === 'split' ? (
              <Split parsed={parsed} wrap={prefs.wrap} />
            ) : (
              <Unified parsed={parsed} wrap={prefs.wrap} />
            )}
          </div>
          {parsed.unparsed.length ? (
            <details className="diff-raw">
              <summary>{parsed.unparsed.length} 行未能解析，按原文保留</summary>
              <pre>{parsed.unparsed.join('\n')}</pre>
            </details>
          ) : null}
        </>
      )}
    </div>
  );
}

export { HUNK_PREFIX };

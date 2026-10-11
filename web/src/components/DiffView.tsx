import { useState } from 'react';
import type { DiffFile, DiffHunk } from '../domain/types.ts';
import { Icon } from './Icons.tsx';
import { basename, dirname, langOf } from '../lib/format.ts';

/* ─────────────────────────────────────────────────────────────
   Diff 渲染
   只为「读」设计：不提供编辑、不提供行内评论锚点，
   修改意见在任务工作台里作为整体指令发出。
   ───────────────────────────────────────────────────────────── */

const SIGN: Record<string, string> = { add: '+', del: '−', ctx: ' ' };

function Hunk({ hunk }: { hunk: DiffHunk }) {
  return (
    <>
      <div className="difftable__hunk">{hunk.header}</div>
      {hunk.lines.map((l, i) => (
        <div key={i} className={`diffrow diffrow--${l.kind}`}>
          <span className="diffrow__ln">{l.oldNo ?? ''}</span>
          <span className="diffrow__ln">{l.newNo ?? ''}</span>
          <span className="diffrow__sign">{SIGN[l.kind]}</span>
          <span className="diffrow__text">{l.text || ' '}</span>
        </div>
      ))}
    </>
  );
}

export function DiffView({ file, open = true }: { file: DiffFile; open?: boolean }) {
  const [expanded, setExpanded] = useState(open);

  return (
    <details className="diff-file" open={expanded} onToggle={(e) => setExpanded((e.target as HTMLDetailsElement).open)}>
      <summary className="diff-file__head">
        <Icon
          name={file.kind === 'add' ? 'plus' : file.kind === 'delete' ? 'x' : 'diff'}
          size={12}
        />
        <span className="diff-file__path grow" title={file.path}>
          <span className="dim">{dirname(file.path)}/</span>
          {basename(file.path)}
        </span>
        <span className="chip chip--plain-dim">{langOf(file.path)}</span>
        <span className="stat stat--add">+{file.additions}</span>
        <span className="stat stat--del">−{file.deletions}</span>
      </summary>

      {file.binary ? (
        <div className="diff-file__head" style={{ cursor: 'default' }}>
          <Icon name="file" size={12} />
          <span className="sec fs-sm">二进制文件，不展示逐行差异</span>
        </div>
      ) : file.hunks.length === 0 ? (
        <div className="difftable__hunk">（演示数据未包含该文件的逐行差异）</div>
      ) : (
        <div className="difftable">
          {file.hunks.map((h, i) => (
            <Hunk key={i} hunk={h} />
          ))}
        </div>
      )}
    </details>
  );
}

/** 大量文件时的分组渲染：默认只展开前 N 个，其余折叠成一个入口 */
export function DiffList({
  files,
  autoOpen = 3,
}: {
  files: DiffFile[];
  autoOpen?: number;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? files : files.slice(0, autoOpen);
  const rest = files.length - visible.length;

  if (files.length === 0) {
    return (
      <div className="empty">
        <Icon name="diff" size={22} />
        <div className="empty__title">没有变更</div>
        <div className="empty__desc">
          本轮没有产生文件改动，或改动尚未写入工作区。
        </div>
      </div>
    );
  }

  return (
    <div className="col gap-4">
      {visible.map((f) => (
        <DiffView key={f.path} file={f} />
      ))}
      {rest > 0 ? (
        <button type="button" className="btn btn--ghost" onClick={() => setShowAll(true)}>
          <Icon name="chevronDown" size={12} />
          展开其余 {rest} 个文件
        </button>
      ) : files.length > autoOpen && showAll ? (
        <button type="button" className="btn btn--ghost" onClick={() => setShowAll(false)}>
          <Icon name="chevronRight" size={12} />
          收起
        </button>
      ) : null}
    </div>
  );
}

/** 变更文件总览表 —— 大量文件时比逐个 diff 更容易扫 */
export function FileTable({
  files,
  onPick,
}: {
  files: DiffFile[];
  onPick?: (path: string) => void;
}) {
  return (
    <table className="flist">
      <thead>
        <tr>
          <th>文件</th>
          <th>类型</th>
          <th className="flist__num">新增</th>
          <th className="flist__num">删除</th>
        </tr>
      </thead>
      <tbody>
        {files.map((f) => (
          <tr key={f.path}>
            <td>
              <span className="row gap-3" style={{ minWidth: 0 }}>
                <Icon
                  name={f.kind === 'add' ? 'plus' : f.kind === 'delete' ? 'x' : 'diff'}
                  size={11}
                />
                {onPick ? (
                  <button
                    type="button"
                    className="copy"
                    style={{ color: 'var(--text)', fontSize: 'var(--fs-sm)' }}
                    onClick={() => onPick(f.path)}
                    title={f.path}
                  >
                    <span className="truncate">{f.path}</span>
                  </button>
                ) : (
                  <span className="truncate" title={f.path}>
                    {f.path}
                  </span>
                )}
              </span>
            </td>
            <td className="dim fs-xs nowrap">
              {f.kind === 'add' ? '新增' : f.kind === 'delete' ? '删除' : f.kind === 'rename' ? '重命名' : '修改'}
            </td>
            <td className="flist__num stat--add">{f.additions || ''}</td>
            <td className="flist__num stat--del">{f.deletions || ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

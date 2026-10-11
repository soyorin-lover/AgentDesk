import type { ReactNode } from 'react';
import type { RunStatus as BackendRunStatus, TaskStatus } from './backend/types.ts';

/** 界面用它渲染状态：任务状态来自后端，运行状态可选 */
export interface StatusInput {
  status: TaskStatus;
  run: BackendRunStatus | null;
}

/* 单一状态表达：一行文字 + 一个圆点。
   任务阶段与运行状态合并为一句准确的话，而不是并排两枚徽章。 */
export function primaryStatus(t: StatusInput): { cls: string; label: string } {
  switch (t.status) {
    case 'draft':
      return { cls: 'st--none', label: '草稿' };
    case 'ready':
      return { cls: '', label: '就绪' };
    case 'in_progress':
      return runStatus(t.run);
    case 'in_review':
      return { cls: 'st--review', label: '待审查' };
    case 'accepted':
      return { cls: 'st--ok', label: '已接受 · 未集成' };
  }
}

export function runStatus(r: BackendRunStatus | null): { cls: string; label: string } {
  switch (r) {
    // 后端把「启动中」也表示为 running + phase，这里统一显示为执行中
    case 'running':
      return { cls: 'st--run', label: '执行中' };
    case 'succeeded':
      return { cls: 'st--ok', label: '执行完成' };
    case 'failed':
      return { cls: 'st--bad', label: '执行失败' };
    case 'aborted':
      return { cls: '', label: '已中止' };
    case 'needs_recovery':
      return { cls: 'st--wait', label: '结果未知 · 待恢复' };
    default:
      return { cls: 'st--none', label: '未开始' };
  }
}

export function Status({ t }: { t: StatusInput }) {
  const s = primaryStatus(t);
  return <span className={`st ${s.cls}`}>{s.label}</span>;
}

/* 轻量正文渲染：段落、有序/无序列表、行内代码。不引入 Markdown 依赖。 */
function inline(text: string): ReactNode[] {
  return text.split(/(`[^`]+`)/g).map((part, i) =>
    part.startsWith('`') && part.endsWith('`') ? <code key={i}>{part.slice(1, -1)}</code> : part,
  );
}

export function Prose({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <>
      {blocks.map((b, i) => {
        const lines = b.split('\n');
        if (lines.every((l) => /^\d+\.\s/.test(l))) {
          return (
            <ol key={i}>
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\d+\.\s/, ''))}</li>
              ))}
            </ol>
          );
        }
        if (lines.every((l) => /^-\s/.test(l))) {
          return (
            <ul key={i}>
              {lines.map((l, j) => (
                <li key={j}>{inline(l.slice(2))}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i}>
            {lines.map((l, j) => (
              <span key={j}>
                {inline(l)}
                {j < lines.length - 1 ? <br /> : null}
              </span>
            ))}
          </p>
        );
      })}
    </>
  );
}

/* Markdown 文档预览（文件面板用） */
export function MdPreview({ text }: { text: string }) {
  const out: ReactNode[] = [];
  const lines = text.split('\n');
  let list: string[] = [];
  const flush = () => {
    if (list.length) {
      out.push(
        <ul key={`u${out.length}`}>
          {list.map((l, i) => (
            <li key={i}>{inline(l)}</li>
          ))}
        </ul>,
      );
      list = [];
    }
  };
  lines.forEach((l, i) => {
    if (l.startsWith('- ')) {
      list.push(l.slice(2));
      return;
    }
    flush();
    if (l.startsWith('# ')) out.push(<h1 key={i}>{l.slice(2)}</h1>);
    else if (l.startsWith('## ')) out.push(<h2 key={i}>{l.slice(3)}</h2>);
    else if (l.trim()) out.push(<p key={i}>{inline(l)}</p>);
  });
  flush();
  return <div className="md">{out}</div>;
}

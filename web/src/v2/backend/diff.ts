/**
 * 统一 diff 文本 → 行模型。
 *
 * 真实后端 `ReviewFile.diff` 是统一 diff **文本**
 * （见 src/backend/types.ts 的 `diff?: string`），不是结构化 hunk。
 * 界面因此必须在客户端解析 —— 演示数据也走同一条路径，
 * 保证接线时不需要改组件。
 */

export interface DiffRow {
  /** 行号；该侧没有这一行时为 null */
  oldNo: number | null;
  newNo: number | null;
  kind: 'ctx' | 'add' | 'del';
  /** 不含前导标记的正文 */
  text: string;
}

export interface DiffHunk {
  header: string;
  /** @@ 之后的上下文（函数签名等） */
  section: string;
  rows: DiffRow[];
}

export interface ParsedDiff {
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
  /** 解析失败的行（保持原样展示，不静默丢弃） */
  unparsed: string[];
}

const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/;

export function parseUnifiedDiff(text: string | undefined | null): ParsedDiff {
  const out: ParsedDiff = { hunks: [], additions: 0, deletions: 0, unparsed: [] };
  if (!text) return out;

  let cur: DiffHunk | null = null;
  let oldN = 0;
  let newN = 0;

  for (const raw of text.split('\n')) {
    const m = HUNK_RE.exec(raw);
    if (m) {
      oldN = Number(m[1]);
      newN = Number(m[2]);
      cur = { header: raw, section: m[3].trim(), rows: [] };
      out.hunks.push(cur);
      continue;
    }

    // 文件头（--- / +++ / diff --git / index）不进入行模型
    if (
      raw.startsWith('diff --git') ||
      raw.startsWith('index ') ||
      raw.startsWith('--- ') ||
      raw.startsWith('+++ ') ||
      raw.startsWith('new file') ||
      raw.startsWith('deleted file') ||
      raw.startsWith('similarity index') ||
      raw.startsWith('rename ')
    ) {
      continue;
    }

    if (!cur) {
      // 没有 hunk 头就出现内容：视为不完整，保留原文而不是丢掉
      if (raw.trim()) out.unparsed.push(raw);
      continue;
    }

    if (raw === '') {
      // 空行在 diff 里通常是上下文空行
      cur.rows.push({ oldNo: oldN++, newNo: newN++, kind: 'ctx', text: '' });
      continue;
    }

    const mark = raw[0];
    const body = raw.slice(1);
    if (mark === '+') {
      cur.rows.push({ oldNo: null, newNo: newN++, kind: 'add', text: body });
      out.additions += 1;
    } else if (mark === '-') {
      cur.rows.push({ oldNo: oldN++, newNo: null, kind: 'del', text: body });
      out.deletions += 1;
    } else if (mark === ' ') {
      cur.rows.push({ oldNo: oldN++, newNo: newN++, kind: 'ctx', text: body });
    } else if (mark === '\\') {
      // "\ No newline at end of file" —— 不是内容行
      continue;
    } else {
      out.unparsed.push(raw);
    }
  }

  return out;
}

/** 由 hunk 行模型还原统一 diff 文本（演示数据构造用） */
export function buildUnifiedDiff(
  hunks: Array<{ oldStart: number; newStart: number; header: string; lines: string[] }>,
): string {
  const out: string[] = [];
  for (const h of hunks) {
    const oldCount = h.lines.filter((l) => !l.startsWith('+')).length;
    const newCount = h.lines.filter((l) => !l.startsWith('-')).length;
    const sec = h.header ? ` ${h.header}` : '';
    out.push(`@@ -${h.oldStart},${oldCount} +${h.newStart},${newCount} @@${sec}`);
    out.push(...h.lines);
  }
  return out.join('\n');
}

/** 纯新增文件：整个内容都是 + 行 */
export function buildAddedFileDiff(lines: string[]): string {
  return [`@@ -0,0 +1,${lines.length} @@`, ...lines.map((l) => `+${l}`)].join('\n');
}

/** 是否需要横向滚动 / 换行才能完整阅读（用于给出提示） */
export function longestLine(p: ParsedDiff): number {
  let n = 0;
  for (const h of p.hunks) for (const r of h.rows) if (r.text.length > n) n = r.text.length;
  return n;
}

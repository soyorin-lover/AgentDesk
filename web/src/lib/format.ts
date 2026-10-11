/* 展示格式化。与业务无关的纯函数，便于单测与替换。 */

const pad = (n: number): string => String(n).padStart(2, '0');

/** 演示时间线的相对时间。now 由调用方注入，避免隐藏的时钟依赖。 */
export function relTime(ms: number, now: number): string {
  const diff = now - ms;
  const abs = Math.abs(diff);
  const future = diff < 0;
  const s = Math.round(abs / 1000);
  if (s < 10) return future ? '即将' : '刚刚';
  if (s < 60) return future ? `${s} 秒后` : `${s} 秒前`;
  const m = Math.round(s / 60);
  if (m < 60) return future ? `${m} 分钟后` : `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return future ? `${h} 小时后` : `${h} 小时前`;
  const d = Math.round(h / 24);
  return future ? `${d} 天后` : `${d} 天前`;
}

/** 绝对时刻 HH:MM:SS */
export function clock(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** HH:MM（用于列表里的次要时间） */
export function clockShort(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 日期 + 时刻 */
export function stamp(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${clock(ms)}`;
}

/** 时长：946ms → "0.95s"，9500 → "9.5s"，72_000 → "1m 12s" */
export function duration(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1_000) return `${ms}ms`;
  const s = ms / 1_000;
  if (s < 60) return `${s.toFixed(s < 10 ? 2 : 1).replace(/\.?0+$/, '')}s`;
  const m = Math.floor(s / 60);
  const rest = Math.round(s - m * 60);
  return `${m}m ${rest}s`;
}

/**
 * 长路径压缩：保留尾部若干段，前面换成 …。
 * 完整路径通过 title 属性给出，避免信息丢失。
 */
export function shortPath(p: string, keepSegments = 3): string {
  const norm = p.replace(/\\/g, '/');
  const parts = norm.split('/').filter(Boolean);
  if (parts.length <= keepSegments) return p;
  return `…/${parts.slice(-keepSegments).join('/')}`;
}

/** 路径末尾的文件名 */
export function basename(p: string): string {
  const norm = p.replace(/\\/g, '/');
  return norm.slice(norm.lastIndexOf('/') + 1);
}

/** 路径中除文件名外的部分 */
export function dirname(p: string): string {
  const norm = p.replace(/\\/g, '/');
  const i = norm.lastIndexOf('/');
  return i < 0 ? '' : norm.slice(0, i);
}

/** +12 / −8 */
export function diffStat(additions: number, deletions: number): string {
  return `+${additions} −${deletions}`;
}

/** 大数字千分位 */
export function num(n: number): string {
  return n.toLocaleString('zh-CN');
}

/** 文件变更类型的中文标签 */
export const FILE_KIND_LABEL: Record<string, string> = {
  add: '新增',
  modify: '修改',
  delete: '删除',
  rename: '重命名',
};

/** 依据文件后缀给一个克制的语法提示色，不做真实高亮 */
export function langOf(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  const map: Record<string, string> = {
    ts: 'TypeScript',
    tsx: 'TypeScript',
    js: 'JavaScript',
    mjs: 'JavaScript',
    json: 'JSON',
    md: 'Markdown',
    css: 'CSS',
    sql: 'SQL',
    yml: 'YAML',
    yaml: 'YAML',
  };
  return map[ext] ?? ext.toUpperCase();
}

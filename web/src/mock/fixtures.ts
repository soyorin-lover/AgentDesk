import type {
  ApprovalEvent,
  Check,
  CommandEvent,
  DiffFile,
  DiffHunk,
  DiffLine,
  FileChangeEvent,
  QuestionEvent,
  Run,
  Task,
  Workspace,
} from '../domain/types.ts';

/* ─────────────────────────────────────────────────────────────
   演示数据种子
   ⚠️ 全部为构造数据。不来自真实 Codex 执行，不表示任何真实
   节省工时、Token 消耗或成功率。时间基准 2026-10-08。
   ───────────────────────────────────────────────────────────── */

const T0 = Date.parse('2026-10-08T09:12:00+08:00');

/** 相对基准的毫秒时间戳，便于让演示时间线保持连续 */
const at = (minutes: number, seconds = 0): number =>
  T0 + minutes * 60_000 + seconds * 1_000;

/* ── diff 构造辅助 ────────────────────────────────────────── */

let lineNo = 0;
const ctx = (text: string): DiffLine => ({
  kind: 'ctx',
  oldNo: ++lineNo,
  newNo: lineNo,
  text,
});
const add = (text: string): DiffLine => ({
  kind: 'add',
  oldNo: null,
  newNo: ++lineNo,
  text,
});
const del = (text: string): DiffLine => {
  const o = ++lineNo;
  return { kind: 'del', oldNo: o, newNo: null, text };
};
const hunk = (header: string, lines: DiffLine[]): DiffHunk => ({
  header,
  lines,
});

/** 用真实行号重排一个 hunk 的行，避免手写行号出错 */
function buildFile(
  path: string,
  kind: DiffFile['kind'],
  hunksIn: Array<{ header: string; lines: DiffLine[] }>,
): DiffFile {
  const files: DiffFile = {
    path,
    kind,
    additions: 0,
    deletions: 0,
    hunks: [],
  };
  for (const h of hunksIn) {
    files.hunks.push(h);
    for (const l of h.lines) {
      if (l.kind === 'add') files.additions++;
      if (l.kind === 'del') files.deletions++;
    }
  }
  return files;
}

export function diffFiles(): DiffFile[] {
  return [
    buildFile('src/sync/loop.ts', 'modify', [
      (() => {
        lineNo = 14;
        return hunk('@@ -14,17 +14,30 @@ export async function syncLoop(ctx: SyncContext): Promise<SyncReport> {', [
          ctx('  const report: SyncReport = { pulled: 0, skipped: 0 }'),
          ctx('  let page = await ctx.api.firstPage()'),
          del('  const seen = new Set<string>()'),
          del('  let guard = 0'),
          add('  // 游标改为按 updated_at 递增推进，替代全量 hash 去重。'),
          add('  // 服务端保证 updated_at 单调，因此只需记住上界。'),
          add('  let cursor = ctx.state.lastSyncedAt'),
          add('  let guard = 0'),
          ctx(''),
          ctx('  while (true) {'),
          del('    const batch = await ctx.api.list({ cursor: page })'),
          add('    const batch = await ctx.api.list({ since: cursor, cursor: page })'),
          ctx('    if (batch.items.length === 0) break'),
          ctx('    for (const tx of batch.items) {'),
          del('      if (seen.has(tx.hash)) {'),
          del('        report.skipped++'),
          del('        continue'),
          del('      }'),
          del('      seen.add(tx.hash)'),
          add('      if (compareUpdatedAt(tx.updatedAt, cursor) <= 0) {'),
          add('        report.skipped++'),
          add('        continue'),
          add('      }'),
          ctx('      await ctx.store.upsert(stripInternalFields(tx))'),
          ctx('      report.pulled++'),
          ctx('    }'),
          del('    if (!batch.next) break'),
          del('    page = batch.next'),
          add('    cursor = maxUpdatedAt(batch.items, cursor)'),
          add('    ctx.state.lastSyncedAt = cursor'),
          add('    await ctx.state.save()'),
          add('    if (!batch.next) break'),
          add('    page = batch.next'),
          ctx('    if (++guard > MAX_PAGES) throw new SyncGuardError(guard)'),
          ctx('  }'),
        ]);
      })(),
    ]),
    (() => {
      lineNo = 0;
      return buildFile('src/sync/cursor.ts', 'add', [
        hunk('@@ -0,0 +1,26 @@', [
          add('/**'),
          add(' * 增量同步游标工具。'),
          add(' *'),
          add(' * 存储的是服务端 updated_at 的最大值。比较前必须规范化，'),
          add(' * 因为服务端在不同端点上返回的精度不一致（秒 / 毫秒）。'),
          add(' */'),
          add('export type IsoCursor = string;'),
          add(''),
          add('const PRECISION = 1000;'),
          add(''),
          add('export function toMillis(value: IsoCursor): number {'),
          add('  const ms = Date.parse(value);'),
          add('  if (Number.isNaN(ms)) throw new TypeError(`非法游标: ${value}`)'),
          add('  return Math.floor(ms / PRECISION) * PRECISION'),
          add('}'),
          add(''),
          add('export function compareUpdatedAt(a: IsoCursor, b: IsoCursor): number {'),
          add('  return toMillis(a) - toMillis(b)'),
          add('}'),
          add(''),
          add('export function maxUpdatedAt(items: readonly { updatedAt: IsoCursor }[], fallback: IsoCursor): IsoCursor {'),
          add('  return items.reduce<IsoCursor>('),
          add('    (acc, item) => (compareUpdatedAt(item.updatedAt, acc) > 0 ? item.updatedAt : acc),'),
          add('    fallback,'),
          add('  )'),
          add('}'),
        ]),
      ]);
    })(),
    (() => {
      lineNo = 0;
      return buildFile('src/sync/__tests__/cursor.test.ts', 'add', [
        hunk('@@ -0,0 +1,23 @@', [
          add("import { describe, expect, it } from 'vitest'"),
          add("import { compareUpdatedAt, maxUpdatedAt, toMillis } from '../cursor.ts'"),
          add(''),
          add("describe('toMillis', () => {"),
          add('  it(\'把秒精度与毫秒精度归一到同一刻度\', () => {'),
          add("    expect(toMillis('2026-10-08T01:00:00Z')).toBe(toMillis('2026-10-08T01:00:00.000Z'))"),
          add('  })'),
          add(''),
          add("  it('遇到非法游标直接抛出，不静默兜底', () => {"),
          add("    expect(() => toMillis('not-a-date')).toThrow(TypeError)"),
          add('  })'),
          add('})'),
          add(''),
          add("describe('maxUpdatedAt', () => {"),
          add("  it('空页返回原游标，避免把进度倒退', () => {"),
          add("    expect(maxUpdatedAt([], '2026-10-08T01:00:00Z')).toBe('2026-10-08T01:00:00Z')"),
          add('  })'),
          add(''),
          add("  it('忽略比当前游标更旧的条目', () => {"),
          add('    const items = ['),
          add("      { updatedAt: '2026-10-08T00:59:00Z' },"),
          add("      { updatedAt: '2026-10-08T01:02:00Z' },"),
          add('    ]'),
          add("    expect(compareUpdatedAt('2026-10-08T01:00:00Z', maxUpdatedAt(items, '2026-10-08T01:00:00Z'))).toBeLessThan(0)"),
          add('  })'),
          add('})'),
        ]),
      ]);
    })(),
    (() => {
      lineNo = 40;
      return buildFile('src/store/schema.ts', 'modify', [
        hunk('@@ -40,6 +40,11 @@ export const migrations: Migration[] = [', [
          ctx("    name: '2026-10-05-add-retry-column',"),
          ctx("    up: (db) => db.exec('ALTER TABLE runs ADD COLUMN retry_of TEXT'),"),
          ctx('  },'),
          add('  {'),
          add("    name: '2026-10-08-index-updated-at',"),
          add('    up: (db) =>'),
          add('      db.exec('),
          add("        'CREATE INDEX IF NOT EXISTS idx_tx_updated_at ON transactions (updated_at)',"),
          add('      ),'),
          add('  },'),
          ctx(']'),
        ]),
      ]);
    })(),
    (() => {
      lineNo = 88;
      return buildFile('src/cli/commands.ts', 'modify', [
        hunk('@@ -88,7 +88,9 @@ export function registerSyncCommand(program: Command): void {', [
          ctx("    .option('--full', '忽略游标，全量重新同步')"),
          add("    .option('--dry-run', '只打印将要写入的条目数，不写库')"),
          ctx("    .action(async (opts) => {"),
          del('      const report = await syncLoop(await openContext(opts))'),
          add('      const ctx = await openContext(opts)'),
          add('      const report = await syncLoop(ctx, { dryRun: Boolean(opts.dryRun) })'),
          ctx("      console.log(`拉取 ${report.pulled}，跳过 ${report.skipped}`)"),
          ctx('    })'),
        ]),
      ]);
    })(),
  ];
}

/* ── 检查构造 ─────────────────────────────────────────────── */

const CHECK_TYPECHECK: Check = {
  id: 'chk-typecheck',
  name: '类型检查',
  command: 'npm run typecheck',
  status: 'passed',
  exitCode: 0,
  durationMs: 4_120,
  output: "> tsc --noEmit\n\n找到 0 个错误。",
  runId: 'run-2',
  startedAtMs: at(51, 12),
};

const CHECK_UNIT: Check = {
  id: 'chk-unit',
  name: '单元测试',
  command: 'npm test -- --run',
  status: 'passed',
  exitCode: 0,
  durationMs: 9_480,
  output:
    '> vitest run\n\n ✓ src/sync/__tests__/cursor.test.ts (4 tests) 12ms\n' +
    ' ✓ src/store/__tests__/migrations.test.ts (7 tests) 38ms\n' +
    ' ✓ src/sync/__tests__/loop.test.ts (11 tests) 96ms\n\n' +
    ' Test Files  3 passed (3)\n      Tests  22 passed (22)\n   Duration  9.48s',
  runId: 'run-2',
  startedAtMs: at(52, 5),
};

const CHECK_INTEGRATION: Check = {
  id: 'chk-integration',
  name: '集成测试（真实账单 API）',
  command: 'npm run test:integration -- --live-api',
  status: 'notRun',
  exitCode: null,
  durationMs: null,
  output: null,
  runId: null,
  startedAtMs: null,
};

const CHECK_LINT: Check = {
  id: 'chk-lint',
  name: 'Lint',
  command: 'npm run lint',
  status: 'notRun',
  exitCode: null,
  durationMs: null,
  output: null,
  runId: null,
  startedAtMs: null,
};

const CHECK_LINUX: Check = {
  id: 'chk-linux',
  name: 'Linux 上的单元测试',
  command: 'npm test -- --run',
  status: 'notRun',
  exitCode: null,
  durationMs: null,
  output: null,
  runId: null,
  startedAtMs: null,
};

/** 已中止任务的检查：一项跑过又因为中止没有结论 */
const CHECK_ABORTED: Check = {
  id: 'chk-aborted',
  name: '单元测试',
  command: 'npm test -- --run',
  status: 'error',
  exitCode: null,
  durationMs: 1_200,
  output:
    '> vitest run\n\n' +
    '进程在测试执行期间被中止（用户中止运行）。\n' +
    '没有得出通过或失败的结论 —— 不要按通过处理。',
  runId: 'run-abort',
  startedAtMs: at(-186, 30),
};

/** 失败任务的检查：真实失败 */
const CHECK_FAILED: Check = {
  id: 'chk-failed',
  name: '迁移回滚测试',
  command: 'npm test -- --run store/rollback',
  status: 'failed',
  exitCode: 1,
  durationMs: 6_300,
  output:
    '> vitest run store/rollback\n\n' +
    ' ❯ src/store/__tests__/rollback.test.ts (5 tests | 1 failed) 612ms\n' +
    '   × 回滚后 transactions 表仍然存在索引 idx_tx_updated_at\n' +
    '     → expected false to be true\n\n' +
    ' Test Files  1 failed (1)\n      Tests  1 failed | 4 passed (5)\n' +
    '   Duration  6.30s',
  runId: 'run-fail',
  startedAtMs: at(-104, 10),
};

/* ── 事件构造 ─────────────────────────────────────────────── */

interface Mk {
  id: string;
  runId: string;
  turnId: string;
  atMs: number;
}

export function agentMessage(
  m: Mk,
  text: string,
  phase: 'commentary' | 'final_answer' = 'commentary',
  pending = false,
): Run['events'][number] {
  return { ...m, kind: 'agentMessage', text, phase, pending };
}

export function userMessage(
  m: Mk,
  text: string,
  isSteer = false,
): Run['events'][number] {
  return { ...m, kind: 'userMessage', text, isSteer };
}

export function reasoning(m: Mk, summary: string[], text?: string): Run['events'][number] {
  return { ...m, kind: 'reasoning', summary, text };
}

export function command(
  m: Mk,
  command_: string,
  cwd: string,
  exitCode: number | null,
  durationMs: number | null,
  output: string,
  pending = false,
): CommandEvent {
  return {
    ...m,
    kind: 'command',
    command: command_,
    cwd,
    exitCode,
    durationMs,
    output,
    approval: null,
    pending,
  };
}

export function fileChange(
  m: Mk,
  status: FileChangeEvent['status'],
  changes: FileChangeEvent['changes'],
): FileChangeEvent {
  return { ...m, kind: 'fileChange', status, changes };
}

export function plan(m: Mk, text: string): Run['events'][number] {
  return { ...m, kind: 'plan', text };
}

export function question(
  m: Mk,
  q: Omit<QuestionEvent, keyof Mk | 'kind'>,
): QuestionEvent {
  return { ...m, kind: 'question', ...q };
}

export function approval(
  m: Mk,
  a: Omit<ApprovalEvent, keyof Mk | 'kind'>,
): ApprovalEvent {
  return { ...m, kind: 'approval', ...a };
}

export function errorEvent(
  m: Mk,
  message: string,
  willRetry: boolean,
  detail?: string,
): Run['events'][number] {
  return { ...m, kind: 'error', message, willRetry, detail };
}

export function warning(m: Mk, message: string): Run['events'][number] {
  return { ...m, kind: 'warning', message };
}

export function interrupted(
  m: Mk,
  reason: string,
  changesPreserved = true,
): Run['events'][number] {
  return { ...m, kind: 'interrupted', reason, changesPreserved };
}

export function info(m: Mk, text: string): Run['events'][number] {
  return { ...m, kind: 'info', text };
}

/* ── 工作区 ───────────────────────────────────────────────── */

export const WORKSPACES: Record<string, Workspace> = {
  t142: {
    repoPath: 'E:\\Projects\\fin-sync',
    worktreePath: 'E:\\Projects\\fin-sync\\.worktrees\\agentdesk-t142',
    branch: 'agentdesk/t142-incremental-sync',
    baseBranch: 'main',
    env: {
      os: 'Windows',
      node: 'v24.17.0',
      git: '2.53.0.windows.2',
      codexVersion: '0.162.0-alpha.2',
      connection: 'connected',
    },
    uncommitted: 8,
  },
  t143: {
    repoPath: 'E:\\Projects\\fin-sync',
    worktreePath: 'E:\\Projects\\fin-sync\\.worktrees\\agentdesk-t143',
    branch: 'agentdesk/t143-retry-classification',
    baseBranch: 'main',
    env: {
      os: 'Windows',
      node: 'v24.17.0',
      git: '2.53.0.windows.2',
      codexVersion: '0.162.0-alpha.2',
      connection: 'connected',
    },
    uncommitted: 3,
  },
  t144: {
    repoPath: 'E:\\Projects\\fin-sync',
    worktreePath: 'E:\\Projects\\fin-sync\\.worktrees\\agentdesk-t144',
    branch: 'agentdesk/t144-cursor-tests',
    baseBranch: 'main',
    env: {
      os: 'Windows',
      node: 'v24.17.0',
      git: '2.53.0.windows.2',
      codexVersion: '0.162.0-alpha.2',
      connection: 'connected',
    },
    uncommitted: 5,
  },
  t145: {
    repoPath: 'E:\\Projects\\fin-sync',
    worktreePath: 'E:\\Projects\\fin-sync\\.worktrees\\agentdesk-t145',
    branch: 'agentdesk/t145-dry-run',
    baseBranch: 'main',
    env: {
      os: 'Windows',
      node: 'v24.17.0',
      git: '2.53.0.windows.2',
      codexVersion: '0.162.0-alpha.2',
      connection: 'connected',
    },
    uncommitted: 2,
  },
  t140: {
    repoPath: 'E:\\Projects\\fin-sync',
    worktreePath: 'E:\\Projects\\fin-sync\\.worktrees\\agentdesk-t140',
    branch: 'agentdesk/t140-stream-csv',
    baseBranch: 'main',
    env: {
      os: 'Windows',
      node: 'v24.17.0',
      git: '2.53.0.windows.2',
      codexVersion: '0.162.0-alpha.2',
      connection: 'connected',
    },
    uncommitted: 6,
  },
  t139: {
    repoPath: 'E:\\Projects\\fin-sync',
    worktreePath: 'E:\\Projects\\fin-sync\\.worktrees\\agentdesk-t139',
    branch: 'agentdesk/t139-encrypt-cache',
    baseBranch: 'main',
    env: {
      os: 'Windows',
      node: 'v24.17.0',
      git: '2.53.0.windows.2',
      codexVersion: '0.162.0-alpha.2',
      connection: 'connected',
    },
    uncommitted: 4,
  },
  t141: {
    repoPath: 'E:\\Projects\\fin-sync',
    worktreePath: 'E:\\Projects\\fin-sync\\.worktrees\\agentdesk-t141',
    branch: 'agentdesk/t141-dedupe',
    baseBranch: 'main',
    env: {
      os: 'Windows',
      node: 'v24.17.0',
      git: '2.53.0.windows.2',
      codexVersion: '0.162.0-alpha.2',
      connection: 'connected',
    },
    uncommitted: 0,
  },
  t146: {
    repoPath: 'E:\\Projects\\fin-sync',
    worktreePath: '',
    branch: '',
    baseBranch: 'main',
    env: {
      os: 'Windows',
      node: 'v24.17.0',
      git: '2.53.0.windows.2',
      codexVersion: '0.162.0-alpha.2',
      connection: 'connected',
    },
    uncommitted: 0,
  },
};

export const CWD_142 = 'E:\\Projects\\fin-sync\\.worktrees\\agentdesk-t142';
export const CWD_143 = 'E:\\Projects\\fin-sync\\.worktrees\\agentdesk-t143';
export const CWD_144 = 'E:\\Projects\\fin-sync\\.worktrees\\agentdesk-t144';
export const CWD_145 = 'E:\\Projects\\fin-sync\\.worktrees\\agentdesk-t145';
export const CWD_140 = 'E:\\Projects\\fin-sync\\.worktrees\\agentdesk-t140';
export const CWD_139 = 'E:\\Projects\\fin-sync\\.worktrees\\agentdesk-t139';
export const CWD_141 = 'E:\\Projects\\fin-sync\\.worktrees\\agentdesk-t141';

export { at, T0, CHECK_INTEGRATION, CHECK_LINT, CHECK_LINUX, CHECK_TYPECHECK, CHECK_UNIT, CHECK_ABORTED, CHECK_FAILED };

export type { Task };

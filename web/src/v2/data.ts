/* ─────────────────────────────────────────────────────────────
   重设计样稿的演示数据。
   全部为构造内容，不来自真实执行。能力矩阵的「已验证」只引用
   AgentDesk/docs/CODEX-BATCH-01-RESULTS.md 中有真实证据的条目。
   ───────────────────────────────────────────────────────────── */

export type EngineId = 'codex' | 'claude-code' | 'deepseek';

export interface Engine {
  id: EngineId;
  name: string;
  mark: string;
  integrated: boolean;
  version?: string;
  note: string;
}

export const ENGINES: Engine[] = [
  {
    id: 'codex',
    name: 'Codex',
    mark: 'Cx',
    integrated: true,
    version: '0.154.0',
    note: '通过 App Server 接入。下列能力在 Windows 上有真实运行证据；Linux 尚未验证。',
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    mark: 'CC',
    integrated: false,
    note: '规划中。产品版本、接入协议与能力尚未核验，暂不能分派任务。',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek Harness',
    mark: 'DS',
    integrated: false,
    note: '规划中。产品版本、接入协议与能力尚未核验，暂不能分派任务。',
  },
];

export type CapState = 'verified' | 'partial' | 'unverified';

export interface Capability {
  name: string;
  state: CapState;
  note?: string;
}

/** 能力属于引擎 + 传输条件，同一引擎的实例共享这份证据 */
export const CODEX_CAPS: Capability[] = [
  { name: '文本输出与完成', state: 'verified' },
  { name: '修改指定文件并读取 diff', state: 'verified' },
  { name: '多轮上下文', state: 'verified' },
  { name: '进程重启后恢复会话', state: 'verified', note: '恢复的是会话上下文，不恢复已结束的外部进程' },
  { name: '执行中补充指令', state: 'partial', note: '补充指令会被接受，但不保证完整执行' },
  { name: '中止当前轮次', state: 'verified', note: '以 interrupted 终态确认；不回滚已写入的文件' },
  { name: '文件写入审批（允许 / 拒绝）', state: 'verified' },
  { name: '命令执行审批', state: 'unverified' },
  { name: '两个工作区并行', state: 'verified', note: '在示例仓库验证；不等于产品调度已实现' },
  { name: 'Linux 运行', state: 'unverified' },
];

export interface Agent {
  id: string;
  engine: EngineId;
  name: string;
  model: string;
  transport: string;
  status: 'ready' | 'limited';
  statusText: string;
  statusNote: string;
  lastCheck: string;
}

export const AGENTS: Agent[] = [
  {
    id: 'codex-eng',
    engine: 'codex',
    name: '工程实例',
    model: 'gpt-5.6-luna',
    transport: 'HTTP',
    status: 'ready',
    statusText: '可执行',
    statusNote: '最近一次执行正常完成。',
    lastCheck: '今天 10:48',
  },
  {
    id: 'codex-fast',
    engine: 'codex',
    name: '快速实例',
    model: 'gpt-6-astra',
    transport: 'HTTP',
    status: 'limited',
    statusText: '额度受限',
    statusNote:
      '最近一次执行返回 usageLimitExceeded。这是服务器原始错误，不能据此判断账户全部额度已用完；新任务暂不建议分派给它。',
    lastCheck: '今天 10:31',
  },
];

export const agentById = (id: string | null): Agent | undefined =>
  AGENTS.find((a) => a.id === id);
export const engineById = (id: EngineId): Engine =>
  ENGINES.find((e) => e.id === id) ?? ENGINES[0];

/* ── 任务 ─────────────────────────────────────────────────── */

export type TaskStatus =
  | 'draft'
  | 'ready'
  | 'inProgress'
  | 'inReview'
  | 'accepted'
  | 'integrated'
  | 'verified'
  | 'cancelled';

export type RunStatus =
  | 'queued'
  | 'running'
  | 'waitingUser'
  | 'succeeded'
  | 'failed'
  | 'interrupted'
  | 'resumable';

export interface Task {
  id: string;
  ref: string;
  title: string;
  agentId: string | null;
  status: TaskStatus;
  run: RunStatus | null;
  updated: string;
  branch: string;
  worktree: string;
  base: string;
  goal: string;
  acceptance: Array<{ text: string; met: boolean | null }>;
  runs: Array<{ n: number; status: RunStatus; at: string; note: string }>;
  /** 运行中时的经过时间与最新活动 */
  elapsed?: string;
  now?: string;
  changes?: { files: number; add: number; del: number };
}

const WT = 'E:\\Projects\\fin-sync\\.worktrees';

export const TASKS: Task[] = [
  {
    id: 't142',
    ref: 'T-142',
    title: '修复增量同步在分页边界重复写入的问题，并补充游标精度不一致时的回归测试',
    agentId: 'codex-eng',
    status: 'inProgress',
    run: 'running',
    updated: '刚刚',
    branch: 'agentdesk/t142-sync-page-boundary',
    worktree: `${WT}\\agentdesk-t142-sync-page-boundary`,
    base: '3c1d7ae',
    goal:
      '让 syncLoop 在服务端分页重叠、updated_at 精度不一致（秒 / 毫秒）时都不会重复写入或漏数据，同时不再随账单总量线性变慢。',
    acceptance: [
      { text: '第二次同步拉取的条目数只与新增和变更有关', met: null },
      { text: '同一条目被两页同时返回时只写入一次', met: null },
      { text: '秒与毫秒精度混用时不会把旧条目误判为新条目', met: null },
      { text: '新增的边界用例在单元测试中通过', met: null },
    ],
    runs: [{ n: 1, status: 'running', at: '09:24', note: '进行中' }],
    elapsed: '4 分 12 秒',
    now: '正在运行 npm test -- --run',
    changes: { files: 3, add: 58, del: 11 },
  },
  {
    id: 't143',
    ref: 'T-143',
    title: '重试策略：账户冻结归为永久失败，网络类错误按指数退避重试',
    agentId: 'codex-eng',
    status: 'inProgress',
    run: 'waitingUser',
    updated: '6 分钟前',
    branch: 'agentdesk/t143-retry-policy',
    worktree: `${WT}\\agentdesk-t143-retry-policy`,
    base: '3c1d7ae',
    goal: '把同步失败分为可重试与永久失败两类，避免被冻结的账户无限退避重试。',
    acceptance: [
      { text: '网络与 5xx 错误按指数退避重试，且有上限', met: null },
      { text: '账户冻结直接标记人工处理，不再排队', met: null },
      { text: '错误映射的测试快照已更新', met: null },
    ],
    runs: [{ n: 1, status: 'waitingUser', at: '10:41', note: '等待写入文件的确认' }],
    elapsed: '7 分钟',
  },
  {
    id: 't144',
    ref: 'T-144',
    title: '为增量同步补充游标工具与单元测试',
    agentId: 'codex-fast',
    status: 'inReview',
    run: 'succeeded',
    updated: '32 分钟前',
    branch: 'agentdesk/t144-sync-cursor',
    worktree: `${WT}\\agentdesk-t144-sync-cursor`,
    base: '3c1d7ae',
    goal: '提供游标工具及测试，锁住「游标只能前进」这一不变式。',
    acceptance: [
      { text: '原先失败的「第二次同步只拉变更」用例转为通过', met: true },
      { text: '秒 / 毫秒精度不一致时不误判', met: true },
      { text: '空页不会让游标回退', met: true },
      { text: '集成测试在真实账单 API 上通过', met: null },
    ],
    runs: [{ n: 1, status: 'succeeded', at: '10:02', note: '完成，6 个文件变更' }],
    changes: { files: 6, add: 79, del: 14 },
  },
  {
    id: 't145',
    ref: 'T-145',
    title: '迁移回滚测试：每个迁移都能回滚，且回滚后不残留索引',
    agentId: 'codex-fast',
    status: 'inProgress',
    run: 'failed',
    updated: '18 分钟前',
    branch: 'agentdesk/t145-migration-rollback',
    worktree: `${WT}\\agentdesk-t145-migration-rollback`,
    base: 'a88f102',
    goal: '为 schema.ts 中每个迁移补齐 down，并验证回滚后 transactions 表不残留自定义索引。',
    acceptance: [
      { text: '每个迁移都有 down 实现', met: null },
      { text: '回滚后不残留自定义索引', met: null },
    ],
    runs: [{ n: 1, status: 'failed', at: '10:24', note: '上游返回 usageLimitExceeded' }],
    changes: { files: 2, add: 78, del: 0 },
  },
  {
    id: 't139',
    ref: 'T-139',
    title: '本地缓存落盘前加密，缺少密钥时拒绝写入而不是降级为明文',
    agentId: 'codex-eng',
    status: 'accepted',
    run: 'succeeded',
    updated: '昨天',
    branch: 'agentdesk/t139-encrypt-cache',
    worktree: `${WT}\\agentdesk-t139-encrypt-cache`,
    base: '91b43cd',
    goal: '缓存写入磁盘前加密，缺失密钥时直接报错。',
    acceptance: [
      { text: '缓存文件不再是明文 JSON', met: true },
      { text: '缺少密钥时拒绝写入', met: true },
    ],
    runs: [{ n: 1, status: 'succeeded', at: '昨天 16:20', note: '完成，2 个文件变更' }],
    changes: { files: 2, add: 86, del: 9 },
  },
  {
    id: 't141',
    ref: 'T-141',
    title: '重复导入的交易按四元组去重并记录审计',
    agentId: 'codex-eng',
    status: 'verified',
    run: 'succeeded',
    updated: '3 天前',
    branch: 'agentdesk/t141-dedupe',
    worktree: `${WT}\\agentdesk-t141-dedupe`,
    base: '2f5c903',
    goal: '同一笔交易被两个来源导入时只保留一条，并留下审计记录。',
    acceptance: [{ text: '重复导入不产生第二条记录', met: true }],
    runs: [{ n: 1, status: 'succeeded', at: '10月5日', note: '已集成并验收' }],
  },
  {
    id: 't146',
    ref: 'T-146',
    title: '月度对账单导出为 PDF',
    agentId: null,
    status: 'draft',
    run: null,
    updated: '2 分钟前',
    branch: '',
    worktree: '',
    base: 'main',
    goal: '',
    acceptance: [],
    runs: [],
  },
];

/* ── 时间线 ───────────────────────────────────────────────── */

export interface Step {
  kind: 'read' | 'search' | 'cmd' | 'edit';
  label: string;
  status: 'ok' | 'fail' | 'running';
  meta?: string;
  output?: string;
}

export interface FileStat {
  path: string;
  add: number;
  del: number;
}

export type Item =
  | { k: 'turn'; text: string }
  | { k: 'user'; text: string; steer?: boolean }
  | { k: 'agent'; text: string; final?: boolean }
  | { k: 'activity'; id: string; steps: Step[] }
  | { k: 'changes'; files: FileStat[] }
  | {
      k: 'approval';
      id: string;
      title: string;
      reason: string;
      scope: string;
      files: FileStat[];
      state: 'pending' | 'accepted' | 'declined';
      at?: string;
    }
  | { k: 'failure'; title: string; body: string; preserved: string }
  | { k: 'note'; text: string };


export const TIMELINES: Record<string, Item[]> = {
  t142: [
    { k: 'turn', text: '第 1 轮 · 09:24 开始' },
    {
      k: 'user',
      text:
        'syncLoop 现在每轮都重新拉取全部交易，账单量上来以后明显变慢。请改成基于 updated_at 的增量拉取，并保证分页边界不会漏数据或重复写入。\n\n验收条件我已经写在任务里了，重点是第 2、3 条：分页重叠和精度不一致。',
    },
    {
      k: 'agent',
      text:
        '先确认两件事：`list` 端点返回的 `updated_at` 是否单调，以及现在写入路径在哪一步保证幂等。这两点决定了游标能不能替代现在的全量 hash 去重。',
    },
    {
      k: 'activity',
      id: 'a1',
      steps: [
        { kind: 'read', label: 'src/api/client.ts', status: 'ok', meta: '120 行' },
        { kind: 'read', label: 'src/sync/loop.ts', status: 'ok', meta: '64 行' },
        { kind: 'search', label: '在 src/store 中搜索 “upsert”', status: 'ok', meta: '4 处' },
        { kind: 'read', label: 'src/store/txStore.ts', status: 'ok', meta: '131 行' },
      ],
    },
    {
      k: 'agent',
      text:
        '排序保证成立：`client.ts` 的注释写明列表端点统一按 `updated_at` 升序返回。但同一处注释也提到，不同端点的精度不一致——有的到秒，有的到毫秒。这正是验收条件 3 要防的情况。\n\n另外 `txStore.upsertMany` 的注释说明去重责任在调用方，所以游标逻辑必须自己保证不重复写。我的计划：\n\n1. 新增 `cursor.ts`，比较前先把时间归一到同一刻度\n2. `syncLoop` 改为只信任游标上界，替代记住所有 hash 的集合\n3. 为精度混用、空页、比上界更旧的条目补单元测试',
    },
    {
      k: 'changes',
      files: [
        { path: 'src/sync/cursor.ts', add: 26, del: 0 },
        { path: 'src/sync/loop.ts', add: 21, del: 11 },
        { path: 'src/sync/__tests__/cursor.test.ts', add: 11, del: 0 },
      ],
    },
    {
      k: 'activity',
      id: 'a2',
      steps: [
        { kind: 'cmd', label: 'npm run typecheck', status: 'ok', meta: 'exit 0 · 4.4s', output: '> tsc --noEmit\n\n找到 0 个错误。' },
        {
          kind: 'cmd',
          label: 'npm test -- --run sync',
          status: 'fail',
          meta: 'exit 1 · 6.1s',
          output:
            '> vitest run sync\n\n FAIL  src/sync/__tests__/loop.test.ts > 分页重叠时只写入一次\n   AssertionError: expected 2 to be 1\n\n Test Files  1 failed | 1 passed (2)\n      Tests  1 failed | 15 passed (16)',
        },
      ],
    },
    {
      k: 'agent',
      text:
        '失败的用例正好暴露了我刚才的取舍：服务端在分页重叠时会再次返回同一条目，而它的 `updated_at` 恰好等于当前上界。`compareUpdatedAt` 返回 0，于是被当成「不比上界旧」又写了一次。\n\n修正方式是把跳过条件从 `<= 0` 之外再加一层页内去重：只保留当前页的临时集合，页处理完就释放。这样内存仍然不会随总量增长。改完后重新跑完整测试。',
    },
    {
      k: 'activity',
      id: 'a3',
      steps: [
        { kind: 'edit', label: 'src/sync/loop.ts', status: 'ok', meta: '+4 −3' },
        { kind: 'cmd', label: 'npm test -- --run', status: 'running', meta: '已运行 38 秒' },
      ],
    },
  ],

  t143: [
    { k: 'turn', text: '第 1 轮 · 10:41 开始' },
    {
      k: 'user',
      text: '把同步失败拆成「可重试」和「永久失败」。可重试的按退避重试，永久失败的直接标记人工处理，不要再排队。账户冻结算永久失败。',
    },
    {
      k: 'activity',
      id: 'b1',
      steps: [
        { kind: 'read', label: 'src/api/errors.ts', status: 'ok', meta: '38 行' },
        { kind: 'read', label: 'src/sync/queue.ts', status: 'ok', meta: '92 行' },
        { kind: 'search', label: '搜索 “ApiErrorKind” 的引用', status: 'ok', meta: '7 处' },
      ],
    },
    {
      k: 'agent',
      text:
        '`ApiErrorKind` 里还没有业务语义这一类，账户冻结目前会被归到 `badRequest`，进而走默认的退避重试——这就是冻结账户被无限重试的原因。\n\n我准备新增 `retry.ts` 承担分类，修改队列在永久失败时直接转人工，并同步更新错误映射的测试快照。写入前需要你确认。',
    },
    {
      k: 'approval',
      id: 'ap1',
      title: '写入 3 个文件',
      reason: '新增重试分类，并让队列在永久失败时停止重试；快照不更新的话会留下 23 个假失败。',
      scope: '只修改本任务工作区 agentdesk/t143-retry-policy 中的这 3 个文件；不影响 main，也不执行任何命令。',
      files: [
        { path: 'src/sync/retry.ts', add: 52, del: 0 },
        { path: 'src/sync/queue.ts', add: 14, del: 6 },
        { path: 'src/api/__tests__/__snapshots__/errors.test.ts.snap', add: 23, del: 23 },
      ],
      state: 'pending',
    },
  ],

  t144: [
    { k: 'turn', text: '第 1 轮 · 10:02 开始' },
    { k: 'user', text: '把增量同步的游标工具和测试补上。测试要覆盖：精度不一致、空页不前移游标、比上界更旧的条目被跳过。' },
    {
      k: 'activity',
      id: 'c1',
      steps: [
        { kind: 'read', label: 'src/sync/loop.ts', status: 'ok' },
        { kind: 'cmd', label: 'npm test -- --run', status: 'fail', meta: 'exit 1 · 7.4s（改动前的基线）' },
        { kind: 'edit', label: '6 个文件', status: 'ok', meta: '+79 −14' },
        { kind: 'cmd', label: 'npm run typecheck', status: 'ok', meta: 'exit 0 · 4.1s' },
        { kind: 'cmd', label: 'npm test -- --run', status: 'ok', meta: 'exit 0 · 9.5s' },
      ],
    },
    {
      k: 'agent',
      final: true,
      text:
        '完成。新增 `cursor.ts` 与测试，`syncLoop` 改用游标上界，并给 `transactions.updated_at` 加了索引。\n\n类型检查和单元测试通过（22 个用例）。集成测试和 Lint 没有运行：集成测试需要 `BILLING_API_TOKEN`，本机没有配置；Lint 是我没有主动跑。\n\n需要你判断的一点：我把逐条 `upsert` 改成了批量写入，写入失败时回滚的粒度会从一条变成一批。',
    },
  ],

  t145: [
    { k: 'turn', text: '第 1 轮 · 10:24 开始' },
    { k: 'user', text: '给 schema.ts 的迁移补回滚测试。每个迁移都要能 down 回去，且回滚后不残留索引。' },
    {
      k: 'activity',
      id: 'd1',
      steps: [
        { kind: 'read', label: 'src/store/schema.ts', status: 'ok' },
        { kind: 'edit', label: 'src/store/schema.ts', status: 'ok', meta: '+31' },
        { kind: 'edit', label: 'src/store/__tests__/rollback.test.ts', status: 'ok', meta: '+47' },
      ],
    },
    {
      k: 'failure',
      title: '本轮未完成：上游返回 usageLimitExceeded',
      body:
        '在准备运行回滚测试时，Codex · 快速实例（gpt-6-astra）的上游返回 usageLimitExceeded，本轮随之结束。这是服务器的原始错误，不能据此判断账户全部额度已用完。',
      preserved: '已写入的改动仍在工作区：2 个文件，+78 行。回滚测试尚未运行。',
    },
  ],
};

/* ── 审查：diff 与检查 ────────────────────────────────────── */

export interface Hunk {
  oldStart: number;
  newStart: number;
  header: string;
  /** 每行首字符：' ' 上下文，'+' 新增，'-' 删除 */
  lines: string[];
}

export interface DiffFile {
  path: string;
  kind: 'add' | 'modify';
  add: number;
  del: number;
  hunks: Hunk[];
}

export const REVIEW_FILES: DiffFile[] = [
  {
    path: 'src/sync/loop.ts',
    kind: 'modify',
    add: 15,
    del: 11,
    hunks: [
      {
        oldStart: 14,
        newStart: 14,
        header: 'export async function syncLoop(ctx: SyncContext): Promise<SyncReport> {',
        lines: [
          '   const report: SyncReport = { pulled: 0, skipped: 0 }',
          '   let page = await ctx.api.firstPage()',
          '-  const seen = new Set<string>()',
          '-  let guard = 0',
          '+  // 游标按 updated_at 递增推进，替代全量 hash 去重',
          '+  let cursor = ctx.state.lastSyncedAt',
          '+  let guard = 0',
          ' ',
          '   while (true) {',
          '-    const batch = await ctx.api.list({ cursor: page })',
          '+    const batch = await ctx.api.list({ since: cursor, cursor: page })',
          '     if (batch.items.length === 0) break',
          '+    const pageSeen = new Set<string>()',
          '     for (const tx of batch.items) {',
          '-      if (seen.has(tx.hash)) {',
          '+      if (compareUpdatedAt(tx.updatedAt, cursor) < 0 || pageSeen.has(tx.id)) {',
          '         report.skipped++',
          '         continue',
          '       }',
          '-      seen.add(tx.hash)',
          '+      pageSeen.add(tx.id)',
          '       await ctx.store.upsert(stripInternalFields(tx))',
          '       report.pulled++',
          '     }',
          '-    if (!batch.next) break',
          '-    page = batch.next',
          '-    if (++guard > MAX_PAGES) throw new SyncGuardError(guard)',
          '-  }',
          '+    cursor = maxUpdatedAt(batch.items, cursor)',
          '+    ctx.state.lastSyncedAt = cursor',
          '+    await ctx.state.save()',
          '+    if (!batch.next) break',
          '+    page = batch.next',
          '+    if (++guard > MAX_PAGES) throw new SyncGuardError(guard)',
          '+  }',
        ],
      },
    ],
  },
  {
    path: 'src/sync/cursor.ts',
    kind: 'add',
    add: 24,
    del: 0,
    hunks: [
      {
        oldStart: 0,
        newStart: 1,
        header: '',
        lines: [
          '+/**',
          '+ * 增量同步游标。存储服务端 updated_at 的最大值。',
          '+ * 比较前必须归一精度：不同端点返回秒或毫秒。',
          '+ */',
          '+export type IsoCursor = string',
          '+',
          '+const PRECISION = 1000',
          '+',
          "+export function toMillis(value: IsoCursor): number {",
          '+  const ms = Date.parse(value)',
          "+  if (Number.isNaN(ms)) throw new TypeError(`非法游标: ${value}`)",
          '+  return Math.floor(ms / PRECISION) * PRECISION',
          '+}',
          '+',
          '+export function compareUpdatedAt(a: IsoCursor, b: IsoCursor): number {',
          '+  return toMillis(a) - toMillis(b)',
          '+}',
          '+',
          '+export function maxUpdatedAt(items: readonly { updatedAt: IsoCursor }[], fallback: IsoCursor): IsoCursor {',
          '+  return items.reduce<IsoCursor>(',
          '+    (acc, item) => (compareUpdatedAt(item.updatedAt, acc) > 0 ? item.updatedAt : acc),',
          '+    fallback,',
          '+  )',
          '+}',
        ],
      },
    ],
  },
  {
    path: 'src/sync/__tests__/cursor.test.ts',
    kind: 'add',
    add: 18,
    del: 0,
    hunks: [
      {
        oldStart: 0,
        newStart: 1,
        header: '',
        lines: [
          "+import { describe, expect, it } from 'vitest'",
          "+import { compareUpdatedAt, maxUpdatedAt, toMillis } from '../cursor.ts'",
          '+',
          "+describe('toMillis', () => {",
          "+  it('把秒精度与毫秒精度归一到同一刻度', () => {",
          "+    expect(toMillis('2026-10-08T01:00:00Z')).toBe(toMillis('2026-10-08T01:00:00.000Z'))",
          '+  })',
          '+})',
          '+',
          "+describe('maxUpdatedAt', () => {",
          "+  it('空页返回原游标，不让进度倒退', () => {",
          "+    expect(maxUpdatedAt([], '2026-10-08T01:00:00Z')).toBe('2026-10-08T01:00:00Z')",
          '+  })',
          "+  it('忽略比当前游标更旧的条目', () => {",
          "+    const items = [{ updatedAt: '2026-10-08T00:59:00Z' }]",
          "+    expect(compareUpdatedAt(maxUpdatedAt(items, '2026-10-08T01:00:00Z'), '2026-10-08T01:00:00Z')).toBe(0)",
          '+  })',
          '+})',
        ],
      },
    ],
  },
  {
    path: 'src/store/schema.ts',
    kind: 'modify',
    add: 6,
    del: 0,
    hunks: [
      {
        oldStart: 40,
        newStart: 40,
        header: 'export const migrations: Migration[] = [',
        lines: [
          "     name: '2026-10-05-add-retry-column',",
          "     up: (db) => db.exec('ALTER TABLE runs ADD COLUMN retry_of TEXT'),",
          '   },',
          '+  {',
          "+    name: '2026-10-08-index-updated-at',",
          '+    up: (db) =>',
          "+      db.exec('CREATE INDEX IF NOT EXISTS idx_tx_updated_at ON transactions (updated_at)'),",
          '+  },',
          '+',
          ' ]',
        ],
      },
    ],
  },
  {
    path: 'src/cli/commands.ts',
    kind: 'modify',
    add: 3,
    del: 1,
    hunks: [
      {
        oldStart: 88,
        newStart: 88,
        header: 'export function registerSyncCommand(program: Command): void {',
        lines: [
          "     .option('--full', '忽略游标，全量重新同步')",
          "+    .option('--dry-run', '只打印将要写入的条目数，不写库')",
          '     .action(async (opts) => {',
          '-      const report = await syncLoop(await openContext(opts))',
          '+      const ctx = await openContext(opts)',
          '+      const report = await syncLoop(ctx, { dryRun: Boolean(opts.dryRun) })',
          '       console.log(`拉取 ${report.pulled}，跳过 ${report.skipped}`)',
        ],
      },
    ],
  },
  {
    path: 'src/integrations/billing-provider/adapters/legacy-v2/normalizeTransactionPayload.ts',
    kind: 'modify',
    add: 13,
    del: 2,
    hunks: [
      {
        oldStart: 21,
        newStart: 21,
        header: 'export function normalizeTransactionPayload(raw: LegacyPayload): Transaction {',
        lines: [
          '   return {',
          '     id: raw.txn_id,',
          '     accountId: raw.acct,',
          '-    updatedAt: raw.modified,',
          '-    amount: Number(raw.amt),',
          '+    // legacy-v2 返回秒精度且不带时区，统一转换为 UTC ISO 字符串，',
          '+    // 否则游标比较会把同一时刻的条目判断为不同时间',
          '+    updatedAt: toUtcIso(raw.modified),',
          '+    amount: parseAmount(raw.amt),',
          '   }',
          ' }',
          '+',
          '+function toUtcIso(seconds: string): string {',
          "+  return new Date(Number(seconds) * 1000).toISOString()",
          '+}',
          '+',
          '+function parseAmount(raw: string): number {',
          "+  const value = Number(raw.replace(/,/g, ''))",
          "+  if (!Number.isFinite(value)) throw new TypeError(`金额格式不正确: ${raw}`)",
          '+  return value',
          '+}',
        ],
      },
    ],
  },
];

export interface Check {
  id: string;
  name: string;
  command: string;
  status: 'passed' | 'failed' | 'notRun';
  exit: number | null;
  duration: string | null;
  output: string | null;
  reason?: string;
}

export const REVIEW_CHECKS: Check[] = [
  {
    id: 'typecheck',
    name: '类型检查',
    command: 'npm run typecheck',
    status: 'passed',
    exit: 0,
    duration: '4.1s',
    output: '> tsc --noEmit\n\n找到 0 个错误。',
  },
  {
    id: 'unit',
    name: '单元测试',
    command: 'npm test -- --run',
    status: 'passed',
    exit: 0,
    duration: '9.5s',
    output:
      '> vitest run\n\n ✓ src/sync/__tests__/cursor.test.ts (4 tests) 12ms\n ✓ src/store/__tests__/migrations.test.ts (7 tests) 38ms\n ✓ src/sync/__tests__/loop.test.ts (11 tests) 96ms\n\n Test Files  3 passed (3)\n      Tests  22 passed (22)',
  },
  {
    id: 'integration',
    name: '集成测试（真实账单 API）',
    command: 'npm run test:integration -- --live-api',
    status: 'notRun',
    exit: null,
    duration: null,
    output: null,
    reason: '本机未配置 BILLING_API_TOKEN',
  },
  {
    id: 'lint',
    name: 'Lint',
    command: 'npm run lint',
    status: 'notRun',
    exit: null,
    duration: null,
    output: null,
    reason: '本轮没有执行',
  },
];

/* ── 辅助面板：文件 ───────────────────────────────────────── */

export interface TreeNode {
  name: string;
  path: string;
  children?: TreeNode[];
}

export const TREE: TreeNode[] = [
  {
    name: 'docs',
    path: 'docs',
    children: [{ name: '同步设计说明.md', path: 'docs/同步设计说明.md' }],
  },
  {
    name: 'src',
    path: 'src',
    children: [
      {
        name: 'api',
        path: 'src/api',
        children: [{ name: 'client.ts', path: 'src/api/client.ts' }],
      },
      {
        name: 'sync',
        path: 'src/sync',
        children: [
          { name: 'cursor.ts', path: 'src/sync/cursor.ts' },
          { name: 'loop.ts', path: 'src/sync/loop.ts' },
        ],
      },
      {
        name: 'store',
        path: 'src/store',
        children: [{ name: 'txStore.ts', path: 'src/store/txStore.ts' }],
      },
    ],
  },
  { name: 'package.json', path: 'package.json' },
];

export const FILE_CONTENT: Record<string, string> = {
  'docs/同步设计说明.md':
    '# 增量同步设计说明\n\n## 为什么要改\n\n当前 syncLoop 每轮拉取全部交易，再用 hash 集合去重。账单量增长后，单次同步时间与内存占用都线性上升。\n\n## 游标约定\n\n- 游标保存服务端 `updated_at` 的最大值\n- 比较前统一归一到毫秒刻度\n- 空页不推进游标\n\n## 已知风险\n\n服务端在分页重叠时会重复返回同一条目，其 `updated_at` 等于当前上界。只靠游标比较会重复写入，需要页内去重配合。',
  'src/api/client.ts':
    "export interface ListParams {\n  cursor?: string\n  since?: string // ISO8601；服务端按 updated_at 升序返回\n  limit?: number\n}\n\n/**\n * 列表端点统一按 updated_at 升序返回。\n * 注意：不同端点的精度不一致（部分到秒，部分到毫秒）。\n */\nexport interface ListResponse<T> {\n  items: T[]\n  next: string | null\n}",
  'src/sync/cursor.ts': REVIEW_FILES[1].hunks[0].lines.map((l) => l.slice(1)).join('\n'),
  'src/sync/loop.ts':
    "export async function syncLoop(ctx: SyncContext): Promise<SyncReport> {\n  const report: SyncReport = { pulled: 0, skipped: 0 }\n  let page = await ctx.api.firstPage()\n  let cursor = ctx.state.lastSyncedAt\n  // …",
  'src/store/txStore.ts':
    '// 注意：调用方负责去重，这里不做 hash 比较\nexport class TxStore {\n  async upsert(tx: Transaction): Promise<void> {\n    // …\n  }\n}',
  'package.json': '{\n  "name": "fin-sync",\n  "private": true,\n  "type": "module"\n}',
};

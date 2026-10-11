import type {
  ChangeSet,
  Integration,
  Project,
  Run,
  Task,
} from '../domain/types.ts';
import {
  CWD_139,
  CWD_140,
  CWD_141,
  CWD_142,
  CWD_143,
  CWD_144,
  CWD_145,
  CHECK_ABORTED,
  CHECK_FAILED,
  CHECK_TYPECHECK,
  CHECK_UNIT,
  WORKSPACES,
  agentMessage,
  approval,
  at,
  command,
  diffFiles,
  errorEvent,
  fileChange,
  info,
  interrupted,
  plan,
  question,
  reasoning,
  userMessage,
  warning,
} from './fixtures.ts';

/* ─────────────────────────────────────────────────────────────
   演示用初始状态
   全部为构造数据，不代表真实 Codex 执行结果。
   ───────────────────────────────────────────────────────────── */

let seq = 0;
const id = (p: string): string => `${p}-${++seq}`;

/** 构造一次运行骨架，减少重复 */
function makeRun(
  runId: string,
  index: number,
  threadId: string,
  turnId: string,
  status: Run['status'],
  startedMinutes: number,
  finishedMinutes: number | null,
  model: string,
  baseCommit: string,
): Run {
  return {
    id: runId,
    threadId,
    turnId,
    index,
    status,
    startedAtMs: at(startedMinutes),
    finishedAtMs: finishedMinutes === null ? null : at(finishedMinutes),
    model,
    baseCommit,
    events: [],
    outcome: null,
  };
}

const M = (
  runId: string,
  turnId: string,
  minutes: number,
  seconds = 0,
): { id: string; runId: string; turnId: string; atMs: number } => ({
  id: id('ev'),
  runId,
  turnId,
  atMs: at(minutes, seconds),
});

/* ═════════════════════════════════════════════════════════════
   T-142 —— 运行中
   ═════════════════════════════════════════════════════════════ */

const run142 = makeRun(
  'run-142-1',
  1,
  'thr-9f21c4',
  'turn-0192ab',
  'running',
  12,
  null,
  'gpt-5.4-codex',
  '3c1d7ae',
);

run142.events = [
  userMessage(
    M('run-142-1', 'turn-0192ab', 12, 0),
    'syncLoop 目前每轮都重新拉取全部交易，账单量上去以后明显变慢。\n' +
      '改成基于 updated_at 的增量拉取，并保证不会因为分页边界漏数据。\n\n' +
      '验收：\n' +
      '1. 第二次同步的拉取条目数只与新增/变更相关，不再线性于总量。\n' +
      '2. 分页过程中若出现同一条目被两页同时返回，只写一次。\n' +
      '3. 游标精度不一致（秒 / 毫秒）时不会误判为新条目。',
  ),
  reasoning(
    M('run-142-1', 'turn-0192ab', 12, 4),
    [
      '先确认 `updated_at` 是否在所有列表端点上单调递增。',
      '如果只是部分端点有序，游标方案会把漏数据风险从分页边界挪到游标本身。',
      '需要先读现有的 API 客户端和 store 写入路径，再决定游标存在哪里。',
    ],
    '本地仓库里没有服务端代码，只能从 `src/api/client.ts` 的类型定义和注释推断排序保证。' +
      '如果注释与实现不一致，那这条假设就会变成静默漏数据 —— 这是本轮最需要小心的地方。',
  ),
  plan(
    M('run-142-1', 'turn-0192ab', 12, 8),
    '1. 读 src/api/client.ts，确认 list 端点的游标与排序保证\n' +
      '2. 读 src/store/ 的写入路径，确认幂等点在哪里\n' +
      '3. 引入 cursor 工具，把精度归一到同一刻度\n' +
      '4. 改 syncLoop，用游标替代全量 hash 去重\n' +
      '5. 补游标工具的单元测试，覆盖精度不一致与空页',
  ),
  command(
    M('run-142-1', 'turn-0192ab', 12, 12),
    'git status --short',
    CWD_142,
    0,
    48,
    '',
  ),
  command(
    M('run-142-1', 'turn-0192ab', 12, 16),
    'git log --oneline -5',
    CWD_142,
    0,
    61,
    '3c1d7ae 拆分 syncLoop 的 store 写入路径\n' +
      'a88f102 补充 list 端点的分页测试\n' +
      '91b43cd 缓存层改为按账户分区\n' +
      '7d0ea11 修正配置读取的空值处理\n' +
      '2f5c903 初始化项目骨架',
  ),
  agentMessage(
    M('run-142-1', 'turn-0192ab', 12, 22),
    '先确认两件事：`list` 端点返回的 `updated_at` 是否单调，以及现在写入路径在哪一步保证幂等。' +
      '这两点决定了游标能不能替代全量去重。',
  ),
  command(
    M('run-142-1', 'turn-0192ab', 12, 27),
    'sed -n "1,120p" src/api/client.ts',
    CWD_142,
    0,
    92,
    'export interface ListParams {\n' +
      '  cursor?: string;\n' +
      '  since?: string;   // ISO8601；服务端按 updated_at 升序返回\n' +
      '  limit?: number;\n' +
      '}\n' +
      '\n' +
      '/**\n' +
      ' * 列表端点统一按 updated_at 升序返回。\n' +
      ' * 注意：不同端点的 updated_at 精度不一（部分到秒，部分到毫秒）。\n' +
      ' */\n' +
      'export interface ListResponse<T> {\n' +
      '  items: T[];\n' +
      '  next: string | null;\n' +
      '}\n' +
      '\n' +
      'export interface ApiClient {\n' +
      '  firstPage(): Promise<string>;\n' +
      '  list(params: ListParams): Promise<ListResponse<Transaction>>;\n' +
      '  // ... 其余端点省略\n' +
      '}',
  ),
  agentMessage(
    M('run-142-1', 'turn-0192ab', 12, 34),
    '排序保证成立，而且注释已经点出了精度不一致的问题 —— 这正好是验收条件 3 要防的。' +
      '接着看写入路径。',
  ),
  command(
    M('run-142-1', 'turn-0192ab', 12, 39),
    'grep -rn "upsert" src/store/',
    CWD_142,
    0,
    74,
    'src/store/txStore.ts:41:  async upsert(tx: Transaction): Promise<void> {\n' +
      'src/store/txStore.ts:88:  async upsertMany(txs: Transaction[]): Promise<number> {\n' +
      'src/store/txStore.ts:112:  // 注意：调用方负责去重，这里不做 hash 比较\n' +
      'src/sync/loop.ts:31:      await ctx.store.upsert(stripInternalFields(tx))',
  ),
  reasoning(
    M('run-142-1', 'turn-0192ab', 12, 46),
    [
      '`upsertMany` 的注释说明去重责任在调用方，所以游标逻辑必须自己保证不重复写。',
      '但如果游标过滤已经保证「只返回比上界更新的条目」，重复写的窗口就只有分页重叠。',
      '分页重叠需要靠 next 游标本身解决，而不是靠去重集合 —— 这是这次改动的关键取舍。',
    ],
  ),
  fileChange(M('run-142-1', 'turn-0192ab', 12, 52), 'inProgress', [
    {
      path: 'src/sync/cursor.ts',
      kind: 'add',
      additions: 26,
      deletions: 0,
      hunks: diffFiles()[1].hunks,
    },
    {
      path: 'src/sync/loop.ts',
      kind: 'modify',
      additions: 14,
      deletions: 11,
      hunks: diffFiles()[0].hunks,
    },
  ]),
  agentMessage(
    M('run-142-1', 'turn-0192ab', 13, 2),
    '游标工具写完了，正在改 `syncLoop`。有一个取舍要说明：' +
      '我把去重责任从「记住所有见过的 hash」改成了「只信任游标上界」。' +
      '这样内存不再随总量增长，但代价是 —— 如果服务端在某次分页里返回了比上界更旧的条目，' +
      '我们会跳过它。对于已经单调的端点这是安全的；对精度不一致的那个端点，' +
      '`toMillis` 会把它归一到秒，所以不会误判为「更旧」。',
    'commentary',
    true, // 正在流式输出
  ),
];

/* ═════════════════════════════════════════════════════════════
   T-143 —— 等待用户（同时有一个提问和一个审批）
   ═════════════════════════════════════════════════════════════ */

const run143 = makeRun(
  'run-143-1',
  1,
  'thr-4b7de0',
  'turn-0192c1',
  'waitingUser',
  6,
  null,
  'gpt-5.4-codex',
  '3c1d7ae',
);

run143.events = [
  userMessage(
    M('run-143-1', 'turn-0192c1', 6, 0),
    '把同步失败的处理拆成「可重试」和「永久失败」。\n' +
      '可重试的按退避重试，永久失败的直接标记人工处理，不要再排队。',
  ),
  reasoning(
    M('run-143-1', 'turn-0192c1', 6, 5),
    [
      'HTTP 层能直接判定的是状态码和错误类型。',
      '但有一类 400 属于业务语义（账户被冻结、账单周期已关闭），跟请求写错是两件事。',
      '这类只能靠错误体里的业务码区分，而错误体格式在本地没有文档。',
    ],
  ),
  command(
    M('run-143-1', 'turn-0192c1', 6, 11),
    'cat src/api/errors.ts',
    CWD_143,
    0,
    39,
    'export type ApiErrorKind =\n' +
      "  | 'network'\n" +
      "  | 'rateLimited'\n" +
      "  | 'serverError'\n" +
      "  | 'badRequest'\n" +
      "  | 'unauthorized';\n" +
      '\n' +
      'export interface ApiError {\n' +
      '  kind: ApiErrorKind;\n' +
      '  status: number;\n' +
      '  message: string;\n' +
      '  /** 服务端原始错误体，未做结构化解析 */\n' +
      '  body?: unknown;\n' +
      '}',
  ),
  agentMessage(
    M('run-143-1', 'turn-0192c1', 6, 18),
    '`ApiErrorKind` 里没有业务语义这一类，`body` 也还没解析。' +
      '在加代码之前我需要确认一个业务判断，因为选错会让「永久失败」被误判成可重试，' +
      '结果就是一条被冻结账户的同步任务无限退避重试。',
  ),
  question(M('run-143-1', 'turn-0192c1', 6, 26), {
    requestId: 'srv-req-8812',
    header: '重试语义',
    isBlocking: true,
    resolution: null,
    questions: [
      {
        id: 'q-freeze',
        header: '账户冻结',
        question:
          '服务端返回「账户已冻结」时，希望按永久失败处理（标记人工介入），还是按可重试处理（等解冻后自动恢复）？',
        options: [
          {
            label: '永久失败（推荐）',
            description:
              '标记为人工处理，不再自动重试。解冻后由你手动重新入队，行为最可预测。',
          },
          {
            label: '可重试，退避上限 24 小时',
            description:
              '解冻后最多一天内自动恢复同步。代价是冻结期间会持续产生重试记录。',
          },
          {
            label: '可重试，不计入重试上限',
            description: '一直等到解冻。会产生持续的后台请求，不建议。',
          },
        ],
        allowOther: true,
        isSecret: false,
      },
    ],
  }),
  approval(M('run-143-1', 'turn-0192c1', 6, 31), {
    requestId: 'srv-req-8813',
    category: 'commandExecution',
    title: '执行会重写测试快照的命令',
    detail: {
      command: 'npm test -- --run --update',
      cwd: CWD_143,
      reason: '重试分类改变了错误映射，快照需要更新',
    },
    reason:
      '重试分类改变了错误到 kind 的映射，现有快照会全部失配。' +
      '我想连同快照一起更新，避免留下 23 个假失败。',
    sessionScopeHint:
      '会话内不再询问：本会话中后续同类测试命令将直接执行，包括会写入文件的快照更新。',
    state: { kind: 'pending' },
  }),
];

/* ═════════════════════════════════════════════════════════════
   T-144 —— 待审查（diff + 检查证据）
   ═════════════════════════════════════════════════════════════ */

const run144 = makeRun(
  'run-144-1',
  1,
  'thr-1c88aa',
  'turn-0192b7',
  'succeeded',
  -38,
  -30,
  'gpt-5.4-codex',
  '3c1d7ae',
);

run144.events = [
  userMessage(
    M('run-144-1', 'turn-0192b7', -38, 0),
    '把增量同步的游标工具和它的测试补上。\n' +
      '测试要覆盖：精度不一致、空页不前移游标、比上界更旧的条目被跳过。',
  ),
  reasoning(
    M('run-144-1', 'turn-0192b7', -38, 6),
    [
      '三个用例其实都在测同一个不变式：游标只能前进，不能后退。',
      '精度归一是实现细节，但它是这个不变式成立的前提，所以值得单独锁住。',
    ],
  ),
  command(
    M('run-144-1', 'turn-0192b7', -38, 12),
    'npm test -- --run',
    CWD_144,
    1,
    7_400,
    '> vitest run\n\n' +
      ' FAIL  src/sync/__tests__/loop.test.ts > 第二次同步只拉取变更条目\n' +
      '   → expected 40 to be 3\n\n' +
      ' Test Files  1 failed | 2 passed (3)\n      Tests  1 failed | 21 passed (22)',
  ),
  agentMessage(
    M('run-144-1', 'turn-0192b7', -38, 22),
    '先跑一遍现有测试，确认基线。已有 1 个失败用例正是这次要解决的 —— `loop.test.ts` 期望第二次同步只拉 3 条，' +
      '但当前实现仍然全量拉取，得到 40。',
  ),
  fileChange(M('run-144-1', 'turn-0192b7', -38, 24), 'completed', [
    { path: 'src/sync/cursor.ts', kind: 'add', additions: 26, deletions: 0, hunks: [] },
    {
      path: 'src/sync/__tests__/cursor.test.ts',
      kind: 'add',
      additions: 23,
      deletions: 0,
      hunks: [],
    },
    { path: 'src/sync/loop.ts', kind: 'modify', additions: 14, deletions: 11, hunks: [] },
    { path: 'src/store/schema.ts', kind: 'modify', additions: 5, deletions: 0, hunks: [] },
    { path: 'src/cli/commands.ts', kind: 'modify', additions: 3, deletions: 1, hunks: [] },
  ]),
  command(
    M('run-144-1', 'turn-0192b7', -30, 42),
    'npm test -- --run',
    CWD_144,
    0,
    9_480,
    CHECK_UNIT.output ?? '',
  ),
  command(
    M('run-144-1', 'turn-0192b7', -30, 12),
    'npm run typecheck',
    CWD_144,
    0,
    4_120,
    CHECK_TYPECHECK.output ?? '',
  ),
  warning(
    M('run-144-1', 'turn-0192b7', -30, 30),
    '集成测试需要真实账单 API 凭据，本机未配置。这项检查没有运行，不代表通过。',
  ),
  agentMessage(
    M('run-144-1', 'turn-0192b7', -30, 40),
    '改动完成：新增 `src/sync/cursor.ts` 与对应测试，`syncLoop` 改用游标上界替代全量 hash 去重，' +
      '并给 `transactions.updated_at` 加了索引。\n\n' +
      '类型检查与单元测试通过（22 个用例）。集成测试和 Lint 没有运行 —— ' +
      '集成测试缺凭据，Lint 是我没有主动跑。这两项在界面上应显示为「未运行」而不是通过。\n\n' +
      '一个需要你判断的点：我把 `upsertMany` 的调用从「逐条 upsert」改成了批量，' +
      '这会让写入失败时的回滚粒度从一个条目变成一批。如果不接受这个取舍，我需要改回去。',
    'final_answer',
  ),
];

/* ═════════════════════════════════════════════════════════════
   T-145 —— 失败（保留结果 + 后续入口）
   ═════════════════════════════════════════════════════════════ */

const run145 = makeRun(
  'run-145-1',
  1,
  'thr-77a1e3',
  'turn-0192a4',
  'failed',
  -104,
  -98,
  'gpt-5.4-codex',
  'a88f102',
);

run145.events = [
  userMessage(
    M('run-145-1', 'turn-0192a4', -104, 0),
    '给 schema.ts 的迁移补回滚测试。要求：每个迁移都能 down 回去，且回滚后不残留索引。',
  ),
  command(
    M('run-145-1', 'turn-0192a4', -104, 8),
    'cat src/store/schema.ts',
    CWD_145,
    0,
    52,
    'export interface Migration {\n' +
      '  name: string;\n' +
      '  up: (db: Db) => void;\n' +
      '  down?: (db: Db) => void;\n' +
      '}\n\n' +
      'export const migrations: Migration[] = [ /* … */ ]',
  ),
  agentMessage(
    M('run-145-1', 'turn-0192a4', -104, 14),
    '`Migration.down` 是可选的，而现有的 4 个迁移里有 3 个没实现它。' +
      '要测回滚，得先补齐这些 `down`。',
  ),
  fileChange(M('run-145-1', 'turn-0192a4', -104, 22), 'completed', [
    {
      path: 'src/store/schema.ts',
      kind: 'modify',
      additions: 31,
      deletions: 0,
      hunks: [],
    },
    {
      path: 'src/store/__tests__/rollback.test.ts',
      kind: 'add',
      additions: 47,
      deletions: 0,
      hunks: [],
    },
  ]),
  command(
    M('run-145-1', 'turn-0192a4', -98, 10),
    'npm test -- --run store/rollback',
    CWD_145,
    1,
    6_300,
    CHECK_FAILED.output ?? '',
  ),
  errorEvent(
    M('run-145-1', 'turn-0192a4', -98, 18),
    '本轮以失败结束：回滚测试未通过 —— `idx_tx_updated_at` 索引在 down 之后仍然存在。',
    false,
    'TurnError {\n' +
      '  code: "test_failure",\n' +
      '  message: "1 of 5 rollback assertions failed",\n' +
      '  detail: "测试报告 DROP INDEX 未生效：迁移 down 里只删了列，没有先删索引。\n' +
      'SQLite 在 DROP COLUMN 时会保留依赖该列的索引，报错被 catch 吞掉了。"\n' +
      '}',
  ),
];

/* ═════════════════════════════════════════════════════════════
   T-140 —— 已中止（保留改动，恢复 ≠ 重跑）
   ═════════════════════════════════════════════════════════════ */

const run140 = makeRun(
  'run-140-1',
  1,
  'thr-2ea55b',
  'turn-01929f',
  'interrupted',
  -186,
  -179,
  'gpt-5.4-codex',
  '7d0ea11',
);

run140.events = [
  userMessage(
    M('run-140-1', 'turn-01929f', -186, 0),
    '导出十万条交易到 CSV。不要一次性读进内存，用流式写。',
  ),
  reasoning(
    M('run-140-1', 'turn-01929f', -186, 5),
    [
      '关键是别在任何一个环节把结果集物化成数组。',
      'CSV 里用户可控的字段（备注、商户名）需要转义，否则会串列。',
    ],
  ),
  command(
    M('run-140-1', 'turn-01929f', -186, 11),
    'npm test -- --run',
    CWD_140,
    null,
    1_200,
    '> vitest run\n\n' +
      ' RUN  v2.1.4\n\n' +
      ' ❯ src/export/__tests__/csv.test.ts  (0 tests | 0 failed)\n\n' +
      '（进程在测试执行期间被中止，未得出结果）',
  ),
  info(
    M('run-140-1', 'turn-01929f', -186, 14),
    '用户中止了本轮。正在执行的命令进程已终止。',
  ),
  interrupted(
    M('run-140-1', 'turn-01929f', -186, 14),
    '用户中止：中止时本轮已完成 2 个文件的修改，这些改动保留在工作区，不会回滚。',
    true,
  ),
];

/* ═════════════════════════════════════════════════════════════
   T-139 —— 已接受（尚未集成）
   ═════════════════════════════════════════════════════════════ */

const run139 = makeRun(
  'run-139-1',
  1,
  'thr-55c1d9',
  'turn-01928b',
  'succeeded',
  -420,
  -404,
  'gpt-5.4-codex',
  '91b43cd',
);

run139.events = [
  userMessage(
    M('run-139-1', 'turn-01928b', -420, 0),
    '缓存落盘前用账户密钥加密。密钥从配置读，不要写进代码。',
  ),
  command(
    M('run-139-1', 'turn-01928b', -420, 35),
    'npm test -- --run',
    CWD_139,
    0,
    8_100,
    '> vitest run\n\n' +
      ' ✓ src/cache/__tests__/cipher.test.ts (9 tests) 121ms\n' +
      ' ✓ src/cache/__tests__/store.test.ts (14 tests) 204ms\n\n' +
      ' Test Files  2 passed (2)\n      Tests  23 passed (23)',
  ),
  agentMessage(
    M('run-139-1', 'turn-01928b', -404, 12),
    '缓存读写改成 AES-GCM，密钥从 `AGENTDESK_CACHE_KEY` 读取；' +
      '缺失时直接抛错而不是退回到明文 —— 静默降级会让人以为数据被加密了。\n\n' +
      '单元测试 23 个全部通过。',
    'final_answer',
  ),
];

/* ═════════════════════════════════════════════════════════════
   T-141 —— 已验收（完整闭环）
   ═════════════════════════════════════════════════════════════ */

const run141 = makeRun(
  'run-141-1',
  1,
  'thr-8d30bb',
  'turn-01927a',
  'succeeded',
  -1_290,
  -1_272,
  'gpt-5.4-codex',
  '2f5c903',
);

run141.events = [
  userMessage(
    M('run-141-1', 'turn-01927a', -1_290, 0),
    '同一笔交易被两个来源重复导入时要去重，以 (账户, 日期, 金额, 摘要哈希) 为准。',
  ),
  command(
    M('run-141-1', 'turn-01927a', -1_290, 40),
    'npm test -- --run',
    CWD_141,
    0,
    8_900,
    '> vitest run\n\n Test Files  4 passed (4)\n      Tests  38 passed (38)',
  ),
  agentMessage(
    M('run-141-1', 'turn-01927a', -1_272, 20),
    '按四元组做幂等键，冲突时保留先到的记录并写入一条审计条目。38 个用例通过。',
    'final_answer',
  ),
];

/* ═════════════════════════════════════════════════════════════
   集成结果
   ═════════════════════════════════════════════════════════════ */

const noIntegration = (): Integration => ({
  targetBranch: 'main',
  status: 'idle',
  mergedCommit: null,
  conflictFiles: [],
  checks: [],
  startedAtMs: null,
  finishedAtMs: null,
  message: null,
});

const integrated141: Integration = {
  targetBranch: 'main',
  status: 'succeeded',
  mergedCommit: 'b41e77c',
  conflictFiles: [],
  checks: [
    {
      id: 'chk-int-typecheck',
      name: '集成后类型检查',
      command: 'npm run typecheck',
      status: 'passed',
      exitCode: 0,
      durationMs: 4_050,
      output: '> tsc --noEmit\n\n找到 0 个错误。',
      runId: null,
      startedAtMs: at(-1_264, 10),
    },
    {
      id: 'chk-int-unit',
      name: '集成后单元测试',
      command: 'npm test -- --run',
      status: 'passed',
      exitCode: 0,
      durationMs: 10_200,
      output: '> vitest run\n\n Test Files  4 passed (4)\n      Tests  38 passed (38)',
      runId: null,
      startedAtMs: at(-1_263, 0),
    },
    {
      id: 'chk-int-linux',
      name: 'Linux CI 单元测试',
      command: 'npm test -- --run',
      status: 'notRun',
      exitCode: null,
      durationMs: null,
      output: null,
      runId: null,
      startedAtMs: null,
    },
  ],
  startedAtMs: at(-1_266),
  finishedAtMs: at(-1_262),
  message: '已合并到 main（b41e77c）。Linux CI 尚未运行。',
};

/* ═════════════════════════════════════════════════════════════
   变更集
   ═════════════════════════════════════════════════════════════ */

const FILES_144 = diffFiles();

const changeSet144: ChangeSet = {
  baseRef: '3c1d7ae',
  worktreePath: WORKSPACES.t144.worktreePath,
  branch: WORKSPACES.t144.branch,
  files: FILES_144,
  uncommitted: 5,
};

const changeSet145: ChangeSet = {
  baseRef: 'a88f102',
  worktreePath: WORKSPACES.t145.worktreePath,
  branch: WORKSPACES.t145.branch,
  files: [
    {
      path: 'src/store/__tests__/rollback.test.ts',
      kind: 'add',
      additions: 47,
      deletions: 0,
      hunks: [
        {
          header: '@@ -0,0 +1,16 @@',
          lines: [
            { kind: 'add', oldNo: null, newNo: 1, text: "import { describe, expect, it } from 'vitest'" },
            { kind: 'add', oldNo: null, newNo: 2, text: "import { migrations } from '../schema.ts'" },
            { kind: 'add', oldNo: null, newNo: 3, text: '' },
            { kind: 'add', oldNo: null, newNo: 4, text: "describe('迁移回滚', () => {" },
            { kind: 'add', oldNo: null, newNo: 5, text: '  it.each(migrations)(' },
            { kind: 'add', oldNo: null, newNo: 6, text: "    '$name 回滚后不残留索引'," },
            { kind: 'add', oldNo: null, newNo: 7, text: '    ({ name, up, down }) => {' },
            { kind: 'add', oldNo: null, newNo: 8, text: '      const db = openMemoryDb()' },
            { kind: 'add', oldNo: null, newNo: 9, text: '      up(db)' },
            { kind: 'add', oldNo: null, newNo: 10, text: '      down?.(db)' },
            { kind: 'add', oldNo: null, newNo: 11, text: "      expect(listIndexes(db, 'transactions')).toEqual([])" },
            { kind: 'add', oldNo: null, newNo: 12, text: '    },' },
            { kind: 'add', oldNo: null, newNo: 13, text: '  )' },
            { kind: 'add', oldNo: null, newNo: 14, text: '})' },
            { kind: 'add', oldNo: null, newNo: 15, text: '' },
          ],
        },
      ],
    },
    {
      path: 'src/store/schema.ts',
      kind: 'modify',
      additions: 31,
      deletions: 0,
      hunks: [
        {
          header: '@@ -38,6 +38,14 @@ export const migrations: Migration[] = [',
          lines: [
            { kind: 'ctx', oldNo: 38, newNo: 38, text: '  {' },
            { kind: 'ctx', oldNo: 39, newNo: 39, text: "    name: '2026-10-05-add-retry-column'," },
            { kind: 'ctx', oldNo: 40, newNo: 40, text: "    up: (db) => db.exec('ALTER TABLE runs ADD COLUMN retry_of TEXT')," },
            { kind: 'add', oldNo: null, newNo: 41, text: '    down: (db) =>' },
            { kind: 'add', oldNo: null, newNo: 42, text: "      db.exec('ALTER TABLE runs DROP COLUMN retry_of')," },
            { kind: 'ctx', oldNo: 41, newNo: 43, text: '  },' },
            { kind: 'ctx', oldNo: 42, newNo: 44, text: ']' },
          ],
        },
      ],
    },
  ],
  uncommitted: 2,
};

const changeSet140: ChangeSet = {
  baseRef: '7d0ea11',
  worktreePath: WORKSPACES.t140.worktreePath,
  branch: WORKSPACES.t140.branch,
  files: [
    {
      path: 'src/export/csv.ts',
      kind: 'add',
      additions: 74,
      deletions: 0,
      hunks: [
        {
          header: '@@ -0,0 +1,14 @@',
          lines: [
            { kind: 'add', oldNo: null, newNo: 1, text: '/** 把结果集按行写入 CSV，全程不物化数组。 */' },
            { kind: 'add', oldNo: null, newNo: 2, text: 'export async function writeCsv(source, out) {' },
            { kind: 'add', oldNo: null, newNo: 3, text: '  const w = out.write.bind(out)' },
            { kind: 'add', oldNo: null, newNo: 4, text: '  w(HEADER + "\\n")' },
            { kind: 'add', oldNo: null, newNo: 5, text: '' },
            { kind: 'add', oldNo: null, newNo: 6, text: '  for await (const tx of source) {' },
            { kind: 'add', oldNo: null, newNo: 7, text: '    w(toRow(tx) + "\\n")' },
            { kind: 'add', oldNo: null, newNo: 8, text: '  }' },
            { kind: 'add', oldNo: null, newNo: 9, text: '' },
            { kind: 'add', oldNo: null, newNo: 10, text: '  await out.flush()' },
            { kind: 'add', oldNo: null, newNo: 11, text: '}' },
            { kind: 'add', oldNo: null, newNo: 12, text: '' },
            { kind: 'add', oldNo: null, newNo: 13, text: '// TODO(未完成): toRow 的字段转义还没写' },
            { kind: 'add', oldNo: null, newNo: 14, text: '' },
          ],
        },
      ],
    },
    {
      path: 'src/export/__tests__/csv.test.ts',
      kind: 'add',
      additions: 41,
      deletions: 0,
      hunks: [
        {
          header: '@@ -0,0 +1,12 @@',
          lines: [
            { kind: 'add', oldNo: null, newNo: 1, text: "import { describe, expect, it } from 'vitest'" },
            { kind: 'add', oldNo: null, newNo: 2, text: "import { writeCsv } from '../csv.ts'" },
            { kind: 'add', oldNo: null, newNo: 3, text: '' },
            { kind: 'add', oldNo: null, newNo: 4, text: "describe('writeCsv', () => {" },
            { kind: 'add', oldNo: null, newNo: 5, text: "  it('不把结果集物化成数组', async () => {" },
            { kind: 'add', oldNo: null, newNo: 6, text: '    // （写入被中止，断言未完成）' },
            { kind: 'add', oldNo: null, newNo: 7, text: '  })' },
            { kind: 'add', oldNo: null, newNo: 8, text: '})' },
            { kind: 'add', oldNo: null, newNo: 9, text: '' },
          ],
        },
      ],
    },
  ],
  uncommitted: 6,
};

const changeSet143: ChangeSet = {
  baseRef: '3c1d7ae',
  worktreePath: WORKSPACES.t143.worktreePath,
  branch: WORKSPACES.t143.branch,
  files: [
    {
      path: 'src/sync/retry.ts',
      kind: 'add',
      additions: 52,
      deletions: 0,
      hunks: [
        {
          header: '@@ -0,0 +1,10 @@',
          lines: [
            { kind: 'add', oldNo: null, newNo: 1, text: '/** 把错误映射到重试策略。 */' },
            { kind: 'add', oldNo: null, newNo: 2, text: 'export function classify(err: ApiError): RetryPolicy {' },
            { kind: 'add', oldNo: null, newNo: 3, text: '  // TODO: 等用户确认冻结账户的语义' },
            { kind: 'add', oldNo: null, newNo: 4, text: '  return RETRYABLE' },
            { kind: 'add', oldNo: null, newNo: 5, text: '}' },
            { kind: 'add', oldNo: null, newNo: 6, text: '' },
          ],
        },
      ],
    },
  ],
  uncommitted: 3,
};

const changeSet142: ChangeSet = {
  baseRef: '3c1d7ae',
  worktreePath: WORKSPACES.t142.worktreePath,
  branch: WORKSPACES.t142.branch,
  files: [
    {
      path: 'src/sync/cursor.ts',
      kind: 'add',
      additions: 26,
      deletions: 0,
      hunks: diffFiles()[1].hunks,
    },
    {
      path: 'src/sync/loop.ts',
      kind: 'modify',
      additions: 14,
      deletions: 11,
      hunks: diffFiles()[0].hunks,
    },
  ],
  uncommitted: 8,
};

const changeSet139: ChangeSet = {
  baseRef: '91b43cd',
  worktreePath: WORKSPACES.t139.worktreePath,
  branch: WORKSPACES.t139.branch,
  files: [
    {
      path: 'src/cache/cipher.ts',
      kind: 'add',
      additions: 64,
      deletions: 0,
      hunks: [
        {
          header: '@@ -0,0 +1,12 @@',
          lines: [
            { kind: 'add', oldNo: null, newNo: 1, text: '/** AES-GCM 缓存加密。密钥缺失直接抛错，不降级明文。 */' },
            { kind: 'add', oldNo: null, newNo: 2, text: 'export function openCipher(): Cipher {' },
            { kind: 'add', oldNo: null, newNo: 3, text: "  const raw = process.env.AGENTDESK_CACHE_KEY" },
            { kind: 'add', oldNo: null, newNo: 4, text: "  if (!raw) throw new Error('缺少 AGENTDESK_CACHE_KEY')" },
            { kind: 'add', oldNo: null, newNo: 5, text: '  return new AesGcmCipher(Buffer.from(raw, "base64"))' },
            { kind: 'add', oldNo: null, newNo: 6, text: '}' },
            { kind: 'add', oldNo: null, newNo: 7, text: '' },
          ],
        },
      ],
    },
    {
      path: 'src/cache/store.ts',
      kind: 'modify',
      additions: 22,
      deletions: 9,
      hunks: [
        {
          header: '@@ -18,8 +18,10 @@ export class CacheStore {',
          lines: [
            { kind: 'ctx', oldNo: 18, newNo: 18, text: '  async put(key: string, value: unknown) {' },
            { kind: 'del', oldNo: 19, newNo: null, text: '    await fs.writeFile(this.pathFor(key), JSON.stringify(value))' },
            { kind: 'add', oldNo: null, newNo: 19, text: '    const plain = Buffer.from(JSON.stringify(value), "utf8")' },
            { kind: 'add', oldNo: null, newNo: 20, text: '    await fs.writeFile(this.pathFor(key), this.cipher.seal(plain))' },
            { kind: 'ctx', oldNo: 20, newNo: 21, text: '  }' },
          ],
        },
      ],
    },
  ],
  uncommitted: 4,
};

const changeSet141: ChangeSet = {
  baseRef: '2f5c903',
  worktreePath: WORKSPACES.t141.worktreePath,
  branch: WORKSPACES.t141.branch,
  files: [
    {
      path: 'src/import/dedupe.ts',
      kind: 'add',
      additions: 58,
      deletions: 0,
      hunks: [
        {
          header: '@@ -0,0 +1,11 @@',
          lines: [
            { kind: 'add', oldNo: null, newNo: 1, text: '/** 幂等键：账户 + 日期 + 金额 + 摘要哈希。 */' },
            { kind: 'add', oldNo: null, newNo: 2, text: 'export function idempotencyKey(tx: Transaction): string {' },
            { kind: 'add', oldNo: null, newNo: 3, text: '  return [tx.accountId, tx.date, tx.amount, sha256(tx.memo)].join(":")' },
            { kind: 'add', oldNo: null, newNo: 4, text: '}' },
            { kind: 'add', oldNo: null, newNo: 5, text: '' },
          ],
        },
      ],
    },
  ],
  uncommitted: 0,
};

/* ═════════════════════════════════════════════════════════════
   任务定义
   ═════════════════════════════════════════════════════════════ */

export function seedProject(): Project {
  return {
    id: 'proj-fin-sync',
    name: 'fin-sync',
    repoPath: 'E:\\Projects\\fin-sync',
    branch: 'main',
    env: WORKSPACES.t142.env,
  };
}

export function seedTasks(): Task[] {
  return [
    /* ── 运行中 ──────────────────────────────────────────── */
    {
      id: 't142',
      ref: 'T-142',
      title: '增量同步：错误恢复与边界处理',
      goal:
        '让 syncLoop 在增量拉取基础上正确处理服务端返回顺序异常与游标精度差异，' +
        '避免静默漏数据。',
      acceptance: [
        { id: 'ac1', text: '服务端返回比游标更旧的条目时被安全跳过', met: null },
        { id: 'ac2', text: '游标在分页过程中只前进，不回退', met: null },
        { id: 'ac3', text: '同一条目被两页同时返回时只写入一次', met: null },
        { id: 'ac4', text: '新增边界用例的单测通过', met: null },
      ],
      status: 'inProgress',
      latestRunStatus: 'running',
      block: null,
      runs: [run142],
      changes: changeSet142,
      integration: noIntegration(),
      workspace: WORKSPACES.t142,
      createdAtMs: at(11),
      updatedAtMs: at(13, 2),
      demo: true,
    },

    /* ── 等待用户 ────────────────────────────────────────── */
    {
      id: 't143',
      ref: 'T-143',
      title: '重试策略分类：可重试 / 永久失败',
      goal:
        '把同步失败拆成可重试与永久失败两类，避免账户级业务错误被无限退避重试。',
      acceptance: [
        { id: 'ac1', text: '可重试错误按指数退避重试，且有上限', met: null },
        { id: 'ac2', text: '永久失败不再排队，直接标记为人工处理', met: null },
        { id: 'ac3', text: '冻结账户的分类结果符合业务约定', met: null },
        { id: 'ac4', text: '错误映射的测试快照已更新', met: null },
      ],
      status: 'inProgress',
      latestRunStatus: 'waitingUser',
      block: {
        kind: 'question',
        summary: '模型需要确认「账户冻结」应归为永久失败还是可重试',
        runId: 'run-143-1',
      },
      runs: [run143],
      changes: changeSet143,
      integration: noIntegration(),
      workspace: WORKSPACES.t143,
      createdAtMs: at(5),
      updatedAtMs: at(6, 31),
      demo: true,
    },

    /* ── 待审查 ──────────────────────────────────────────── */
    {
      id: 't144',
      ref: 'T-144',
      title: '增量同步：游标实现与测试',
      goal:
        '为增量同步提供游标工具及其单元测试，锁住「游标只能前进」这一不变式。',
      acceptance: [
        { id: 'ac1', text: '第二次同步只拉取变更条目（原失败用例转绿）', met: true },
        { id: 'ac2', text: '秒 / 毫秒精度不一致时不会误判为新条目', met: true },
        { id: 'ac3', text: '空页不会让游标回退', met: true },
        { id: 'ac4', text: '比上界更旧的条目被跳过', met: true },
        { id: 'ac5', text: '集成测试在真实账单 API 上通过', met: null },
      ],
      status: 'inReview',
      latestRunStatus: 'succeeded',
      block: null,
      runs: [run144],
      changes: changeSet144,
      integration: noIntegration(),
      workspace: WORKSPACES.t144,
      createdAtMs: at(-40),
      updatedAtMs: at(-30, 40),
      demo: true,
    },

    /* ── 失败 ────────────────────────────────────────────── */
    {
      id: 't145',
      ref: 'T-145',
      title: '迁移回滚测试',
      goal: '为 schema.ts 的每个迁移补回滚路径，并验证回滚后不残留索引。',
      acceptance: [
        { id: 'ac1', text: '每个迁移都有 down 实现', met: true },
        { id: 'ac2', text: '回滚后 transactions 表不残留自定义索引', met: false },
        { id: 'ac3', text: '回滚测试 5 个断言全部通过', met: false },
      ],
      status: 'inReview',
      latestRunStatus: 'failed',
      block: {
        kind: 'processExited',
        summary: '本轮以失败结束，承载进程已退出；可保留结果继续，或重新执行',
        runId: 'run-145-1',
      },
      runs: [run145],
      changes: changeSet145,
      integration: noIntegration(),
      workspace: WORKSPACES.t145,
      createdAtMs: at(-106),
      updatedAtMs: at(-98, 18),
      demo: true,
    },

    /* ── 已中止 ──────────────────────────────────────────── */
    {
      id: 't140',
      ref: 'T-140',
      title: '交易 CSV 流式导出',
      goal: '把十万条交易按行流式导出为 CSV，全程不把结果集物化成数组。',
      acceptance: [
        { id: 'ac1', text: '导出过程峰值内存不随条目数线性增长', met: null },
        { id: 'ac2', text: '含逗号与换行的字段被正确转义', met: null },
        { id: 'ac3', text: '导出可在中途取消且不损坏已写入部分', met: null },
      ],
      status: 'inReview',
      latestRunStatus: 'interrupted',
      block: null,
      runs: [run140],
      changes: changeSet140,
      integration: noIntegration(),
      workspace: WORKSPACES.t140,
      createdAtMs: at(-188),
      updatedAtMs: at(-179),
      demo: true,
    },

    /* ── 已接受，待集成 ──────────────────────────────────── */
    {
      id: 't139',
      ref: 'T-139',
      title: '本地缓存加密落盘',
      goal: '缓存写入磁盘前用账户密钥加密，缺失密钥时拒绝写入而不是降级明文。',
      acceptance: [
        { id: 'ac1', text: '缓存文件内容不再是明文 JSON', met: true },
        { id: 'ac2', text: '缺少密钥时直接抛错，不静默降级', met: true },
        { id: 'ac3', text: '原有缓存读写测试全部通过', met: true },
      ],
      status: 'accepted',
      latestRunStatus: 'succeeded',
      block: null,
      runs: [run139],
      changes: changeSet139,
      integration: noIntegration(),
      workspace: WORKSPACES.t139,
      createdAtMs: at(-424),
      updatedAtMs: at(-402),
      demo: true,
    },

    /* ── 已验收 ──────────────────────────────────────────── */
    {
      id: 't141',
      ref: 'T-141',
      title: '重复交易去重',
      goal: '同一笔交易被两个来源导入时按四元组幂等键去重，并留下审计记录。',
      acceptance: [
        { id: 'ac1', text: '重复导入不产生第二条记录', met: true },
        { id: 'ac2', text: '冲突时保留先到记录并写入审计条目', met: true },
        { id: 'ac3', text: '去重相关测试全部通过', met: true },
      ],
      status: 'verified',
      latestRunStatus: 'succeeded',
      block: null,
      runs: [run141],
      changes: changeSet141,
      integration: integrated141,
      workspace: WORKSPACES.t141,
      createdAtMs: at(-1_294),
      updatedAtMs: at(-1_262),
      demo: true,
    },

    /* ── 草稿 ────────────────────────────────────────────── */
    {
      id: 't146',
      ref: 'T-146',
      title: '账单 PDF 导出',
      goal: '',
      acceptance: [],
      status: 'draft',
      latestRunStatus: null,
      block: null,
      runs: [],
      changes: null,
      integration: noIntegration(),
      workspace: WORKSPACES.t146,
      createdAtMs: at(-2),
      updatedAtMs: at(-2),
      demo: true,
    },
  ];
}

export { CHECK_ABORTED, CHECK_FAILED };
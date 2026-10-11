import type { RunOutcome, TimelineEvent } from '../domain/types.ts';
import { CHECK_ABORTED, CHECK_FAILED, CHECK_INTEGRATION, CHECK_LINT, at, command, errorEvent, fileChange, info, interrupted, warning } from './fixtures.ts';

/* ─────────────────────────────────────────────────────────────
   T-142「运行中」的后续脚本
   演示推进用：每次推进追加一个事件，全部用完后本轮成功结束，
   任务进入「待审查」。
   ───────────────────────────────────────────────────────────── */

export interface ScriptStep {
  /** 该步追加的事件 */
  event: TimelineEvent;
  /** 该步结束时检查的运行状态 */
  status: 'running' | 'succeeded';
  /** 若为成功，附带本轮结论 */
  outcome?: Omit<RunOutcome, 'nextSteps'>;
}

const RUN = 'run-142-1';
const TURN = 'turn-0192ab';

let n = 0;
const mk = () => ({
  id: `ev-s${++n}`,
  runId: RUN,
  turnId: TURN,
  atMs: 0,
});

export function demoSteps(now: () => number): ScriptStep[] {
  const t = (offset: number) => now() + offset;

  return [
    /* 1. 落盘第一版实现，跑类型检查 */
    {
      event: {
        ...mk(),
        atMs: t(0),
        kind: 'agentMessage',
        phase: 'commentary',
        pending: false,
        text:
          '两处都改完了。现在跑一遍类型检查确认没有引入新的类型错误 —— ' +
          '注意这个仓库的 tsconfig 开了 `noUncheckedIndexedAccess`，' +
          '游标比较里容易踩到索引为 undefined 的坑。',
      },
      status: 'running',
    },
    {
      event: command(
        { ...mk(), atMs: t(400) },
        'npm run typecheck',
        'E:\\Projects\\fin-sync\\.worktrees\\agentdesk-t142',
        0,
        4_380,
        '> tsc --noEmit\n\n找到 0 个错误。',
      ),
      status: 'running',
    },

    /* 2. 单测：先失败 */
    {
      event: command(
        { ...mk(), atMs: t(900) },
        'npm test -- --run sync',
        'E:\\Projects\\fin-sync\\.worktrees\\agentdesk-t142',
        1,
        6_120,
        '> vitest run sync\n\n' +
          ' FAIL  src/sync/__tests__/loop.test.ts > 分页重叠时只写入一次\n' +
          '   AssertionError: expected 2 to be 1\n' +
          '    → 同一交易在第 2 页被再次返回时，写入了第二次\n\n' +
          ' Test Files  1 failed | 1 passed (2)\n' +
          '      Tests  1 failed | 15 passed (16)\n' +
          '   Duration  6.12s',
      ),
      status: 'running',
    },
    {
      event: warning(
        { ...mk(), atMs: t(940) },
        '分页重叠用例失败。这是真实失败，不是环境问题。',
      ),
      status: 'running',
    },
    {
      event: {
        ...mk(),
        atMs: t(1_200),
        kind: 'agentMessage',
        phase: 'commentary',
        pending: false,
        text:
          '失败原因和我预想的取舍有关：我把去重责任全交给游标上界，' +
          '但服务端在分页重叠时确实会重复返回同一条目，而它的 `updated_at` 等于当前上界 —— ' +
          '`compareUpdatedAt` 返回 0，于是被当作「不比上界新」重新写入。\n\n' +
          '修法：把跳过条件从 `<= 0` 改成 `< 0`，并在写入前用一个只保留当前页的集合去重。' +
          '这样内存仍然不随总量增长，因为每页去重集合在处理完就丢掉。',
      } as TimelineEvent,
      status: 'running',
    },
    {
      event: fileChange({ ...mk(), atMs: t(1_500) }, 'inProgress', [
        { path: 'src/sync/loop.ts', kind: 'modify', additions: 4, deletions: 3, hunks: [] },
      ]),
      status: 'running',
    },

    /* 3. 重跑测试，通过 */
    {
      event: command(
        { ...mk(), atMs: t(2_100) },
        'npm test -- --run',
        'E:\\Projects\\fin-sync\\.worktrees\\agentdesk-t142',
        0,
        9_760,
        '> vitest run\n\n' +
          ' ✓ src/sync/__tests__/cursor.test.ts (4 tests) 14ms\n' +
          ' ✓ src/sync/__tests__/loop.test.ts (12 tests) 108ms\n\n' +
          ' Test Files  2 passed (2)\n      Tests  16 passed (16)\n' +
          '   Duration  9.76s',
      ),
      status: 'running',
    },
    {
      event: command(
        { ...mk(), atMs: t(2_300) },
        'git diff --stat',
        'E:\\Projects\\fin-sync\\.worktrees\\agentdesk-t142',
        0,
        88,
        ' src/cli/commands.ts |  4 ++--\n' +
          ' src/store/schema.ts  |  5 +++++\n' +
          ' src/sync/cursor.ts   | 26 ++++++++++++++++++++++++++\n' +
          ' src/sync/loop.ts     | 21 +++++++++++----------\n' +
          ' 4 files changed, 47 insertions(+), 9 deletions(-)',
      ),
      status: 'running',
    },

    /* 4. 收尾：得到本轮结论 */
    {
      event: {
        ...mk(),
        atMs: t(2_600),
        kind: 'agentMessage',
        phase: 'final_answer',
        pending: false,
        text:
          '本轮完成。`syncLoop` 改为纯游标驱动：\n\n' +
          '1. 游标只前进不回退 —— 空页返回原上界（`maxUpdatedAt` 的 fallback 分支）。\n' +
          '2. 页内用临时集合去重，页处理完即释放，内存不随总量增长。\n' +
          '3. 精度归一到毫秒刻度，秒精度端点不会把同一条目误判为新条目。\n\n' +
          '检查结果：类型检查与单元测试通过（16 个用例）。' +
          '集成测试和 Lint 我没有运行 —— 集成测试缺 `BILLING_API_TOKEN`，' +
          'Lint 是我判断这次改动不涉及风格，主动跳过的。这两项在界面上应显示「未运行」。\n\n' +
          '一个我无法在本地确认的假设：`list` 端点是否在所有账户类型下都保证 `updated_at` 单调。' +
          '代码注释这么写了，但没有测试覆盖。如果这个保证不成立，游标方案会在跨页边界漏数据。',
      } as TimelineEvent,
      status: 'succeeded',
      outcome: {
        summary:
          '增量同步改为游标驱动，页内去重；类型检查与单元测试通过。集成测试与 Lint 未运行。',
        changedFiles: 4,
        additions: 47,
        deletions: 9,
        checks: [
          {
            id: 'chk-142-typecheck',
            name: '类型检查',
            command: 'npm run typecheck',
            status: 'passed',
            exitCode: 0,
            durationMs: 4_380,
            output: '> tsc --noEmit\n\n找到 0 个错误。',
            runId: RUN,
            startedAtMs: now(),
          },
          {
            id: 'chk-142-unit',
            name: '单元测试',
            command: 'npm test -- --run',
            status: 'passed',
            exitCode: 0,
            durationMs: 9_760,
            output:
              '> vitest run\n\n' +
              ' Test Files  2 passed (2)\n      Tests  16 passed (16)',
            runId: RUN,
            startedAtMs: now(),
          },
          {
            id: 'chk-142-integration',
            name: '集成测试（真实账单 API）',
            command: 'npm run test:integration -- --live-api',
            status: 'notRun',
            exitCode: null,
            durationMs: null,
            output: null,
            runId: null,
            startedAtMs: null,
          },
          {
            id: 'chk-142-lint',
            name: 'Lint',
            command: 'npm run lint',
            status: 'notRun',
            exitCode: null,
            durationMs: null,
            output: null,
            runId: null,
            startedAtMs: null,
          },
        ],
      },
    },
  ];
}

export { CHECK_ABORTED, CHECK_FAILED, CHECK_INTEGRATION, CHECK_LINT, at, errorEvent, info, interrupted };

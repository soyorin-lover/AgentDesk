import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient, ApiClientError, type Event, type Task, type TaskDetail } from '../api/client/api.ts';
import {
  DOUBLE_BASE_HEAD,
  DOUBLE_ORIGIN,
  DOUBLE_PRESETS,
  DOUBLE_PROJECT,
  DOUBLE_TOKEN,
  createDoubleBackend,
  type DoubleBackend,
} from './double.ts';

/* ─────────────────────────────────────────────────────────────
   替身的契约测试

   用 Node 内置测试器直接跑：
     node --test src/v2/live/double.test.ts

   这些测试刻意**只**通过 `ApiClient` 说话（除了少数需要注入 Origin 头、
   或需要断言内部状态的场合）。测试里出现的每个断言都应当对真实后端同样成立
   —— 否则就说明替身与契约有偏差。
   ───────────────────────────────────────────────────────────── */

function makeClient(backend: DoubleBackend, token = DOUBLE_TOKEN): ApiClient {
  return new ApiClient({ baseUrl: DOUBLE_ORIGIN, getToken: () => token, fetch: backend.fetch });
}

let keyCounter = 0;
/** 每个写意图一个键。测试之间不共享，避免幂等表互相干扰。 */
function key(label: string): string {
  keyCounter += 1;
  return `test-${keyCounter}-${label}`;
}

/** 期望失败并返回 ApiClientError；避免在 TS strict 下用 `any`。 */
async function expectError(operation: () => Promise<unknown>): Promise<ApiClientError> {
  try {
    await operation();
  } catch (error) {
    if (error instanceof ApiClientError) return error;
    throw error;
  }
  throw new Error('期望请求失败，但它成功了');
}

/** 期望被中止并返回中止原因。 */
async function expectAbort(operation: () => Promise<unknown>): Promise<unknown> {
  try {
    await operation();
  } catch (error) {
    return error;
  }
  throw new Error('期望请求被中止，但它成功了');
}

/** 写入前必须拿最新版本：每次事件都会推进任务版本（与真实后端一致）。 */
async function version(client: ApiClient, taskId: string): Promise<number> {
  return (await client.task(taskId)).task.version;
}

type Fixture = { backend: DoubleBackend; client: ApiClient; task: Task };

/** 建一个任务（可选标题标记），默认把工作区准备到就绪。 */
async function setup(title: string, options: { prepare?: boolean; acceptance?: string[] } = {}): Promise<Fixture> {
  const backend = createDoubleBackend();
  const client = makeClient(backend);
  const task = await client.createTask(
    {
      projectId: DOUBLE_PROJECT.id,
      title,
      goal: `替身目标：${title}`,
      acceptanceCriteria: options.acceptance ?? ['只使用确定性替身数据'],
      agentInstanceId: 'codex-local',
    },
    key('create'),
  );
  if (options.prepare !== false) {
    await client.prepareWorkspace(task.id, { expectedVersion: task.version }, key('prepare'));
    await backend.settle();
  }
  return { backend, client, task };
}

/** 从详情里取最新运行的 id，避免各处重复判空。 */

/* ── 1. bootstrap ─────────────────────────────────────────── */

test('bootstrap 报告 project 模式并列出预设（含不可用的 .cmd 预设）', async () => {
  const backend = createDoubleBackend();
  const client = makeClient(backend);
  const boot = await client.bootstrap();

  assert.equal(boot.schemaVersion, 1);
  assert.equal(boot.mode, 'project');
  assert.equal(boot.storageHealthy, true);
  assert.deepEqual(boot.project, DOUBLE_PROJECT);
  assert.equal(boot.workspace.id, 'unbound');
  assert.equal(boot.workspace.kind, 'task_worktrees');
  assert.equal(boot.workspace.availability, 'per_task');
  assert.equal(boot.workspace.baseHead, DOUBLE_BASE_HEAD);

  const presets = boot.checkPresets ?? [];
  assert.deepEqual(
    presets.map((preset) => preset.id),
    DOUBLE_PRESETS.map((preset) => preset.id),
  );
  const windows = presets.find((preset) => preset.id === 'windows-script');
  assert.ok(windows, '期望有 .cmd 预设');
  assert.equal(windows.available, false);
  assert.ok(presets.filter((preset) => preset.id !== 'windows-script').every((preset) => preset.available));
  // 不可用的预设也必须完整回传，界面要能解释"为什么不可用"
  assert.equal(windows.executable, 'check.cmd');
  assert.deepEqual(windows.args, []);
  assert.equal(windows.timeoutMs, 1000);
  assert.equal(windows.outputBytes, 1024);

  assert.deepEqual(boot.engines, [
    { id: 'codex', integrationStatus: 'verified_probe' },
    { id: 'claude_code', integrationStatus: 'not_integrated' },
    { id: 'deepseek_harness', integrationStatus: 'not_integrated' },
  ]);
  assert.equal(boot.instances[0]?.id, 'codex-local');
  assert.equal(boot.instances[0]?.engineId, 'codex');

  const projects = await client.projects();
  assert.deepEqual(projects.items, [DOUBLE_PROJECT]);

  // 空后端：一开始没有任何任务
  const list = await client.tasks(0, 50);
  assert.deepEqual(list.items, []);
  assert.equal(list.nextCursor, null);
});

/* ── 2. 建任务 ────────────────────────────────────────────── */

test('新建任务：工作区未准备，可用动作不含 start', async () => {
  const { client, task } = await setup('准备前状态', { prepare: false });

  assert.equal(task.schemaVersion, 1);
  assert.equal(task.status, 'ready');
  assert.equal(task.version, 1);
  assert.equal(task.projectId, DOUBLE_PROJECT.id);
  assert.equal(task.agentInstanceId, 'codex-local');
  assert.equal(task.latestRunId, undefined);

  const detail = await client.task(task.id);
  assert.equal(detail.workspace?.status, 'unprepared');
  assert.equal(detail.workspace?.baseHead, undefined);
  assert.equal(detail.workspace?.branch, undefined);
  assert.equal(detail.run, undefined);
  assert.equal(detail.snapshot, undefined);
  assert.equal(detail.checks?.status, 'not_run');
  // 未准备的工作区只能编辑与准备，绝不能启动
  assert.deepEqual(detail.availableActions, ['edit', 'prepare_workspace']);
  assert.ok(!detail.availableActions.includes('start'));

  // 目标空白 / 验收条件为空 → draft
  const draft = await client.createTask(
    { projectId: DOUBLE_PROJECT.id, title: '草稿', goal: '   ', acceptanceCriteria: [], agentInstanceId: 'codex-local' },
    key('draft'),
  );
  assert.equal(draft.status, 'draft');
  assert.deepEqual((await client.task(draft.id)).availableActions, ['edit', 'prepare_workspace']);

  // 引擎未接入 → 422；项目不匹配 → 422
  const engine = await expectError(async () =>
    client.createTask(
      { projectId: DOUBLE_PROJECT.id, title: 'x', goal: 'y', acceptanceCriteria: ['z'], agentInstanceId: 'other' },
      key('engine'),
    ),
  );
  assert.equal(engine.status, 422);
  assert.equal(engine.code, 'engine_not_integrated');

  const project = await expectError(async () =>
    client.createTask(
      { projectId: 'nope', title: 'x', goal: 'y', acceptanceCriteria: ['z'], agentInstanceId: 'codex-local' },
      key('project'),
    ),
  );
  assert.equal(project.status, 422);
  assert.equal(project.code, 'project_not_found');
});

/* ── 3. 工作区准备 ────────────────────────────────────────── */

test('准备 workspace：就绪 / #conflict 失败 / #recover 需要恢复', async () => {
  const ok = await setup('普通任务');
  const okDetail = await ok.client.task(ok.task.id);
  assert.equal(okDetail.workspace?.status, 'ready');
  assert.equal(okDetail.workspace?.baseHead, DOUBLE_BASE_HEAD);
  assert.equal(okDetail.workspace?.branch, `codex/task-${ok.task.id}`);
  assert.deepEqual(okDetail.availableActions, ['edit', 'start']);

  const conflict = await setup('会冲突的任务 #conflict');
  const conflictDetail = await conflict.client.task(conflict.task.id);
  assert.equal(conflictDetail.workspace?.status, 'failed');
  assert.equal(conflictDetail.workspace?.reason, 'workspace_conflict');
  // 字面按规格第 4 步：状态不是 ready 时给 edit（可以改标题/目标后重来），
  // 但不给 prepare_workspace —— 状态已经不是 unprepared 了，重复准备是 409。
  assert.deepEqual(conflictDetail.availableActions, ['edit']);

  const recover = await setup('准备无法确认的任务 #recover');
  const recoverDetail = await recover.client.task(recover.task.id);
  assert.equal(recoverDetail.workspace?.status, 'needs_recovery');
  assert.equal(recoverDetail.workspace?.reason, 'preparation_unconfirmed');
  // 同上：状态不是 ready → 只给 edit
  assert.deepEqual(recoverDetail.availableActions, ['edit']);

  // 事件序列：preparing 在前，终态在后
  const types = (await ok.client.events(ok.task.id, 0, 200)).items.map((event) => event.type);
  assert.deepEqual(types, ['task.created', 'workspace.preparing', 'workspace.ready']);
  const conflictTypes = (await conflict.client.events(conflict.task.id, 0, 200)).items.map((event) => event.type);
  assert.deepEqual(conflictTypes, ['task.created', 'workspace.preparing', 'workspace.failed']);

  // 重复准备是显式冲突，不是静默幂等
  const again = await expectError(async () =>
    ok.client.prepareWorkspace(ok.task.id, { expectedVersion: okDetail.task.version }, key('prepare-again')),
  );
  assert.equal(again.status, 409);
  assert.equal(again.code, 'workspace_already_prepared');
});

/* ── 4. 运行 ──────────────────────────────────────────────── */

test('启动运行：202 立刻返回，之后任务进入审查态', async () => {
  const { backend, client, task } = await setup('跑一轮');

  const run = await client.startRun(task.id, { expectedVersion: await version(client, task.id) }, key('run'));
  // 202 的语义是"意图已记录"，不是"已完成"
  assert.equal(run.status, 'running');
  assert.equal(run.phase, 'starting');
  assert.equal(run.version, 1);
  assert.equal(run.engineId, 'codex');

  const mid = await client.task(task.id);
  assert.notEqual(mid.run?.status, 'succeeded');
  assert.ok(!(mid.availableActions ?? []).includes('accept'));
  assert.ok(!(mid.availableActions ?? []).includes('snapshot'));

  await backend.settle();

  const done = await client.task(task.id);
  assert.equal(done.task.status, 'in_review');
  assert.equal(done.run?.status, 'succeeded');
  assert.equal(done.run?.phase, 'ended');
  assert.ok(done.run?.endedAt);
  assert.equal(done.task.blockedReason, undefined);
  // 成功的一轮之后：可以取快照、可以给反馈、可以接受（接受仍在快照接口那一关把关）
  assert.deepEqual(done.availableActions, ['snapshot', 'feedback', 'accept']);
  assert.equal(done.snapshot, undefined, '运行本身不产快照 —— 必须由用户显式调用');

  // 逐轮输入由 GET /runs/:id 回传（首轮由目标推导）
  const detail = await client.run(run.id);
  assert.ok(detail.input?.includes('替身目标：跑一轮'));
  assert.ok(detail.input?.includes('- 只使用确定性替身数据'));

  // 事件脚本：created → 进入 executing → 活动 → 消息 → 终态
  const events = (await client.events(task.id, 0, 200)).items;
  const types = events.map((event) => event.type);
  assert.deepEqual(types.slice(0, 2), ['task.created', 'workspace.preparing']);
  assert.ok(types.includes('run.created'));
  assert.ok(types.includes('activity.started'));
  assert.ok(types.includes('activity.completed'));
  assert.ok(types.includes('message.delta'));
  assert.ok(types.includes('message.completed'));
  assert.equal(types.at(-1), 'task.updated');
  const completed = events.find((event) => event.type === 'message.completed');
  assert.match(String(completed?.data.text), /第 1 轮：已完成（替身输出）/);
  const categories = new Set(
    events.filter((event) => event.type === 'activity.started').map((event) => String(event.data.category)),
  );
  for (const category of categories) assert.ok(['read', 'search', 'command', 'edit'].includes(category));
});

test('运行失败与结果未知：#fail / #recover 标记', async () => {
  const fixture = await setup('标记测试');
  const first = await fixture.client.startRun(fixture.task.id, { expectedVersion: await version(fixture.client, fixture.task.id) }, key('run-1'));
  await fixture.backend.settle();

  // 第二轮必须带非空 input
  const missing = await expectError(async () =>
    fixture.client.startRun(fixture.task.id, { expectedVersion: 1 }, key('run-2')),
  );
  assert.equal(missing.status, 409);
  assert.equal(missing.code, 'version_conflict');

  const failVersion = await version(fixture.client, fixture.task.id);
  const failed = await fixture.client.startRun(fixture.task.id, { expectedVersion: failVersion, input: '这一轮会 #fail' }, key('run-fail'));
  await fixture.backend.settle();
  const failedDetail = await fixture.client.task(fixture.task.id);
  assert.equal(failed.status, 'running');
  assert.equal(failedDetail.run?.status, 'failed');
  assert.equal(failedDetail.run?.outcomeReason, 'start_rejected');
  assert.equal(failedDetail.task.status, 'in_review');
  // 失败的一轮不推进内容修订号，也不给接受
  assert.deepEqual(failedDetail.availableActions, ['snapshot', 'feedback']);

  const recoverVersion = await version(fixture.client, fixture.task.id);
  await fixture.client.startRun(fixture.task.id, { expectedVersion: recoverVersion, input: '这一轮会 #recover' }, key('run-recover'));
  await fixture.backend.settle();
  const recoverDetail = await fixture.client.task(fixture.task.id);
  assert.equal(recoverDetail.run?.status, 'needs_recovery');
  assert.equal(recoverDetail.run?.outcomeReason, 'result_unknown');
  assert.equal(recoverDetail.run?.endedAt, undefined, '结果未知就没有确定的结束时间');
  assert.equal(recoverDetail.task.status, 'in_progress');
  assert.equal(recoverDetail.task.blockedReason, 'result_unknown');
  // 阻断原因存在时不给任何动作
  assert.deepEqual(recoverDetail.availableActions, []);
  // 结果不可判定会在事件流里留下一条诊断
  const diagnostics = (await fixture.client.events(fixture.task.id, 0, 200)).items.filter((event) => event.type === 'diagnostic.recorded');
  assert.equal(diagnostics.length, 2);
  assert.deepEqual(
    diagnostics.map((event) => event.data.code),
    ['start_rejected', 'result_unknown'],
  );
});

test('长时间运行可被中断：#slow', async () => {
  const { backend, client, task } = await setup('中断测试');
  await client.startRun(task.id, { expectedVersion: await version(client, task.id) }, key('run-1'));
  await backend.settle();

  const slowVersion = await version(client, task.id);
  const slow = await client.startRun(task.id, { expectedVersion: slowVersion, input: '这一轮会 #slow' }, key('run-slow'));
  await backend.settle();

  // #slow 刻意不登记进 settle 的待处理集合，所以 settle() 之后它仍在执行
  const live = await client.task(task.id);
  assert.equal(live.run?.status, 'running');
  assert.equal(live.run?.phase, 'executing');
  assert.deepEqual(live.availableActions, ['interrupt']);
  assert.match(String((await client.run(slow.id)).input), /#slow/);

  // 运行中：其它写意图一律 active_run
  const busy = await expectError(async () => client.snapshot(task.id, { expectedVersion: live.task.version }, key('snap-busy')));
  assert.equal(busy.status, 409);
  assert.equal(busy.code, 'active_run');

  // 版本必须是「运行」的版本
  const conflict = await expectError(async () => client.interrupt(slow.id, { expectedVersion: 1 }, key('interrupt-bad')));
  assert.equal(conflict.status, 409);
  assert.equal(conflict.code, 'version_conflict');

  const stopped = await client.interrupt(slow.id, { expectedVersion: live.run!.version }, key('interrupt'));
  assert.equal(stopped.phase, 'stopping');
  await backend.settle();

  const aborted = await client.run(slow.id);
  assert.equal(aborted.status, 'aborted');
  assert.equal(aborted.phase, 'ended');
  assert.ok(aborted.endedAt);
  const after = await client.task(task.id);
  assert.equal(after.task.status, 'in_review');
  // 中止的运行没有产出，不能接受
  assert.deepEqual(after.availableActions, ['snapshot', 'feedback']);
});

/* ── 5. 事件：分页与 SSE 一致 ─────────────────────────────── */

test('SSE 与分页事件一致且 seq 无缺口', async () => {
  const { backend, client, task } = await setup('事件一致性');
  await client.startRun(task.id, { expectedVersion: await version(client, task.id) }, key('run'));
  await backend.settle();

  const collected: Event[] = [];
  const controller = new AbortController();
  const reader = (async () => {
    try {
      for await (const event of client.streamEvents(task.id, { signal: controller.signal })) {
        collected.push(event);
        // 收到快照事件就收工，保证流是被我们主动结束的
        if (event.type === 'changes.snapshot_created') break;
      }
    } catch {
      /* 结束时主动取消，忽略取消引发的错误 */
    }
  })();

  // 一边看流，一边产生新事件：这正是 SSE 与分页需要对齐的地方
  await client.snapshot(task.id, { expectedVersion: await version(client, task.id) }, key('snap'));
  await backend.settle();
  await Promise.race([
    reader,
    new Promise((_resolve, reject) => {
      const handle = setTimeout(() => reject(new Error('SSE 没有在 5 秒内送达快照事件')), 5000);
      // Node 下解除对事件循环的持有；浏览器没有 unref
      (handle as unknown as { unref?: () => void }).unref?.();
    }),
  ]);
  controller.abort();

  const last = collected.at(-1);
  assert.ok(last, '期望流里至少有一个事件');
  assert.equal(last.type, 'changes.snapshot_created');

  // seq 严格连续，从 1 开始，没有缺口
  collected.forEach((event, index) => assert.equal(event.seq, index + 1));
  collected.forEach((event) => assert.equal(event.taskId, task.id));

  // 逐字节等同分页接口按游标重放的同一段
  const page = await client.events(task.id, 0, 200);
  const expected = page.items.filter((event) => event.seq <= last.seq);
  assert.deepEqual(collected, expected);
  assert.equal(page.nextCursor, page.items.at(-1)?.seq ?? 0);

  // 从游标继续读到的下一条必须紧跟其后，没有跳号
  const tail = await client.events(task.id, last.seq, 200);
  if (tail.items.length > 0) assert.equal(tail.items[0]!.seq, last.seq + 1);
});

/* ── 6. 快照与文件 ────────────────────────────────────────── */

test('快照 201，文件可取回统一 diff', async () => {
  const { backend, client, task } = await setup('快照测试');
  await client.startRun(task.id, { expectedVersion: await version(client, task.id) }, key('run'));
  await backend.settle();

  const snapshot = await client.snapshot(task.id, { expectedVersion: await version(client, task.id) }, key('snap'));
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.taskId, task.id);
  assert.equal(snapshot.completeness, 'complete');
  assert.equal(snapshot.checks, 'not_run');
  assert.equal(snapshot.baseHead, DOUBLE_BASE_HEAD);
  assert.equal(snapshot.head, DOUBLE_BASE_HEAD);
  assert.equal(snapshot.contentDigest, backend.state().contentDigest[task.id]);
  assert.equal(snapshot.files.length, 2);
  assert.deepEqual(
    snapshot.files.map((file) => file.path),
    ['src/app/greeting.ts', 'README.md'],
  );

  const first = snapshot.files[0]!;
  const file = await client.file(snapshot.id, first.id);
  assert.equal(file.id, first.id);
  assert.equal(file.path, 'src/app/greeting.ts');
  assert.equal(file.kind, 'text');
  assert.match(file.diff ?? '', /@@ -1,4 \+1,6 @@ export function greet/);
  assert.match(file.diff ?? '', /\+.*trimmed = name\.trim\(\)/);
  assert.match(file.diff ?? '', /^-.*return 'Hello, ' \+ name/m);

  // 不存在的文件与不存在的快照都是 404
  const missingFile = await expectError(async () => client.file(snapshot.id, 'file-does-not-exist'));
  assert.equal(missingFile.status, 404);
  assert.equal(missingFile.code, 'not_found');
  const missingSnapshot = await expectError(async () => client.file('snap-nope', first.id));
  assert.equal(missingSnapshot.status, 404);

  const detail = await client.task(task.id);
  assert.equal(detail.snapshot?.id, snapshot.id);
  // 有了当前快照，check 动作才出现
  assert.deepEqual(detail.availableActions, ['snapshot', 'feedback', 'check', 'accept']);
});

/* ── 7. 检查 ──────────────────────────────────────────────── */

test('检查：通过 / 陈旧 / 失败 / 运行中取消 / 超时 / 不可用', async () => {
  const { backend, client, task } = await setup('检查测试');
  await client.startRun(task.id, { expectedVersion: await version(client, task.id) }, key('run'));
  await backend.settle();

  const snapshot = await client.snapshot(task.id, { expectedVersion: await version(client, task.id) }, key('snap'));

  // 通过 → current
  const running = await client.startCheck(
    task.id,
    { expectedVersion: await version(client, task.id), presetId: 'whitespace', snapshotId: snapshot.id },
    key('check-ws'),
  );
  assert.equal(running.status, 'running');
  assert.equal(running.validity, 'stale');
  assert.equal(running.snapshotId, snapshot.id);
  assert.equal(running.contentDigest, snapshot.contentDigest);
  assert.equal(running.version, 1);
  assert.deepEqual(running.preset, DOUBLE_PRESETS[0]);

  await backend.settle();
  const passed = await client.checks(task.id);
  assert.equal(passed.items.at(-1)?.status, 'passed');
  assert.equal(passed.items.at(-1)?.exitCode, 0);
  assert.equal(passed.items.at(-1)?.truncated, false);
  assert.equal(passed.summary.status, 'passed');
  assert.equal(passed.summary.validity, 'current');
  assert.equal(passed.summary.checkId, passed.items.at(-1)?.id);

  // 只在下一次检查仍绑当前摘要时才算 current —— 外部改动会让它 stale
  backend.simulateExternalChange(task.id);
  const stale = await client.checks(task.id);
  assert.equal(stale.items.at(-1)?.status, 'passed', '陈旧不等于失败：状态仍是 passed');
  assert.equal(stale.summary.validity, 'stale');
  assert.equal(stale.summary.status, 'passed');
  // 详情页读到的 summary 同源
  const staleDetail = await client.task(task.id);
  assert.equal(staleDetail.checks?.validity, 'stale');
  assert.equal(staleDetail.checks?.status, 'passed');
  // 旧快照也已陈旧：用它启动检查要被拒
  const staleStart = await expectError(async () =>
    client.startCheck(
      task.id,
      { expectedVersion: staleDetail.task.version, presetId: 'whitespace', snapshotId: snapshot.id },
      key('check-stale'),
    ),
  );
  assert.equal(staleStart.status, 409);
  assert.equal(staleStart.code, 'snapshot_stale');

  // 外部改动之后重新取快照，才能继续检查
  const snapshot2 = await client.snapshot(task.id, { expectedVersion: await version(client, task.id) }, key('snap-2'));
  assert.notEqual(snapshot2.contentDigest, snapshot.contentDigest);

  const unit = await client.startCheck(
    task.id,
    { expectedVersion: await version(client, task.id), presetId: 'unit', snapshotId: snapshot2.id },
    key('check-unit'),
  );
  await backend.settle();
  const failed = await client.checks(task.id);
  const unitResult = failed.items.find((item) => item.id === unit.id);
  assert.equal(unitResult?.status, 'failed');
  assert.equal(unitResult?.exitCode, 1);
  assert.ok(unitResult?.stdout.includes('not ok 1 - greeting'));
  assert.ok(unitResult?.stderr.includes('ERR_ASSERTION'));
  assert.equal(unitResult?.validity, 'current');
  assert.equal(failed.summary.checkId, unit.id);

  // 长时间检查：一直 running，取消后才是 cancelled
  const slow = await client.startCheck(
    task.id,
    { expectedVersion: await version(client, task.id), presetId: 'slow', snapshotId: snapshot2.id },
    key('check-slow'),
  );
  await backend.settle();
  const during = await client.checks(task.id);
  assert.equal(during.items.find((item) => item.id === slow.id)?.status, 'running');
  assert.equal(during.summary.status, 'running');
  assert.equal(during.summary.validity, 'stale', '还在跑的检查不能算 current');
  // 正在跑的检查让任务锁在 cancel_check 上
  assert.deepEqual((await client.task(task.id)).availableActions, ['cancel_check']);

  const runningCheck = during.items.find((item) => item.id === slow.id)!;
  const cancelled = await client.cancelCheck(slow.id, { expectedVersion: runningCheck.version }, key('cancel-slow'));
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.reason, 'cancel_requested');
  await backend.settle();
  const afterCancel = await client.checks(task.id);
  assert.equal(afterCancel.items.find((item) => item.id === slow.id)?.status, 'cancelled');

  // 再次取消 → 409 check_not_running
  const notRunning = await expectError(async () =>
    client.cancelCheck(slow.id, { expectedVersion: afterCancel.items.find((item) => item.id === slow.id)!.version }, key('cancel-again')),
  );
  assert.equal(notRunning.status, 409);
  assert.equal(notRunning.code, 'check_not_running');

  // 超时
  const timeout = await client.startCheck(
    task.id,
    { expectedVersion: await version(client, task.id), presetId: 'timeout', snapshotId: snapshot2.id },
    key('check-timeout'),
  );
  await backend.settle();
  const timedOut = (await client.checks(task.id)).items.find((item) => item.id === timeout.id);
  assert.equal(timedOut?.status, 'timed_out');
  assert.equal(timedOut?.reason, 'timeout');
  assert.equal(timedOut?.endedAt !== undefined, true);

  // 不可用的预设：422 check_unavailable
  const unavailable = await expectError(async () =>
    client.startCheck(
      task.id,
      { expectedVersion: await version(client, task.id), presetId: 'windows-script', snapshotId: snapshot2.id },
      key('check-cmd'),
    ),
  );
  assert.equal(unavailable.status, 422);
  assert.equal(unavailable.code, 'check_unavailable');

  // 未知预设：422 preset_not_found
  const unknown = await expectError(async () =>
    client.startCheck(
      task.id,
      { expectedVersion: await version(client, task.id), presetId: 'nope', snapshotId: snapshot2.id },
      key('check-unknown'),
    ),
  );
  assert.equal(unknown.status, 422);
  assert.equal(unknown.code, 'preset_not_found');

  // 每次检查都留下 check.created / check.ended 事件
  const types = (await client.events(task.id, 0, 200)).items.map((event) => event.type);
  assert.equal(types.filter((type) => type === 'check.created').length, 4);
  assert.equal(types.filter((type) => type === 'check.ended').length, 4);
});

/* ── 8. 接受与失效 ────────────────────────────────────────── */

test('接受成功；新的一轮使旧接受失效', async () => {
  const { backend, client, task } = await setup('接受测试');
  await client.startRun(task.id, { expectedVersion: await version(client, task.id) }, key('run-1'));
  await backend.settle();
  const snapshot = await client.snapshot(task.id, { expectedVersion: await version(client, task.id) }, key('snap'));

  const accepted = await client.accept(task.id, { expectedVersion: await version(client, task.id), snapshotId: snapshot.id }, key('accept'));
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.acceptedSnapshotId, snapshot.id);

  const state = backend.state();
  const first = state.acceptances.filter((item) => item.taskId === task.id && item.valid);
  assert.equal(first.length, 1);
  assert.equal(first[0]?.snapshotId, snapshot.id);
  assert.equal(first[0]?.runId, snapshot.runId);

  const acceptedDetail = await client.task(task.id);
  assert.equal(acceptedDetail.task.status, 'accepted');
  // 已经接受，但仍可再来一轮
  assert.deepEqual(acceptedDetail.availableActions, ['snapshot', 'feedback', 'check', 'accept']);

  // 重新接受：旧接受先失效，再产生新的
  const reaccepted = await client.accept(task.id, { expectedVersion: acceptedDetail.task.version, snapshotId: snapshot.id }, key('accept-again'));
  assert.equal(reaccepted.acceptedSnapshotId, snapshot.id);
  const afterReaccept = backend.state().acceptances.filter((item) => item.taskId === task.id);
  assert.equal(afterReaccept.length, 2);
  assert.equal(afterReaccept.filter((item) => item.valid).length, 1);

  // 新的一轮 → 旧接受失效
  const reacceptDetail = await client.task(task.id);
  await client.startRun(task.id, { expectedVersion: reacceptDetail.task.version, input: '再来一轮' }, key('run-2'));
  await backend.settle();

  const events = (await client.events(task.id, 0, 200)).items;
  const invalidated = events.filter((event) => event.type === 'task.acceptance_invalidated');
  // 第一次重接受让第 1 条失效（reaccepted），新的一轮让第 2 条失效（new_run）
  assert.deepEqual(
    invalidated.map((event) => event.data.reason),
    ['reaccepted', 'new_run'],
  );
  assert.equal(new Set(invalidated.map((event) => String(event.data.acceptanceId))).size, 2);

  const final = await client.task(task.id);
  assert.equal(final.task.status, 'in_review');
  assert.equal(final.task.acceptedSnapshotId, undefined);
  assert.equal(backend.state().acceptances.every((item) => !item.valid), true);

  // 运行没有成功时不许接受：先制造一次 #fail 的运行
  const failVersion = await version(client, task.id);
  await client.startRun(task.id, { expectedVersion: failVersion, input: '#fail' }, key('run-3'));
  await backend.settle();
  const notSuccessful = await expectError(async () =>
    client.accept(task.id, { expectedVersion: (await client.task(task.id)).task.version, snapshotId: snapshot.id }, key('accept-bad')),
  );
  assert.equal(notSuccessful.status, 409);
  assert.equal(notSuccessful.code, 'run_not_successful');
});

/* ── 9. 版本冲突 ──────────────────────────────────────────── */

test('陈旧的 expectedVersion → 409 version_conflict', async () => {
  const { client, task } = await setup('版本冲突');
  const stale = task.version + 7;
  const error = await expectError(async () => client.updateTask(task.id, { expectedVersion: stale, title: '改个标题' }, key('patch')));
  assert.equal(error.status, 409);
  assert.equal(error.code, 'version_conflict');

  // 读到最新版本后可以改；改完这个版本立刻作废
  const current = await version(client, task.id);
  const updated = await client.updateTask(task.id, { expectedVersion: current, title: '改个标题' }, key('patch-ok'));
  assert.equal(updated.title, '改个标题');
  assert.equal(updated.version, current + 1);
  const conflict = await expectError(async () => client.updateTask(task.id, { expectedVersion: current, title: '再改' }, key('patch-2')));
  assert.equal(conflict.code, 'version_conflict');
});

/* ── 10. 幂等 ─────────────────────────────────────────────── */

test('幂等键：同键同体重放，同键异体冲突', async () => {
  const backend = createDoubleBackend();
  const client = makeClient(backend);
  const body = {
    projectId: DOUBLE_PROJECT.id,
    title: '幂等测试',
    goal: '同一个键只能对应同一份内容',
    acceptanceCriteria: ['重放不得产生新对象'],
    agentInstanceId: 'codex-local',
  };

  const idempotencyKey = key('idem');
  const first = await client.createTask(body, idempotencyKey);
  const replay = await client.createTask(body, idempotencyKey);
  assert.equal(replay.id, first.id, '同键同体必须返回同一个资源');
  assert.equal(backend.state().tasks.length, 1);

  const conflict = await expectError(async () => client.createTask({ ...body, title: '换了标题' }, idempotencyKey));
  assert.equal(conflict.status, 409);
  assert.equal(conflict.code, 'idempotency_conflict');
  assert.equal(backend.state().tasks.length, 1, '冲突不得产生新对象');

  // 键的作用域是 (方法 + 路径 + 键)，不同路径互不影响
  const other = await client.createTask(body, key('idem-2'));
  assert.notEqual(other.id, first.id);

  // 202 类写意图同样支持重放：运行不会因为重发而多起一轮
  await client.prepareWorkspace(first.id, { expectedVersion: first.version }, key('prepare'));
  await backend.settle();
  // 重放必须用同一个键和同一份载荷：这才是幂等的定义
  const runBody = { expectedVersion: await version(client, first.id) };
  const runKey = key('run');
  const started = await client.startRun(first.id, runBody, runKey);
  const startedAgain = await client.startRun(first.id, runBody, runKey);
  assert.equal(startedAgain.id, started.id);
  assert.equal(backend.state().runs.length, 1);
  await backend.settle();
});

/* ── 11. 鉴权与来源 ───────────────────────────────────────── */

test('令牌错误 401；来源不允许 403；中止信号被遵守', async () => {
  const backend = createDoubleBackend();
  const bad = makeClient(backend, 'not-the-token');
  const unauthorized = await expectError(async () => bad.bootstrap());
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.code, 'unauthorized');

  // 空令牌客户端自己就挡下了（ApiClient 不会发出这种请求），这里直接对替身发
  const missing = await backend.fetch(`${DOUBLE_ORIGIN}/api/v1/bootstrap`, { method: 'GET', headers: { authorization: 'Bearer ' } });
  assert.equal(missing.status, 401);
  assert.equal(((await missing.json()) as { error: { code: string } }).error.code, 'unauthorized');

  // Origin 由客户端之外的调用方注入，这里直接对替身发请求
  const forbidden = await backend.fetch(`${DOUBLE_ORIGIN}/api/v1/bootstrap`, {
    method: 'GET',
    headers: { authorization: `Bearer ${DOUBLE_TOKEN}`, origin: 'http://evil.example' },
  });
  assert.equal(forbidden.status, 403);
  assert.deepEqual(await forbidden.json(), { error: { code: 'origin_forbidden', message: 'origin_forbidden', retryable: false } });

  // 放行的来源正常通过
  const allowed = await backend.fetch(`${DOUBLE_ORIGIN}/api/v1/bootstrap`, {
    method: 'GET',
    headers: { authorization: `Bearer ${DOUBLE_TOKEN}`, origin: 'http://localhost:5311' },
  });
  assert.equal(allowed.status, 200);
  assert.equal(((await allowed.json()) as { mode: string }).mode, 'project');

  // 已经中止的信号：立刻抛出，不做任何工作
  const preAborted = new AbortController();
  preAborted.abort();
  const reason = await expectAbort(() => bad.bootstrap(preAborted.signal));
  assert.equal((reason as Error).name, 'AbortError');

  // 请求途中中止：拒绝而不是返回半成品
  const inFlight = new AbortController();
  const pending = backend.fetch(`${DOUBLE_ORIGIN}/api/v1/bootstrap`, {
    method: 'GET',
    headers: { authorization: `Bearer ${DOUBLE_TOKEN}` },
    signal: inFlight.signal,
  });
  inFlight.abort();
  const abortedReason = await expectAbort(() => pending);
  assert.equal((abortedReason as Error).name, 'AbortError');
});

/* ── 12. 任务之间互不串味 ─────────────────────────────────── */

test('两个任务的事件、检查、接受互不影响', async () => {
  const backend = createDoubleBackend();
  const client = makeClient(backend);
  const a = await client.createTask(
    { projectId: DOUBLE_PROJECT.id, title: '任务 A', goal: 'A 的目标', acceptanceCriteria: ['A 的条件'], agentInstanceId: 'codex-local' },
    key('a-create'),
  );
  const b = await client.createTask(
    { projectId: DOUBLE_PROJECT.id, title: '任务 B', goal: 'B 的目标', acceptanceCriteria: ['B 的条件'], agentInstanceId: 'codex-local' },
    key('b-create'),
  );
  await client.prepareWorkspace(a.id, { expectedVersion: a.version }, key('a-prepare'));
  await client.prepareWorkspace(b.id, { expectedVersion: b.version }, key('b-prepare'));
  await backend.settle();

  const beforeB = await client.task(b.id);

  await client.startRun(a.id, { expectedVersion: await version(client, a.id) }, key('a-run'));
  await backend.settle();
  const snapshot = await client.snapshot(a.id, { expectedVersion: await version(client, a.id) }, key('a-snap'));
  const check = await client.startCheck(
    a.id,
    { expectedVersion: await version(client, a.id), presetId: 'whitespace', snapshotId: snapshot.id },
    key('a-check'),
  );
  await backend.settle();
  const accepted = await client.accept(a.id, { expectedVersion: await version(client, a.id), snapshotId: snapshot.id }, key('a-accept'));
  assert.equal(accepted.status, 'accepted');

  const state = backend.state();
  // 事件：每个任务一套独立 seq，且 id 前缀带任务 id
  const eventsA = state.events[a.id] ?? [];
  const eventsB = state.events[b.id] ?? [];
  assert.ok(eventsA.length > eventsB.length);
  assert.ok(eventsA.every((event) => event.taskId === a.id));
  assert.ok(eventsB.every((event) => event.taskId === b.id));
  assert.equal(eventsB.map((event) => event.seq).join(','), eventsB.map((_event, index) => index + 1).join(','));
  assert.equal((await client.task(b.id)).lastEventSeq, eventsB.length);
  assert.equal((await client.task(a.id)).lastEventSeq, eventsA.length);
  assert.ok(!eventsA.some((event) => event.id === `ev-${b.id}-1`));

  // B 什么都没发生：没有运行、没有检查、没有接受、没有快照
  const detailB = await client.task(b.id);
  assert.equal(detailB.task.status, 'ready');
  assert.equal(detailB.run, undefined);
  assert.equal(detailB.snapshot, undefined);
  assert.equal(detailB.checks?.status, 'not_run');
  assert.deepEqual(detailB.task, beforeB.task);
  assert.deepEqual(detailB.availableActions, ['edit', 'start']);
  const checksB = await client.checks(b.id);
  assert.deepEqual(checksB.items, []);
  assert.deepEqual(checksB.summary, { status: 'not_run' });

  // 全局表里也都按 taskId 分得清
  assert.ok(state.checks.every((item) => item.taskId === a.id));
  assert.equal(state.checks.length, 1);
  assert.equal(state.checks[0]?.id, check.id);
  assert.equal(state.acceptances.filter((item) => item.taskId === b.id).length, 0);
  assert.equal(state.snapshots.filter((item) => item.taskId === b.id).length, 0);
  assert.equal(state.runs.filter((item) => item.taskId === b.id).length, 0);

  // B 的事件流只送 B 的事件
  const bEvents = (await client.events(b.id, 0, 200)).items;
  assert.ok(bEvents.every((event) => event.taskId === b.id));
  assert.deepEqual(bEvents.map((event) => event.type), ['task.created', 'workspace.preparing', 'workspace.ready']);

  // 列表按插入顺序分页，游标是过滤前的原始下标
  const page = await client.tasks(0, 1);
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0]?.id, a.id);
  const filtered = await client.tasks(0, 50, undefined, { status: 'ready' });
  assert.deepEqual(filtered.items.map((task) => task.id), [b.id]);
  assert.deepEqual((await client.tasks(0, 50, undefined, { projectId: 'other' })).items, []);
});

/* ── 13. 确定性 ───────────────────────────────────────────── */

test('同样的调用序列得到同样的响应（时间戳与摘要都稳定）', async () => {
  async function scenario() {
    const backend = createDoubleBackend();
    const client = makeClient(backend);
    const task = await client.createTask(
      { projectId: DOUBLE_PROJECT.id, title: '确定性', goal: '同一序列同一结果', acceptanceCriteria: ['可重复'], agentInstanceId: 'codex-local' },
      'fixed-key',
    );
    await client.prepareWorkspace(task.id, { expectedVersion: task.version }, 'fixed-prepare');
    await backend.settle();
    await client.startRun(task.id, { expectedVersion: await version(client, task.id) }, 'fixed-run');
    await backend.settle();
    const snapshot = await client.snapshot(task.id, { expectedVersion: await version(client, task.id) }, 'fixed-snapshot');
    const events = await client.events(task.id, 0, 200);
    return { snapshot, events, detail: await client.task(task.id) };
  }

  const one = await scenario();
  const two = await scenario();
  assert.deepEqual(one.snapshot, two.snapshot);
  assert.deepEqual(one.events, two.events);
  assert.deepEqual(one.detail, two.detail);
  // 计数器从 1 开始，标识符因此可预测
  assert.equal(one.snapshot.id, 'snap-1');
  assert.equal(one.detail.task.id, 't-1');
  assert.equal(one.detail.workspace?.id, 'ws-1');
  assert.equal(one.detail.run?.id, 'run-1');
  assert.equal(one.events.items[0]?.id, 'ev-t-1-1');
  assert.match(String(one.events.items[0]?.occurredAt), /^2026-10-09T09:00:00/);
});

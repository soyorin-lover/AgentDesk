import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { BackendService } from '../src/backend/service.ts';
import { startHttp } from '../src/backend/http.ts';
import { ApiClient, ApiClientError } from '../src/client/api.ts';
import { DatabaseSync } from 'node:sqlite';
import { FixtureEngine, projectFixture, taskInput, settled, waitFor } from './backend-fixtures.ts';
import type { executeCheck } from '../src/backend/checks.ts';

async function fixture(checkExecutor?: typeof executeCheck) {
  const { config } = await projectFixture(); const engine = new FixtureEngine();
  const options = { ...config, adapter: engine, checkExecutor, checkPresets: [{ id: 'pass', name: 'Pass', executable: process.execPath, args: ['-e', 'process.exit(0)'], timeoutMs: 3000, outputBytes: 100 }] };
  const s = await BackendService.open(options);
  return { s, engine, options };
}
async function completed(f: Awaited<ReturnType<typeof fixture>>) {
  const t = await f.s.createTask(taskInput, 'create'); await f.s.prepareWorkspace(t.id, { expectedVersion: t.version }, 'prepare');
  await settled(f.s, t.id);
  const r = await f.s.startRun(t.id, { expectedVersion: f.s.task(t.id).version }, 'start');
  await waitFor(() => f.engine.contexts.length === 1); f.engine.finish({ status: 'succeeded' });
  await waitFor(() => f.s.run(r.id).status === 'succeeded');
  const snap = await f.s.snapshot(t.id, { expectedVersion: f.s.task(t.id).version }, 'snapshot');
  return { t, r, snap };
}

test('acceptance query exposes binding, persists external invalidation and survives restart', async () => {
  const f = await fixture(); const { s } = f;
  try {
    const { t, r, snap } = await completed(f);
    assert.equal((await s.queryAcceptance(t.id)).status, 'not_accepted');
    await s.accept(t.id, { expectedVersion: s.task(t.id).version, snapshotId: snap.id }, 'accept');
    const valid = await s.queryAcceptance(t.id);
    assert.equal(valid.status, 'valid'); assert.equal(valid.acceptance?.contentDigest, snap.contentDigest);
    assert.equal(valid.acceptance?.runId, r.id); assert.equal(valid.acceptance?.snapshotId, snap.id);
    const legacy = new DatabaseSync(f.options.database);
    try { legacy.prepare("UPDATE documents SET value=json_remove(value,'$.contentDigest') WHERE kind='acceptance'").run(); }
    finally { legacy.close(); }
    assert.equal((await s.queryAcceptance(t.id)).acceptance?.contentDigest, snap.contentDigest);
    const cwd = join(f.options.workspaceRoot, t.workspaceId);
    await writeFile(join(cwd, 'sample.txt'), 'outside\n');
    const changed = await s.queryDetail(t.id);
    assert.equal(changed.acceptance.status, 'invalid'); assert.equal(changed.acceptance.reason, 'workspace_changed');
    assert.equal(changed.task.status, 'in_review');
    await writeFile(join(cwd, 'sample.txt'), 'baseline\n');
    assert.equal((await s.queryAcceptance(t.id)).status, 'invalid');
    await s.close();
    const old = new DatabaseSync(f.options.database);
    try { old.prepare("UPDATE documents SET value=json_remove(value,'$.invalidatedReason','$.invalidatedAt') WHERE kind='acceptance'").run(); }
    finally { old.close(); }
    const reopened = await BackendService.open(f.options);
    try { assert.equal((await reopened.queryAcceptance(t.id)).reason, 'workspace_changed'); }
    finally { await reopened.close(); }
  } finally { await s.close(); }
});

test('real HTTP overview and attention cover all tasks, paginate and report currentVersion', async () => {
  const f = await fixture(); const http = await startHttp(f.s);
  const client = new ApiClient({ baseUrl: http.url, getToken: () => http.token });
  try {
    assert.equal((await client.overview()).totalTasks, 0);
    for (let n = 0; n < 3; n++) await client.createTask({ ...taskInput, title: 'task ' + n }, 'task-' + n);
    const overview = await client.overview(); assert.equal(overview.totalTasks, 3); assert.equal(overview.taskCounts.ready, 3);
    const first = await client.attention(0, 1); assert.equal(first.items.length, 1); assert.equal(first.nextCursor, 1);
    const next = await client.attention(first.nextCursor!, 10); assert.equal(next.items.length, 2);
    assert.equal(new Set([...first.items, ...next.items].map(i => i.taskId)).size, 3);
    assert.equal((await client.attention(0, 10, undefined, { projectId: 'missing' })).items.length, 0);
    const task = (await client.tasks()).items[0];
    const conflict = await fetch(http.url + '/api/v1/tasks/' + task.id, { method: 'PATCH', headers: { Authorization: 'Bearer ' + http.token, 'Content-Type': 'application/json', 'Idempotency-Key': 'conflict' }, body: JSON.stringify({ expectedVersion: 99, title: 'update' }) });
    assert.equal(conflict.status, 409); assert.equal((await conflict.json()).currentVersion, task.version);
    await assert.rejects(client.updateTask(task.id, { expectedVersion: 99, title: 'update' }, 'client-conflict'), error => error instanceof ApiClientError && error.currentVersion === task.version);
    assert.equal((await client.acceptance(task.id)).status, 'not_accepted');
    assert.equal((await client.recovery(task.id)).items.length, 0);
    assert.equal((await client.bootstrap()).executionMode, 'codex');
    assert.equal((await fetch(http.url + '/api/v1/overview')).status, 401);
  } finally { await http.close(); await f.s.close(); }
});

test('confirmed check result survives scan failure and restart, recovery is versioned and idempotent', async () => {
  let gitFile = '', saved = '';
  const f = await fixture(() => ({ cancel: () => {}, result: (async () => {
    await rename(gitFile, saved);
    return { status: 'passed' as const, stdout: 'confirmed', stderr: '', truncated: false, exitCode: 0 };
  })() }));
  try {
    const { t, snap } = await completed(f);
    gitFile = join(f.options.workspaceRoot, t.workspaceId, '.git'); saved = gitFile + '.saved';
    const check = await f.s.startCheck(t.id, { expectedVersion: f.s.task(t.id).version, snapshotId: snap.id, presetId: 'pass' }, 'check');
    await waitFor(() => f.s.check(check.id).status === 'needs_recovery');
    await rename(saved, gitFile); await f.s.close();
    const s = await BackendService.open(f.options); const http = await startHttp(s);
    const client = new ApiClient({ baseUrl: http.url, getToken: () => http.token });
    try {
      const recovery = await client.recovery(t.id); assert.equal(recovery.items[0].recoverable, true);
      assert.ok((await client.task(t.id)).availableActions.includes('recover_check'));
      await assert.rejects(client.recoverCheck(check.id, { expectedVersion: 0 }, 'bad'), /version_conflict/);
      const body = { expectedVersion: s.check(check.id).version };
      const recovered = await client.recoverCheck(check.id, body, 'recover');
      assert.equal(recovered.status, 'passed'); assert.equal(recovered.validity, 'stale'); assert.equal(recovered.reason, 'recovered_confirmed_exit');
      assert.equal((await client.recoverCheck(check.id, body, 'recover')).version, recovered.version);
      await assert.rejects(client.recoverCheck(check.id, { ...body, expectedVersion: 999 }, 'recover'), /idempotency_conflict/);
      assert.equal((await client.recovery(t.id)).items.length, 0);
      assert.equal((await client.checks(t.id)).summary.validity, 'stale');
      assert.equal((await client.events(t.id, 0, 200)).items.filter(e => e.type === 'check.recovered').length, 1);
    } finally { await http.close(); await s.close(); }
  } finally { await f.s.close(); }
});

test('unknown check exit has diagnostics but cannot be unlocked by a browser assertion', async () => {
  const f = await fixture(() => ({ cancel: () => {}, result: Promise.resolve({ status: 'needs_recovery', reason: 'process_exit_unconfirmed', stdout: '', stderr: '', truncated: false }) }));
  try {
    const { t, snap } = await completed(f);
    const c = await f.s.startCheck(t.id, { expectedVersion: f.s.task(t.id).version, snapshotId: snap.id, presetId: 'pass' }, 'check');
    await waitFor(() => f.s.check(c.id).status === 'needs_recovery');
    assert.equal(f.s.recovery(t.id).items[0].recoverable, false);
    await assert.rejects(f.s.recoverCheck(c.id, { expectedVersion: f.s.check(c.id).version }, 'unsafe'), /process_exit_unconfirmed/);
    await assert.rejects(f.s.recoverCheck(c.id, { expectedVersion: f.s.check(c.id).version, confirmed: true }, 'assertion'), /invalid_input/);
    const overview = f.s.overview(); assert.equal(overview.checks.needsRecovery, 1);
    const pending = f.s.attention(0, 20); assert.ok(pending.items.some(i => i.kind === 'check_recovery' && i.taskId === t.id));
    assert.deepEqual(f.s.detail(t.id).availableActions, []);
  } finally { await f.s.close(); }
});

test('unverifiable acceptance stays uncertain and feedback durably invalidates the previous acceptance', async () => {
  const f = await fixture();
  let moved = false, file = '', saved = '';
  try {
    const { t, snap } = await completed(f);
    await f.s.accept(t.id, { expectedVersion: f.s.task(t.id).version, snapshotId: snap.id }, 'accept');
    file = join(f.options.workspaceRoot, t.workspaceId, '.git'); saved = file + '.saved';
    await rename(file, saved); moved = true;
    const unknown = await f.s.queryAcceptance(t.id);
    assert.equal(unknown.status, 'unverifiable'); assert.equal(unknown.reason, 'workspace_unverifiable');
    await rename(saved, file); moved = false;
    assert.equal((await f.s.queryAcceptance(t.id)).status, 'valid');
    await f.s.startRun(t.id, { expectedVersion: f.s.task(t.id).version, input: 'feedback' }, 'feedback');
    const old = await f.s.queryAcceptance(t.id); assert.equal(old.status, 'invalid'); assert.equal(old.reason, 'new_run');
    assert.ok(old.acceptance?.invalidatedAt);
  } finally { if (moved) await rename(saved, file); await f.s.close(); }
});

test('overview filters and attention validate cursors and report draft preparation separately', async () => {
  const f = await fixture();
  try {
    await f.s.createTask({ ...taskInput, goal: '', acceptanceCriteria: [] }, 'draft');
    assert.equal(f.s.overview('missing').totalTasks, 0);
    assert.equal(f.s.overview().workspaces.unprepared, 1);
    assert.deepEqual(f.s.attention().items.map(i => i.kind), ['prepare_workspace', 'task_details']);
    assert.throws(() => f.s.attention(-1), /invalid_input/);
    assert.throws(() => f.s.attention(0, 201), /invalid_input/);
    assert.throws(() => f.s.attention(3, 1), /invalid_input/);
    assert.equal(f.s.attention(2, 1).nextCursor, null);
  } finally { await f.s.close(); }
});

test('acceptance invalidation preserves task version changes from a concurrent check completion', async () => {
  type Result = Awaited<ReturnType<typeof executeCheck>['result']>;
  let finish!: (result: Result) => void;
  const result = new Promise<Result>(r => { finish = r; });
  const unknown: Result = { status: 'needs_recovery', reason: 'process_exit_unconfirmed', stdout: '', stderr: '', truncated: false };
  const f = await fixture(() => ({ result, cancel: () => finish(unknown) }));
  try {
    const { t, snap } = await completed(f);
    await f.s.accept(t.id, { expectedVersion: f.s.task(t.id).version, snapshotId: snap.id }, 'accept');
    const check = await f.s.startCheck(t.id, { expectedVersion: f.s.task(t.id).version, presetId: 'pass', snapshotId: snap.id }, 'check');
    const version = f.s.task(t.id).version;
    await writeFile(join(f.options.workspaceRoot, t.workspaceId, 'sample.txt'), 'external\n');
    const query = f.s.queryAcceptance(t.id);
    await new Promise<void>(r => setImmediate(r)); finish(unknown);
    await waitFor(() => f.s.check(check.id).status === 'needs_recovery');
    assert.equal((await query).status, 'invalid');
    assert.equal(f.s.task(t.id).version, version + 2, 'check completion and acceptance invalidation each increment version');
  } finally { finish(unknown); await f.s.close(); }
});

test('attention omits a failed check from a previous run after feedback starts', async () => {
  const f = await fixture(() => ({ cancel: () => {}, result: Promise.resolve({ status: 'failed', exitCode: 1, stdout: '', stderr: '', truncated: false }) }));
  try {
    const { t, snap } = await completed(f);
    const check = await f.s.startCheck(t.id, { expectedVersion: f.s.task(t.id).version, presetId: 'pass', snapshotId: snap.id }, 'check');
    await waitFor(() => f.s.check(check.id).status === 'failed');
    assert.ok(f.s.attention().items.some(i => i.kind === 'check_failed'));
    await f.s.startRun(t.id, { expectedVersion: f.s.task(t.id).version, input: 'fix' }, 'feedback');
    assert.equal(f.s.attention().items.some(i => i.kind === 'check_failed'), false);
  } finally { await f.s.close(); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createSample } from '../src/workspace.ts';
import { BackendService } from '../src/backend/service.ts';
import type { EngineAdapter, ExecutionContext, ExecutionResult } from '../src/backend/types.ts';

// Only the external engine is controlled; SQLite, transactions, repository reads and service are real.
export class ControlledEngine implements EngineAdapter {
  contexts: ExecutionContext[] = [];
  finish!: (result: ExecutionResult) => void;
  reject!: (error: Error) => void;
  async start(context: ExecutionContext) {
    this.contexts.push(context); context.onSession('fixture-session'); context.onModel('fixture-model');
    const result = new Promise<ExecutionResult>((resolve, reject) => { this.finish = resolve; this.reject = reject; });
    return { result, interrupt: async () => {}, close: async () => { this.reject(Error('closed')); } };
  }
}
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'agentdesk-service-'));
  const cwd = await createSample(root, 'repo');
  const adapter = new ControlledEngine();
  const config = { workspace: cwd, database: join(root, 'state.sqlite'), mainProject: process.cwd(), adapter };
  return { root, cwd, adapter, config, service: await BackendService.open(config) };
}
export async function waitUntil(check: () => boolean, timeout = 5000) {
  const until = Date.now() + timeout;
  while (!check()) { if (Date.now() > until) throw Error('condition timeout'); await new Promise(r => setTimeout(r, 10)); }
}
const body = { title: '测试任务', goal: '修改样例', acceptanceCriteria: ['内容准确'], agentInstanceId: 'codex-local' };

test('idempotent execution, actual review, feedback and snapshot-bound acceptance persist across restart', async () => {
  const { service: s, cwd, adapter, config } = await setup();
  try {
    const task = await s.createTask(body, 'create');
    assert.equal((await s.createTask(body, 'create')).id, task.id);
    await assert.rejects(s.createTask({ ...body, title: 'conflict' }, 'create'), /idempotency_conflict/);
    const run = await s.startRun(task.id, { expectedVersion: task.version }, 'start');
    assert.equal((await s.startRun(task.id, { expectedVersion: task.version }, 'start')).id, run.id);
    await waitUntil(() => adapter.contexts.length === 1);
    await assert.rejects(s.startRun(task.id, { expectedVersion: s.task(task.id).version, input: 'duplicate' }, 'other'), /active_run/);
    await writeFile(join(cwd, 'sample.txt'), 'first\n');
    adapter.contexts[0].emit({ type: 'message.completed', data: { messageId: 'm1', text: '完成' } });
    adapter.finish({ status: 'succeeded' }); await waitUntil(() => s.run(run.id).status === 'succeeded');
    const snap = await s.snapshot(task.id, { expectedVersion: s.task(task.id).version }, 'review');
    assert.equal(snap.checks, 'not_run');
    await s.accept(task.id, { expectedVersion: s.task(task.id).version, snapshotId: snap.id }, 'accept');
    assert.equal(s.task(task.id).status, 'accepted');
    await writeFile(join(cwd, 'sample.txt'), 'external\n');
    await assert.rejects(s.accept(task.id, { expectedVersion: s.task(task.id).version, snapshotId: snap.id }, 'stale'), /snapshot_stale/);
    assert.equal(s.task(task.id).status, 'in_review');
    const next = await s.startRun(task.id, { expectedVersion: s.task(task.id).version, input: '请修改' }, 'feedback');
    await waitUntil(() => adapter.contexts.length === 2);
    assert.equal(adapter.contexts[1].sessionId, 'fixture-session');
    adapter.finish({ status: 'succeeded' }); await waitUntil(() => s.run(next.id).status === 'succeeded');
    const seq = s.detail(task.id).lastEventSeq;
    assert.equal(s.events(task.id, seq, 50).length, 0);
    await s.close();
    const reopened = await BackendService.open(config);
    try { assert.equal(reopened.task(task.id).status, 'in_review'); assert.equal(reopened.events(task.id, 0, 200).some(e => e.type === 'message.completed'), true); }
    finally { await reopened.close(); }
  } finally { await s.close(); }
});

test('interrupt is pending until real terminal confirmation and unknown outcomes block future execution', async () => {
  const { service: s, adapter } = await setup();
  try {
    const t = await s.createTask(body, 'create'); const r = await s.startRun(t.id, { expectedVersion: t.version }, 'start');
    await waitUntil(() => adapter.contexts.length === 1);
    const pending = await s.interrupt(r.id, { expectedVersion: s.run(r.id).version }, 'interrupt');
    assert.equal(pending.phase, 'stopping'); assert.equal(pending.status, 'running');
    adapter.finish({ status: 'aborted' }); await waitUntil(() => s.run(r.id).status === 'aborted');
    const next = await s.startRun(t.id, { expectedVersion: s.task(t.id).version, input: 'again' }, 'again');
    await waitUntil(() => adapter.contexts.length === 2); adapter.reject(Error('connection lost'));
    await waitUntil(() => s.run(next.id).status === 'needs_recovery');
    assert.equal(s.task(t.id).blockedReason, 'result_unknown');
    await assert.rejects(s.startRun(t.id, { expectedVersion: s.task(t.id).version, input: 'retry' }, 'retry'), /active_run/);
  } finally { await s.close(); }
});

test('restart never replays an execution whose result was not known', async () => {
  const { service: s, adapter, config } = await setup();
  const t = await s.createTask(body, 'create'); const r = await s.startRun(t.id, { expectedVersion: t.version }, 'start');
  await waitUntil(() => adapter.contexts.length === 1); await s.close();
  const reopened = await BackendService.open(config);
  try { assert.equal(reopened.run(r.id).status, 'needs_recovery'); assert.equal(adapter.contexts.length, 1); }
  finally { await reopened.close(); }
});

test('a confirmed engine terminal does not release the workspace until its owned process exits', async () => {
  const { service: original, config } = await setup(); await original.close();
  let finish!: (value: ExecutionResult) => void, release!: () => void;
  const closing = new Promise<void>(resolve => { release = resolve; });
  const result = new Promise<ExecutionResult>(resolve => { finish = resolve; });
  const service = await BackendService.open({ ...config, adapter: { start: async () => ({ result, interrupt: async () => {}, close: () => closing }) } });
  try {
    const task = await service.createTask(body, 'create'); const run = await service.startRun(task.id, { expectedVersion: task.version }, 'start');
    await waitUntil(() => service.run(run.id).phase === 'executing'); finish({ status: 'succeeded' });
    await new Promise(r => setTimeout(r, 20));
    assert.equal(service.run(run.id).status, 'running');
    await assert.rejects(service.startRun(task.id, { expectedVersion: service.task(task.id).version, input: 'racing' }, 'racing'), /active_run/);
    release(); await waitUntil(() => service.run(run.id).status === 'succeeded');
  } finally { release(); await service.close(); }
});

test('event storage failure stops further actions and restart marks the unfinished execution unknown', async () => {
  const { service, adapter, config } = await setup();
  const task = await service.createTask(body, 'create'); const run = await service.startRun(task.id, { expectedVersion: task.version }, 'start');
  await waitUntil(() => service.run(run.id).phase === 'executing');
  const db = new DatabaseSync(config.database);
  try {
    db.exec("CREATE TRIGGER reject_events BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT,'test storage fault'); END;");
    assert.throws(() => adapter.contexts[0].emit({ type: 'message.completed', data: { messageId: 'm', text: 'lost' } }));
    await assert.rejects(service.startRun(task.id, { expectedVersion: service.task(task.id).version, input: 'unsafe' }, 'unsafe'), /storage_unavailable/);
    assert.equal(service.events(task.id, 0, 200).some(e => e.type === 'message.completed'), false);
    await service.close();
  } finally { db.exec('DROP TRIGGER reject_events'); db.close(); await service.close(); }
  const restarted = await BackendService.open(config);
  try { assert.equal(restarted.run(run.id).status, 'needs_recovery'); } finally { await restarted.close(); }
});

test('unconfirmed owned process exit quarantines the workspace across service restarts', async () => {
  const { service: original, config } = await setup(); await original.close();
  const service = await BackendService.open({ ...config, adapter: { start: async () => ({ result: Promise.resolve({ status: 'succeeded' }), interrupt: async () => {}, close: async () => { throw Error('exit unknown'); } }) } });
  const task = await service.createTask(body, 'create'); const run = await service.startRun(task.id, { expectedVersion: task.version }, 'start');
  await waitUntil(() => service.run(run.id).status === 'needs_recovery');
  assert.equal(service.run(run.id).outcomeReason, 'process_exit_unconfirmed');
  await assert.rejects(service.snapshot(task.id, { expectedVersion: service.task(task.id).version }, 'snapshot'), /active_run/);
  await service.close(); await assert.rejects(BackendService.open(config), /workspace_quarantined/);
});

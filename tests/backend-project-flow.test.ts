import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BackendService } from '../src/backend/service.ts';
import { startHttp } from '../src/backend/http.ts';
import { ApiClient } from '../src/client/api.ts';
import { FixtureEngine, projectFixture, taskInput, waitFor } from './backend-fixtures.ts';

async function poll<T>(get: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  const until = Date.now() + 15000;
  while (true) { const value = await get(); if (done(value)) return value; if (Date.now() > until) throw Error('HTTP condition timeout'); await new Promise(r => setTimeout(r, 20)); }
}
test('public client completes two isolated project tasks, checks, stale review and manual acceptance', async () => {
  const { config, path } = await projectFixture(); const engine = new FixtureEngine(); config.adapter = engine;
  const s = await BackendService.open({ ...config, checkPresets: [{ id: 'test', name: 'Node fixture', executable: process.execPath, args: ['-e', 'console.log("checked")'], timeoutMs: 3000, outputBytes: 100 }] });
  const http = await startHttp(s, { allowedOrigins: ['http://localhost:5173'] });
  const client = new ApiClient({ baseUrl: http.url, getToken: () => http.token });
  try {
    assert.deepEqual((await client.projects()).items, [{ id: 'fixture', name: 'Fixture' }]);
    assert.equal((await client.bootstrap()).mode, 'project');
    for (const endpoint of ['/projects', '/tasks']) {
      assert.equal((await fetch(http.url + '/api/v1' + endpoint)).status, 401);
      assert.equal((await fetch(http.url + '/api/v1' + endpoint, { headers: { Authorization: 'Bearer ' + http.token, Origin: 'http://untrusted.invalid' } })).status, 403);
    }
    const a = await client.createTask(taskInput, 'a'), b = await client.createTask(taskInput, 'b');
    const page = await client.tasks(0, 1, undefined, { projectId: 'fixture', status: 'ready' });
    assert.equal(page.items[0].id, a.id); assert.equal(page.nextCursor, 1);
    assert.equal((await client.tasks(page.nextCursor!, 1, undefined, { projectId: 'fixture' })).items[0].id, b.id);
    assert.equal((await client.tasks(0, 50, undefined, { projectId: 'unknown' })).items.length, 0);
    await assert.rejects(client.prepareWorkspace(a.id, { expectedVersion: 99 }, 'bad'), /version_conflict/);
    for (const task of [a, b]) {
      const body = { expectedVersion: task.version };
      const ws = await client.prepareWorkspace(task.id, body, 'prepare'); assert.equal('cwd' in ws, false);
      assert.equal((await client.prepareWorkspace(task.id, body, 'prepare')).id, ws.id);
      await poll(() => client.task(task.id), d => d.workspace?.status === 'ready');
    }
    for (const [index, task] of [a, b].entries()) {
      const before = await client.task(task.id); assert.equal(before.checks?.status, 'not_run');
      const run = await client.startRun(task.id, { expectedVersion: before.task.version }, 'run');
      await waitFor(() => engine.contexts.length === index + 1);
      await assert.rejects(client.startRun(index === 0 ? b.id : a.id, { expectedVersion: s.task(index === 0 ? b.id : a.id).version, ...(index ? { input: 'busy' } : {}) }, 'busy-' + index), /active_run/);
      await writeFile(join(engine.contexts[index].cwd, 'sample.txt'), 'task ' + index + '\n');
      engine.contexts[index].emit({ type: 'message.completed', data: { messageId: 'message', text: 'reply ' + index } }); engine.finish({ status: 'succeeded' });
      await poll(() => client.run(run.id), r => r.status === 'succeeded');
      const snapshot = await client.snapshot(task.id, { expectedVersion: s.task(task.id).version }, 'snapshot');
      const checkBody = { expectedVersion: s.task(task.id).version, presetId: 'test', snapshotId: snapshot.id };
      const check = await client.startCheck(task.id, checkBody, 'check');
      assert.equal((await client.startCheck(task.id, checkBody, 'check')).id, check.id);
      await assert.rejects(client.startCheck(task.id, { ...checkBody, presetId: 'other' }, 'check'), /idempotency_conflict/);
      const checked = await poll(() => client.checks(task.id), c => c.summary.status !== 'running');
      assert.equal(checked.summary.status, 'passed'); assert.equal(checked.summary.validity, 'current');
      const events = await client.events(task.id, 0, 200); assert.ok(events.items.every(e => e.taskId === task.id));
      assert.equal(events.items.find(e => e.type === 'message.completed')?.data.text, 'reply ' + index);
      await client.accept(task.id, { expectedVersion: s.task(task.id).version, snapshotId: snapshot.id }, 'accept');
    }
    const aSnap = s.changes(a.id)!;
    await assert.rejects(client.startCheck(b.id, { expectedVersion: s.task(b.id).version, presetId: 'test', snapshotId: aSnap.id }, 'cross'), /snapshot_stale/);
    await writeFile(join(engine.contexts[0].cwd, 'sample.txt'), 'external\n');
    assert.equal((await client.task(a.id)).checks?.validity, 'stale');
    assert.equal((await client.task(b.id)).checks?.validity, 'current');
    const update = await client.snapshot(a.id, { expectedVersion: s.task(a.id).version }, 'external');
    await client.startCheck(a.id, { expectedVersion: s.task(a.id).version, presetId: 'test', snapshotId: update.id }, 'recheck');
    await poll(() => client.checks(a.id), c => c.summary.status !== 'running');
    await client.accept(a.id, { expectedVersion: s.task(a.id).version, snapshotId: update.id }, 'accept-external');
    const feedback = await client.startRun(a.id, { expectedVersion: s.task(a.id).version, input: 'feedback A' }, 'feedback');
    await waitFor(() => engine.contexts.length === 3); assert.equal(engine.contexts[2].sessionId, 'session-1');
    assert.equal((await client.task(a.id)).checks?.validity, 'stale');
    assert.equal((await client.task(b.id)).task.status, 'accepted');
    engine.finish({ status: 'succeeded' }); await poll(() => client.run(feedback.id), r => r.status === 'succeeded');
    assert.equal(await readFile(join(path, 'sample.txt'), 'utf8'), 'baseline\n');
    assert.equal(await readFile(join(engine.contexts[1].cwd, 'sample.txt'), 'utf8'), 'task 1\n');
  } finally { await http.close(); await s.close(); }
});

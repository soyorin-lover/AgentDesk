import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BackendService } from '../src/backend/service.ts';
import { projectFixture, taskInput, settled, FixtureEngine, waitFor } from './backend-fixtures.ts';

test('independent worktrees, sessions, feedback, events and acceptance share one execution gate', async () => {
  const { config, path } = await projectFixture(); const engine = new FixtureEngine(); config.adapter = engine;
  const s = await BackendService.open(config);
  try {
    const a = await s.createTask(taskInput, 'a'), b = await s.createTask(taskInput, 'b');
    await assert.rejects(s.startRun(a.id, { expectedVersion: a.version }, 'unprepared'), /workspace_not_ready/);
    for (const t of [a, b]) { await s.prepareWorkspace(t.id, { expectedVersion: t.version }, 'p'); assert.equal((await settled(s, t.id)).status, 'ready'); }
    const runA = await s.startRun(a.id, { expectedVersion: s.task(a.id).version }, 'a');
    await waitFor(() => engine.contexts.length === 1);
    await assert.rejects(s.startRun(b.id, { expectedVersion: s.task(b.id).version }, 'busy'), /active_run/);
    await writeFile(join(engine.contexts[0].cwd, 'sample.txt'), 'task A\n');
    engine.contexts[0].emit({ type: 'message.completed', data: { text: 'A' } }); engine.finish({ status: 'succeeded' });
    await waitFor(() => s.run(runA.id).status === 'succeeded');
    const snap = await s.snapshot(a.id, { expectedVersion: s.task(a.id).version }, 'snap');
    await s.accept(a.id, { expectedVersion: s.task(a.id).version, snapshotId: snap.id }, 'accept');
    const runB = await s.startRun(b.id, { expectedVersion: s.task(b.id).version }, 'b'); await waitFor(() => engine.contexts.length === 2);
    assert.notEqual(engine.contexts[0].cwd, engine.contexts[1].cwd); assert.equal(engine.contexts[1].sessionId, undefined);
    await writeFile(join(engine.contexts[1].cwd, 'sample.txt'), 'task B\n'); engine.finish({ status: 'succeeded' }); await waitFor(() => s.run(runB.id).status === 'succeeded');
    assert.equal(s.task(a.id).status, 'accepted'); assert.equal(s.changes(b.id), undefined);
    assert.ok(s.events(b.id, 0, 200).every(e => e.taskId === b.id && (e.data.text !== 'A')));
    await s.close(); const restarted = await BackendService.open(config);
    try {
      for (const [index, t] of [a, b].entries()) {
        const r = await restarted.startRun(t.id, { expectedVersion: restarted.task(t.id).version, input: 'feedback' }, 'feedback');
        await waitFor(() => engine.contexts.length === 3 + index);
        assert.equal(engine.contexts[2 + index].sessionId, 'session-' + (index + 1));
        engine.finish({ status: 'succeeded' }); await waitFor(() => restarted.run(r.id).status === 'succeeded');
      }
      assert.equal(await readFile(join(path, 'sample.txt'), 'utf8'), 'baseline\n');
      assert.equal(await readFile(join(engine.contexts[0].cwd, 'sample.txt'), 'utf8'), 'task A\n');
      assert.equal(await readFile(join(engine.contexts[1].cwd, 'sample.txt'), 'utf8'), 'task B\n');
    } finally { await restarted.close(); }
  } finally { await s.close(); }
});

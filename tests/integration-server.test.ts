import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startIntegration } from '../scripts/integration-server.ts';
import { ApiClient } from '../src/client/api.ts';

async function poll<T>(get: () => Promise<T>, done: (value: T) => boolean) {
  const until = Date.now() + 15000;
  for (;;) {
    const value = await get(); if (done(value)) return value;
    if (Date.now() > until) throw Error('integration timeout');
    await new Promise(r => setTimeout(r, 30));
  }
}

test('standalone integration uses real HTTP, Git, SQLite and a labelled deterministic executor', async () => {
  const mainProject = await mkdtemp(join(tmpdir(), 'agentdesk-integration-test-'));
  const server = await startIntegration({ mainProject, port: 0 });
  const client = new ApiClient({ baseUrl: server.info.url, getToken: () => server.token });
  try {
    assert.equal(server.info.execution, 'deterministic-fixture');
    assert.equal((await client.bootstrap()).mode, 'project');
    assert.equal((await client.bootstrap()).executionMode, 'deterministic');
    assert.match((await client.projects()).items[0].name, /确定性/);
    const preflight = await fetch(server.info.url + '/api/v1/bootstrap', { method: 'OPTIONS', headers: { Origin: 'http://localhost:5311', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), 'http://localhost:5311');
    assert.equal((await fetch(server.info.url + '/api/v1/bootstrap')).status, 401);
    const task = await client.createTask({ projectId: 'integration-fixture', title: '联调', goal: 'change sample', acceptanceCriteria: ['sample changed'], agentInstanceId: 'codex-local' }, 'create');
    await client.prepareWorkspace(task.id, { expectedVersion: task.version }, 'prepare');
    const ready = await poll(() => client.task(task.id), d => d.workspace?.status === 'ready');
    const run = await client.startRun(task.id, { expectedVersion: ready.task.version }, 'start');
    const ended = await poll(() => client.run(run.id), r => r.status !== 'running');
    assert.equal(ended.status, 'succeeded'); assert.equal(ended.model, 'deterministic-fixture');
    const snapshot = await client.snapshot(task.id, { expectedVersion: (await client.task(task.id)).task.version }, 'snapshot');
    assert.deepEqual(snapshot.files.map(f => f.path), ['sample.txt']);
    await client.startCheck(task.id, { expectedVersion: (await client.task(task.id)).task.version, presetId: 'sample-pass', snapshotId: snapshot.id }, 'check');
    const checks = await poll(() => client.checks(task.id), c => c.summary.status !== 'running');
    assert.equal(checks.summary.status, 'passed'); assert.equal(checks.summary.validity, 'current');
    await client.accept(task.id, { expectedVersion: (await client.task(task.id)).task.version, snapshotId: snapshot.id }, 'accept');
    assert.equal((await client.task(task.id)).task.status, 'accepted');
    assert.equal(await readFile(join(server.info.source, 'sample.txt'), 'utf8'), 'baseline\n');
    assert.match(await readFile(server.info.database, 'utf8'), /^SQLite format 3/);
    const tokenOnDisk = await readFile(server.info.tokenFile, 'utf8'); assert.equal(tokenOnDisk, server.token);
    const controller = new AbortController();
    const stream = await fetch(server.info.url + `/api/v1/tasks/${task.id}/events/stream`, { headers: { Authorization: 'Bearer ' + server.token }, signal: controller.signal });
    try {
      assert.equal(stream.headers.get('content-type'), 'text/event-stream; charset=utf-8');
      const chunk = await stream.body!.getReader().read(); assert.match(new TextDecoder().decode(chunk.value), /data:/);
    } finally { controller.abort(); }
  } finally { await server.close(); }
});

test('opt-in multi-project integration grants two sources without automatically binding or executing', async () => {
  const mainProject = await mkdtemp(join(tmpdir(), 'agentdesk-integration-multi-'));
  const server = await startIntegration({ mainProject, port: 0, additionalProject: true });
  const client = new ApiClient({ baseUrl: server.info.url, getToken: () => server.token });
  try {
    assert.equal((await client.executionGrants()).items.length, 2);
    assert.equal((await client.projects()).items.length, 1); assert.equal((await client.tasks()).items.length, 0);
    const source = server.info.additionalProject!; const p = await client.createProject({ name: 'Second fixture' }, 'create');
    const i = await client.inspectProjectRepository(p.id, { expectedVersion: 1, path: source.source }, 'inspect');
    await client.confirmProjectRepository(p.id, { expectedVersion: 1, inspectionId: i.id, baselineCommit: i.repository.head!, acknowledgeUncommittedExcluded: true }, 'confirm');
    await client.bindProjectExecution(p.id, { expectedVersion: 2, grantId: source.grantId, inspectionId: i.id, baselineCommit: i.repository.head!, acknowledgeUncommittedExcluded: true }, 'bind');
    const task = await client.createTask({ projectId: p.id, title: 'Second', goal: 'sample', acceptanceCriteria: ['sample'], agentInstanceId: 'codex-local' }, 'task');
    await client.prepareWorkspace(task.id, { expectedVersion: task.version }, 'prepare'); await poll(() => client.task(task.id), t => t.workspace?.status === 'ready');
    const run = await client.startRun(task.id, { expectedVersion: (await client.task(task.id)).task.version }, 'run');
    assert.equal((await poll(() => client.run(run.id), r => r.status !== 'running')).model, 'deterministic-fixture');
    assert.equal(await readFile(join(source.source, 'sample.txt'), 'utf8'), 'baseline\n');
    assert.equal(await readFile(join(server.info.source, 'sample.txt'), 'utf8'), 'baseline\n');
  } finally { await server.close(); }
});

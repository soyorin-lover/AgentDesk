import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, symlink, unlink, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { BackendService } from '../src/backend/service.ts';
import { git } from '../src/backend/repository.ts';
import { createSample } from '../src/workspace.ts';
import { FixtureEngine, projectFixture, taskInput, settled, waitFor } from './backend-fixtures.ts';
import { startHttp } from '../src/backend/http.ts';
import { ApiClient, ApiClientError } from '../src/client/api.ts';
import { Store } from '../src/backend/store.ts';
import { acquireLease } from '../src/backend/store.ts';
import { DatabaseSync } from 'node:sqlite';
import { get } from 'node:http';

async function setup() {
  const fixture = await projectFixture(); const second = await createSample(fixture.root, 'second');
  await writeFile(join(second, 'sample.txt'), 'second baseline\n'); await git(second, ['add', 'sample.txt']);
  await git(second, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'second']);
  const engine = new FixtureEngine();
  const config = { ...fixture.config, adapter: engine, executionGrants: [{ id: 'second', name: 'Second', path: second, workspaceRoot: join(fixture.root, 'second-workspaces') }] };
  return { ...fixture, second, config, engine };
}
async function bind(s: BackendService, projectId: string, path: string, grantId: string, key: string) {
  const inspection = await s.inspectProjectRepository(projectId, { expectedVersion: s.project(projectId).version, path }, 'inspect-' + key);
  await s.confirmProjectRepository(projectId, { expectedVersion: inspection.projectVersion, inspectionId: inspection.id, baselineCommit: inspection.repository.head!, acknowledgeUncommittedExcluded: true }, 'confirm-' + key);
  const body = { expectedVersion: s.project(projectId).version, grantId, inspectionId: inspection.id, baselineCommit: inspection.repository.head!, acknowledgeUncommittedExcluded: true };
  return { binding: await s.bindProjectExecution(projectId, body, 'bind-' + key), body };
}

test('two authorized sources pin task baselines, preserve dirty source and route isolated executions', async () => {
  const { config, path, second, engine } = await setup(); const s = await BackendService.open(config);
  try {
    const p = await s.createProject({ name: 'Second space' }, 'project');
    await writeFile(join(second, 'sample.txt'), 'unsaved source'); await writeFile(join(second, 'untracked.txt'), 'keep');
    const before = { head: await git(second, ['rev-parse', 'HEAD']), index: await readFile(join(second, '.git/index')), status: await git(second, ['status', '--porcelain=v1', '-z']) };
    const { binding, body } = await bind(s, p.id, second, 'second', 'one');
    assert.equal((await s.bindProjectExecution(p.id, body, 'bind-one')).id, binding.id);
    assert.equal(s.project(p.id).execution.supported, true);
    const a = await s.createTask(taskInput, 'a'), b = await s.createTask({ ...taskInput, projectId: p.id }, 'b');
    assert.equal(b.executionBinding?.id, binding.id); assert.equal(b.executionBinding?.baselineCommit, before.head.trim());
    for (const t of [a, b]) { await s.prepareWorkspace(t.id, { expectedVersion: t.version }, 'prepare'); assert.equal((await settled(s, t.id)).status, 'ready'); }
    const r = await s.startRun(a.id, { expectedVersion: s.task(a.id).version }, 'run'); await waitFor(() => engine.contexts.length === 1);
    await assert.rejects(s.startRun(b.id, { expectedVersion: s.task(b.id).version }, 'busy'), /active_run/);
    assert.equal((await readFile(join(engine.contexts[0].cwd, 'sample.txt'), 'utf8')).trim(), 'baseline'); engine.finish({ status: 'succeeded' }); await waitFor(() => s.run(r.id).status === 'succeeded');
    await s.startRun(b.id, { expectedVersion: s.task(b.id).version }, 'run'); await waitFor(() => engine.contexts.length === 2);
    assert.equal((await readFile(join(engine.contexts[1].cwd, 'sample.txt'), 'utf8')).trim(), 'second baseline'); engine.finish({ status: 'succeeded' });
    assert.equal(await readFile(join(second, 'sample.txt'), 'utf8'), 'unsaved source'); assert.equal(await readFile(join(second, 'untracked.txt'), 'utf8'), 'keep');
    assert.equal(await git(second, ['rev-parse', 'HEAD']), before.head); assert.deepEqual(await readFile(join(second, '.git/index')), before.index); assert.equal(await git(second, ['status', '--porcelain=v1', '-z']), before.status);
    assert.equal(await readFile(join(path, 'sample.txt'), 'utf8'), 'baseline\n');
  } finally { await s.close(); }
});

test('HTTP binding requires local grants and current association, validates fields, versions and idempotency', async () => {
  const { config, path, second, root } = await setup(); const unknown = await createSample(root, 'unknown'); const s = await BackendService.open(config);
  const http = await startHttp(s, { allowedOrigins: ['http://localhost:5311'] }); const client = new ApiClient({ baseUrl: http.url, getToken: () => http.token });
  try {
    assert.deepEqual((await client.executionGrants()).items.map(g => g.id), ['fixture', 'second']);
    for (const endpoint of ['/execution-grants', '/projects/fixture/execution-binding']) {
      assert.equal((await fetch(http.url + '/api/v1' + endpoint)).status, 401);
      assert.equal((await fetch(http.url + '/api/v1' + endpoint, { headers: { Authorization: 'Bearer ' + http.token, Origin: 'http://forbidden.invalid' } })).status, 403);
      const hostileStatus = await new Promise<number | undefined>((resolve, reject) => { get(http.url + '/api/v1' + endpoint, { headers: { Authorization: 'Bearer ' + http.token, Host: 'evil.invalid' } }, response => { response.resume(); response.once('end', () => resolve(response.statusCode)); }).once('error', reject); });
      assert.equal(hostileStatus, 403);
    }
    const p = await client.createProject({ name: 'Bound HTTP' }, 'p');
    assert.equal((await client.executionBinding(p.id)).available, false);
    let i = await client.inspectProjectRepository(p.id, { path: unknown, expectedVersion: 1 }, 'unknown');
    await client.confirmProjectRepository(p.id, { expectedVersion: 1, inspectionId: i.id, baselineCommit: i.repository.head!, acknowledgeUncommittedExcluded: true }, 'unknown');
    let body = { expectedVersion: 2, grantId: 'unknown', inspectionId: i.id, baselineCommit: i.repository.head!, acknowledgeUncommittedExcluded: true as const };
    await assert.rejects(client.bindProjectExecution(p.id, body, 'unknown'), /grant_not_authorized/);
    await assert.rejects(client.bindProjectExecution(p.id, { ...body, grantId: 'second' }, 'mismatch'), /grant_repository_mismatch/);
    await assert.rejects(s.bindProjectExecution(p.id, { ...body, trusted: true, path: unknown }, 'trusted'), /invalid_input/);
    i = await client.inspectProjectRepository(p.id, { path: second, expectedVersion: 2 }, 'known');
    await client.confirmProjectRepository(p.id, { expectedVersion: 2, inspectionId: i.id, baselineCommit: i.repository.head!, acknowledgeUncommittedExcluded: true }, 'known');
    body = { ...body, expectedVersion: 3, grantId: 'second', inspectionId: i.id, baselineCommit: i.repository.head! };
    const values = await Promise.allSettled(['a', 'b'].map(key => client.bindProjectExecution(p.id, body, key)));
    assert.equal(values.filter(v => v.status === 'fulfilled').length, 1);
    const failed = values.find(v => v.status === 'rejected') as PromiseRejectedResult; assert.ok(failed.reason instanceof ApiClientError); assert.equal(failed.reason.currentVersion, 4);
    const winner = values[0].status === 'fulfilled' ? 'a' : 'b'; const binding = await client.bindProjectExecution(p.id, body, winner);
    assert.equal((await client.executionBinding(p.id)).binding?.id, binding.id);
    await assert.rejects(client.bindProjectExecution(p.id, { ...body, grantId: 'fixture' }, winner), /idempotency_conflict/);
    await assert.rejects(client.bindProjectExecution(p.id, { ...body, expectedVersion: 4, acknowledgeUncommittedExcluded: false as true }, 'ack'), /invalid_input/);
    for (const value of [await client.projects(), await client.project(p.id), await client.executionGrants(), await client.executionBinding(p.id), await client.overview()]) assert.equal(JSON.stringify(value).includes(path) || JSON.stringify(value).includes(second), false);
    const abort = new AbortController(); abort.abort(); await assert.rejects(client.bindProjectExecution(p.id, body, 'abort', abort.signal));
    assert.equal((await client.project(p.id)).version, 4);
  } finally { await http.close(); await s.close(); }
});

test('source HEAD advance and explicit new binding never change old task basis, including after restart', async () => {
  const { config, second } = await setup(); let s = await BackendService.open(config);
  try {
    const p = await s.createProject({ name: 'Revisions' }, 'p'); const first = await bind(s, p.id, second, 'second', 'one');
    const old = await s.createTask({ ...taskInput, projectId: p.id }, 'old');
    await writeFile(join(second, 'sample.txt'), 'new baseline'); await git(second, ['add', 'sample.txt']); await git(second, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'new baseline']);
    const stillOld = await s.createTask({ ...taskInput, projectId: p.id }, 'still-old'); assert.equal(stillOld.executionBinding?.baselineCommit, first.binding.baselineCommit);
    const secondBinding = await bind(s, p.id, second, 'second', 'two'); assert.equal(secondBinding.binding.revision, 2);
    const fresh = await s.createTask({ ...taskInput, projectId: p.id }, 'fresh'); assert.notEqual(fresh.executionBinding?.baselineCommit, old.executionBinding?.baselineCommit);
    await s.close(); s = await BackendService.open(config);
    assert.equal((await s.executionBinding(p.id)).binding?.id, secondBinding.binding.id);
    assert.equal(s.task(old.id).executionBinding?.id, first.binding.id);
    for (const t of [old, fresh]) { await s.prepareWorkspace(t.id, { expectedVersion: s.task(t.id).version }, 'prepare'); assert.equal((await settled(s, t.id)).status, 'ready'); }
    const storePath = config.database; await s.close(); const store = new Store(storePath);
    const oldWorkspace = store.get<{ cwd: string }>('private', 'workspace:' + old.workspaceId)!, newWorkspace = store.get<{ cwd: string }>('private', 'workspace:' + fresh.workspaceId)!;
    assert.equal((await readFile(join(oldWorkspace.cwd, 'sample.txt'), 'utf8')).trim(), 'second baseline'); assert.equal(await readFile(join(newWorkspace.cwd, 'sample.txt'), 'utf8'), 'new baseline'); store.close();
    s = await BackendService.open(config);
    assert.equal(s.workspace(old.id).status, 'ready'); assert.equal(s.workspace(fresh.id).status, 'ready');
  } finally { await s.close(); }
});

test('configuration conflicts fail; removed, retargeted and changed grants never adopt another repository', async () => {
  const { config, second, root } = await setup();
  await assert.rejects(BackendService.open({ ...config, executionGrants: [...config.executionGrants, ...config.executionGrants] }), /invalid_configuration/);
  await assert.rejects(BackendService.open({ ...config, executionGrants: [{ ...config.executionGrants[0], path: config.projects[0].path }] }), /conflicting_execution_grants/);
  let s = await BackendService.open(config);
  try {
    const p = await s.createProject({ name: 'Config' }, 'p'); await bind(s, p.id, second, 'second', 'one'); const task = await s.createTask({ ...taskInput, projectId: p.id }, 'task');
    await s.close(); s = await BackendService.open({ ...config, executionGrants: [] });
    assert.equal((await s.executionBinding(p.id)).available, false); assert.equal(s.project(p.id).execution.reason, 'binding_unavailable');
    await assert.rejects(s.prepareWorkspace(task.id, { expectedVersion: task.version }, 'missing'), /execution_binding_unavailable/);
    await assert.rejects(s.createTask({ ...taskInput, projectId: p.id }, 'missing'), /execution_binding_unavailable/);
    await s.close(); const other = await createSample(root, 'replacement');
    s = await BackendService.open({ ...config, executionGrants: [{ ...config.executionGrants[0], path: other }] });
    assert.equal((await s.executionBinding(p.id)).available, false);
    await assert.rejects(s.prepareWorkspace(task.id, { expectedVersion: task.version }, 'changed'), /execution_binding_unavailable/);
    await s.close(); s = await BackendService.open(config);
    await s.prepareWorkspace(task.id, { expectedVersion: task.version }, 'restored'); assert.equal((await settled(s, task.id)).status, 'ready');
  } finally { await s.close(); }
});

test('bound source alias retarget and workspace marker tampering are rejected on direct commands', async () => {
  const { config, second, root } = await setup(); const alias = join(root, 'source-alias'); await symlink(second, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const modified = { ...config, executionGrants: [{ ...config.executionGrants[0], path: alias }] }; const s = await BackendService.open(modified);
  try {
    const p = await s.createProject({ name: 'Alias' }, 'p'); await bind(s, p.id, alias, 'second', 'one'); const task = await s.createTask({ ...taskInput, projectId: p.id }, 'task');
    const other = await createSample(root, 'other'); await unlink(alias); await symlink(other, alias, process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal((await s.executionBinding(p.id)).available, false);
    await assert.rejects(s.prepareWorkspace(task.id, { expectedVersion: task.version }, 'retarget'), /execution_binding_unavailable/);
    await unlink(alias); await symlink(second, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await s.prepareWorkspace(task.id, { expectedVersion: task.version }, 'prepare'); assert.equal((await settled(s, task.id)).status, 'ready');
    // The trusted fixture root and task ID determine this local path; never accept it over HTTP.
    const cwd = join(config.executionGrants[0].workspaceRoot, task.workspaceId), gitDir = (await git(cwd, ['rev-parse', '--absolute-git-dir'])).trim();
    const marker = join(gitDir, 'agentdesk-workspace.json'), saved = await readFile(marker, 'utf8'); await writeFile(marker, JSON.stringify({ ...JSON.parse(saved), baseHead: '0'.repeat(40) }));
    await assert.rejects(s.startRun(task.id, { expectedVersion: s.task(task.id).version }, 'tamper'), /workspace_identity_changed/);
    await writeFile(marker, saved);
  } finally { await s.close(); }
});

test('old task migration uses saved baseline, and cross-project needs_recovery still blocks execution and rebinding', async () => {
  const { config, second, engine } = await setup(); let s = await BackendService.open(config);
  try {
    const old = await s.createTask(taskInput, 'old'); await s.close();
    const db = new DatabaseSync(config.database); const row = db.prepare('SELECT value FROM documents WHERE kind=? AND id=?').get('task', old.id)!;
    const value = JSON.parse(row.value as string); delete value.executionBinding; db.prepare('UPDATE documents SET value=? WHERE kind=? AND id=?').run(JSON.stringify(value), 'task', old.id); db.close();
    s = await BackendService.open(config); assert.equal(s.task(old.id).executionBinding?.baselineCommit, old.executionBinding?.baselineCommit); assert.equal(s.task(old.id).version, old.version);
    const p = await s.createProject({ name: 'Second' }, 'p'); await bind(s, p.id, second, 'second', 'second'); const task = await s.createTask({ ...taskInput, projectId: p.id }, 'task');
    for (const t of [old, task]) { await s.prepareWorkspace(t.id, { expectedVersion: s.task(t.id).version }, 'prepare'); assert.equal((await settled(s, t.id)).status, 'ready'); }
    const run = await s.startRun(old.id, { expectedVersion: s.task(old.id).version }, 'run'); await waitFor(() => engine.contexts.length === 1); engine.finish({ status: 'succeeded' }); await waitFor(() => s.run(run.id).status === 'succeeded');
    await s.close(); const store = new Store(config.database); store.put('run', run.id, { ...store.get('run', run.id)!, status: 'needs_recovery', outcomeReason: 'fixture_unknown_exit' }); store.close();
    s = await BackendService.open(config);
    await assert.rejects(s.startRun(task.id, { expectedVersion: s.task(task.id).version }, 'blocked'), /active_run/);
    const current = (await s.executionBinding(p.id)).binding!;
    await assert.rejects(s.bindProjectExecution(p.id, { expectedVersion: s.project(p.id).version, grantId: current.grantId, inspectionId: current.associationInspectionId, baselineCommit: current.baselineCommit, acknowledgeUncommittedExcluded: true }, 'blocked'), /active_run/);
    assert.equal(s.run(run.id).status, 'needs_recovery');
  } finally { await s.close(); }
});

test('per-grant checks, snapshots, sessions and acceptance stay isolated across projects', async () => {
  const fixture = await setup(); const { second, engine } = fixture;
  const preset = (id: string) => ({ id, name: id, executable: process.execPath, args: ['-e', 'console.log("checked")'], timeoutMs: 3000, outputBytes: 100 });
  const config = { ...fixture.config, executionGrants: [{ ...fixture.config.executionGrants[0], checkPresetIds: ['second-check'] }], checkPresets: [preset('primary-check'), preset('second-check')] };
  const s = await BackendService.open(config);
  try {
    const p = await s.createProject({ name: 'Checks' }, 'p'); await bind(s, p.id, second, 'second', 'one');
    const a = await s.createTask(taskInput, 'a'), b = await s.createTask({ ...taskInput, projectId: p.id }, 'b');
    for (const [index, t] of [a, b].entries()) {
      await s.prepareWorkspace(t.id, { expectedVersion: t.version }, 'prepare'); assert.equal((await settled(s, t.id)).status, 'ready');
      const run = await s.startRun(t.id, { expectedVersion: s.task(t.id).version }, 'run'); await waitFor(() => engine.contexts.length === index + 1);
      await writeFile(join(engine.contexts[index].cwd, 'sample.txt'), 'result ' + index);
      engine.contexts[index].onModel('deterministic-fixture'); engine.contexts[index].emit({ type: 'message.completed', data: { messageId: 'm', text: 'reply ' + index } }); engine.finish({ status: 'succeeded' }); await waitFor(() => s.run(run.id).status === 'succeeded');
      const snapshot = await s.snapshot(t.id, { expectedVersion: s.task(t.id).version }, 'snapshot'); assert.equal(snapshot.baseHead, t.executionBinding?.baselineCommit);
      if (index) await assert.rejects(s.startCheck(t.id, { expectedVersion: s.task(t.id).version, snapshotId: snapshot.id, presetId: 'primary-check' }, 'wrong-preset'), /preset_not_found/);
      const check = await s.startCheck(t.id, { expectedVersion: s.task(t.id).version, snapshotId: snapshot.id, presetId: index ? 'second-check' : 'primary-check' }, 'check'); await waitFor(() => s.check(check.id).status !== 'running'); assert.equal(s.check(check.id).status, 'passed');
      await s.accept(t.id, { expectedVersion: s.task(t.id).version, snapshotId: snapshot.id }, 'accept');
      assert.equal(s.run(run.id).model, 'deterministic-fixture'); assert.equal(s.events(t.id).find(e => e.type === 'message.completed')?.data.text, 'reply ' + index);
    }
    assert.notEqual(engine.contexts[0].cwd, engine.contexts[1].cwd);
    await writeFile(join(engine.contexts[0].cwd, 'sample.txt'), 'external');
    assert.equal((await s.queryAcceptance(a.id)).status, 'invalid'); assert.equal((await s.queryAcceptance(b.id)).status, 'valid');
    const feedback = await s.startRun(b.id, { expectedVersion: s.task(b.id).version, input: 'feedback' }, 'feedback'); await waitFor(() => engine.contexts.length === 3); assert.equal(engine.contexts[2].sessionId, 'session-2'); engine.finish({ status: 'succeeded' }); await waitFor(() => s.run(feedback.id).status === 'succeeded');
  } finally { await s.close(); }
});

test('temporarily revoked grant disables a prepared task without destroying proven workspace state', async () => {
  const { config, second } = await setup(); let s = await BackendService.open(config);
  try {
    const p = await s.createProject({ name: 'Revoked' }, 'p'); await bind(s, p.id, second, 'second', 'one'); const t = await s.createTask({ ...taskInput, projectId: p.id }, 'task');
    await s.prepareWorkspace(t.id, { expectedVersion: t.version }, 'prepare'); assert.equal((await settled(s, t.id)).status, 'ready');
    await s.close(); s = await BackendService.open({ ...config, executionGrants: [] }); assert.deepEqual(s.detail(t.id).availableActions, []);
    await assert.rejects(s.startRun(t.id, { expectedVersion: s.task(t.id).version }, 'revoked'), /execution_binding_unavailable/);
    await s.close(); s = await BackendService.open(config);
    assert.equal(s.workspace(t.id).status, 'ready'); assert.ok(s.detail(t.id).availableActions.includes('start'));
  } finally { await s.close(); }
});

test('different configured worktrees of one common repository are a conflicting grant identity', async () => {
  const { config, second, root } = await setup(); const linked = join(root, 'linked-source');
  await git(second, ['worktree', 'add', '--detach', linked, 'HEAD']);
  await assert.rejects(BackendService.open({ ...config, executionGrants: [...config.executionGrants, { id: 'linked', name: 'Linked duplicate', path: linked, workspaceRoot: join(root, 'linked-workspaces') }] }), /conflicting_execution_grants/);
});

test('replacement of the granted workspace root is rejected live and after restart', async () => {
  const { config, second, root } = await setup(); let s = await BackendService.open(config);
  try {
    const p = await s.createProject({ name: 'Root identity' }, 'p'); await bind(s, p.id, second, 'second', 'one'); const task = await s.createTask({ ...taskInput, projectId: p.id }, 'task');
    const workspaceRoot = config.executionGrants[0].workspaceRoot;
    await rename(workspaceRoot, join(root, 'original-workspace-root')); await mkdir(workspaceRoot);
    await assert.rejects(s.prepareWorkspace(task.id, { expectedVersion: task.version }, 'replacement'), /execution_binding_unavailable/);
    await s.close(); s = await BackendService.open(config);
    assert.equal((await s.executionBinding(p.id)).available, false);
    await assert.rejects(s.prepareWorkspace(task.id, { expectedVersion: task.version }, 'restart'), /execution_binding_unavailable/);
  } finally { await s.close(); }
});

test('unknown model process exit retains its lease when quarantine persistence fails', async () => {
  const { config } = await projectFixture();
  const s = await BackendService.open({ ...config, adapter: { start: async () => ({ result: Promise.resolve({ status: 'succeeded' as const }), interrupt: async () => {}, close: async () => { throw Error('exit unconfirmed'); } }) } });
  let closed = false;
  try {
    const task = await s.createTask(taskInput, 'task'); await s.prepareWorkspace(task.id, { expectedVersion: task.version }, 'prepare'); assert.equal((await settled(s, task.id)).status, 'ready');
    const cwd = join(config.workspaceRoot, task.workspaceId), gitDir = (await git(cwd, ['rev-parse', '--absolute-git-dir'])).trim();
    const lease = join(gitDir, 'agentdesk-backend.lock'); await mkdir(lease + '.quarantine');
    await s.startRun(task.id, { expectedVersion: s.task(task.id).version }, 'run'); await waitFor(() => !s.bootstrap().storageHealthy);
    await s.close(); closed = true;
    assert.throws(() => { const release = acquireLease(lease); release(); }, /locked/);
  } finally { if (!closed) await s.close(); }
});

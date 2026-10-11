import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, symlink, unlink, realpath, readdir, rmdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { BackendService } from '../src/backend/service.ts';
import { startHttp } from '../src/backend/http.ts';
import { ApiClient, ApiClientError } from '../src/client/api.ts';
import { inspectImportRepository } from '../src/backend/repository-import.ts';
import { git } from '../src/backend/repository.ts';
import { createSample } from '../src/workspace.ts';
import { Store } from '../src/backend/store.ts';
import { projectFixture, taskInput } from './backend-fixtures.ts';

async function state(path: string) {
  return { head: await git(path, ['rev-parse', 'HEAD']), branch: await git(path, ['symbolic-ref', 'HEAD']), status: await git(path, ['status', '--porcelain=v1', '-z', '--untracked-files=all']), index: await readFile(join(path, '.git', 'index')), sample: await readFile(join(path, 'sample.txt')), untracked: await readFile(join(path, 'untracked.txt')) };
}
function confirm(inspection: Awaited<ReturnType<BackendService['inspectProjectRepository']>>) {
  return { expectedVersion: inspection.projectVersion, inspectionId: inspection.id, baselineCommit: inspection.repository.head!, acknowledgeUncommittedExcluded: true as const };
}

test('project spaces persist across restart, do not execute, and migrate old task IDs additively', async () => {
  const { config } = await projectFixture(); let s = await BackendService.open(config);
  try {
    const task = await s.createTask(taskInput, 'old-task');
    const before = await readdir(config.projects[0].path);
    const p = await s.createProject({ name: '  新项目  ', description: '内部空间' }, 'create');
    assert.equal(p.name, '新项目'); assert.equal(p.version, 1);
    assert.equal(p.execution.supported, false); assert.equal(p.execution.reason, 'execution_binding_required');
    assert.deepEqual(await readdir(config.projects[0].path), before);
    assert.equal((await s.createProject({ description: '内部空间', name: '  新项目  ' }, 'create')).id, p.id);
    await assert.rejects(s.createProject({ name: 'other' }, 'create'), /idempotency_conflict/);
    await assert.rejects(s.createTask({ ...taskInput, projectId: p.id }, 'unauthorized'), /execution_binding_required/);
    const edited = await s.updateProject(p.id, { expectedVersion: 1, description: '' }, 'edit');
    assert.equal(edited.version, 2);
    await s.close();
    // Simulate an earlier database: no organization record for the configured project.
    const db = new DatabaseSync(config.database); db.prepare('DELETE FROM documents WHERE kind=? AND id=?').run('project-space', 'fixture'); db.close();
    s = await BackendService.open(config);
    assert.equal(s.project(p.id).description, ''); assert.equal(s.project(p.id).version, 2);
    assert.equal(s.task(task.id).projectId, 'fixture'); assert.equal(s.project('fixture').execution.supported, true);
    assert.equal(s.projects().length, 2); assert.equal(s.bootstrap().project.id, 'fixture');
  } finally { await s.close(); }
});

test('dirty repository inspection and confirmation are read only, persistent and never bind execution', async () => {
  const { config, root } = await projectFixture(); const path = await createSample(root, 'import');
  await writeFile(join(path, 'sample.txt'), 'staged\n'); await git(path, ['add', 'sample.txt']);
  await writeFile(join(path, 'sample.txt'), 'unsaved\n'); await writeFile(join(path, 'untracked.txt'), 'keep me\n');
  const before = await state(path); let s = await BackendService.open(config);
  try {
    const p = await s.createProject({ name: 'Imported' }, 'create');
    const i = await s.inspectProjectRepository(p.id, { path, expectedVersion: 1 }, 'inspect');
    assert.equal(i.repository.path, await realpath(path)); assert.equal(i.repository.headState, 'attached');
    assert.deepEqual(i.repository.changes, { staged: 1, unstaged: 1, untracked: 1, conflicted: 0 });
    assert.ok(i.repository.worktrees.some(w => resolve(w.path) === resolve(path)));
    const association = await s.confirmProjectRepository(p.id, confirm(i), 'confirm');
    assert.equal(association.baselineCommit, before.head.trim()); assert.equal(association.uncommittedChangesIncluded, false);
    assert.equal(s.project(p.id).version, 2); assert.equal(s.project(p.id).execution.supported, false);
    assert.equal(JSON.stringify(s.project(p.id)).includes(path), false);
    assert.equal((await s.confirmProjectRepository(p.id, confirm(i), 'confirm')).baselineCommit, association.baselineCommit);
    assert.deepEqual(await state(path), before);
    await s.close(); s = await BackendService.open(config);
    assert.deepEqual(s.projectRepository(p.id), association);
    assert.equal((await s.inspectProjectRepository(p.id, { path, expectedVersion: 1 }, 'inspect')).id, i.id);
    assert.deepEqual(await state(path), before);
    assert.equal(s.bootstrap().workspace.baseHead, (await git(config.projects[0].path, ['rev-parse', 'HEAD'])).trim());
  } finally { await s.close(); }
});

test('detached, unborn, bare, aliases, nested paths and non-repositories have explicit outcomes', async () => {
  const { root, path } = await projectFixture();
  const head = (await git(path, ['rev-parse', 'HEAD'])).trim(); await git(path, ['checkout', '--detach', head]);
  const detached = await inspectImportRepository(path);
  assert.equal(detached.headState, 'detached'); assert.equal(detached.branch, null); assert.equal(detached.head, head);
  assert.equal((await git(path, ['rev-parse', 'HEAD'])).trim(), head);
  await assert.rejects(git(path, ['symbolic-ref', '-q', 'HEAD']));
  const alias = join(root, 'alias'); await symlink(path, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.deepEqual(await inspectImportRepository(alias), detached);
  const empty = join(root, 'unborn'); await mkdir(empty); await git(empty, ['init', '-b', 'main']);
  await writeFile(join(empty, 'pending.txt'), 'pending');
  const unborn = await inspectImportRepository(empty);
  assert.equal(unborn.headState, 'unborn'); assert.equal(unborn.head, null); assert.equal(unborn.branch, 'main'); assert.equal(unborn.changes.untracked, 1);
  const bare = join(root, 'bare'); await mkdir(bare); await git(bare, ['init', '--bare']);
  await assert.rejects(inspectImportRepository(bare), /bare_repository_unsupported/);
  await assert.rejects(inspectImportRepository(root), /repository_unavailable/);
  await assert.rejects(inspectImportRepository('relative'), /invalid_repository_path/);
  const nested = join(path, 'nested'); await mkdir(nested);
  await assert.rejects(inspectImportRepository(nested), /repository_root_required/);
  assert.equal(await readFile(join(empty, 'pending.txt'), 'utf8'), 'pending');
});

test('changed dirty bytes, new files, HEAD and worktree changes invalidate checks before confirmation', async () => {
  const { config, root } = await projectFixture(); const path = await createSample(root, 'import');
  await writeFile(join(path, 'sample.txt'), 'dirty one'); const s = await BackendService.open(config);
  try {
    const p = await s.createProject({ name: 'Import' }, 'create');
    let i = await s.inspectProjectRepository(p.id, { path, expectedVersion: 1 }, 'one');
    await writeFile(join(path, 'sample.txt'), 'dirty two');
    await assert.rejects(s.confirmProjectRepository(p.id, confirm(i), 'one'), /repository_changed/);
    assert.equal(s.projectRepository(p.id), null); assert.equal(s.project(p.id).version, 1);
    i = await s.inspectProjectRepository(p.id, { path, expectedVersion: 1 }, 'two');
    await writeFile(join(path, 'new.txt'), 'new');
    await assert.rejects(s.confirmProjectRepository(p.id, confirm(i), 'two'), /repository_changed/);
    i = await s.inspectProjectRepository(p.id, { path, expectedVersion: 1 }, 'three');
    await git(path, ['checkout', '--detach', i.repository.head!]);
    await assert.rejects(s.confirmProjectRepository(p.id, confirm(i), 'three'), /repository_changed/);
    i = await s.inspectProjectRepository(p.id, { path, expectedVersion: 1 }, 'four');
    await git(path, ['-c', 'core.hooksPath=', 'worktree', 'add', '--detach', join(root, 'linked'), i.repository.head!]);
    await assert.rejects(s.confirmProjectRepository(p.id, confirm(i), 'four'), /repository_changed/);
    const linked = await inspectImportRepository(join(root, 'linked'));
    assert.equal(linked.commonDir, i.repository.commonDir); assert.notEqual(linked.gitDir, i.repository.gitDir);
    assert.equal(linked.worktrees.length, 2);
    assert.equal(await readFile(join(path, 'sample.txt'), 'utf8'), 'dirty two');
  } finally { await s.close(); }
});

test('retargeted input path alias is rechecked at confirmation', async () => {
  const { config, root } = await projectFixture(); const a = await createSample(root, 'a'), b = await createSample(root, 'b');
  const alias = join(root, 'alias'); await symlink(a, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const s = await BackendService.open(config);
  try {
    const p = await s.createProject({ name: 'Alias' }, 'create');
    const i = await s.inspectProjectRepository(p.id, { path: alias, expectedVersion: 1 }, 'inspect');
    await unlink(alias); await symlink(b, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(s.confirmProjectRepository(p.id, confirm(i), 'confirm'), /repository_changed/);
    assert.equal(s.projectRepository(p.id), null);
  } finally { await s.close(); }
});

test('unborn cannot be confirmed; mismatched project, baseline, stale version and expired checks fail closed', async () => {
  const { config, root, path } = await projectFixture(); const empty = join(root, 'empty'); await mkdir(empty); await git(empty, ['init', '-b', 'main']);
  let s = await BackendService.open(config);
  try {
    const p = await s.createProject({ name: 'P' }, 'p'), q = await s.createProject({ name: 'Q' }, 'q');
    const unborn = await s.inspectProjectRepository(p.id, { path: empty, expectedVersion: 1 }, 'unborn');
    assert.equal(unborn.confirmable, false); assert.equal(unborn.reason, 'no_commit_baseline');
    await assert.rejects(s.confirmProjectRepository(p.id, { ...confirm(unborn), baselineCommit: '0'.repeat(40) }, 'unborn'), /invalid_baseline/);
    const i = await s.inspectProjectRepository(p.id, { path, expectedVersion: 1 }, 'inspect');
    await assert.rejects(s.confirmProjectRepository(q.id, confirm(i), 'cross'), /inspection_stale/);
    await assert.rejects(s.confirmProjectRepository(p.id, { ...confirm(i), baselineCommit: '0'.repeat(40) }, 'wrong'), /invalid_baseline/);
    await assert.rejects(s.confirmProjectRepository(p.id, { ...confirm(i), acknowledgeUncommittedExcluded: false }, 'ack'), /invalid_input/);
    await s.updateProject(p.id, { name: 'P2', expectedVersion: 1 }, 'edit');
    await assert.rejects(s.confirmProjectRepository(p.id, { ...confirm(i), expectedVersion: 2 }, 'stale'), /inspection_stale/);
    const fresh = await s.inspectProjectRepository(p.id, { path, expectedVersion: 2 }, 'fresh');
    await s.close(); const store = new Store(config.database);
    store.put('repository-inspection', fresh.id, { ...fresh, expiresAt: '2000-01-01T00:00:00Z' }); store.close(); s = await BackendService.open(config);
    await assert.rejects(s.confirmProjectRepository(p.id, confirm(fresh), 'expired'), /inspection_expired/);
  } finally { await s.close(); }
});

test('HTTP/client authorization, validation and concurrent writes keep versions and paths private', async () => {
  const { config, path } = await projectFixture(); const s = await BackendService.open(config); const http = await startHttp(s, { allowedOrigins: ['http://localhost:5173'] });
  const client = new ApiClient({ baseUrl: http.url, getToken: () => http.token });
  try {
    for (const [method, endpoint, body] of [['POST', '/projects', { name: 'Unauthorized' }], ['GET', '/projects/fixture', undefined], ['GET', '/projects/fixture/repository', undefined], ['POST', '/projects/fixture/repository-inspections', { path, expectedVersion: 1 }], ['POST', '/projects/fixture/repository', {}], ['PATCH', '/projects/fixture', { expectedVersion: 1, name: 'Unauthorized' }]] as const) {
      const headers = { 'Content-Type': 'application/json', 'Idempotency-Key': 'unauthorized' };
      const init = { method, headers, body: body ? JSON.stringify(body) : undefined };
      assert.equal((await fetch(http.url + '/api/v1' + endpoint, init)).status, 401);
      assert.equal((await fetch(http.url + '/api/v1' + endpoint, { ...init, headers: { ...headers, Authorization: 'Bearer ' + http.token, Origin: 'http://forbidden.invalid' } })).status, 403);
    }
    const p = await client.createProject({ name: 'HTTP', description: 'description' }, 'create');
    assert.ok((await client.projects()).items.some(row => row.id === p.id));
    assert.equal((await client.project(p.id)).description, 'description');
    await assert.rejects(client.createProject({ name: '' }, 'empty'), /invalid_input/);
    await assert.rejects(s.createProject({ name: 'bad', path }, 'path'), /invalid_input/);
    await assert.rejects(client.project('missing'), /not_found/);
    const outcomes = await Promise.allSettled(['A', 'B'].map(name => client.updateProject(p.id, { expectedVersion: 1, name }, name)));
    assert.equal(outcomes.filter(o => o.status === 'fulfilled').length, 1);
    const failed = outcomes.find(o => o.status === 'rejected') as PromiseRejectedResult;
    assert.ok(failed.reason instanceof ApiClientError); assert.equal(failed.reason.currentVersion, 2);
    const i = await client.inspectProjectRepository(p.id, { path, expectedVersion: 2 }, 'inspect');
    const results = await Promise.allSettled(['C', 'D'].map(key => client.confirmProjectRepository(p.id, confirm(i), key)));
    assert.equal(results.filter(o => o.status === 'fulfilled').length, 1);
    assert.equal((await client.projectRepository(p.id))?.baselineCommit, i.repository.head);
    assert.equal((await client.project(p.id)).version, 3);
    await assert.rejects(client.createTask({ ...taskInput, projectId: p.id }, 'new-task'), /execution_binding_required/);
    for (const value of [await client.projects(), await client.bootstrap(), await client.project(p.id), await client.overview(), await client.attention()]) assert.equal(JSON.stringify(value).includes(path), false);
    const invalid = await fetch(http.url + '/api/v1/projects/' + p.id + '/repository-inspections', { method: 'POST', headers: { Authorization: 'Bearer ' + http.token, 'Content-Type': 'application/json', 'Idempotency-Key': 'bad-path' }, body: JSON.stringify({ path: join(path, 'missing'), expectedVersion: 3 }) });
    assert.equal(invalid.status, 422); assert.equal((await invalid.text()).includes(path), false);
  } finally { await http.close(); await s.close(); }
});

test('bounded checks reject oversized files and hidden index changes rather than certify them', async () => {
  const { path } = await projectFixture();
  await git(path, ['update-index', '--assume-unchanged', 'sample.txt']);
  await writeFile(join(path, 'sample.txt'), 'hidden');
  await assert.rejects(inspectImportRepository(path), /repository_scan_unsupported/);
  await git(path, ['update-index', '--no-assume-unchanged', 'sample.txt']);
  await writeFile(join(path, 'large.bin'), Buffer.alloc(1024 * 1024 + 1));
  await assert.rejects(inspectImportRepository(path), /repository_scan_limited/);
  assert.equal(await readFile(join(path, 'sample.txt'), 'utf8'), 'hidden');
});

test('advanced commit requires a fresh inspection and leaves the external commit untouched', async () => {
  const { config, root } = await projectFixture(); const path = await createSample(root, 'import'); const s = await BackendService.open(config);
  try {
    const p = await s.createProject({ name: 'Commit' }, 'create'); const i = await s.inspectProjectRepository(p.id, { path, expectedVersion: 1 }, 'first');
    await writeFile(join(path, 'sample.txt'), 'external commit'); await git(path, ['add', 'sample.txt']);
    await git(path, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'core.hooksPath=', 'commit', '-m', 'external']);
    const head = (await git(path, ['rev-parse', 'HEAD'])).trim(); assert.notEqual(head, i.repository.head);
    await assert.rejects(s.confirmProjectRepository(p.id, confirm(i), 'stale'), /repository_changed/);
    const fresh = await s.inspectProjectRepository(p.id, { path, expectedVersion: 1 }, 'fresh');
    assert.equal((await s.confirmProjectRepository(p.id, confirm(fresh), 'fresh')).baselineCommit, head);
    assert.equal((await git(path, ['rev-parse', 'HEAD'])).trim(), head);
    assert.equal(await readFile(join(path, 'sample.txt'), 'utf8'), 'external commit');
  } finally { await s.close(); }
});

test('parent Git overrides cannot redirect repository inspection', async () => {
  const { root, path } = await projectFixture(); const other = await createSample(root, 'other');
  const previous = process.env.GIT_DIR, previousWorktree = process.env.GIT_WORK_TREE;
  try {
    process.env.GIT_DIR = join(other, '.git'); process.env.GIT_WORK_TREE = other;
    const i = await inspectImportRepository(path);
    assert.equal(i.path, await realpath(path)); assert.equal(i.gitDir, await realpath(join(path, '.git')));
  } finally {
    if (previous === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = previous;
    if (previousWorktree === undefined) delete process.env.GIT_WORK_TREE; else process.env.GIT_WORK_TREE = previousWorktree;
  }
});

test('deleted tracked directory is inspectable without recreating it', async () => {
  const { path } = await projectFixture(); const nested = join(path, 'nested'); await mkdir(nested); await writeFile(join(nested, 'tracked.txt'), 'tracked');
  await git(path, ['add', 'nested']); await git(path, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'core.hooksPath=', 'commit', '-m', 'nested']);
  await unlink(join(nested, 'tracked.txt')); await rmdir(nested);
  const i = await inspectImportRepository(path); assert.equal(i.changes.unstaged, 1);
  await assert.rejects(readFile(join(nested, 'tracked.txt')), { code: 'ENOENT' });
});

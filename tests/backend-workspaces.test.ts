import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, symlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { BackendService } from '../src/backend/service.ts';
import { git } from '../src/workspace.ts';
import { projectFixture, taskInput, settled } from './backend-fixtures.ts';

test('preparation is idempotent, creates isolated branches and never changes source', async () => {
  const { config, path } = await projectFixture(); const s = await BackendService.open(config);
  try {
    const a = await s.createTask(taskInput, 'a'), b = await s.createTask(taskInput, 'b');
    const request = { expectedVersion: a.version };
    const first = await s.prepareWorkspace(a.id, request, 'prepare');
    assert.equal(first.status, 'preparing');
    await s.prepareWorkspace(a.id, request, 'prepare');
    assert.equal((await settled(s, a.id)).status, 'ready');
    await s.prepareWorkspace(b.id, { expectedVersion: b.version }, 'prepare');
    assert.equal((await settled(s, b.id)).status, 'ready');
    assert.equal((await s.prepareWorkspace(a.id, request, 'prepare')).id, first.id);
    const paths = (await git(path, ['worktree', 'list', '--porcelain'])).split('\n').filter(x => x.startsWith('worktree '));
    assert.equal(paths.length, 3);
    assert.equal(await readFile(join(path, 'sample.txt'), 'utf8'), 'baseline\n');
    assert.equal((await git(path, ['status', '--porcelain'])).trim(), '');
    await s.close(); const reopened = await BackendService.open(config);
    try { assert.equal(reopened.workspace(a.id).status, 'ready'); } finally { await reopened.close(); }
  } finally { await s.close(); }
});

test('foreign destination and branch conflicts fail without reusing or deleting files', async () => {
  for (const conflict of ['path', 'branch']) {
    const { config, path } = await projectFixture(); const s = await BackendService.open(config);
    try {
      const t = await s.createTask(taskInput, 't');
      const destination = join(config.workspaceRoot, t.workspaceId);
      if (conflict === 'path') { await mkdir(destination); await writeFile(join(destination, 'user.txt'), 'keep'); }
      else await git(path, ['branch', 'codex/task-' + t.id]);
      await s.prepareWorkspace(t.id, { expectedVersion: t.version }, 'p');
      assert.equal((await settled(s, t.id)).status, 'failed');
      if (conflict === 'path') assert.equal(await readFile(join(destination, 'user.txt'), 'utf8'), 'keep');
    } finally { await s.close(); }
  }
});

test('workspace roots reject overlaps and junction escapes', async () => {
  const { config, path, root } = await projectFixture();
  for (const workspaceRoot of [path, join(path, 'nested'), dirname(path), process.cwd(), join(process.cwd(), 'nested'), ...(process.platform === 'win32' ? [path.toUpperCase(), process.cwd().toUpperCase()] : [])]) {
    await assert.rejects(BackendService.open({ ...config, workspaceRoot }), /overlaps/);
  }
  const link = join(root, 'alias'); await symlink(path, link, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(BackendService.open({ ...config, workspaceRoot: join(link, 'escape') }), /overlaps/);
});

test('restart does not replay a preparing intent or adopt an unfamiliar directory', async () => {
  const { config } = await projectFixture(); let s = await BackendService.open(config);
  const t = await s.createTask(taskInput, 't'); await s.close();
  const db = new DatabaseSync(config.database);
  db.prepare('INSERT INTO documents(kind,id,value) VALUES(?,?,?)').run('workspace', t.workspaceId, JSON.stringify({ id: t.workspaceId, taskId: t.id, projectId: t.projectId, status: 'preparing', cwd: join(config.workspaceRoot, t.workspaceId), branch: 'codex/task-' + t.id })); db.close();
  s = await BackendService.open(config);
  try { assert.equal(s.workspace(t.id).status, 'needs_recovery'); assert.ok(!s.detail(t.id).availableActions.includes('start')); } finally { await s.close(); }
});

test('Git success followed by database failure preserves worktree and blocks automatic replay', async () => {
  const { config, path } = await projectFixture(); let s = await BackendService.open(config);
  const t = await s.createTask(taskInput, 't');
  const db = new DatabaseSync(config.database);
  db.exec("CREATE TRIGGER reject_ready BEFORE UPDATE ON documents WHEN NEW.kind='workspace' AND json_extract(NEW.value,'$.status')='ready' BEGIN SELECT RAISE(ABORT,'fixture write failure'); END;");
  try {
    await s.prepareWorkspace(t.id, { expectedVersion: t.version }, 'p');
    for (let n = 0; n < 1000 && s.bootstrap().storageHealthy; n++) await new Promise(r => setTimeout(r, 10));
    assert.equal(s.bootstrap().storageHealthy, false);
    assert.equal(s.workspace(t.id).status, 'preparing');
    assert.equal((await git(path, ['worktree', 'list', '--porcelain'])).split('\n').filter(x => x.startsWith('worktree ')).length, 2);
    await s.close(); db.exec('DROP TRIGGER reject_ready'); db.close();
    s = await BackendService.open(config);
    assert.equal(s.workspace(t.id).status, 'needs_recovery');
    assert.equal(s.workspace(t.id).reason, 'owned_preparation_interrupted');
    await assert.rejects(s.prepareWorkspace(t.id, { expectedVersion: s.task(t.id).version }, 'new-key'), /workspace_already_prepared/);
    assert.equal((await git(path, ['worktree', 'list', '--porcelain'])).split('\n').filter(x => x.startsWith('worktree ')).length, 2);
  } finally { try { db.close(); } catch {} await s.close(); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { git } from '../src/workspace.ts';
import { BackendService } from '../src/backend/service.ts';
import { projectFixture, taskInput } from './backend-fixtures.ts';

test('trusted project registration persists identity and permits multiple unprepared tasks', async () => {
  const { config, path } = await projectFixture();
  let s = await BackendService.open(config);
  try {
    assert.deepEqual(s.projects(), [{ id: 'fixture', name: 'Fixture' }]);
    const t = await s.createTask(taskInput, 'one');
    const second = await s.createTask(taskInput, 'two');
    assert.notEqual(t.workspaceId, second.workspaceId);
    assert.equal(s.detail(t.id).workspace?.status, 'unprepared');
    assert.ok(!s.detail(t.id).availableActions.includes('start'));
    await assert.rejects(s.createTask({ ...taskInput, projectId: 'unknown' }, 'bad'), /project_not_found/);
    await s.close();
    await writeFile(join(path, 'sample.txt'), 'local changes after registration');
    s = await BackendService.open(config);
    assert.equal(s.task(t.id).projectId, 'fixture');
    assert.equal(s.tasks().items.length, 2);
  } finally { await s.close(); }
});

test('registration rejects duplicate IDs, dirty and unborn repositories without touching files', async () => {
  const { config, path, root } = await projectFixture();
  await assert.rejects(BackendService.open({ ...config, projects: [...config.projects, ...config.projects] }), /one project|duplicate/);
  await writeFile(join(path, 'sample.txt'), 'unsaved');
  await assert.rejects(BackendService.open(config), /clean/);
  const unborn = join(root, 'unborn'); await mkdir(unborn); await git(unborn, ['init']);
  await assert.rejects(BackendService.open({ ...config, projects: [{ ...config.projects[0], path: unborn }] }));
});

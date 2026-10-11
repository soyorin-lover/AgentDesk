import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSample, checkSample, auditSample, git } from '../src/workspace.ts';

test('sample gets a Git baseline and only exact intended diff passes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agentdesk-test-'));
  const cwd = await createSample(root, 'sample');
  assert.equal((await checkSample(cwd, 'baseline\n', false)).changed, false);
  await writeFile(join(cwd, 'sample.txt'), 'verified\n');
  const result = await checkSample(cwd, 'verified\n', true);
  assert.equal(result.changed, true);
  assert.ok(result.diff.includes('+verified'));
  await writeFile(join(cwd, 'unexpected.txt'), 'unwanted');
  await assert.rejects(checkSample(cwd, 'verified\n', true), /unexpected/);
});
test('sample creation refuses traversal and existing repository reuse', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agentdesk-test-'));
  await assert.rejects(createSample(root, '../unsafe'), /name/);
  const cwd = await createSample(root, 'one');
  await assert.rejects(createSample(root, 'one'), /EEXIST/);
  assert.equal(await readFile(join(cwd, 'sample.txt'), 'utf8'), 'baseline\n');
});
test('failed-run audit records residual and untracked changes without copying their names or contents', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agentdesk-test-'));
  const cwd = await createSample(root, 'audit');
  const head = (await git(cwd, ['rev-parse', 'HEAD'])).trim();
  await writeFile(join(cwd, 'sample.txt'), 'partial\n');
  assert.deepEqual(await auditSample(cwd, head), { sampleChanged: true, unexpectedChanges: false, changedFiles: 1, headUnchanged: true });
  await writeFile(join(cwd, 'SECRET.txt'), 'private');
  const result = await auditSample(cwd, head);
  assert.equal(result.unexpectedChanges, true);
  assert.equal(result.changedFiles, 2);
  assert.equal(JSON.stringify(result).includes('SECRET'), false);
});

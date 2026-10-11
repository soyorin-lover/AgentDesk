import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSample, git } from '../src/workspace.ts';
import { inspectRepository, captureChanges } from '../src/backend/repository.ts';

test('review snapshot covers staged, unstaged, untracked and deletion; external edits invalidate digest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agentdesk-review-'));
  const cwd = await createSample(root, 'repo');
  const repo = await inspectRepository(cwd, process.cwd());
  await writeFile(join(cwd, 'sample.txt'), 'staged\n'); await git(cwd, ['add', 'sample.txt']);
  await writeFile(join(cwd, 'sample.txt'), 'unstaged\n');
  await writeFile(join(cwd, 'new file.txt'), 'new\n'); await unlink(join(cwd, 'AGENTS.md'));
  const snapshot = await captureChanges(repo);
  assert.equal(snapshot.completeness, 'complete');
  assert.deepEqual(snapshot.files.map(f => f.path).sort(), ['AGENTS.md', 'new file.txt', 'sample.txt']);
  assert.ok(snapshot.files.find(f => f.path === 'sample.txt')?.diff?.includes('+unstaged'));
  assert.ok(snapshot.files.find(f => f.path === 'new file.txt')?.diff?.includes('+new'));
  await writeFile(join(cwd, 'sample.txt'), 'outside\n');
  assert.notEqual((await captureChanges(repo)).contentDigest, snapshot.contentDigest);
});

test('binary and oversized changes cannot become an acceptable complete snapshot', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agentdesk-limits-'));
  const cwd = await createSample(root, 'repo');
  const repo = await inspectRepository(cwd, process.cwd());
  await writeFile(join(cwd, 'binary.dat'), Buffer.from([0, 1, 2]));
  assert.equal((await captureChanges(repo)).completeness, 'unsupported');
  await unlink(join(cwd, 'binary.dat')); await writeFile(join(cwd, 'large.txt'), 'x'.repeat(1025));
  assert.equal((await captureChanges(repo, { fileBytes: 1024 })).completeness, 'limited');
});

test('binding rejects the main project and a dirty new workspace', async () => {
  await assert.rejects(inspectRepository(process.cwd(), process.cwd()), /main|project/);
  const root = await mkdtemp(join(tmpdir(), 'agentdesk-binding-'));
  const cwd = await createSample(root, 'repo'); await writeFile(join(cwd, 'sample.txt'), 'dirty');
  await assert.rejects(inspectRepository(cwd, process.cwd()), /clean/);
});
test('staged symbolic-link mode is unsupported even when Windows materializes a regular file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agentdesk-link-'));
  const cwd = await createSample(root, 'repo'); const repo = await inspectRepository(cwd, process.cwd());
  const blob = (await git(cwd, ['rev-parse', 'HEAD:sample.txt'])).trim();
  await git(cwd, ['update-index', '--cacheinfo', `120000,${blob},sample.txt`]);
  const snapshot = await captureChanges(repo);
  assert.equal(snapshot.completeness, 'unsupported');
  assert.equal(snapshot.files.find(f => f.path === 'sample.txt')?.kind, 'symlink');
});
test('snapshot digest distinguishes deletion from the literal file content deleted', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agentdesk-digest-delete-')); const cwd = await createSample(root, 'repo');
  const repo = await inspectRepository(cwd, process.cwd()); await writeFile(join(cwd, 'sample.txt'), 'deleted');
  const before = await captureChanges(repo); await unlink(join(cwd, 'sample.txt'));
  assert.notEqual((await captureChanges(repo)).contentDigest, before.contentDigest);
});
test('snapshot digest frames file paths and contents so a new empty file changes the digest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agentdesk-digest-frame-')); const cwd = await createSample(root, 'repo');
  const repo = await inspectRepository(cwd, process.cwd()); await writeFile(join(cwd, 'a'), '"b"');
  const before = await captureChanges(repo); await writeFile(join(cwd, 'a'), ''); await writeFile(join(cwd, 'b'), '');
  assert.notEqual((await captureChanges(repo)).contentDigest, before.contentDigest);
});
test('concurrent worktree content changes cannot certify a complete snapshot', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agentdesk-changing-'));
  const cwd = await createSample(root, 'repo'); const repo = await inspectRepository(cwd, process.cwd());
  let stop = false, counter = 0;
  const path = join(cwd, 'sample.txt');
  await writeFile(path, 'version-00000000');
  // Git can map this file while scanning on Windows. Change fixed-size bytes
  // without repeatedly truncating the mapped file; keep the content race real.
  const writer = (async () => { while (!stop) { await writeFile(path, 'version-' + String(counter + 1).padStart(8, '0'), { flag: 'r+' }); counter++; await new Promise(r => setTimeout(r, 15)); } })();
  void writer.catch(() => {}); // attach immediately; finally still propagates failures
  try {
    await new Promise(r => setTimeout(r, 50));
    const before = counter;
    assert.notEqual((await captureChanges(repo)).completeness, 'complete');
    assert.ok(counter > before, 'writer must actually advance during capture');
  } finally { stop = true; await writer; }
});

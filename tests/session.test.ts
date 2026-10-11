import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { CodexSession } from '../src/codex/session.ts';
const peer = fileURLToPath(new URL('./fixtures/peer.mjs', import.meta.url));
async function session(t: any) {
  const s = new CodexSession(process.execPath, [peer]);
  t.after(() => s.close());
  await s.initialize();
  return s;
}
test('initialize sends initialized before creating a thread', async t => {
  const s = await session(t);
  assert.equal((await s.createThread(process.cwd())).thread.id, 'thread-1');
});
test('model discovery uses advertised default rather than inheriting an unavailable configured name', async t => {
  const s = await session(t);
  assert.equal(await s.discoverModel(), 'fixture-default');
  assert.equal((await s.createThread(process.cwd())).model, 'fixture-default');
  await assert.rejects(s.discoverModel('unlisted-model'), /not advertised/);
});
test('completion before start response is retained with text', async t => {
  const s = await session(t);
  const result = await s.runTurn('thread-1', 'short');
  assert.equal(result.status, 'completed');
  assert.equal(result.text, 'fixture text');
  assert.ok(result.turnId.startsWith('turn-'));
});
test('an old turn completion before acceptance cannot consume the new turn terminal', async t => {
  const s = await session(t);
  const result = await s.runTurn('thread-1', 'stale-first');
  assert.equal(result.status, 'completed');
  assert.notEqual(result.turnId, 'old-turn');
});
test('failed turns never pass as execution success', async t => {
  const s = await session(t);
  await assert.rejects(s.runTurn('thread-1', 'fail'), /failed/);
});
test('proposed file paths are exposed before approval so caller can enforce sample boundary', async t => {
  const s = await session(t);
  await s.rpc.request('patch-event', {});
  assert.deepEqual(s.proposedChanges.get('patch-1')?.changes.map(c => c.path), ['sample.txt']);
});
test('interrupt waits for interrupted terminal event', async t => {
  const s = await session(t);
  const handle = await s.startTurn('thread-1', 'long');
  const result = await s.interrupt(handle);
  assert.equal(result.status, 'interrupted');
});
test('a timed out turn retires the connection so a late completion cannot contaminate a new turn', async t => {
  const s = await session(t);
  const handle = await s.startTurn('thread-1', 'late', 10);
  await assert.rejects(handle.completion, /timed out/);
  await assert.rejects(s.startTurn('thread-1', 'short'), /closed|exited/);
});

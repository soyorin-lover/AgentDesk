import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { RpcClient } from '../src/codex/rpc.ts';

const peer = fileURLToPath(new URL('./fixtures/peer.mjs', import.meta.url));
function client(t: any, options = {}) {
  const c = new RpcClient(process.execPath, [peer], options);
  t.after(() => c.close());
  return c;
}
test('UTF-8 fragments and CRLF retain the complete response', async t => {
  assert.equal(await client(t).request('fragment', {}), '你好');
});
test('concurrent out of order responses match their own ids', async t => {
  const c = client(t);
  const slow = c.request('delay', {});
  assert.deepEqual(await c.request('echo', { value: 2 }), { value: 2 });
  assert.equal(await slow, 'late');
});
test('error response rejects only its matching request', async t => {
  const c = client(t);
  await assert.rejects(c.request('error', {}), /-32602.*bad params/);
  assert.equal(await c.request('echo', 9), 9);
});
test('explicit RPC rejection keeps a numeric code distinct from a transport timeout', async t => {
  const c = client(t);
  await assert.rejects(c.request('error', {}), (error: any) => error.code === -32602 && error.name === 'RpcError');
});
test('timeout removes pending request and ignores its late response', async t => {
  const c = client(t);
  await assert.rejects(c.request('delay', {}, 20), /timed out/);
  await new Promise(r => setTimeout(r, 100));
  assert.equal(await c.request('echo', 3), 3);
});
test('early process exit rejects pending and future requests', async t => {
  const c = client(t);
  await assert.rejects(c.request('exit', {}), /exited.*7/);
  await assert.rejects(c.request('echo', {}), /exited/);
});
test('spawn error rejects cleanly', async t => {
  const c = new RpcClient('agentdesk-nonexistent-executable', []);
  t.after(() => c.close());
  await assert.rejects(c.request('echo', {}), /ENOENT|spawn/);
});
test('invalid JSON and truncated final frame fail the transport', async t => {
  for (const method of ['bad', 'truncated']) {
    await assert.rejects(client(t).request(method, {}), /JSON|truncated/);
  }
});
test('duplicate server requests do not repeat side effects while pending or settled', async t => {
  let count = 0;
  const c = client(t, { onRequest: async () => { count++; await new Promise(r => setTimeout(r, 10)); return { decision: 'decline' }; } });
  assert.equal(await c.request('server-request', {}), true);
  assert.equal(count, 1);
});
test('same server id with conflicting action fails instead of replaying approval', async t => {
  let count = 0;
  const c = client(t, { onRequest: async () => { count++; return { decision: 'accept' }; } });
  // This checks conflicting request identity, not child-process startup latency.
  await c.request('echo', {});
  await assert.rejects(c.request('conflicting-server-request', {}, 5000), /conflicting server request id/);
  assert.equal(count, 1);
});
test('close terminates own peer that ignores stdin EOF', async t => {
  const c = client(t);
  await c.request('hang', {});
  await c.close();
  assert.equal(c.exited, true);
});
test('waiter installed before request receives event preceding response', async t => {
  const c = client(t);
  const done = c.waitFor('done', () => true);
  await c.request('event', {});
  assert.deepEqual(await done, { value: 42 });
});
test('close settles event waiters and confirms own process exit', async t => {
  const c = client(t);
  const done = c.waitFor('never', () => true);
  const rejected = assert.rejects(done, /closed|exited/);
  await c.close();
  await rejected;
  assert.equal(c.exited, true);
});

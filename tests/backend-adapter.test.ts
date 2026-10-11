import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { CodexAdapter } from '../src/backend/adapter.ts';

const peer = fileURLToPath(new URL('./fixtures/peer.mjs', import.meta.url));
test('adapter rejects missing or mismatched thread workspace and policies before exposing session or turn', async () => {
  for (const sessionId of [undefined, 'known-thread']) for (const flag of ['--missing-cwd', '--wrong-cwd', '--missing-approval', '--wrong-approval', '--missing-sandbox', '--wrong-sandbox', '--readonly-sandbox']) {
    const callbacks: string[] = [];
    const adapter = new CodexAdapter({ binary: process.execPath, args: [peer, flag] });
    const owned: { execution?: Awaited<ReturnType<CodexAdapter['start']>> } = {};
    try {
      await assert.rejects(async () => { owned.execution = await adapter.start({ cwd: process.cwd(), input: 'x', sessionId, onSession: () => callbacks.push('session'), onModel: () => callbacks.push('model'), onTurn: () => callbacks.push('turn'), emit: () => {} }); }, /engine_start_failed/, flag);
      assert.deepEqual(callbacks, [], flag);
    } finally { await owned.execution?.close(); }
  }
});
test('adapter reports returned configuration and correlated reroutes, never advertised fallback', async () => {
  for (const flag of ['--missing-model', '--different-model', '']) {
    const models: { model: string; source?: string }[] = [], events: any[] = [], turns: string[] = [];
    const adapter = new CodexAdapter({ binary: process.execPath, args: [peer, ...(flag ? [flag] : [])] });
    const execution = await adapter.start({ cwd: process.cwd(), input: flag ? 'x' : 'correlation', onSession: () => {}, onModel: (model, source) => models.push({ model, source }), onTurn: id => turns.push(id), emit: event => events.push(event) });
    try {
      assert.equal((await execution.result).status, 'succeeded');
      assert.equal(turns.length, 1); assert.match(turns[0], /^turn-/);
      assert.deepEqual(models, flag === '--missing-model' ? [] : flag === '--different-model' ? [{ model: 'fixture-returned', source: 'thread_configuration' }] : [{ model: 'fixture-default', source: 'thread_configuration' }, { model: 'fixture-rerouted', source: 'model_rerouted' }]);
      assert.equal(events.filter(e => e.type === 'message.completed').length, 1);
      assert.equal(events.some(e => e.data.messageId === 'foreign' || e.data.activityId === 'foreign'), false);
    } finally { await execution.close(); }
  }
});

test('adapter configuration identity is stable, private and immutable for launch selectors', () => {
  const args = [peer], options = { binary: process.execPath, args, model: 'configured' };
  const adapter = new CodexAdapter(options), identity = adapter.configurationIdentity;
  assert.equal(adapter.configuredModel, 'configured'); assert.match(identity, /^[a-f0-9]{64}$/);
  assert.equal(identity, new CodexAdapter({ ...options, args: [...args] }).configurationIdentity);
  for (const changed of [{ binary: 'other' }, { args: [peer, 'other'] }, { model: 'other' }, { transport: 'http' as const }, { turnTimeoutMs: 1 }]) assert.notEqual(identity, new CodexAdapter({ ...options, ...changed }).configurationIdentity);
  args.push('mutated'); options.model = 'mutated';
  assert.equal(adapter.configurationIdentity, identity); assert.equal(adapter.configuredModel, 'configured');
});

test('adapter preserves events preceding acceptance and resumes only the supplied engine session', async () => {
  const adapter = new CodexAdapter({ binary: process.execPath, args: [fileURLToPath(new URL('./fixtures/peer.mjs', import.meta.url))] });
  const events: any[] = []; let sessionId = '', model = '';
  const execution = await adapter.start({ cwd: process.cwd(), input: 'stale-first', sessionId: 'known-thread', onSession: id => { sessionId = id; }, onModel: value => { model = value; }, emit: event => events.push(event) });
  try {
    assert.equal((await execution.result).status, 'succeeded'); assert.equal(sessionId, 'known-thread'); assert.equal(model, 'fixture-default');
    assert.equal(events.find(e => e.type === 'message.completed').data.text, 'fixture text');
    assert.equal(events.find(e => e.type === 'message.delta').data.chunkIndex, 0);
  } finally { await execution.close(); }
});

test('adapter maps actual interrupted confirmation and rejects unknown executable explicitly', async () => {
  const adapter = new CodexAdapter({ binary: process.execPath, args: [fileURLToPath(new URL('./fixtures/peer.mjs', import.meta.url))] });
  const execution = await adapter.start({ cwd: process.cwd(), input: 'long', onSession: () => {}, onModel: () => {}, emit: () => {} });
  try { await execution.interrupt(); assert.equal((await execution.result).status, 'aborted'); } finally { await execution.close(); }
  const missing = new CodexAdapter({ binary: 'agentdesk-no-such-binary' });
  await assert.rejects(missing.start({ cwd: process.cwd(), input: 'x', onSession: () => {}, onModel: () => {}, emit: () => {} }), (e: any) => e.definitive === true);
});

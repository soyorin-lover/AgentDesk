import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type SpawnOptionsWithoutStdio } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ClaudeAdapter } from '../src/backend/claude-adapter.ts';
import type { AdapterEvent, ExecutionContext } from '../src/backend/types.ts';
import { BackendService } from '../src/backend/service.ts';
import { startHttp } from '../src/backend/http.ts';
import { projectFixture, taskInput, settled, waitFor } from './backend-fixtures.ts';

const peer = fileURLToPath(new URL('./fixtures/claude-peer.mjs', import.meta.url));
function adapter(scenario: string | (() => string) = 'ok', calls: string[][] = []) {
  return new ClaudeAdapter({ binary: process.execPath, version: '2.1.284', turnTimeoutMs: 10000 }, {
    spawn: (_binary: string, args: string[], options: SpawnOptionsWithoutStdio) => {
      calls.push([...args]); return spawn(process.execPath, [peer, typeof scenario === 'function' ? scenario() : scenario, ...args], options);
    },
  });
}
function context(sessionId?: string) {
  const events: AdapterEvent[] = [], models: { model: string; source?: string }[] = []; let session = '';
  const value: ExecutionContext = { cwd: process.cwd(), input: 'hello', sessionId, onSession: id => { session = id; }, onModel: (model, source) => models.push({ model, source }), emit: e => events.push(e) };
  return { value, events, models, get session() { return session; } };
}
test('Claude start and exact resume normalize only owned visible messages and keep model evidence qualified', async () => {
  const calls: string[][] = [], a = adapter('ok', calls), first = context();
  const e = await a.start(first.value); assert.equal((await e.result).status, 'succeeded'); await e.close();
  assert.match(first.session, /^[a-f0-9-]{36}$/);
  assert.deepEqual(first.events, [{ type: 'message.completed', data: { messageId: 'message-1', text: 'hello' } }]);
  assert.deepEqual(first.models, [{ model: 'fixture-config', source: 'thread_configuration' }, { model: 'fixture-header', source: 'assistant_message' }]);
  const second = context(first.session), resumed = await a.start(second.value); await resumed.result; await resumed.close();
  assert.equal(second.session, first.session);
  assert.ok(calls[1].includes('--session-id')); assert.equal(calls[3][calls[3].indexOf('--resume') + 1], first.session);
  assert.ok(!calls[3].includes('--continue')); assert.ok(calls[1].includes('--restricted')); assert.ok(calls[1].includes('--safe-mode'));
  assert.equal(calls[1][calls[1].indexOf('--tools') + 1], 'Read,Glob,Grep,Edit,Write');
  await assert.rejects(a.start(context('../foreign').value), /native_session_invalid/);
});
test('Claude malformed, mismatched or absent terminal stays unknown; definite result errors fail', async () => {
  for (const scenario of ['malformed', 'wrong-session', 'missing-result', 'bad-exit', 'error']) {
    const c = context(), e = await adapter(scenario).start(c.value);
    try {
      if (scenario === 'error') assert.equal((await e.result).status, 'failed');
      else await assert.rejects(e.result);
      assert.equal(c.events.some(v => v.data.text === 'must not leak'), false);
    } finally { await e.close(); }
  }
});
test('Claude result requires actual exit, unsupported interrupt never stops the process, close confirms exit', async () => {
  const e = await adapter('hold').start(context().value); let ended = false;
  void e.result.then(() => { ended = true; }, () => { ended = true; });
  await new Promise(r => setTimeout(r, 150)); assert.equal(ended, false);
  await assert.rejects(e.interrupt(), /engine_capability_unsupported/); assert.equal(ended, false);
  await e.close(); await assert.rejects(e.result); assert.equal(ended, true);
});
test('Claude selectors stay fixed, require native executable and reject unverified versions before a turn', async () => {
  const options = { binary: process.execPath, version: '2.1.284', model: 'fixed' }, a = new ClaudeAdapter(options), identity = a.configurationIdentity;
  options.model = 'changed'; assert.equal(a.configuredModel, 'fixed'); assert.equal(a.configurationIdentity, identity);
  assert.notEqual(identity, new ClaudeAdapter(options).configurationIdentity);
  assert.throws(() => new ClaudeAdapter({ binary: 'claude.cmd', version: '2.1.284' }));
  assert.throws(() => new ClaudeAdapter({ binary: process.execPath, version: 'unknown' }));
  const calls: string[][] = [];
  await assert.rejects(adapter('wrong-version', calls).start(context().value), /engine_version_mismatch/); assert.equal(calls.length, 1);
});
test('Claude service preserves exact sessions and unknown model evidence; rejects unsupported HTTP interrupt', async () => {
  let scenario = 'ok'; const calls: string[][] = [];
  const f = await projectFixture(), a = adapter(() => scenario, calls);
  const s = await BackendService.open({ ...f.config, agentInstances: [{ id: 'claude-dev', name: 'Claude dev', engineId: 'claude_code', adapter: a }] });
  const http = await startHttp(s);
  try {
    const t = await s.createTask({ ...taskInput, agentInstanceId: 'claude-dev' }, 'claude');
    await s.prepareWorkspace(t.id, { expectedVersion: t.version }, 'prepare'); await settled(s, t.id);
    const first = await s.startRun(t.id, { expectedVersion: s.task(t.id).version }, 'start');
    await waitFor(() => s.run(first.id).status === 'succeeded');
    const session = s.taskSession(t.id).session!;
    const next = await s.startRun(t.id, { expectedVersion: s.task(t.id).version, input: 'feedback' }, 'continue');
    await waitFor(() => s.run(next.id).status === 'succeeded');
    assert.equal(s.run(next.id).sessionRef, session.id);
    assert.equal(calls[3][calls[3].indexOf('--resume') + 1], session.nativeSessionId);
    assert.equal(s.run(next.id).modelEvidence?.source, 'assistant_message');
    assert.equal(s.run(next.id).modelEvidence?.actualModel, undefined);
    scenario = 'hold';
    const r = await s.startRun(t.id, { expectedVersion: s.task(t.id).version, input: 'hold' }, 'hold');
    await waitFor(() => s.run(r.id).phase === 'executing');
    const capabilities = s.agentInstance('claude-dev').capabilities;
    assert.deepEqual(capabilities.map(c => c.businessSupport), ['implemented', 'implemented', 'unsupported', 'unsupported', 'unsupported']);
    assert.equal(s.run(r.id).engineId, 'claude_code'); assert.equal(s.run(r.id).modelEvidence?.status, 'unknown');
    assert.ok(!s.detail(t.id).availableActions.includes('interrupt'));
    const response = await fetch(http.url + `/api/v1/runs/${r.id}/interrupt`, { method: 'POST', headers: { Authorization: 'Bearer ' + http.token, 'Content-Type': 'application/json', 'Idempotency-Key': 'no-interrupt' }, body: JSON.stringify({ expectedVersion: s.run(r.id).version }) });
    assert.equal(response.status, 409); assert.match(await response.text(), /engine_capability_unsupported/);
    assert.equal(s.run(r.id).phase, 'executing');
  } finally { await http.close(); await s.close(); }
});

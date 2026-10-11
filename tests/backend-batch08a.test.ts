import test from 'node:test';
import assert from 'node:assert/strict';
import { BackendService } from '../src/backend/service.ts';
import { startHttp } from '../src/backend/http.ts';
import { ApiClient } from '../src/client/api.ts';
import { Store } from '../src/backend/store.ts';
import { projectFixture, taskInput, FixtureEngine, settled, waitFor } from './backend-fixtures.ts';
import type { Task, Run, WorkflowDraft, WorkflowApproval } from '../src/backend/types.ts';

class FixedEngine extends FixtureEngine { readonly configurationIdentity: string; constructor(identity: string) { super(); this.configurationIdentity = identity; } }
async function prepare(s: BackendService, instanceId = 'codex-local', key = instanceId) {
  const task = await s.createTask({ ...taskInput, agentInstanceId: instanceId }, key);
  await s.prepareWorkspace(task.id, { expectedVersion: task.version }, key + '-prepare'); await settled(s, task.id); return s.task(task.id);
}
async function round(s: BackendService, taskId: string, engine: FixtureEngine, key: string, input?: string) {
  const count = engine.contexts.length;
  const run = await s.startRun(taskId, { expectedVersion: s.task(taskId).version, ...(input ? { input } : {}) }, key);
  await waitFor(() => engine.contexts.length > count); return run;
}
async function finish(s: BackendService, runId: string, engine: FixtureEngine) { engine.finish({ status: 'succeeded' }); await waitFor(() => s.run(runId).status === 'succeeded'); }

test('B08a HTTP registry separates same-engine instances and fixes session ownership and per-round evidence', async () => {
  const f = await projectFixture(), a = new FixedEngine('a'), b = new FixedEngine('b');
  const s = await BackendService.open({ ...f.config, adapter: a, agentInstances: [{ id: 'codex-review', name: 'Reviewer', engineId: 'codex', adapter: b }] });
  const http = await startHttp(s); const client = new ApiClient({ baseUrl: http.url, getToken: () => http.token });
  try {
    const instances = await client.agentInstances(); assert.equal(instances.items.filter(i => i.available).length, 2);
    assert.equal((await client.agentInstance('codex-review')).health.online, 'unknown');
    assert.equal((await client.agentInstance('claude-local')).available, false);
    const t1 = await prepare(s), t2 = await prepare(s, 'codex-review');
    assert.notDeepEqual(t1.agentBinding, t2.agentBinding);
    const r1 = await round(s, t1.id, a, 'a1');
    await assert.rejects(s.startRun(t2.id, { expectedVersion: t2.version }, 'concurrent'), /active_run/);
    a.contexts[0].onTurn?.('turn-a1'); a.contexts[0].onModel('selected', 'thread_configuration');
    a.contexts[0].emit({ type: 'message.completed', data: { messageId: 'm', text: 'done', origin: { instanceId: 'spoof' } } });
    await finish(s, r1.id, a);
    const r2 = await round(s, t2.id, b, 'b1'); b.contexts[0].onTurn?.('turn-b1'); await finish(s, r2.id, b);
    const aSession = (await client.taskSession(t1.id)).session!, bSession = (await client.taskSession(t2.id)).session!;
    assert.notEqual(aSession.id, bSession.id); assert.equal(aSession.workspaceId, t1.workspaceId); assert.equal(bSession.agentBinding?.instanceId, 'codex-review');
    const r3 = await round(s, t1.id, a, 'a2', 'feedback'); assert.equal(a.contexts[1].sessionId, aSession.nativeSessionId);
    assert.equal(b.contexts[0].sessionId, undefined); assert.equal(s.run(r3.id).modelEvidence?.status, 'unknown'); assert.equal(s.run(r3.id).model, undefined);
    a.contexts[0].onModel('late-model'); a.contexts[0].onTurn?.('late-turn');
    a.contexts[0].emit({ type: 'message.completed', data: { text: 'late' } });
    assert.equal(s.run(r3.id).model, undefined); assert.equal(s.run(r1.id).model, 'selected');
    assert.throws(() => a.contexts[1].onSession('other-native'), /native_session_mismatch/);
    await finish(s, r3.id, a);
    assert.equal(s.run(r1.id).modelEvidence?.source, 'thread_configuration'); assert.equal(s.run(r1.id).modelEvidence?.actualModel, undefined);
    assert.equal(s.run(r1.id).nativeTurnId, 'turn-a1');
    const event = s.events(t1.id, 0, 200).find(e => e.type === 'message.completed')!;
    assert.equal((event.data.origin as { instanceId: string }).instanceId, 'codex-local');
    for (const action of ['approval', 'recover', 'steer']) {
      const response = await fetch(http.url + `/api/v1/runs/${r1.id}/${action}`, { method: 'POST', headers: { Authorization: 'Bearer ' + http.token, 'Content-Type': 'application/json', 'Idempotency-Key': action }, body: '{}' });
      assert.equal(response.status, 404);
    }
    assert.equal((await fetch(http.url + '/api/v1/agent-instances', { method: 'POST', headers: { Authorization: 'Bearer ' + http.token, 'Content-Type': 'application/json', 'Idempotency-Key': 'inject' }, body: '{}' })).status, 404);
  } finally { await http.close(); await s.close(); }
});

test('B08a restart config drift cannot retarget task or old session; exact restored config resumes', async () => {
  const f = await projectFixture(), engine = new FixedEngine('original'); let s = await BackendService.open({ ...f.config, adapter: engine });
  try {
    const task = await prepare(s), run = await round(s, task.id, engine, 'first'); await finish(s, run.id, engine);
    const session = s.taskSession(task.id).session!; await s.close();
    const changed = new FixedEngine('changed'); s = await BackendService.open({ ...f.config, adapter: changed });
    assert.equal(s.taskSession(task.id).session?.id, session.id);
    await assert.rejects(s.startRun(task.id, { expectedVersion: s.task(task.id).version, input: 'wrong target' }, 'drift'), /agent_configuration_changed/);
    assert.equal(changed.contexts.length, 0); assert.equal((await s.queryDetail(task.id)).agentAuthorization?.eligible, false);
    await s.close(); const restored = new FixedEngine('original'); s = await BackendService.open({ ...f.config, adapter: restored });
    const resumed = await round(s, task.id, restored, 'resume', 'correct'); assert.equal(restored.contexts[0].sessionId, session.nativeSessionId); await finish(s, resumed.id, restored);
  } finally { await s.close(); }
});

test('B08a unknown result blocks other instances across restart without automatic retries', async () => {
  const f = await projectFixture(), other = new FixedEngine('other');
  const unknown = { configurationIdentity: 'unknown-fixture', start: async () => { throw Error('acceptance outcome unknown'); } };
  const config = { ...f.config, adapter: unknown, agentInstances: [{ id: 'codex-other', name: 'Other', engineId: 'codex' as const, adapter: other }] };
  let s = await BackendService.open(config);
  try {
    const a = await prepare(s), b = await prepare(s, 'codex-other');
    const run = await s.startRun(a.id, { expectedVersion: a.version }, 'unknown'); await waitFor(() => s.run(run.id).status === 'needs_recovery');
    await assert.rejects(s.startRun(b.id, { expectedVersion: b.version }, 'blocked'), /active_run/);
    await s.close(); s = await BackendService.open(config);
    await assert.rejects(s.startRun(b.id, { expectedVersion: b.version }, 'still-blocked'), /active_run/);
    assert.equal(other.contexts.length, 0); assert.equal(s.run(run.id).status, 'needs_recovery');
  } finally { await s.close(); }
});

test('B08a historical workflow approvals without instance proof cannot gain authorization on migration', async () => {
  const f = await projectFixture(), engine = new FixedEngine('proof'); let s = await BackendService.open({ ...f.config, adapter: engine });
  const source = (await s.executionBinding('fixture')).binding!;
  const executionBinding = { id: source.id, revision: source.revision, grantId: source.grantId, baselineCommit: source.baselineCommit };
  await s.saveWorkflow('fixture', { expectedVersion: 0, roles: [{ id: 'dev', name: 'Dev', responsibility: 'Code', defaultAgentInstanceId: 'codex-local' }], members: [{ id: 'm', name: 'Agent', roleId: 'dev', agentInstanceId: 'codex-local' }], ownerMemberId: 'm', nodes: [{ id: 'n', name: 'N', goal: 'Goal', acceptanceCriteria: ['ok'], roleId: 'dev', memberId: 'm', agentInstanceId: 'codex-local', dependencyIds: [], executionBinding }] }, 'draft');
  const approval = await s.approveWorkflow('fixture', { expectedVersion: 1, revision: 1, nodeIds: ['n'] }, 'approve'); await s.close();
  const store = new Store(f.config.database), draft = store.get<WorkflowDraft>('workflow', 'fixture')!;
  delete draft.nodes[0].agentBinding; store.put('workflow', 'fixture', draft); store.put('workflow-revision', 'fixture:1', draft);
  const oldApproval = store.get<WorkflowApproval>('workflow-approval', approval.id)!; delete oldApproval.nodes[0].node.agentBinding; store.put('workflow-approval', approval.id, oldApproval); store.close();
  s = await BackendService.open({ ...f.config, adapter: engine });
  try {
    assert.equal((await s.workflow('fixture')).nodes[0].agentBinding, undefined);
    assert.equal((await s.workflow('fixture')).nodeStates[0].reason, 'agent_configuration_unproven');
    await assert.rejects(s.linkWorkflowTask('fixture', { expectedVersion: 2, revision: 1, nodeId: 'n' }, 'legacy-link'), /agent_configuration_unproven/);
    assert.equal(s.tasks().items.length, 0); assert.equal(engine.contexts.length, 0);
  } finally { await s.close(); }
});

test('B08a refuses mismatched session ownership before adapter execution', async () => {
  const f = await projectFixture(), engine = new FixedEngine('proof'); let s = await BackendService.open({ ...f.config, adapter: engine });
  const task = await prepare(s), run = await round(s, task.id, engine, 'first'); await finish(s, run.id, engine);
  const session = s.taskSession(task.id).session!; await s.close();
  const store = new Store(f.config.database); store.put('native-session', session.id, { ...session, workspaceId: 'foreign-workspace' }); store.close();
  s = await BackendService.open({ ...f.config, adapter: engine });
  try {
    await assert.rejects(s.startRun(task.id, { expectedVersion: s.task(task.id).version, input: 'continue' }, 'mismatch'), /native_session_unproven/);
    assert.equal(engine.contexts.length, 1);
  } finally { await s.close(); }
});

test('B08a missing native session after a round never silently creates a new feedback thread', async () => {
  const f = await projectFixture(); let starts = 0;
  const adapter = { configurationIdentity: 'sessionless-fixture', start: async () => { starts++; return { result: Promise.resolve({ status: 'succeeded' as const }), interrupt: async () => {}, close: async () => {} }; } };
  const s = await BackendService.open({ ...f.config, adapter });
  try {
    const task = await prepare(s), run = await s.startRun(task.id, { expectedVersion: s.task(task.id).version }, 'first'); await waitFor(() => s.run(run.id).status === 'succeeded');
    assert.equal(s.taskSession(task.id).session, null);
    await assert.rejects(s.startRun(task.id, { expectedVersion: s.task(task.id).version, input: 'continue' }, 'feedback'), /native_session_unproven/);
    assert.equal(starts, 1);
  } finally { await s.close(); }
});

test('B08a legacy records remain readable without automatically claiming old config, model or session', async () => {
  const f = await projectFixture(), engine = new FixedEngine('legacy'); let s = await BackendService.open({ ...f.config, adapter: engine });
  const task = await prepare(s); await s.close();
  const store = new Store(f.config.database);
  const old = store.get<Task>('task', task.id)!; delete old.agentBinding; store.put('task', task.id, old);
  store.put('private', 'session:' + task.id, { id: 'legacy-native' });
  store.put('run', 'historical', { schemaVersion: 1, id: 'historical', taskId: task.id, agentInstanceId: 'codex-local', engineId: 'codex', model: 'old-selection', status: 'succeeded', phase: 'ended', version: 1, startedAt: new Date().toISOString() } satisfies Run); store.close();
  s = await BackendService.open({ ...f.config, adapter: engine });
  try {
    assert.equal(s.task(task.id).agentBinding, undefined); assert.equal(s.taskSession(task.id).session?.ownership, 'legacy_unproven');
    assert.equal(s.run('historical').model, 'old-selection'); assert.equal(s.run('historical').modelEvidence?.source, 'legacy_unspecified');
    await assert.rejects(s.startRun(task.id, { expectedVersion: s.task(task.id).version }, 'legacy'), /agent_configuration_unproven/);
    assert.equal(engine.contexts.length, 0);
  } finally { await s.close(); }
});

test('B08a workflow approval captures exact instance config and never follows startup edits', async () => {
  const f = await projectFixture(), engine = new FixedEngine('v1'); let s = await BackendService.open({ ...f.config, adapter: engine });
  try {
    const source = (await s.executionBinding('fixture')).binding!;
    const executionBinding = { id: source.id, revision: source.revision, grantId: source.grantId, baselineCommit: source.baselineCommit };
    const input = { expectedVersion: 0, roles: [{ id: 'dev', name: 'Dev', responsibility: 'Code', defaultAgentInstanceId: 'codex-local' }], members: [{ id: 'm', name: 'Agent', roleId: 'dev', agentInstanceId: 'codex-local' }], ownerMemberId: 'm', nodes: [{ id: 'n', name: 'N', goal: 'Goal', acceptanceCriteria: ['ok'], roleId: 'dev', memberId: 'm', agentInstanceId: 'codex-local', dependencyIds: [], executionBinding }] };
    const draft = await s.saveWorkflow('fixture', input, 'draft'); assert.ok(draft.nodes[0].agentBinding);
    const approval = await s.approveWorkflow('fixture', { expectedVersion: 1, revision: 1, nodeIds: ['n'] }, 'approve');
    assert.deepEqual(approval.nodes[0].node.agentBinding, draft.nodes[0].agentBinding);
    await s.close(); s = await BackendService.open({ ...f.config, adapter: new FixedEngine('v2') });
    await assert.rejects(s.linkWorkflowTask('fixture', { expectedVersion: 2, revision: 1, nodeId: 'n' }, 'link'), /agent_configuration_changed/);
    assert.equal((await s.workflow('fixture')).nodeStates[0].status, 'blocked');
    const next = await s.saveWorkflow('fixture', { ...input, expectedVersion: 2 }, 'newdraft');
    assert.notDeepEqual(next.nodes[0].agentBinding, draft.nodes[0].agentBinding); assert.deepEqual(next.affectedNodeIds, ['n']);
  } finally { await s.close(); }
});

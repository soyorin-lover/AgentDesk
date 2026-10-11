import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { BackendService } from '../src/backend/service.ts';
import { projectFixture, taskInput, FixtureEngine, settled, waitFor } from './backend-fixtures.ts';
import { startHttp } from '../src/backend/http.ts';
import { ApiClient } from '../src/client/api.ts';
import { Store } from '../src/backend/store.ts';
import type { Workspace } from '../src/backend/types.ts';

async function setup() { const f = await projectFixture(); const engine = new FixtureEngine(); const config = { ...f.config, adapter: engine }; return { ...f, engine, config, s: await BackendService.open(config) }; }
async function graph(s: BackendService) {
  const binding = (await s.executionBinding('fixture')).binding!;
  const executionBinding = { id: binding.id, revision: binding.revision, grantId: binding.grantId, baselineCommit: binding.baselineCommit };
  const node = (id: string, dependencyIds: string[] = []) => ({ id, name: id, goal: 'change file', acceptanceCriteria: ['correct'], roleId: 'dev', memberId: 'member', agentInstanceId: 'codex-local', dependencyIds, executionBinding });
  return { roles: [{ id: 'dev', name: 'Developer', responsibility: 'Implement', defaultAgentInstanceId: 'codex-local' }], members: [{ id: 'member', name: 'Agent', roleId: 'dev', agentInstanceId: 'codex-local' }], ownerMemberId: 'member', nodes: [node('a'), node('b', ['a'])] };
}

test('workflow revisions and exact partial approvals persist without executing; edits revoke managed task authority', async () => {
  const { config, s: initial, engine } = await setup(); let s = initial;
  try {
    assert.equal((await s.workflow('fixture')).version, 0);
    const input = await graph(s); const draft = await s.saveWorkflow('fixture', { ...input, expectedVersion: 0 }, 'draft'); assert.equal(draft.revision, 1);
    await assert.rejects(s.approveWorkflow('fixture', { expectedVersion: 1, revision: 1, nodeIds: ['b'] }, 'subset'), /approval_dependencies_missing/);
    const approved = await s.approveWorkflow('fixture', { expectedVersion: 1, revision: 1, nodeIds: ['a'] }, 'approve');
    assert.equal((await s.approveWorkflow('fixture', { expectedVersion: 1, revision: 1, nodeIds: ['a'] }, 'approve')).id, approved.id);
    const task = await s.linkWorkflowTask('fixture', { expectedVersion: 2, revision: 1, nodeId: 'a' }, 'link');
    assert.equal(task.flow?.approvalId, approved.id); assert.equal(s.workspace(task.id).status, 'unprepared'); assert.equal(engine.contexts.length, 0);
    await s.approveWorkflow('fixture', { expectedVersion: 3, revision: 1, nodeIds: ['b'] }, 'b');
    const before = await s.workflow('fixture'); assert.equal(before.nodeStates.find(n => n.nodeId === 'b')?.status, 'blocked');
    await s.close(); s = await BackendService.open(config); assert.deepEqual(await s.workflow('fixture'), before); assert.equal(s.workflowRevisions('fixture').items.length, 1);
    const changed = { ...input, nodes: input.nodes.map(n => n.id === 'a' ? { ...n, goal: 'new goal' } : n) };
    const next = await s.saveWorkflow('fixture', { ...changed, expectedVersion: 4 }, 'edit');
    assert.deepEqual(next.affectedNodeIds.sort(), ['a', 'b']); assert.deepEqual(next.authorizationInvalidatedNodeIds.sort(), ['a', 'b']); assert.equal(s.task(task.id).goal, 'change file');
    await assert.rejects(s.prepareWorkspace(task.id, { expectedVersion: s.task(task.id).version }, 'old-prepare'), /workflow_revision_stale/);
    await assert.rejects(s.approveWorkflow('fixture', { expectedVersion: 5, revision: 1, nodeIds: ['a'] }, 'old-approve'), /workflow_revision_stale/);
    await assert.rejects(s.updateTask(task.id, { expectedVersion: s.task(task.id).version, goal: 'bypass' }, 'update'), /workflow_managed_task/);
  } finally { await s.close(); }
});

test('dependencies need explicit confirmation and current acceptance; succeeded is never automatically completed', async () => {
  const { s, engine } = await setup();
  try {
    await s.saveWorkflow('fixture', { ...await graph(s), expectedVersion: 0 }, 'draft');
    await s.approveWorkflow('fixture', { expectedVersion: 1, revision: 1, nodeIds: ['a', 'b'] }, 'all');
    const a = await s.linkWorkflowTask('fixture', { expectedVersion: 2, revision: 1, nodeId: 'a' }, 'a');
    const b = await s.linkWorkflowTask('fixture', { expectedVersion: 3, revision: 1, nodeId: 'b' }, 'b');
    await assert.rejects(s.prepareWorkspace(b.id, { expectedVersion: b.version }, 'blocked-prepare'), /workflow_dependencies_blocked/);
    await assert.rejects(s.startRun(b.id, { expectedVersion: b.version }, 'blocked-run'), /workflow_dependencies_blocked/);
    await s.prepareWorkspace(a.id, { expectedVersion: a.version }, 'prepare'); await settled(s, a.id);
    const run = await s.startRun(a.id, { expectedVersion: s.task(a.id).version }, 'run'); await waitFor(() => engine.contexts.length === 1);
    await writeFile(join(engine.contexts[0].cwd, 'sample.txt'), 'changed'); engine.finish({ status: 'succeeded' }); await waitFor(() => s.run(run.id).status === 'succeeded');
    assert.equal((await s.workflow('fixture')).nodeStates[0].status, 'awaiting_confirmation');
    const snap = await s.snapshot(a.id, { expectedVersion: s.task(a.id).version }, 'snap'); await s.accept(a.id, { expectedVersion: s.task(a.id).version, snapshotId: snap.id }, 'accept');
    const acceptance = await s.queryAcceptance(a.id); assert.equal((await s.workflow('fixture')).nodeStates[0].status, 'awaiting_confirmation');
    await s.confirmWorkflowNode('fixture', { expectedVersion: 4, revision: 1, nodeId: 'a', acceptanceId: acceptance.acceptance!.id }, 'confirm');
    assert.equal((await s.workflow('fixture')).nodeStates[0].status, 'completed');
    await s.prepareWorkspace(b.id, { expectedVersion: s.task(b.id).version }, 'prepare'); await settled(s, b.id);
    const downstream = await s.startRun(b.id, { expectedVersion: s.task(b.id).version }, 'downstream'); await waitFor(() => engine.contexts.length === 2 && s.run(downstream.id).phase === 'executing');
    await writeFile(join(engine.contexts[0].cwd, 'sample.txt'), 'external');
    const during = await s.workflow('fixture'); assert.equal(during.nodeStates[1].status, 'in_progress'); assert.equal(during.nodeStates[1].reason, 'workflow_dependencies_blocked');
    await s.interrupt(downstream.id, { expectedVersion: s.run(downstream.id).version }, 'stop'); await waitFor(() => s.run(downstream.id).status === 'aborted');
    await assert.rejects(s.startRun(b.id, { expectedVersion: s.task(b.id).version }, 'stale-run'), /workflow_dependencies_blocked/);
    const view = await s.workflow('fixture'); assert.equal(view.nodeStates[0].status, 'awaiting_confirmation'); assert.equal(view.nodeStates[1].status, 'blocked'); assert.equal(view.confirmations.length, 1);
  } finally { await s.close(); }
});

test('a project rebind never substitutes the approved task basis and unknown legacy runs still block managed linking', async () => {
  const { s: initial, config, path, engine } = await setup(); let s = initial;
  try {
    const input = await graph(s); const original = input.nodes[0].executionBinding;
    await s.saveWorkflow('fixture', { ...input, expectedVersion: 0 }, 'draft'); await s.approveWorkflow('fixture', { expectedVersion: 1, revision: 1, nodeIds: ['a'] }, 'approve');
    const { git } = await import('../src/backend/repository.ts'); await writeFile(join(path, 'sample.txt'), 'new source baseline'); await git(path, ['add', 'sample.txt']); await git(path, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'new']);
    const inspection = await s.inspectProjectRepository('fixture', { expectedVersion: 1, path }, 'inspect');
    await s.confirmProjectRepository('fixture', { expectedVersion: 1, inspectionId: inspection.id, baselineCommit: inspection.repository.head, acknowledgeUncommittedExcluded: true }, 'confirm');
    await s.bindProjectExecution('fixture', { expectedVersion: 2, grantId: 'fixture', inspectionId: inspection.id, baselineCommit: inspection.repository.head, acknowledgeUncommittedExcluded: true }, 'bind');
    const task = await s.linkWorkflowTask('fixture', { expectedVersion: 2, revision: 1, nodeId: 'a' }, 'task'); assert.deepEqual(task.executionBinding, original);
    await s.prepareWorkspace(task.id, { expectedVersion: task.version }, 'prepare'); assert.equal((await settled(s, task.id)).baseHead, original.baselineCommit);
    const old = await s.createTask(taskInput, 'legacy'); await s.prepareWorkspace(old.id, { expectedVersion: old.version }, 'prepare-old'); await settled(s, old.id);
    await s.close();
    // Keep this test's fixed adapter identity; configuration drift has separate B08a coverage.
    engine.start = async () => { throw Error('unknown fixture failure'); };
    s = await BackendService.open(config);
    const run = await s.startRun(old.id, { expectedVersion: s.task(old.id).version }, 'unknown'); await waitFor(() => s.run(run.id).status === 'needs_recovery');
    await s.approveWorkflow('fixture', { expectedVersion: 3, revision: 1, nodeIds: ['b'] }, 'approve-b');
    await assert.rejects(s.linkWorkflowTask('fixture', { expectedVersion: 4, revision: 1, nodeId: 'b' }, 'blocked'), /active_run/);
    await assert.rejects(s.startRun(task.id, { expectedVersion: s.task(task.id).version }, 'blocked-start'), /active_run/);
  } finally { await s.close(); }
});

test('HTTP workflow versions serialize edits, reject unavailable tools, and preserve non-workflow tasks', async () => {
  const { s } = await setup(); const http = await startHttp(s); const api = new ApiClient({ baseUrl: http.url, getToken: () => http.token });
  try {
    const input = await graph(s); assert.equal((await fetch(http.url + '/api/v1/projects/fixture/workflow')).status, 401);
    await assert.rejects(api.saveWorkflow('fixture', { ...input, expectedVersion: 1 }, 'empty-version'), error => { assert.equal((error as { currentVersion?: number }).currentVersion, 0); return true; });
    const attempts = await Promise.allSettled(['a', 'b'].map(key => api.saveWorkflow('fixture', { ...input, expectedVersion: 0 }, key)));
    assert.equal(attempts.filter(r => r.status === 'fulfilled').length, 1); const loser = attempts.find(r => r.status === 'rejected') as PromiseRejectedResult; assert.equal(loser.reason.currentVersion, 1);
    await assert.rejects(s.saveWorkflow('fixture', { ...input, expectedVersion: 1, trusted: true }, 'unknown'), /invalid_input/);
    const unsupported = { ...input, members: input.members.map(m => ({ ...m, agentInstanceId: 'claude-local' })), nodes: input.nodes.map(n => ({ ...n, agentInstanceId: 'claude-local' })) };
    await api.saveWorkflow('fixture', { ...unsupported, expectedVersion: 1 }, 'tool'); await assert.rejects(api.approveWorkflow('fixture', { expectedVersion: 2, revision: 2, nodeIds: ['a'] }, 'tool'), /engine_not_integrated/);
    const old = await api.createTask(taskInput, 'compatibility'); assert.equal(old.flow, undefined); await api.prepareWorkspace(old.id, { expectedVersion: old.version }, 'prepare'); assert.equal((await settled(s, old.id)).status, 'ready');
    assert.equal((await api.workflowRevisions('fixture')).items.length, 2);
  } finally { await http.close(); await s.close(); }
});

test('workflow graph displays preparing and failed workspace facts instead of ready', async () => {
  const { s, config } = await setup();
  try {
    const input = await graph(s); input.nodes = input.nodes.slice(0, 1);
    await s.saveWorkflow('fixture', { ...input, expectedVersion: 0 }, 'draft'); await s.approveWorkflow('fixture', { expectedVersion: 1, revision: 1, nodeIds: ['a'] }, 'approve');
    const task = await s.linkWorkflowTask('fixture', { expectedVersion: 2, revision: 1, nodeId: 'a' }, 'task');
    await mkdir(join(config.workspaceRoot, task.workspaceId));
    await s.prepareWorkspace(task.id, { expectedVersion: task.version }, 'prepare');
    const preparing = (await s.workflow('fixture')).nodeStates[0]; assert.equal(preparing.status, 'in_progress'); assert.equal(preparing.reason, 'workspace_preparing');
    assert.equal((await settled(s, task.id)).status, 'failed');
    const failed = (await s.workflow('fixture')).nodeStates[0]; assert.equal(failed.status, 'blocked'); assert.equal(failed.reason, 'workspace_conflict');
  } finally { await s.close(); }
});

test('workflow graph preserves persisted interrupted preparation as needs_recovery after restart', async () => {
  const { s: initial, config } = await setup(); let s = initial;
  try {
    const input = await graph(s); input.nodes = input.nodes.slice(0, 1);
    await s.saveWorkflow('fixture', { ...input, expectedVersion: 0 }, 'draft'); await s.approveWorkflow('fixture', { expectedVersion: 1, revision: 1, nodeIds: ['a'] }, 'approve');
    const task = await s.linkWorkflowTask('fixture', { expectedVersion: 2, revision: 1, nodeId: 'a' }, 'task');
    await s.prepareWorkspace(task.id, { expectedVersion: task.version }, 'prepare'); await settled(s, task.id); await s.close();
    const store = new Store(config.database); const workspace = store.get<Workspace>('workspace', task.workspaceId)!;
    workspace.status = 'preparing'; store.put('workspace', task.workspaceId, workspace); store.close();
    s = await BackendService.open(config); assert.equal(s.workspace(task.id).status, 'needs_recovery');
    const state = (await s.workflow('fixture')).nodeStates[0]; assert.equal(state.status, 'needs_recovery'); assert.equal(state.reason, 'owned_preparation_interrupted');
  } finally { await s.close(); }
});

test('draft binding references are project-scoped and existing task association cannot turn historical acceptance into approval', async () => {
  const { s, engine } = await setup();
  try {
    const input = await graph(s); const p = await s.createProject({ name: 'Other' }, 'other');
    await assert.rejects(s.saveWorkflow(p.id, { ...input, expectedVersion: 0 }, 'cross'), /execution_binding_unavailable/);
    const task = await s.createTask({ ...taskInput, title: 'a' }, 'existing');
    await s.prepareWorkspace(task.id, { expectedVersion: task.version }, 'prepare'); await settled(s, task.id);
    const run = await s.startRun(task.id, { expectedVersion: s.task(task.id).version }, 'run'); await waitFor(() => engine.contexts.length === 1); engine.finish({ status: 'succeeded' }); await waitFor(() => s.run(run.id).status === 'succeeded');
    const snap = await s.snapshot(task.id, { expectedVersion: s.task(task.id).version }, 'snap'); await s.accept(task.id, { expectedVersion: s.task(task.id).version, snapshotId: snap.id }, 'accept');
    const acceptance = await s.queryAcceptance(task.id);
    await s.saveWorkflow('fixture', { ...input, expectedVersion: 0 }, 'draft');
    await assert.rejects(s.linkWorkflowTask('fixture', { expectedVersion: 1, revision: 1, nodeId: 'a', taskId: task.id }, 'unapproved'), /workflow_not_approved/);
    await s.approveWorkflow('fixture', { expectedVersion: 1, revision: 1, nodeIds: ['a'] }, 'approve');
    await s.linkWorkflowTask('fixture', { expectedVersion: 2, revision: 1, nodeId: 'a', taskId: task.id }, 'link');
    await assert.rejects(s.confirmWorkflowNode('fixture', { expectedVersion: 3, revision: 1, nodeId: 'a', acceptanceId: acceptance.acceptance!.id }, 'historical'), /workflow_confirmation_stale/);
    assert.equal((await s.workflow('fixture')).nodeStates[0].reason, 'historical_run_not_approved');
    await assert.rejects(s.linkWorkflowTask('fixture', { expectedVersion: 3, revision: 1, nodeId: 'a' }, 'duplicate'), /workflow_task_already_linked/);
    const second = await s.startRun(task.id, { expectedVersion: s.task(task.id).version, input: 'Approved feedback' }, 'feedback'); await waitFor(() => engine.contexts.length === 2); engine.finish({ status: 'succeeded' }); await waitFor(() => s.run(second.id).status === 'succeeded');
    assert.equal((await s.workflow('fixture')).nodeStates[0].reason, 'acceptance_invalid');
  } finally { await s.close(); }
});

test('editing an active managed revision preserves input and blocks every subsequent write, with interrupt available', async () => {
  const { s, engine } = await setup();
  try {
    const input = await graph(s); await s.saveWorkflow('fixture', { ...input, expectedVersion: 0 }, 'draft'); await s.approveWorkflow('fixture', { expectedVersion: 1, revision: 1, nodeIds: ['a'] }, 'approve');
    const task = await s.linkWorkflowTask('fixture', { expectedVersion: 2, revision: 1, nodeId: 'a' }, 'task'); await s.prepareWorkspace(task.id, { expectedVersion: task.version }, 'prepare'); await settled(s, task.id);
    const run = await s.startRun(task.id, { expectedVersion: s.task(task.id).version }, 'run'); await waitFor(() => engine.contexts.length === 1 && s.run(run.id).phase === 'executing');
    const originalInput = engine.contexts[0].input;
    await s.saveWorkflow('fixture', { ...input, nodes: input.nodes.map(n => ({ ...n, goal: 'changed approved target' })), expectedVersion: 3 }, 'edit-active');
    assert.equal(engine.contexts[0].input, originalInput); assert.equal(s.task(task.id).goal, 'change file');
    await s.interrupt(run.id, { expectedVersion: s.run(run.id).version }, 'stop'); await waitFor(() => s.run(run.id).status === 'aborted');
    for (const [name, command] of [
      ['feedback', () => s.startRun(task.id, { expectedVersion: s.task(task.id).version, input: 'bypass' }, 'feedback')],
      ['snapshot', () => s.snapshot(task.id, { expectedVersion: s.task(task.id).version }, 'snapshot')],
      ['check', () => s.startCheck(task.id, { expectedVersion: s.task(task.id).version, presetId: 'none', snapshotId: 'none' }, 'check')],
      ['accept', () => s.accept(task.id, { expectedVersion: s.task(task.id).version, snapshotId: 'none' }, 'accept')],
    ] as const) await assert.rejects(command(), /workflow_revision_stale/, name);
    const detail = await s.queryDetail(task.id); assert.deepEqual(detail.availableActions, []); assert.equal(detail.workflowAuthorization?.reason, 'workflow_revision_stale');
  } finally { await s.close(); }
});

test('role changes show affected nodes; revoked binding has an explicit graph reason after restart', async () => {
  const { s: initial, config } = await setup(); let s = initial;
  try {
    const input = await graph(s); await s.saveWorkflow('fixture', { ...input, expectedVersion: 0 }, 'draft');
    await s.approveWorkflow('fixture', { expectedVersion: 1, revision: 1, nodeIds: ['a', 'b'] }, 'approve');
    const next = await s.saveWorkflow('fixture', { ...input, roles: input.roles.map(r => ({ ...r, responsibility: 'Review changed scope' })), expectedVersion: 2 }, 'role');
    assert.deepEqual(next.affectedNodeIds, ['a', 'b']);
    await s.approveWorkflow('fixture', { expectedVersion: 3, revision: 2, nodeIds: ['a'] }, 'approve2');
    const task = await s.linkWorkflowTask('fixture', { expectedVersion: 4, revision: 2, nodeId: 'a' }, 'task');
    await s.close();
    // Only this temporary service configuration changes. A different granted
    // check scope cannot silently replace the scope pinned by the old binding.
    s = await BackendService.open({ ...config, checkPresets: [{ id: 'new-scope', name: 'New', executable: process.execPath, args: ['-e', '0'], timeoutMs: 1000, outputBytes: 1000 }] });
    assert.equal(s.task(task.id).flow?.revision, 2);
    const state = (await s.workflow('fixture')).nodeStates[0]; assert.equal(state.status, 'blocked'); assert.equal(state.reason, 'execution_binding_unavailable');
    await assert.rejects(s.prepareWorkspace(task.id, { expectedVersion: s.task(task.id).version }, 'revoked'), /execution_binding_unavailable/);
  } finally { await s.close(); }
});

test('public client completes exact approval, managed execution and explicit confirmation over real HTTP', async () => {
  const { s, engine } = await setup(); const http = await startHttp(s, { allowedOrigins: ['http://localhost:5311'] }); const api = new ApiClient({ baseUrl: http.url, getToken: () => http.token });
  try {
    const input = await graph(s); input.nodes = input.nodes.slice(0, 1);
    const draft = await api.saveWorkflow('fixture', { ...input, expectedVersion: 0 }, 'draft');
    const attempts = await Promise.allSettled(['one', 'two'].map(key => api.approveWorkflow('fixture', { expectedVersion: 1, revision: draft.revision, nodeIds: ['a'] }, key)));
    assert.equal(attempts.filter(r => r.status === 'fulfilled').length, 1); assert.equal((attempts.find(r => r.status === 'rejected') as PromiseRejectedResult).reason.currentVersion, 2);
    const task = await api.linkWorkflowTask('fixture', { expectedVersion: 2, revision: 1, nodeId: 'a' }, 'link');
    await assert.rejects(api.linkWorkflowTask('fixture', { expectedVersion: 2, revision: 1, nodeId: 'a', taskId: task.id }, 'link'), /idempotency_conflict/);
    await api.prepareWorkspace(task.id, { expectedVersion: task.version }, 'prepare'); await settled(s, task.id);
    const run = await api.startRun(task.id, { expectedVersion: s.task(task.id).version }, 'start'); await waitFor(() => engine.contexts.length === 1); engine.finish({ status: 'succeeded' }); await waitFor(() => s.run(run.id).status === 'succeeded');
    const snap = await api.snapshot(task.id, { expectedVersion: s.task(task.id).version }, 'snapshot'); await api.accept(task.id, { expectedVersion: s.task(task.id).version, snapshotId: snap.id }, 'accept');
    const acceptance = await api.acceptance(task.id);
    const body = { expectedVersion: 3, revision: 1, nodeId: 'a', acceptanceId: acceptance.acceptance!.id };
    const confirmation = await api.confirmWorkflowNode('fixture', body, 'confirm'); assert.equal((await api.confirmWorkflowNode('fixture', body, 'confirm')).id, confirmation.id);
    const view = await api.workflow('fixture'); assert.equal(view.nodeStates[0].status, 'completed'); assert.equal(view.version, 4);
    assert.equal((await api.workflowRevisions('fixture')).items[0].version, 1);
    assert.ok((await api.events(task.id)).items.some(e => e.type === 'task.workflow_linked' && e.data.approvalId === task.flow?.approvalId));
    assert.equal((await api.task(task.id)).availableActions.includes('edit'), false);
    const feedback = await api.startRun(task.id, { expectedVersion: s.task(task.id).version, input: 'Explicit next feedback' }, 'feedback'); await waitFor(() => engine.contexts.length === 2); engine.finish({ status: 'succeeded' }); await waitFor(() => s.run(feedback.id).status === 'succeeded');
    assert.equal((await api.workflow('fixture')).nodeStates[0].status, 'awaiting_confirmation');
    await assert.rejects(api.confirmWorkflowNode('fixture', { ...body, expectedVersion: 4 }, 'stale-confirm'), /workflow_confirmation_stale/);
  } finally { await http.close(); await s.close(); }
});

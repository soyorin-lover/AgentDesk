import { randomUUID } from 'node:crypto';
import { ApiError, requireValue } from './errors.ts';
import { Store } from './store.ts';
import { validateWorkflow, affectedNodes, nodeContract } from './workflow.ts';
import type { WorkflowDraft, WorkflowNode } from './workflow.ts';
import type { AgentBinding, AcceptanceSummary, Task, Run, Workspace, TaskExecutionBinding, WorkflowApproval, WorkflowLink, WorkflowConfirmation, WorkflowNodeState, WorkflowView } from './types.ts';
type Body = Record<string, unknown>;
type Ref = { kind: string; id: string };
type Callbacks = { project(id: string): unknown; agent(id: string, binding?: AgentBinding, capture?: boolean): AgentBinding | undefined; binding(projectId: string, binding: TaskExecutionBinding): Promise<void>; acceptance(taskId: string): Promise<AcceptanceSummary>; task(id: string): Task; create(projectId: string, node: WorkflowNode): Task; linked(task: Task, link: WorkflowLink): void; busy(): boolean };
const now = () => new Date().toISOString();
function keys(body: Body, allowed: string[]) { requireValue(body && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).every(k => allowed.includes(k))); }
function version(value: { version: number }, expected: unknown) { requireValue(Number.isSafeInteger(expected) && (expected as number) >= 0); if (value.version !== expected) throw new ApiError(409, 'version_conflict', value.version); }
function sameBinding(a: TaskExecutionBinding | undefined, b: TaskExecutionBinding) { return a?.id === b.id && a.revision === b.revision && a.grantId === b.grantId && a.baselineCommit === b.baselineCommit; }

/** Flow authorization does not replace process safety or execution evidence. */
export class Workflows {
  private store: Store;
  private callbacks: Callbacks;
  constructor(store: Store, callbacks: Callbacks) { this.store = store; this.callbacks = callbacks; }
  current(projectId: string): WorkflowDraft { this.callbacks.project(projectId); return this.store.get<WorkflowDraft>('workflow', projectId) ?? { projectId, version: 0, revision: 0, roles: [], members: [], ownerMemberId: null, nodes: [], createdAt: '', affectedNodeIds: [], authorizationInvalidatedNodeIds: [] }; }
  revisions(projectId: string) { this.callbacks.project(projectId); return { items: this.store.list<WorkflowDraft>('workflow-revision').filter(d => d.projectId === projectId) }; }
  approvals(projectId: string) { return this.store.list<WorkflowApproval>('workflow-approval').filter(a => a.projectId === projectId); }
  links(projectId: string) { return this.store.list<WorkflowLink>('workflow-link').filter(l => l.projectId === projectId); }
  confirmations(projectId: string) { return this.store.list<WorkflowConfirmation>('workflow-confirmation').filter(c => c.projectId === projectId); }
  approval(d: WorkflowDraft, id: string) { return this.approvals(d.projectId).find(a => a.revision === d.revision && a.nodeIds.includes(id)); }
  link(d: WorkflowDraft, id: string) { return this.links(d.projectId).find(l => l.revision === d.revision && l.nodeId === id); }
  managed(task: Task) { return Boolean(task.flow || this.store.get<WorkflowLink>('workflow-link', task.id)); }
  #revision(d: WorkflowDraft, revision: unknown) { requireValue(d.revision > 0 && revision === d.revision, 409, 'workflow_revision_stale'); }
  #node(d: WorkflowDraft, id: unknown) { const node = d.nodes.find(n => n.id === id); requireValue(node, 404, 'not_found'); return node; }
  #bump(d: WorkflowDraft) { d.version++; this.store.put('workflow', d.projectId, d); }
  async prepareDraft(projectId: string, body: Body): Promise<() => Ref> {
    const old = this.current(projectId); version(old, body.expectedVersion); const value = validateWorkflow(body);
    for (const role of value.roles) this.callbacks.agent(role.defaultAgentInstanceId, undefined, true);
    for (const member of value.members) this.callbacks.agent(member.agentInstanceId, undefined, true);
    for (const node of value.nodes) {
      node.agentBinding = node.agentBinding ? this.callbacks.agent(node.agentInstanceId, node.agentBinding) : this.callbacks.agent(node.agentInstanceId, undefined, true);
      await this.callbacks.binding(projectId, node.executionBinding);
    }
    const changedRoles = new Set([...old.roles, ...value.roles].filter(role => JSON.stringify(old.roles.find(r => r.id === role.id)) !== JSON.stringify(value.roles.find(r => r.id === role.id))).map(role => role.id));
    const changedMembers = new Set([...old.members, ...value.members].filter(member => JSON.stringify(old.members.find(m => m.id === member.id)) !== JSON.stringify(value.members.find(m => m.id === member.id))).map(member => member.id));
    const affected = affectedNodes(old.nodes, value.nodes);
    for (const node of [...old.nodes, ...value.nodes]) if (changedRoles.has(node.roleId) || changedMembers.has(node.memberId)) affected.push(node.id);
    // Propagate role/member changes through dependency successors as well.
    for (let index = 0; index < affected.length; index++) for (const node of [...old.nodes, ...value.nodes]) if (node.dependencyIds.includes(affected[index]) && !affected.includes(node.id)) affected.push(node.id);
    const draft: WorkflowDraft = { ...value, projectId, version: old.version + 1, revision: old.revision + 1, createdAt: now(), affectedNodeIds: [...new Set(affected)].sort(), authorizationInvalidatedNodeIds: [...new Set(this.approvals(projectId).filter(a => a.revision === old.revision).flatMap(a => a.nodeIds))] };
    return () => { version(this.current(projectId), body.expectedVersion); this.store.put('workflow', projectId, draft); const id = projectId + ':' + draft.revision; this.store.put('workflow-revision', id, draft); return { kind: 'workflow-revision', id }; };
  }
  async prepareApproval(projectId: string, body: Body): Promise<() => Ref> {
    keys(body, ['expectedVersion', 'revision', 'nodeIds']); const d = this.current(projectId); version(d, body.expectedVersion); this.#revision(d, body.revision);
    requireValue(Array.isArray(body.nodeIds) && body.nodeIds.length > 0 && body.nodeIds.length <= 100 && body.nodeIds.every(v => typeof v === 'string') && new Set(body.nodeIds).size === body.nodeIds.length);
    const nodeIds = body.nodeIds as string[], nodes = nodeIds.map(id => this.#node(d, id));
    for (const node of nodes) {
      requireValue(!this.approval(d, node.id), 409, 'workflow_already_approved'); requireValue(node.dependencyIds.every(id => nodeIds.includes(id) || this.approval(d, id)), 409, 'approval_dependencies_missing');
      this.callbacks.agent(node.agentInstanceId, node.agentBinding); await this.callbacks.binding(projectId, node.executionBinding);
    }
    const a: WorkflowApproval = { id: randomUUID(), projectId, revision: d.revision, nodeIds, nodes: nodes.map(node => ({ node, role: d.roles.find(r => r.id === node.roleId)!, member: d.members.find(m => m.id === node.memberId)! })), createdAt: now() };
    return () => { version(this.current(projectId), body.expectedVersion); this.store.put('workflow-approval', a.id, a); this.#bump(d); return { kind: 'workflow-approval', id: a.id }; };
  }
  #matches(task: Task, projectId: string, node: WorkflowNode) { return task.projectId === projectId && task.title === node.name && task.goal === node.goal && JSON.stringify(task.acceptanceCriteria) === JSON.stringify(node.acceptanceCriteria) && task.agentInstanceId === node.agentInstanceId && JSON.stringify(task.agentBinding) === JSON.stringify(node.agentBinding) && sameBinding(task.executionBinding, node.executionBinding); }
  async prepareLink(projectId: string, body: Body): Promise<() => Ref> {
    keys(body, ['expectedVersion', 'revision', 'nodeId', 'taskId']); const d = this.current(projectId); version(d, body.expectedVersion); this.#revision(d, body.revision);
    const node = this.#node(d, body.nodeId), a = this.approval(d, node.id); requireValue(a, 409, 'workflow_not_approved'); requireValue(!this.link(d, node.id), 409, 'workflow_task_already_linked');
    requireValue(!this.callbacks.busy(), 409, 'active_run'); this.callbacks.agent(node.agentInstanceId, node.agentBinding); await this.callbacks.binding(projectId, node.executionBinding);
    let task: Task | undefined;
    if (body.taskId !== undefined) { requireValue(typeof body.taskId === 'string'); task = this.callbacks.task(body.taskId); requireValue(!this.managed(task), 409, 'workflow_task_already_linked'); requireValue(this.#matches(task, projectId, node), 409, 'workflow_task_mismatch'); }
    return () => { version(this.current(projectId), body.expectedVersion); const t = task ?? this.callbacks.create(projectId, node); const link: WorkflowLink = { projectId, nodeId: node.id, revision: d.revision, approvalId: a.id, taskId: t.id, linkedAt: now() }; this.store.put('workflow-link', t.id, link); this.callbacks.linked(t, link); this.#bump(d); return { kind: 'task', id: t.id }; };
  }
  async #state(d: WorkflowDraft, node: WorkflowNode, cache: Map<string, WorkflowNodeState>): Promise<WorkflowNodeState> {
    const prior = cache.get(node.id); if (prior) return prior;
    const a = this.approval(d, node.id), link = this.link(d, node.id);
    const state: WorkflowNodeState = { nodeId: node.id, status: a ? 'approved' : 'draft', reason: a ? 'task_not_linked' : 'workflow_not_approved', ...(a ? { approvalId: a.id } : {}), ...(link ? { taskId: link.taskId } : {}) }; cache.set(node.id, state);
    if (!a) return state;
    const task = link ? this.callbacks.task(link.taskId) : undefined;
    const run = task?.latestRunId ? this.store.get<Run>('run', task.latestRunId) : undefined;
    const workspace = task ? this.store.get<Workspace>('workspace', task.workspaceId) : undefined;
    if (workspace?.status === 'preparing' && !run) { state.status = 'in_progress'; state.reason = 'workspace_preparing'; return state; }
    if (workspace?.status === 'needs_recovery') { state.status = run?.status === 'running' ? 'in_progress' : 'needs_recovery'; state.reason = workspace.reason ?? 'workspace_recovery_required'; return state; }
    if (workspace?.status === 'failed') { state.status = run?.status === 'running' ? 'in_progress' : run?.status === 'needs_recovery' ? 'needs_recovery' : 'blocked'; state.reason = workspace.reason ?? 'workspace_failed'; return state; }
    const blocked = (reason: string) => { state.status = run?.status === 'running' ? 'in_progress' : run?.status === 'needs_recovery' ? 'needs_recovery' : 'blocked'; state.reason = reason; return state; };
    try { this.callbacks.agent(node.agentInstanceId, node.agentBinding); await this.callbacks.binding(d.projectId, node.executionBinding); }
    catch (error) { if (!(error instanceof ApiError)) throw error; return blocked(error.code); }
    for (const id of node.dependencyIds) if ((await this.#state(d, this.#node(d, id), cache)).status !== 'completed') return blocked('workflow_dependencies_blocked');
    if (!task) return state;
    if (!this.#matches(task, d.projectId, node)) return blocked('workflow_task_mismatch');
    if (run?.status === 'needs_recovery') { state.status = 'needs_recovery'; state.reason = 'result_unknown'; return state; }
    if (run?.status === 'running') { state.status = 'in_progress'; delete state.reason; return state; }
    if (run?.status === 'succeeded') {
      state.status = 'awaiting_confirmation'; state.reason = 'user_confirmation_required'; state.acceptance = await this.callbacks.acceptance(task.id); const runLink = this.store.get<WorkflowLink>('workflow-run', run.id);
      const c = this.confirmations(d.projectId).findLast(c => c.revision === d.revision && c.nodeId === node.id && c.taskId === task.id && c.runId === run.id && c.approvalId === a.id && c.acceptanceId === state.acceptance?.acceptance?.id);
      if (c && runLink?.approvalId === a.id && state.acceptance.status === 'valid') { state.status = 'completed'; state.confirmationId = c.id; delete state.reason; }
      else if (state.acceptance.status !== 'valid') state.reason = state.acceptance.status === 'not_accepted' ? 'acceptance_required' : 'acceptance_' + state.acceptance.status;
      else if (!runLink) state.reason = 'historical_run_not_approved'; return state;
    }
    state.status = 'ready';
    state.reason = run?.status === 'failed' ? 'run_failed' : run?.status === 'aborted' ? 'run_aborted' : !workspace || workspace.status === 'unprepared' ? 'workspace_unprepared' : undefined;
    return state;
  }
  async view(projectId: string): Promise<WorkflowView> { const d = this.current(projectId), cache = new Map<string, WorkflowNodeState>(), nodeStates: WorkflowNodeState[] = []; for (const node of d.nodes) nodeStates.push(await this.#state(d, node, cache)); return { ...d, approvals: this.approvals(projectId), links: this.links(projectId), confirmations: this.confirmations(projectId), nodeStates }; }
  async assertTask(task: Task) {
    const link = this.store.get<WorkflowLink>('workflow-link', task.id); if (!link && !task.flow) return;
    requireValue(link && task.flow && task.flow.projectId === link.projectId && task.flow.nodeId === link.nodeId && task.flow.revision === link.revision && task.flow.approvalId === link.approvalId, 409, 'workflow_not_approved');
    const d = this.current(task.projectId); this.#revision(d, link.revision); const node = this.#node(d, link.nodeId), a = this.approval(d, node.id);
    requireValue(a?.id === link.approvalId && this.link(d, node.id)?.taskId === task.id, 409, 'workflow_not_approved'); requireValue(this.#matches(task, task.projectId, node) && nodeContract(a.nodes.find(n => n.node.id === node.id)!.node) === nodeContract(node), 409, 'workflow_task_mismatch'); await this.callbacks.binding(task.projectId, node.executionBinding);
    this.callbacks.agent(node.agentInstanceId, node.agentBinding);
    const cache = new Map<string, WorkflowNodeState>(); for (const id of node.dependencyIds) requireValue((await this.#state(d, this.#node(d, id), cache)).status === 'completed', 409, 'workflow_dependencies_blocked');
  }
  recordRun(task: Task, run: Run) { const link = this.store.get<WorkflowLink>('workflow-link', task.id); if (link) this.store.put('workflow-run', run.id, link); }
  async prepareConfirmation(projectId: string, body: Body): Promise<() => Ref> {
    keys(body, ['expectedVersion', 'revision', 'nodeId', 'acceptanceId']); const d = this.current(projectId); version(d, body.expectedVersion); this.#revision(d, body.revision); requireValue(typeof body.acceptanceId === 'string'); requireValue(!this.callbacks.busy(), 409, 'active_run');
    const node = this.#node(d, body.nodeId), link = this.link(d, node.id); requireValue(link, 409, 'workflow_not_approved'); const task = this.callbacks.task(link.taskId); await this.assertTask(task); const summary = await this.callbacks.acceptance(task.id), run = task.latestRunId ? this.store.get<Run>('run', task.latestRunId) : undefined;
    requireValue(run?.status === 'succeeded' && summary.status === 'valid' && summary.acceptance?.id === body.acceptanceId && this.store.get<WorkflowLink>('workflow-run', run.id)?.approvalId === link.approvalId, 409, 'workflow_confirmation_stale'); const c: WorkflowConfirmation = { ...link, id: randomUUID(), runId: run.id, acceptanceId: body.acceptanceId, confirmedAt: now() };
    return () => { version(this.current(projectId), body.expectedVersion); this.store.put('workflow-confirmation', c.id, c); this.#bump(d); return { kind: 'workflow-confirmation', id: c.id }; };
  }
}

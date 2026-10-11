import { requireValue } from './errors.ts';
import type { AgentBinding, TaskExecutionBinding, WorkflowNode, WorkflowDraft } from './types.ts';
export type { WorkflowRole, WorkflowMember, WorkflowNode, WorkflowDraft } from './types.ts';

function object(value: unknown, keys: string[]): Record<string, unknown> {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value));
  const result = value as Record<string, unknown>;
  requireValue(Object.keys(result).every(key => keys.includes(key)));
  return result;
}
function text(value: unknown, max: number): string {
  requireValue(typeof value === 'string' && value.trim().length > 0 && value.length <= max);
  return value;
}
function id(value: unknown): string { const result = text(value, 80); requireValue(/^[a-zA-Z0-9_-]+$/.test(result)); return result; }
function instance(value: unknown): string { return id(value); }
function agentBinding(value: unknown): AgentBinding {
  const entry = object(value, ['instanceId', 'revision', 'configurationId']);
  requireValue(Number.isSafeInteger(entry.revision) && (entry.revision as number) > 0);
  return { instanceId: instance(entry.instanceId), revision: entry.revision as number, configurationId: text(entry.configurationId, 100) };
}
function list<T>(value: unknown, parse: (entry: unknown) => T): T[] { requireValue(Array.isArray(value) && value.length <= 100); return value.map(parse); }
function unique(values: string[]) { requireValue(new Set(values).size === values.length); }
function binding(value: unknown): TaskExecutionBinding {
  const entry = object(value, ['id', 'revision', 'grantId', 'baselineCommit']);
  requireValue(Number.isSafeInteger(entry.revision) && (entry.revision as number) > 0);
  const baselineCommit = text(entry.baselineCommit, 64);
  requireValue(/^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/.test(baselineCommit));
  return { id: text(entry.id, 80), revision: entry.revision as number, grantId: id(entry.grantId), baselineCommit };
}
function acyclic(nodes: WorkflowNode[], edges: (node: WorkflowNode) => string[]) {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const active = new Set<string>(), done = new Set<string>();
  function visit(node: WorkflowNode) {
    requireValue(!active.has(node.id), 422, 'workflow_cycle');
    if (done.has(node.id)) return;
    active.add(node.id);
    for (const target of edges(node)) visit(byId.get(target)!);
    active.delete(node.id); done.add(node.id);
  }
  nodes.forEach(visit);
}

export function validateWorkflow(body: Record<string, unknown>): Pick<WorkflowDraft, 'roles' | 'members' | 'ownerMemberId' | 'nodes'> {
  object(body, ['expectedVersion', 'roles', 'members', 'ownerMemberId', 'nodes']);
  requireValue(Number.isSafeInteger(body.expectedVersion) && (body.expectedVersion as number) >= 0);
  const roles = list(body.roles, value => {
    const entry = object(value, ['id', 'name', 'responsibility', 'defaultAgentInstanceId']);
    return { id: id(entry.id), name: text(entry.name, 200), responsibility: text(entry.responsibility, 64000), defaultAgentInstanceId: instance(entry.defaultAgentInstanceId) };
  });
  const members = list(body.members, value => {
    const entry = object(value, ['id', 'name', 'roleId', 'agentInstanceId']);
    return { id: id(entry.id), name: text(entry.name, 200), roleId: id(entry.roleId), agentInstanceId: instance(entry.agentInstanceId) };
  });
  const nodes = list(body.nodes, value => {
    const entry = object(value, ['id', 'name', 'goal', 'acceptanceCriteria', 'roleId', 'memberId', 'agentInstanceId', 'agentBinding', 'parentId', 'dependencyIds', 'executionBinding']);
    requireValue(Array.isArray(entry.acceptanceCriteria) && entry.acceptanceCriteria.length > 0 && entry.acceptanceCriteria.length <= 50);
    const dependencyIds = list(entry.dependencyIds, id); unique(dependencyIds);
    return { id: id(entry.id), name: text(entry.name, 200), goal: text(entry.goal, 64000), acceptanceCriteria: entry.acceptanceCriteria.map(value => text(value, 2000)), roleId: id(entry.roleId), memberId: id(entry.memberId), agentInstanceId: instance(entry.agentInstanceId), ...(entry.agentBinding !== undefined ? { agentBinding: agentBinding(entry.agentBinding) } : {}), ...(Object.hasOwn(entry, 'parentId') ? { parentId: id(entry.parentId) } : {}), dependencyIds, executionBinding: binding(entry.executionBinding) };
  });
  unique(roles.map(role => role.id)); unique(members.map(member => member.id)); unique(nodes.map(node => node.id));
  const ownerMemberId = body.ownerMemberId === null ? null : id(body.ownerMemberId);
  const roleIds = new Set(roles.map(role => role.id)), memberMap = new Map(members.map(member => [member.id, member])), nodeIds = new Set(nodes.map(node => node.id));
  const reference = (condition: unknown) => requireValue(condition, 422, 'workflow_invalid_reference');
  reference(ownerMemberId === null || memberMap.has(ownerMemberId));
  for (const member of members) reference(roleIds.has(member.roleId));
  for (const node of nodes) {
    const member = memberMap.get(node.memberId);
    reference(roleIds.has(node.roleId) && member && member.roleId === node.roleId && member.agentInstanceId === node.agentInstanceId);
    reference(node.parentId === undefined || nodeIds.has(node.parentId));
    reference(node.dependencyIds.every(target => nodeIds.has(target)));
  }
  acyclic(nodes, node => node.parentId === undefined ? [] : [node.parentId]);
  acyclic(nodes, node => node.dependencyIds);
  return { roles, members, ownerMemberId, nodes };
}

/** Stable execution contract; grouping does not create execution dependencies. */
export function nodeContract(node: WorkflowNode): string {
  const { id, revision, grantId, baselineCommit } = node.executionBinding;
  return JSON.stringify([node.name, node.goal, node.acceptanceCriteria, node.roleId, node.memberId, node.agentInstanceId, node.agentBinding ? [node.agentBinding.instanceId, node.agentBinding.revision, node.agentBinding.configurationId] : null, { id, revision, grantId, baselineCommit }, [...node.dependencyIds].sort()]);
}
export function affectedNodes(previous: WorkflowNode[], next: WorkflowNode[]): string[] {
  const before = new Map(previous.map(node => [node.id, node])), after = new Map(next.map(node => [node.id, node]));
  const affected = new Set<string>();
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const oldNode = before.get(id), newNode = after.get(id);
    if (!oldNode || !newNode || nodeContract(oldNode) !== nodeContract(newNode) || oldNode.parentId !== newNode.parentId) affected.add(id);
  }
  const successors = new Map<string, Set<string>>();
  for (const node of [...previous, ...next]) for (const dependency of node.dependencyIds) {
    if (!successors.has(dependency)) successors.set(dependency, new Set());
    successors.get(dependency)!.add(node.id);
  }
  const queue = [...affected];
  for (let index = 0; index < queue.length; index++) for (const successor of successors.get(queue[index]) ?? []) if (!affected.has(successor)) { affected.add(successor); queue.push(successor); }
  return [...affected].sort();
}

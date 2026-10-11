import test from 'node:test';
import assert from 'node:assert/strict';
import { validateWorkflow, affectedNodes, nodeContract } from '../src/backend/workflow.ts';

const binding = { id: 'binding', revision: 1, grantId: 'grant', baselineCommit: 'a'.repeat(40) };
const node = (id: string, dependencyIds: string[] = []) => ({ id, name: id, goal: 'goal', acceptanceCriteria: ['done'], roleId: 'role', memberId: 'member', agentInstanceId: 'codex-local', dependencyIds, executionBinding: binding });
const draft = () => ({ expectedVersion: 0, roles: [{ id: 'role', name: 'Developer', responsibility: 'Build', defaultAgentInstanceId: 'codex-local' }], members: [{ id: 'member', name: 'Codex', roleId: 'role', agentInstanceId: 'codex-local' }], ownerMemberId: 'member', nodes: [node('a'), node('b', ['a'])] });
const rejects = (body: Record<string, unknown>, code = 'invalid_input') => assert.throws(() => validateWorkflow(body), { code });

test('validates explicit graph and permits grouping independent of dependencies', () => {
  const body = draft();
  body.nodes = [{ ...node('a'), parentId: 'b' } as ReturnType<typeof node>, node('b', ['a'])];
  assert.equal(validateWorkflow(body).nodes.length, 2);
  assert.deepEqual(validateWorkflow({ expectedVersion: 0, roles: [], members: [], ownerMemberId: null, nodes: [] }).nodes, []);
});
test('rejects unknown fields, malformed binding, limits and duplicate identifiers', () => {
  rejects({ ...draft(), extra: true });
  rejects({ ...draft(), expectedVersion: -1 });
  for (const change of [{ extra: true }, { name: '' }, { goal: 'x'.repeat(64001) }, { acceptanceCriteria: [] }, { dependencyIds: ['a', 'a'] }, { executionBinding: { ...binding, extra: true } }, { executionBinding: { ...binding, baselineCommit: 'abc' } }, { executionBinding: { ...binding, revision: 0 } }]) rejects({ ...draft(), nodes: [{ ...node('b'), ...change }] });
  rejects({ ...draft(), nodes: [node('a'), node('a')] });
  rejects({ ...draft(), roles: Array.from({ length: 101 }, (_, i) => ({ ...draft().roles[0], id: `r${i}` })) });
});
test('rejects dangling references and role/member or instance mismatch', () => {
  for (const change of [{ roleId: 'foreign' }, { memberId: 'foreign' }, { parentId: 'foreign' }, { dependencyIds: ['foreign'] }, { agentInstanceId: 'claude-local' }]) rejects({ ...draft(), nodes: [{ ...node('a'), ...change }] }, 'workflow_invalid_reference');
  rejects({ ...draft(), ownerMemberId: 'foreign' }, 'workflow_invalid_reference');
  rejects({ ...draft(), members: [{ ...draft().members[0], roleId: 'foreign' }] }, 'workflow_invalid_reference');
});
test('rejects tree and dependency cycles independently including self references', () => {
  for (const nodes of [[node('a', ['a'])], [node('a', ['b']), node('b', ['a'])], [{ ...node('a'), parentId: 'a' }], [{ ...node('a'), parentId: 'b' }, { ...node('b'), parentId: 'a' }]]) rejects({ ...draft(), nodes }, 'workflow_cycle');
});
test('affected nodes use old and new successor closure without hierarchy edges', () => {
  const previous = [node('a'), node('b', ['a']), node('c', ['b']), { ...node('group'), parentId: 'a' }];
  const next = [node('b'), node('c', ['b']), { ...node('group'), parentId: 'a' }];
  assert.deepEqual(affectedNodes(previous, next), ['a', 'b', 'c']);
  assert.deepEqual(affectedNodes([node('c', ['a', 'b'])], [node('c', ['b', 'a'])]), []);
  assert.notEqual(nodeContract(node('a')), nodeContract({ ...node('a'), goal: 'changed' }));
  assert.equal(nodeContract(node('a')), nodeContract({ ...node('a'), parentId: 'group' }));
});

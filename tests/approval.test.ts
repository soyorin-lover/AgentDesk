import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { samplePatchAllowed } from '../src/codex/approval.ts';
const cwd = process.cwd();
const request = { method: 'item/fileChange/requestApproval', params: { threadId: 't', turnId: 'r', itemId: 'p' } };
const proposed = { threadId: 't', turnId: 'r', itemId: 'p', changes: [{ path: join(cwd, 'sample.txt'), kind: { type: 'update', move_path: null } }] };
test('approval permits only the exact correlated sample update', () => {
  assert.equal(samplePatchAllowed(request, proposed, 't', cwd), true);
  assert.equal(samplePatchAllowed(request, { ...proposed, turnId: 'other' }, 't', cwd), false);
  assert.equal(samplePatchAllowed(request, undefined, 't', cwd), false);
  assert.equal(samplePatchAllowed({ ...request, params: { ...request.params, grantRoot: cwd } }, proposed, 't', cwd), false);
});
test('approval rejects rename, traversal, deletion, and additional file changes', () => {
  for (const changes of [
    [{ path: 'sample.txt', kind: { type: 'update', move_path: '../outside.txt' } }],
    [{ path: '../sample.txt', kind: { type: 'update' } }],
    [{ path: 'sample.txt', kind: { type: 'delete' } }],
    [...proposed.changes, { path: 'other.txt', kind: { type: 'update' } }],
  ]) assert.equal(samplePatchAllowed(request, { ...proposed, changes }, 't', cwd), false);
});

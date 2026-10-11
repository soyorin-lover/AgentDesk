import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/backend/store.ts';

test('SQLite restart preserves records and ordered events; failed transaction rolls back both', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'agentdesk-store-')), 'state.sqlite');
  let s = new Store(path);
  s.transaction(() => { s.put('task', 't', { id: 't', status: 'ready' }); s.append('t', 'task.created', { status: 'ready' }); });
  assert.throws(() => s.transaction(() => { s.put('task', 't', { status: 'wrong' }); s.append('t', 'wrong', {}); throw Error('rollback'); }));
  s.close(); s = new Store(path);
  try {
    assert.equal(s.get<any>('task', 't')?.status, 'ready');
    assert.deepEqual(s.events('t', 0, 50).map(e => [e.seq, e.type]), [[1, 'task.created']]);
    s.append('t', 'task.updated', {});
    assert.deepEqual(s.events('t', 1, 50).map(e => e.seq), [2]);
  } finally { s.close(); }
});

test('database lock refuses a second live owner and is released on close', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'agentdesk-lock-')), 'state.sqlite');
  const first = new Store(path);
  try { assert.throws(() => new Store(path), /locked/); } finally { first.close(); }
  new Store(path).close();
});

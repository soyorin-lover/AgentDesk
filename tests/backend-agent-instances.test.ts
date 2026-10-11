import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/backend/store.ts';
import { AgentInstances } from '../src/backend/agent-instances.ts';
import type { EngineAdapter } from '../src/backend/types.ts';
const adapter = (configurationIdentity?: string): EngineAdapter => ({ configurationIdentity, start: async () => { throw Error('never execute'); } });
function fixture(fn: (path: string) => void) { const dir = mkdtempSync(join(tmpdir(), 'agent-instances-')); try { fn(join(dir, 'store.sqlite')); } finally { try { rmSync(dir, { recursive: true, force: true }); } catch { /* Preserve the original assertion if SQLite is still open. */ } } }
test('registry keeps immutable revisions across restart, drift and restoration', () => fixture(path => {
  let store = new Store(path);
  let registry = AgentInstances.open(store, adapter('secret-A'));
  const first = registry.binding('codex-local');
  assert.equal(first.revision, 1);
  assert.equal(registry.assert(first).engineId, 'codex');
  assert.ok(!JSON.stringify(registry.list()).includes('secret-A'));
  store.close(); store = new Store(path);
  registry = AgentInstances.open(store, adapter('secret-A'));
  assert.deepEqual(registry.binding('codex-local'), first);
  registry = AgentInstances.open(store, adapter('secret-B'));
  assert.equal(registry.binding('codex-local').revision, 2);
  assert.throws(() => registry.assert(first), /agent_configuration_changed/);
  registry = AgentInstances.open(store, adapter('secret-A'));
  assert.equal(registry.binding('codex-local').revision, 3);
  assert.equal(registry.assert(first).engineId, 'codex');
  assert.throws(() => registry.assert(undefined), /agent_configuration_unproven/);
  assert.throws(() => registry.assert({ ...registry.binding('codex-local'), configurationId: 'forged' }), /agent_configuration_unproven/);
  store.close();
}));
test('runtime object identity proves only the same adapter and isolates instances', () => fixture(path => {
  const store = new Store(path); const a = adapter(); const b = adapter();
  let registry = AgentInstances.open(store, a, [{ id: 'second', name: 'Second', engineId: 'codex', adapter: b }], 'deterministic');
  const first = registry.binding('codex-local'); const second = registry.binding('second');
  assert.equal(registry.assert(second).adapter, b);
  assert.throws(() => registry.assert(second, 'codex-local'), /agent_instance_mismatch/);
  registry = AgentInstances.open(store, a);
  assert.deepEqual(registry.binding('codex-local'), first);
  assert.equal(registry.get('second').available, false);
  assert.throws(() => registry.assert(second), /agent_instance_unavailable/);
  registry = AgentInstances.open(store, adapter());
  assert.throws(() => registry.assert(first), /agent_configuration_changed/);
  store.close();
}));
test('reserved placeholders, capability evidence and malformed registration', () => fixture(path => {
  const store = new Store(path); const a = adapter('trusted'); const registry = AgentInstances.open(store, a);
  for (const id of ['claude-local', 'deepseek-local']) { assert.equal(registry.get(id).available, false); assert.throws(() => registry.binding(id), /agent_instance_unavailable/); }
  const codex = registry.get('codex-local'); assert.deepEqual(codex.health, { login: 'unknown', quota: 'unknown', online: 'unknown' });
  assert.deepEqual(codex.capabilities.map(c => c.businessSupport), ['implemented', 'implemented', 'implemented', 'unsupported', 'unsupported']);
  for (const id of ['codex-local', 'claude-local', 'deepseek-local', '../bad', 'x'.repeat(65)]) assert.throws(() => AgentInstances.open(store, a, [{ id, name: 'bad', engineId: 'codex', adapter: a }]));
  assert.throws(() => AgentInstances.open(store, a, [{ id: 'same', name: 'a', engineId: 'codex', adapter: a }, { id: 'same', name: 'b', engineId: 'codex', adapter: a }]));
  assert.throws(() => AgentInstances.open(store, a, [{ id: 'other', name: 'Other', engineId: 'claude_code', adapter: a }]));
  const unsupported = AgentInstances.open(store, a, [{ id: 'other', name: 'Other', engineId: 'claude_code' }]);
  assert.equal(unsupported.get('other').available, false);
  assert.throws(() => unsupported.binding('other'), /agent_instance_unavailable/);
  codex.name = 'mutated'; assert.notEqual(registry.get('codex-local').name, 'mutated');
  store.close();
}));




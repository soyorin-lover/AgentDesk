import { createHash, randomUUID } from 'node:crypto';
import { ApiError, requireValue } from './errors.ts';
import type { Store } from './store.ts';
import type { AgentBinding, AgentCapability, AgentInstance, AgentInstanceRegistration, EngineAdapter } from './types.ts';

const objectIdentities = new WeakMap<EngineAdapter, string>();
const safeId = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
type PersistedInstance = { id: string; name: string; engineId: string; binding?: AgentBinding; configuredModel?: string; identityEvidence: AgentInstance['identityEvidence'] };
type Revision = AgentBinding & { fingerprint: string };
function identity(adapter: EngineAdapter): { fingerprint: string; evidence: AgentInstance['identityEvidence'] } {
  const configured = adapter.configurationIdentity;
  if (typeof configured === 'string' && configured.length > 0) return { fingerprint: createHash('sha256').update(configured).digest('hex'), evidence: 'adapter_config' };
  let token = objectIdentities.get(adapter);
  if (!token) { token = randomUUID(); objectIdentities.set(adapter, token); }
  return { fingerprint: createHash('sha256').update(token).digest('hex'), evidence: 'runtime_object' };
}
function capabilities(executable: boolean): AgentCapability[] {
  return (['start', 'continue', 'interrupt', 'approval', 'recovery'] as const).map(name => ({ name, businessSupport: executable && ['start', 'continue', 'interrupt'].includes(name) ? 'implemented' : 'unsupported', protocolSupport: executable ? 'implemented' : 'not_integrated', verification: executable && ['start', 'continue', 'interrupt'].includes(name) ? 'fixture_verified' : 'unverified', evidenceRef: executable ? 'tests/backend-agent-instances.test.ts;tests/backend-adapter.test.ts' : 'not_integrated' }));
}
export class AgentInstances {
  #store: Store;
  #instances = new Map<string, AgentInstance>();
  #adapters = new Map<string, EngineAdapter>();
  private constructor(store: Store) { this.#store = store; }
  static open(store: Store, defaultAdapter: EngineAdapter, registrations: AgentInstanceRegistration[] = [], mode: 'codex' | 'deterministic' = 'codex'): AgentInstances {
    requireValue(defaultAdapter && typeof defaultAdapter.start === 'function', 400, 'invalid_agent_registration');
    requireValue(Array.isArray(registrations) && ['codex', 'deterministic'].includes(mode), 400, 'invalid_agent_registration');
    const entries: AgentInstanceRegistration[] = [{ id: 'codex-local', name: mode === 'deterministic' ? 'Codex (deterministic)' : 'Codex', engineId: 'codex', adapter: defaultAdapter }, { id: 'claude-local', name: 'Claude', engineId: 'claude_code' }, { id: 'deepseek-local', name: 'DeepSeek', engineId: 'deepseek_harness' }];
    const ids = new Set(entries.map(entry => entry.id));
    for (const entry of registrations) {
      requireValue(entry && typeof entry.id === 'string' && safeId.test(entry.id) && !ids.has(entry.id), 400, 'invalid_agent_registration');
      requireValue(typeof entry.name === 'string' && entry.name.trim().length > 0 && entry.name.length <= 200 && ['codex', 'claude_code', 'deepseek_harness'].includes(entry.engineId), 400, 'invalid_agent_registration');
      requireValue(entry.adapter === undefined || (entry.adapter && typeof entry.adapter.start === 'function'), 400, 'invalid_agent_registration');
      requireValue(entry.configuredModel === undefined || (typeof entry.configuredModel === 'string' && entry.configuredModel.length > 0 && entry.configuredModel.length <= 200), 400, 'invalid_agent_registration');
      requireValue(entry.adapter === undefined || (entry.engineId === 'codex' && (!entry.adapter.engineId || entry.adapter.engineId === 'codex')) || (entry.engineId === 'claude_code' && entry.adapter.engineId === 'claude_code' && entry.adapter.capabilities !== undefined), 400, 'invalid_agent_registration');
      ids.add(entry.id); entries.push(entry);
    }
    const registry = new AgentInstances(store);
    store.transaction(() => {
      for (const prior of store.list<PersistedInstance>('agent_instance')) registry.#instances.set(prior.id, registry.#view(prior, false, 'agent_instance_removed'));
      for (const entry of entries) {
        const executable = ['codex', 'claude_code'].includes(entry.engineId) && !!entry.adapter;
        const prior = store.get<PersistedInstance>('agent_instance', entry.id);
        let binding = prior?.binding;
        let evidence: AgentInstance['identityEvidence'] = 'not_integrated';
        if (executable) {
          const proof = identity(entry.adapter!); evidence = proof.evidence;
          const previousRevision = binding && store.get<Revision>('agent_configuration', `${entry.id}:${binding.revision}`);
          if (!previousRevision || previousRevision.fingerprint !== proof.fingerprint) {
            binding = { instanceId: entry.id, revision: (binding?.revision ?? 0) + 1, configurationId: randomUUID() };
            store.put('agent_configuration', `${entry.id}:${binding.revision}`, { ...binding, fingerprint: proof.fingerprint });
          }
          registry.#adapters.set(entry.id, entry.adapter!);
        }
        const saved: PersistedInstance = { id: entry.id, name: entry.name, engineId: entry.engineId, binding, identityEvidence: evidence, configuredModel: entry.configuredModel ?? entry.adapter?.configuredModel };
        store.put('agent_instance', entry.id, saved);
        registry.#instances.set(entry.id, registry.#view(saved, executable, executable ? undefined : 'agent_engine_not_integrated'));
      }
    });
    return registry;
  }
  #view(entry: PersistedInstance, available: boolean, reason?: string): AgentInstance {
    return { ...entry, available, reason, health: { login: 'unknown', quota: 'unknown', online: 'unknown' }, capabilities: this.#adapters.get(entry.id)?.capabilities ?? capabilities(available) };
  }
  list(): AgentInstance[] { return structuredClone([...this.#instances.values()]); }
  get(id: string): AgentInstance {
    const instance = this.#instances.get(id);
    if (!instance) throw new ApiError(404, 'agent_instance_not_found');
    return structuredClone(instance);
  }
  binding(id: string): AgentBinding {
    const instance = this.get(id);
    if (!instance.available || !instance.binding) throw new ApiError(409, 'agent_instance_unavailable');
    return instance.binding;
  }
  assert(binding: AgentBinding | undefined, instanceId?: string): { adapter: EngineAdapter; engineId: string } {
    if (!binding || typeof binding.instanceId !== 'string' || !Number.isSafeInteger(binding.revision) || binding.revision < 1 || typeof binding.configurationId !== 'string') throw new ApiError(409, 'agent_configuration_unproven');
    if (instanceId !== undefined && instanceId !== binding.instanceId) throw new ApiError(409, 'agent_instance_mismatch');
    const instance = this.#instances.get(binding.instanceId);
    const adapter = this.#adapters.get(binding.instanceId);
    if (!instance?.available || !adapter) throw new ApiError(409, 'agent_instance_unavailable');
    const revision = this.#store.get<Revision>('agent_configuration', `${binding.instanceId}:${binding.revision}`);
    if (!revision || revision.configurationId !== binding.configurationId || revision.instanceId !== binding.instanceId || revision.revision !== binding.revision) throw new ApiError(409, 'agent_configuration_unproven');
    const current = this.#store.get<PersistedInstance>('agent_instance', binding.instanceId)?.binding;
    const currentRevision = current && this.#store.get<Revision>('agent_configuration', binding.instanceId + ':' + current.revision);
    if (!current || !currentRevision || currentRevision.configurationId !== current.configurationId || currentRevision.fingerprint !== revision.fingerprint || revision.fingerprint !== identity(adapter).fingerprint) throw new ApiError(409, 'agent_configuration_changed');
    return { adapter, engineId: instance.engineId };
  }
}




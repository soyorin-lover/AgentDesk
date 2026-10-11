import { randomUUID } from 'node:crypto';
import { ProjectRegistry, within } from './projects.ts';
import { requireValue, ApiError } from './errors.ts';
import type { Store } from './store.ts';
import type { ExecutionGrantConfig, ExecutionBinding, Task, TaskExecutionBinding, RepositoryAssociation, BindingStatus } from './types.ts';
import { isAbsolute } from 'node:path';

type StoredBinding = { binding: ExecutionBinding; sourceIdentity: string; workspaceRoot: string; workspaceRootIdentity: string; checkPresetIds: string[] };
type Grant = { registry?: ProjectRegistry; name: string; reason?: string; checkPresetIds: string[] };

/** Local configuration grants authority. Bindings and task references never widen it. */
export class ExecutionBindings {
  #store: Store;
  #grants = new Map<string, Grant>();
  readonly primary: ProjectRegistry;
  private constructor(store: Store, primary: ProjectRegistry) { this.#store = store; this.primary = primary; }
  static async open(store: Store, primary: ProjectRegistry, configs: ExecutionGrantConfig[], main: string, presetIds: string[]) {
    requireValue(Array.isArray(configs), 422, 'invalid_configuration');
    const result = new ExecutionBindings(store, primary);
    result.#grants.set(primary.project.id, { registry: primary, name: primary.project.name, checkPresetIds: presetIds });
    for (const config of configs) {
      requireValue(config && Object.keys(config).every(k => ['id', 'name', 'path', 'workspaceRoot', 'checkPresetIds'].includes(k)) && typeof config.id === 'string' && !result.#grants.has(config.id), 422, 'invalid_configuration');
      requireValue(/^[a-zA-Z0-9_-]{1,80}$/.test(config.id) && typeof config.name === 'string' && config.name.trim().length > 0 && config.name.length <= 200 && typeof config.path === 'string' && isAbsolute(config.path) && typeof config.workspaceRoot === 'string' && isAbsolute(config.workspaceRoot), 422, 'invalid_configuration');
      const ids = config.checkPresetIds ?? presetIds;
      requireValue(Array.isArray(ids) && new Set(ids).size === ids.length && ids.every(id => typeof id === 'string' && presetIds.includes(id)), 422, 'invalid_configuration');
      const saved = store.get<{ identity: string; workspaceRoot: string; workspaceRootIdentity: string; checkPresetIds: string[] }>('private', 'execution-grant:' + config.id);
      let registry: ProjectRegistry;
      try { registry = await ProjectRegistry.authorized(config, config.workspaceRoot, main); }
      catch (e) {
        if (!saved || /overlaps source\/main/.test(String(e))) throw e;
        result.#grants.set(config.id, { name: config.name, reason: 'grant_repository_unavailable', checkPresetIds: ids }); continue;
      }
      for (const grant of result.#grants.values()) if (grant.registry) {
        const other = grant.registry;
        requireValue(registry.identity.commonDir !== other.identity.commonDir, 422, 'conflicting_execution_grants');
        for (const a of [registry.repository.cwd, registry.workspaceRoot]) for (const b of [other.repository.cwd, other.workspaceRoot]) requireValue(!within(a, b) && !within(b, a), 422, 'conflicting_execution_grants');
      }
      if (saved && (saved.identity !== registry.identity.fingerprint || saved.workspaceRoot !== registry.workspaceRoot || saved.workspaceRootIdentity !== registry.workspaceRootIdentity || JSON.stringify(saved.checkPresetIds) !== JSON.stringify(ids))) {
        result.#grants.set(config.id, { name: config.name, reason: 'grant_configuration_changed', checkPresetIds: ids }); continue;
      }
      result.#grants.set(config.id, { registry, name: config.name, checkPresetIds: ids });
      if (!saved) store.put('private', 'execution-grant:' + config.id, { identity: registry.identity.fingerprint, workspaceRoot: registry.workspaceRoot, workspaceRootIdentity: registry.workspaceRootIdentity, checkPresetIds: ids });
    }
    return result;
  }
  registries() { return [...this.#grants.values()].flatMap(g => g.registry ? [g.registry] : []); }
  grants() { return [...this.#grants].map(([id, grant]) => ({ id, name: grant.name, available: Boolean(grant.registry), ...(grant.reason ? { reason: grant.reason } : {}) })); }
  current(projectId: string): StoredBinding | undefined {
    const ref = this.#store.get<{ id: string }>('execution-binding-current', projectId);
    return ref ? this.#store.get<StoredBinding>('execution-binding', ref.id) : undefined;
  }
  status(projectId: string): BindingStatus {
    const stored = this.current(projectId); if (!stored) return { binding: null, available: false, reason: 'execution_binding_required' };
    try { this.registryFor(stored); return { binding: stored.binding, available: true }; }
    catch { return { binding: stored.binding, available: false, reason: this.#grants.get(stored.binding.grantId)?.reason ?? 'grant_not_authorized' }; }
  }
  make(projectId: string, grantId: string, baselineCommit: string, associationInspectionId?: string): StoredBinding {
    const grant = this.#grants.get(grantId); requireValue(grant?.registry, 422, 'grant_not_authorized');
    return { binding: { id: randomUUID(), projectId, revision: (this.current(projectId)?.binding.revision ?? 0) + 1, grantId, baselineCommit, associationInspectionId, createdAt: new Date().toISOString(), uncommittedChangesIncluded: false }, sourceIdentity: grant.registry.identity.fingerprint, workspaceRoot: grant.registry.workspaceRoot, workspaceRootIdentity: grant.registry.workspaceRootIdentity, checkPresetIds: [...grant.checkPresetIds] };
  }
  save(stored: StoredBinding, current = true) { this.#store.put('execution-binding', stored.binding.id, stored); if (current) this.#store.put('execution-binding-current', stored.binding.projectId, { id: stored.binding.id }); }
  reference(stored: StoredBinding): TaskExecutionBinding { const { id, revision, grantId, baselineCommit } = stored.binding; return { id, revision, grantId, baselineCommit }; }
  storedFor(task: Task): StoredBinding {
    const ref = task.executionBinding;
    const stored = ref ? this.#store.get<StoredBinding>('execution-binding', ref.id) : undefined;
    requireValue(stored && stored.binding.projectId === task.projectId && JSON.stringify(this.reference(stored)) === JSON.stringify(ref), 409, 'execution_binding_unavailable');
    return stored;
  }
  registryFor(stored: StoredBinding): ProjectRegistry {
    const grant = this.#grants.get(stored.binding.grantId), registry = grant?.registry;
    requireValue(registry && registry.identity.fingerprint === stored.sourceIdentity && registry.workspaceRoot === stored.workspaceRoot && registry.workspaceRootIdentity === stored.workspaceRootIdentity && JSON.stringify(grant.checkPresetIds) === JSON.stringify(stored.checkPresetIds), 409, 'execution_binding_unavailable');
    return registry;
  }
  async validate(stored: StoredBinding) {
    const registry = this.registryFor(stored);
    try { await registry.assertSource(stored.binding.baselineCommit); }
    catch { throw new ApiError(409, 'execution_binding_unavailable'); }
    return registry;
  }
  async grantForAssociation(grantId: string, association: RepositoryAssociation) {
    const grant = this.#grants.get(grantId); requireValue(grant?.registry, 422, 'grant_not_authorized');
    const registry = grant.registry;
    requireValue(registry.identity.cwd === association.repository.path && registry.identity.gitDir === association.repository.gitDir && registry.identity.commonDir === association.repository.commonDir, 422, 'grant_repository_mismatch');
    try { await registry.assertSource(association.baselineCommit); } catch { throw new ApiError(409, 'execution_binding_unavailable'); }
  }
  checkPresetIds(task: Task) { const stored = this.storedFor(task); this.registryFor(stored); return stored.checkPresetIds; }
}

import { randomUUID, createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { Store, acquireLease } from './store.ts';
import { inspectRepository, workspaceLeasePath, captureChanges } from './repository.ts';
import { ApiError, requireValue } from './errors.ts';
import { ProjectRegistry } from './projects.ts';
import { ExecutionBindings } from './execution-bindings.ts';
import { Workflows } from './workflow-service.ts';
import { AgentInstances } from './agent-instances.ts';
import type { AgentBinding, AgentInstanceRegistration, NativeSession } from './types.ts';
import type { WorkflowDraft, WorkflowApproval, WorkflowConfirmation, TaskExecutionBinding } from './types.ts';
import type { ExecutionGrantConfig, ExecutionBinding, BindingStatus } from './types.ts';
import { inspectImportRepository } from './repository-import.ts';
import type { ProjectSpace, ProjectDetail, RepositoryInspection, RepositoryAssociation } from './types.ts';
import { validatePresets, presetAvailable, executeCheck } from './checks.ts';
import { attentionItems } from './queries.ts';
import type { AcceptanceSummary, AttentionPage, Overview, RecoveryItem } from './types.ts';
import type { ProjectConfig, Workspace, StoredWorkspace, CheckPreset, CheckRun, CheckSummary } from './types.ts';
import type { Task, Run, Repository, Snapshot, Acceptance, EngineAdapter, Execution, AdapterEvent } from './types.ts';
type Body = Record<string, unknown>;
type Ref = { kind: string; id: string };
type Options = { workspace?: string; projects?: ProjectConfig[]; workspaceRoot?: string; executionGrants?: ExecutionGrantConfig[]; checkPresets?: CheckPreset[]; checkExecutor?: typeof executeCheck; database: string; mainProject: string; adapter: EngineAdapter; agentInstances?: AgentInstanceRegistration[]; executionMode?: 'codex' | 'deterministic' };
type CheckExit = { taskId: string; runId: string; snapshotId: string; contentDigest: string; result: Awaited<ReturnType<typeof executeCheck>['result']>; confirmedAt: string };
const now = () => new Date().toISOString();
const active = (r: Run) => r.status === 'running' || r.status === 'needs_recovery';
function keys(body: Body, allowed: string[]) { requireValue(body && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).every(k => allowed.includes(k))); }
function text(value: unknown, max = 64000): value is string { return typeof value === 'string' && value.trim().length > 0 && value.length <= max; }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
  return JSON.stringify(value);
}

export class BackendService {
  #store: Store;
  #repo: Repository;
  #agents!: AgentInstances;
  #release: () => void;
  #queue: Promise<unknown> = Promise.resolve();
  #workers = new Set<Promise<void>>();
  #executions = new Map<string, Execution>();
  #closing = false;
  #fault = false;
  #closed?: Promise<void>;
  #leasePath: string;
  #projects?: ProjectRegistry;
  #bindings?: ExecutionBindings;
  #flows: Workflows;
  #workspaceLeases = new Map<string, { path: string; release: () => void }>();
  #presets: CheckPreset[] = [];
  #checkExecutions = new Map<string, ReturnType<typeof executeCheck>>();
  #checkExecutor = executeCheck;
  #retainLeases = new Set<string>();
  #executionMode: 'codex' | 'deterministic' = 'codex';
  private constructor(store: Store, repo: Repository, adapter: EngineAdapter, release: () => void, leasePath: string) {
    this.#store = store; this.#repo = repo; this.#release = release;
    this.#leasePath = leasePath;
    this.#flows = new Workflows(store, {
      project: id => this.project(id), task: id => this.task(id), acceptance: id => this.#acceptanceSummary(id), busy: () => this.#busy() || this.#store.list<Workspace>('workspace').some(w => w.status === 'preparing'),
      binding: (projectId, binding) => this.#flowBinding(projectId, binding),
      agent: (id, binding, capture) => {
        const instance = this.#agents.get(id);
        if (capture) return instance.available ? this.#agents.binding(id) : undefined;
        requireValue(instance.available, 422, 'engine_not_integrated');
        this.#agents.assert(binding, id); return binding;
      },
      create: (projectId, node) => {
        const task: Task = { schemaVersion: 1, id: randomUUID(), projectId, workspaceId: randomUUID(), title: node.name, goal: node.goal, acceptanceCriteria: node.acceptanceCriteria, agentInstanceId: node.agentInstanceId, agentBinding: node.agentBinding, executionBinding: node.executionBinding, status: 'ready', version: 1, createdAt: now() };
        this.#taskEvent(task, 'task.created'); return task;
      },
      linked: (task, link) => { task.flow = { projectId: link.projectId, nodeId: link.nodeId, revision: link.revision, approvalId: link.approvalId }; task.version++; this.#taskEvent(task, 'task.workflow_linked', { ...task.flow }); },
    });
  }
  static async open(options: Options): Promise<BackendService> {
    const store = new Store(resolve(options.database));
    let release: (() => void) | undefined;
    let service: BackendService | undefined;
    try {
      requireValue(Boolean(options.workspace) !== Boolean(options.projects), 422, 'invalid_configuration');
      const projects = options.projects ? await ProjectRegistry.open(options.projects, options.workspaceRoot!, options.mainProject, store) : undefined;
      if (!projects && store.get('private', 'project')) throw Error('project database cannot be rebound to legacy mode');
      const repo = projects?.repository ?? await inspectRepository(options.workspace!, options.mainProject, store.get<Repository>('private', 'repository'));
      const leasePath = await workspaceLeasePath(repo);
      release = acquireLease(leasePath);
      try { await readFile(leasePath + '.quarantine'); throw Error('workspace_quarantined: owned process exit unconfirmed'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (!projects) store.put('private', 'repository', repo);
      service = new BackendService(store, repo, options.adapter, release, leasePath);
      service.#projects = projects;
      // Additive document migration: keep historical task IDs and private execution bindings.
      const configured = projects?.project ?? { id: 'local-project', name: '专用测试项目' };
      if (!store.get('project-space', configured.id)) {
        const timestamp = now();
        store.put('project-space', configured.id, { schemaVersion: 1, id: configured.id, name: configured.name, description: '', version: 1, createdAt: timestamp, updatedAt: timestamp } satisfies ProjectSpace);
      }
      requireValue(options.executionMode === undefined || ['codex', 'deterministic'].includes(options.executionMode), 422, 'invalid_configuration');
      service.#executionMode = options.executionMode ?? 'codex';
      service.#agents = AgentInstances.open(store, options.adapter, options.agentInstances, service.#executionMode);
      // Historical native IDs remain readable, but lack instance/configuration ownership proof.
      store.transaction(() => {
        for (const task of store.list<Task>('task')) {
          const old = store.get<{ id: string }>('private', 'session:' + task.id);
          if (!task.nativeSessionRef && old?.id) {
            const session: NativeSession = { id: randomUUID(), taskId: task.id, workspaceId: task.workspaceId, engineId: 'codex', nativeSessionId: old.id, ownership: 'legacy_unproven', createdAt: now() };
            store.put('native-session', session.id, session); task.nativeSessionRef = session.id; store.put('task', task.id, task);
          }
        }
      });
      service.#presets = validatePresets(options.checkPresets ?? []);
      service.#checkExecutor = options.checkExecutor ?? executeCheck;
      requireValue(projects || options.executionGrants === undefined, 422, 'invalid_configuration');
      if (projects) {
        service.#bindings = await ExecutionBindings.open(store, projects, options.executionGrants ?? [], options.mainProject, service.#presets.map(p => p.id));
        for (const registry of service.#bindings.registries()) if (registry !== projects) {
          const path = await workspaceLeasePath(registry.repository), unlock = acquireLease(path);
          try { await readFile(path + '.quarantine'); throw Error('workspace_quarantined'); }
          catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') { unlock(); throw e; } }
          service.#workspaceLeases.set('source:' + registry.project.id, { path, release: unlock });
        }
        store.transaction(() => {
          if (!service!.#bindings!.current(projects.project.id)) service!.#bindings!.save(service!.#bindings!.make(projects.project.id, projects.project.id, projects.repository.baseHead));
          for (const task of store.list<Task>('task')) if (!task.executionBinding && task.projectId === projects.project.id) {
            const workspace = store.get<Workspace>('workspace', task.workspaceId), base = workspace?.baseHead ?? projects.repository.baseHead;
            const current = service!.#bindings!.current(task.projectId)!;
            const stored = current.binding.baselineCommit === base && !current.binding.associationInspectionId ? current : service!.#bindings!.make(task.projectId, projects.project.id, base);
            if (stored !== current) service!.#bindings!.save(stored, false);
            task.executionBinding = service!.#bindings!.reference(stored); store.put('task', task.id, task);
          }
        });
      }
      for (const workspace of store.list<Workspace>('workspace')) {
        if (workspace.status === 'preparing' || workspace.status === 'ready') {
          try {
            const stored = store.get<StoredWorkspace>('private', 'workspace:' + workspace.id);
            if (!projects || !stored) throw Error('preparation_unknown');
            await (await service.#taskRegistry(service.task(workspace.taskId))).verify(stored);
            if (workspace.status === 'preparing') {
              workspace.status = 'needs_recovery'; workspace.reason = 'owned_preparation_interrupted'; store.put('workspace', workspace.id, workspace); continue;
            }
            await service.#leaseWorkspace(stored);
          } catch (error) {
            // Revocation is not an unknown preparation/identity result. Keep the proven
            // record; direct commands still validate authority before touching its files.
            if (workspace.status === 'ready' && error instanceof ApiError && error.code === 'execution_binding_unavailable') continue;
            workspace.status = 'needs_recovery'; workspace.reason = 'preparation_or_identity_unconfirmed'; store.put('workspace', workspace.id, workspace);
          }
        }
      }
      store.transaction(() => {
        for (const run of store.list<Run>('run')) {
          if (run.status === 'running') service!.#finish(run.id, 'needs_recovery', 'service_restarted');
        }
        for (const check of store.list<CheckRun>('check')) {
          if (check.status === 'running') { check.status = 'needs_recovery'; check.validity = 'stale'; check.reason = 'service_restarted'; check.version++; store.put('check', check.id, check); }
        }
      });
      return service;
    } catch (e) { if (service) for (const lease of service.#workspaceLeases.values()) lease.release(); release?.(); store.close(); throw e; }
  }
  bootstrap() {
    const projectId = this.#projects?.project.id ?? 'local-project', project = this.project(projectId);
    return { schemaVersion: 1, executionMode: this.#executionMode, mode: this.#projects ? 'project' : 'legacy', project: { id: project.id, name: project.name }, workspace: { id: this.#projects ? 'unbound' : 'local-workspace', projectId, kind: this.#projects ? 'task_worktrees' : this.#repo.kind, baseHead: this.#repo.baseHead, availability: this.#fault ? 'unavailable' : this.#projects ? 'per_task' : 'bound' }, checkPresets: this.checkPresets(),
      engines: [{ id: 'codex', integrationStatus: 'verified_probe' }, { id: 'claude_code', integrationStatus: this.#agents.list().some(i => i.engineId === 'claude_code' && i.available) ? 'fixture_verified' : 'not_integrated' }, { id: 'deepseek_harness', integrationStatus: 'not_integrated' }],
      instances: [{ id: 'codex-local', engineId: 'codex', name: this.#executionMode === 'deterministic' ? '确定性样例执行器（无模型）' : '本机 Codex', availability: this.#executionMode === 'deterministic' ? 'fixture' : 'not_probed', capabilities: ['execute', 'interrupt'].map(name => ({ name, adapterSupport: 'implemented', verification: 'unverified', evidenceRef: 'CODEX-BATCH-01-RESULTS.md: historical Windows probe only' })) }], storageHealthy: !this.#fault };
  }
  projects() { return this.#store.list<ProjectSpace>('project-space').map(({ id, name }) => ({ id, name })); }
  project(id: string): ProjectDetail {
    const project = this.#store.get<ProjectSpace>('project-space', id); requireValue(project, 404, 'not_found');
    const status = this.#bindings?.status(id), binding = status?.binding;
    const used = Boolean(binding?.associationInspectionId);
    const association = used ? this.#store.get<RepositoryAssociation>('project-repository', id) : undefined;
    const refresh = used && (association?.inspectionId !== binding!.associationInspectionId || association?.baselineCommit !== binding!.baselineCommit);
    const supported = this.#bindings ? Boolean(status?.available && !refresh) : id === 'local-project';
    return { ...project, execution: { supported, reason: refresh ? 'binding_refresh_required' : binding && !status?.available ? 'binding_unavailable' : supported ? 'trusted_configuration' : 'execution_binding_required', repositoryAssociationUsed: used } };
  }
  executionGrants() { return { items: this.#bindings?.grants() ?? [] }; }
  agentInstances() { return { items: this.#agents.list() }; }
  agentInstance(id: string) { return this.#agents.get(id); }
  taskSession(id: string): { session: NativeSession | null } {
    const task = this.task(id);
    return { session: task.nativeSessionRef ? this.#store.get<NativeSession>('native-session', task.nativeSessionRef) ?? null : null };
  }
  #sessionFor(task: Task, engineId: string, startingRunId?: string): NativeSession | undefined {
    if (!task.nativeSessionRef) {
      requireValue(!task.latestRunId || task.latestRunId === startingRunId, 409, 'native_session_unproven');
      return;
    }
    const session = this.#store.get<NativeSession>('native-session', task.nativeSessionRef);
    requireValue(session && session.ownership === 'verified' && session.taskId === task.id && session.workspaceId === task.workspaceId && session.engineId === engineId && canonical(session.agentBinding) === canonical(task.agentBinding), 409, 'native_session_unproven');
    return session;
  }
  async #flowBinding(projectId: string, binding: TaskExecutionBinding) {
    requireValue(this.#bindings, 422, 'execution_binding_unavailable');
    const stored = this.#bindings.storedFor({ projectId, executionBinding: binding } as Task);
    await this.#bindings.validate(stored);
  }
  workflow(id: string) { return this.#serialize(() => this.#flows.view(id)); }
  workflowRevisions(id: string) { return this.#flows.revisions(id); }
  saveWorkflow(id: string, body: Body, key: string): Promise<WorkflowDraft> { return this.#command('/projects/' + id + '/workflow', key, body, async () => this.#flows.prepareDraft(id, body)); }
  approveWorkflow(id: string, body: Body, key: string): Promise<WorkflowApproval> { return this.#command('/projects/' + id + '/workflow-approvals', key, body, () => this.#flows.prepareApproval(id, body)); }
  linkWorkflowTask(id: string, body: Body, key: string): Promise<Task> { return this.#command('/projects/' + id + '/workflow-tasks', key, body, () => this.#flows.prepareLink(id, body)); }
  confirmWorkflowNode(id: string, body: Body, key: string): Promise<WorkflowConfirmation> { return this.#command('/projects/' + id + '/workflow-confirmations', key, body, () => this.#flows.prepareConfirmation(id, body)); }
  async executionBinding(id: string): Promise<BindingStatus> {
    this.project(id); const status = this.#bindings?.status(id) ?? { binding: null, available: false, reason: 'execution_binding_required' };
    if (status.available) {
      try { await this.#bindings!.validate(this.#bindings!.current(id)!); }
      catch { return { ...status, available: false, reason: 'execution_binding_unavailable' }; }
      if (!this.project(id).execution.supported) return { ...status, available: false, reason: 'binding_refresh_required' };
    }
    return status;
  }
  bindProjectExecution(id: string, body: Body, key: string): Promise<ExecutionBinding> {
    return this.#command<{ binding: ExecutionBinding }>('/projects/' + id + '/execution-binding', key, body, async () => {
      keys(body, ['expectedVersion', 'grantId', 'inspectionId', 'baselineCommit', 'acknowledgeUncommittedExcluded']);
      const project = this.project(id); this.#version(project, body.expectedVersion);
      requireValue(this.#bindings, 422, 'execution_binding_required');
      requireValue(typeof body.grantId === 'string' && typeof body.inspectionId === 'string' && typeof body.baselineCommit === 'string' && body.acknowledgeUncommittedExcluded === true);
      requireValue(!this.#busy() && !this.#store.list<Workspace>('workspace').some(w => w.status === 'preparing'), 409, 'active_run');
      const association = this.projectRepository(id);
      requireValue(association && association.inspectionId === body.inspectionId && association.baselineCommit === body.baselineCommit, 409, 'association_stale');
      const currentBinding = this.#bindings.current(id);
      requireValue(!currentBinding || currentBinding.binding.grantId === body.grantId || !this.#store.list<Task>('task').some(t => t.projectId === id), 409, 'binding_change_forbidden');
      await this.#bindings.grantForAssociation(body.grantId, association);
      const submitted = this.#store.get<{ path: string }>('private', 'inspection-path:' + association.inspectionId);
      requireValue(submitted, 409, 'association_stale');
      const observation = await inspectImportRepository(submitted.path);
      requireValue(observation.fingerprint === association.repository.fingerprint, 409, 'repository_changed');
      const stored = this.#bindings.make(id, body.grantId, association.baselineCommit, association.inspectionId);
      return () => {
        const { execution: _execution, ...updated } = this.project(id); this.#version(updated, body.expectedVersion);
        updated.version++; updated.updatedAt = now();
        this.#bindings!.save(stored); this.#store.put('project-space', id, updated);
        return { kind: 'execution-binding', id: stored.binding.id };
      };
    }).then(stored => stored.binding);
  }
  createProject(body: Body, key: string): Promise<ProjectDetail> {
    return this.#command<ProjectSpace>('/projects', key, body, async () => {
      keys(body, ['name', 'description']); this.#projectMetadata(body);
      const timestamp = now();
      const project: ProjectSpace = { schemaVersion: 1, id: randomUUID(), name: (body.name as string).trim(), description: (body.description as string | undefined) ?? '', version: 1, createdAt: timestamp, updatedAt: timestamp };
      return () => { this.#store.put('project-space', project.id, project); return { kind: 'project-space', id: project.id }; };
    }).then(p => this.project(p.id));
  }
  #projectMetadata(body: Body, partial = false) {
    requireValue((partial && body.name === undefined) || text(body.name, 200));
    requireValue(body.description === undefined || (typeof body.description === 'string' && body.description.length <= 8000));
  }
  updateProject(id: string, body: Body, key: string): Promise<ProjectDetail> {
    return this.#command<ProjectSpace>('/projects/' + id, key, body, async () => {
      keys(body, ['name', 'description', 'expectedVersion']); const project = this.project(id); this.#version(project, body.expectedVersion);
      requireValue(body.name !== undefined || body.description !== undefined); this.#projectMetadata(body, true);
      const { execution: _execution, ...updated } = project;
      if (body.name !== undefined) updated.name = (body.name as string).trim();
      if (body.description !== undefined) updated.description = body.description as string;
      updated.version++; updated.updatedAt = now();
      return () => { this.#store.put('project-space', id, updated); return { kind: 'project-space', id }; };
    }).then(p => this.project(p.id));
  }
  inspectProjectRepository(id: string, body: Body, key: string): Promise<RepositoryInspection> {
    return this.#command('/projects/' + id + '/repository-inspections', key, body, async () => {
      keys(body, ['path', 'expectedVersion']); const project = this.project(id); this.#version(project, body.expectedVersion);
      requireValue(typeof body.path === 'string', 400, 'invalid_repository_path');
      const repository = await inspectImportRepository(body.path);
      const inspection: RepositoryInspection = { schemaVersion: 1, id: randomUUID(), projectId: id, projectVersion: project.version, checkedAt: now(), expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(), repository, confirmable: Boolean(repository.head), ...(!repository.head ? { reason: 'no_commit_baseline' as const } : {}), uncommittedChangesIncluded: false };
      return () => { this.#store.put('repository-inspection', inspection.id, inspection); this.#store.put('private', 'inspection-path:' + inspection.id, { path: body.path }); return { kind: 'repository-inspection', id: inspection.id }; };
    });
  }
  confirmProjectRepository(id: string, body: Body, key: string): Promise<RepositoryAssociation> {
    return this.#command('/projects/' + id + '/repository', key, body, async () => {
      keys(body, ['expectedVersion', 'inspectionId', 'baselineCommit', 'acknowledgeUncommittedExcluded']);
      const project = this.project(id); this.#version(project, body.expectedVersion);
      requireValue(typeof body.inspectionId === 'string' && typeof body.baselineCommit === 'string' && body.acknowledgeUncommittedExcluded === true);
      const inspection = this.#store.get<RepositoryInspection>('repository-inspection', body.inspectionId);
      requireValue(inspection && inspection.projectId === id && inspection.projectVersion === project.version, 409, 'inspection_stale');
      requireValue(Date.parse(inspection.expiresAt) > Date.now(), 409, 'inspection_expired');
      requireValue(inspection.confirmable && inspection.repository.head === body.baselineCommit, 422, 'invalid_baseline');
      const submitted = this.#store.get<{ path: string }>('private', 'inspection-path:' + inspection.id);
      requireValue(submitted, 409, 'inspection_stale');
      const current = await inspectImportRepository(submitted.path);
      requireValue(current.fingerprint === inspection.repository.fingerprint, 409, 'repository_changed');
      const association: RepositoryAssociation = { projectId: id, baselineCommit: body.baselineCommit, confirmedAt: now(), inspectionId: inspection.id, uncommittedChangesIncluded: false, repository: current };
      return () => {
        // Re-read within the transaction; never overwrite a newer project version.
        const { execution: _execution, ...updated } = this.project(id); this.#version(updated, body.expectedVersion);
        requireValue(Date.parse(inspection.expiresAt) > Date.now(), 409, 'inspection_expired');
        updated.repository = { baselineCommit: association.baselineCommit, confirmedAt: association.confirmedAt, uncommittedChangesIncluded: false };
        updated.version++; updated.updatedAt = association.confirmedAt;
        this.#store.put('project-space', id, updated); this.#store.put('project-repository', id, association);
        return { kind: 'project-repository', id };
      };
    });
  }
  projectRepository(id: string): RepositoryAssociation | null { this.project(id); return this.#store.get<RepositoryAssociation>('project-repository', id) ?? null; }
  overview(projectId?: string): Overview {
    const tasks = this.#store.list<Task>('task').filter(t => projectId === undefined || t.projectId === projectId);
    const ids = new Set(tasks.map(t => t.id));
    const runs = this.#store.list<Run>('run').filter(r => ids.has(r.taskId)), checks = this.#store.list<CheckRun>('check').filter(c => ids.has(c.taskId));
    const taskCounts: Overview['taskCounts'] = { draft: 0, ready: 0, in_progress: 0, in_review: 0, accepted: 0 };
    const workspaces: Overview['workspaces'] = { unprepared: 0, preparing: 0, ready: 0, failed: 0, needs_recovery: 0 };
    for (const task of tasks) { taskCounts[task.status]++; workspaces[this.workspace(task.id).status]++; }
    return { totalTasks: tasks.length, taskCounts, runs: { running: runs.filter(r => r.status === 'running').length, needsRecovery: runs.filter(r => r.status === 'needs_recovery').length }, checks: { running: checks.filter(c => c.status === 'running').length, needsRecovery: checks.filter(c => c.status === 'needs_recovery').length }, workspaces, storageHealthy: !this.#fault, executionMode: this.#executionMode };
  }
  attention(cursor = 0, limit = 50, projectId?: string): AttentionPage {
    requireValue(Number.isSafeInteger(cursor) && cursor >= 0 && Number.isSafeInteger(limit) && limit >= 1 && limit <= 200);
    const all = attentionItems(this.#store.list<Task>('task'), this.#store.list<Run>('run'), this.#store.list<CheckRun>('check'), id => this.workspace(id));
    requireValue(cursor <= all.length);
    const items: AttentionPage['items'] = []; let next = cursor;
    while (next < all.length && items.length < limit) { const item = all[next++]; if (projectId === undefined || item.projectId === projectId) items.push(item); }
    return { items, nextCursor: next < all.length ? next : null };
  }
  #confirmedCheckExit(check: CheckRun): CheckExit | undefined {
    const exit = this.#store.get<CheckExit>('private', 'check-exit:' + check.id);
    return exit && exit.taskId === check.taskId && exit.runId === check.runId && exit.snapshotId === check.snapshotId && exit.contentDigest === check.contentDigest && ['passed', 'failed', 'cancelled', 'timed_out'].includes(exit.result.status) ? exit : undefined;
  }
  recovery(id: string): { items: RecoveryItem[] } {
    const task = this.task(id), workspace = this.workspace(id), items: RecoveryItem[] = [];
    if (workspace.status === 'needs_recovery' || workspace.status === 'failed') items.push({ kind: 'workspace', id: workspace.id, taskId: id, reason: workspace.reason ?? 'preparation_unconfirmed', recoverable: false });
    for (const run of this.#store.list<Run>('run').filter(r => r.taskId === id && r.status === 'needs_recovery')) items.push({ kind: 'run', id: run.id, taskId: id, version: run.version, reason: run.outcomeReason ?? 'result_unknown', recoverable: false });
    for (const check of this.#store.list<CheckRun>('check').filter(c => c.taskId === id && c.status === 'needs_recovery')) {
      const confirmed = Boolean(this.#confirmedCheckExit(check));
      items.push({ kind: 'check', id: check.id, taskId: id, version: check.version, reason: confirmed ? 'confirmed_exit_review_required' : 'process_exit_unconfirmed', recoverable: confirmed && workspace.status === 'ready' && !task.blockedReason && !this.#checkExecutions.has(check.id) && !this.#fault && !this.#closing });
    }
    return { items };
  }
  #busy() { return this.#store.list<Run>('run').some(active) || this.#store.list<CheckRun>('check').some(c => c.status === 'running' || c.status === 'needs_recovery'); }
  check(id: string): CheckRun { const check = this.#store.get<CheckRun>('check', id); requireValue(check, 404, 'not_found'); return check; }
  checkPresets() { return this.#presets.map(p => ({ id: p.id, name: p.name, available: presetAvailable(p), executable: p.executable, args: p.args, timeoutMs: p.timeoutMs, outputBytes: p.outputBytes })); }
  async listChecks(id: string) {
    const task = this.task(id), snapshot = this.changes(id);
    const items = this.#store.list<CheckRun>('check').filter(c => c.taskId === id);
    let digest: string | undefined;
    if (items.some(c => c.status !== 'running' && c.runId === task.latestRunId && c.snapshotId === snapshot?.id)) {
      try { const current = await captureChanges(await this.#repoFor(id)); if (current.completeness === 'complete') digest = current.contentDigest; } catch { /* unresolved identity or scan cannot certify current */ }
    }
    for (const check of items) check.validity = check.validity === 'current' && check.status !== 'running' && check.status !== 'needs_recovery' && check.runId === this.task(id).latestRunId && check.snapshotId === this.changes(id)?.id && check.contentDigest === digest ? 'current' : 'stale';
    const latest = items.at(-1);
    const summary: CheckSummary = latest ? { status: latest.status, validity: latest.validity, checkId: latest.id } : { status: 'not_run' };
    return { items, summary };
  }
  async queryDetail(id: string) {
    return this.#serialize(async () => {
      const acceptance = await this.#acceptanceSummary(id), checks = await this.listChecks(id), detail = this.detail(id);
      const managed = this.#flows.managed(detail.task);
      let reason: string | undefined;
      if (managed) {
        try { await this.#flows.assertTask(detail.task); }
        catch (error) { if (!(error instanceof ApiError)) throw error; reason = error.code; }
        detail.availableActions = detail.availableActions.filter(action => action !== 'edit' && (!reason || ['interrupt', 'cancel_check', 'recover_check'].includes(action)));
      }
      let agentReason: string | undefined;
      try { const route = this.#agents.assert(detail.task.agentBinding, detail.task.agentInstanceId); this.#sessionFor(detail.task, route.engineId); }
      catch (error) { if (!(error instanceof ApiError)) throw error; agentReason = error.code; }
      if (agentReason) detail.availableActions = detail.availableActions.filter(action => !['start', 'feedback'].includes(action));
      return { ...detail, checks: checks.summary, acceptance, recovery: this.recovery(id), workflowAuthorization: { managed, eligible: !reason, ...(reason ? { reason } : {}) }, agentAuthorization: { eligible: !agentReason, ...(agentReason ? { reason: agentReason } : {}) } };
    });
  }
  queryAcceptance(id: string): Promise<AcceptanceSummary> { return this.#serialize(() => this.#acceptanceSummary(id)); }
  async #acceptanceSummary(id: string): Promise<AcceptanceSummary> {
    const task = this.task(id), checkedAt = now();
    let acceptance = this.#store.list<Acceptance>('acceptance').filter(a => a.taskId === id).at(-1);
    if (!acceptance) return { status: 'not_accepted', checkedAt };
    const snapshot = this.#store.get<Snapshot>('snapshot', acceptance.snapshotId);
    acceptance = { ...acceptance, contentDigest: acceptance.contentDigest ?? snapshot?.contentDigest };
    if (!acceptance.valid) {
      const event = acceptance.invalidatedReason ? undefined : this.#store.acceptanceInvalidation(id, acceptance.id);
      const oldReason = event?.data.reason;
      const reason = acceptance.invalidatedReason ?? (typeof oldReason === 'string' && /^[a-z_]{1,80}$/.test(oldReason) ? oldReason : 'previously_invalidated');
      return { status: 'invalid', acceptance: { ...acceptance, invalidatedReason: reason, invalidatedAt: acceptance.invalidatedAt ?? event?.occurredAt }, reason, checkedAt };
    }
    if (this.#fault || this.#closing) return { status: 'unverifiable', acceptance, reason: 'storage_unavailable', checkedAt };
    let reason: string | undefined;
    if (!snapshot || snapshot.taskId !== id || snapshot.runId !== acceptance.runId || snapshot.contentDigest !== acceptance.contentDigest || task.latestRunId !== acceptance.runId || task.acceptedSnapshotId !== acceptance.snapshotId) reason = 'binding_changed';
    else {
      try {
        const current = await captureChanges(await this.#repoFor(id));
        if (current.completeness !== 'complete') return { status: 'unverifiable', acceptance, reason: 'workspace_unverifiable', checkedAt };
        if (current.contentDigest !== acceptance.contentDigest) reason = 'workspace_changed';
      } catch { return { status: 'unverifiable', acceptance, reason: 'workspace_unverifiable', checkedAt }; }
    }
    if (!reason) return { status: 'valid', acceptance, checkedAt };
    // A check worker can finish during the scan and increment this task's version.
    try { this.#store.transaction(() => this.#invalidate(this.task(id), reason!)); }
    catch { this.#storageFault(); throw new ApiError(503, 'storage_unavailable'); }
    acceptance = this.#store.get<Acceptance>('acceptance', acceptance.id)!;
    return { status: 'invalid', acceptance: { ...acceptance, contentDigest: acceptance.contentDigest ?? snapshot?.contentDigest }, reason, checkedAt };
  }
  startCheck(id: string, body: Body, key: string): Promise<CheckRun> {
    return this.#command('/tasks/' + id + '/checks', key, body, async () => {
      keys(body, ['expectedVersion', 'presetId', 'snapshotId']); const task = this.task(id); this.#version(task, body.expectedVersion);
      await this.#flows.assertTask(task);
      requireValue(!this.#busy(), 409, 'active_run');
      const preset = this.#presets.find(p => p.id === body.presetId); requireValue(preset && this.#taskPresets(task).some(p => p.id === preset.id), 422, 'preset_not_found'); requireValue(presetAvailable(preset), 422, 'check_unavailable');
      const snapshot = this.#store.get<Snapshot>('snapshot', String(body.snapshotId));
      requireValue(snapshot && snapshot.taskId === id && snapshot.runId === task.latestRunId && snapshot.completeness === 'complete' && this.changes(id)?.id === snapshot.id, 409, 'snapshot_stale');
      const current = await captureChanges(await this.#repoFor(id)); requireValue(current.completeness === 'complete' && current.contentDigest === snapshot.contentDigest, 409, 'snapshot_stale');
      const check: CheckRun = { schemaVersion: 1, id: randomUUID(), taskId: id, runId: snapshot.runId, snapshotId: snapshot.id, contentDigest: snapshot.contentDigest, presetId: preset.id, preset, status: 'running', validity: 'stale', startedAt: now(), stdout: '', stderr: '', truncated: false, version: 1 };
      return () => { this.#store.put('check', check.id, check); task.version++; this.#taskEvent(task, 'check.created', { checkId: check.id }); return { kind: 'check', id: check.id }; };
    }, ref => {
      const work = new Promise<void>(r => setImmediate(r)).then(() => this.#executeCheck(ref.id));
      this.#workers.add(work); void work.finally(() => this.#workers.delete(work)).catch(() => {});
    });
  }
  async #executeCheck(id: string) {
    const check = this.check(id);
    try {
      if (this.#closing) throw Error('service_stopped');
      const repo = await this.#repoFor(check.taskId), preset = check.preset;
      const execution = this.#checkExecutor(preset, repo.cwd); this.#checkExecutions.set(id, execution);
      if (this.check(id).reason === 'cancel_requested' || this.#closing || this.#fault) execution.cancel();
      const result = await execution.result;
      if (['passed', 'failed', 'cancelled', 'timed_out'].includes(result.status)) {
        const exit: CheckExit = { taskId: check.taskId, runId: check.runId, snapshotId: check.snapshotId, contentDigest: check.contentDigest, result, confirmedAt: now() };
        this.#store.put('private', 'check-exit:' + id, exit);
      }
      if (result.status === 'needs_recovery') {
        const leasePath = this.#workspaceLeases.get(this.task(check.taskId).workspaceId)?.path ?? this.#leasePath;
        try { await writeFile(leasePath + '.quarantine', JSON.stringify({ reason: 'check_process_exit_unconfirmed', createdAt: now() })); }
        catch { this.#retainLeases.add(leasePath); this.#storageFault(); throw Error('quarantine_failed'); }
      }
      const after = result.status === 'needs_recovery' ? undefined : await captureChanges(repo);
      Object.assign(check, result, { endedAt: result.status === 'needs_recovery' ? undefined : now(), validity: after?.completeness === 'complete' && after.contentDigest === check.contentDigest ? 'current' : 'stale', version: this.check(id).version + 1 });
      this.#store.transaction(() => { this.#store.put('check', id, check); const task = this.task(check.taskId); task.version++; this.#taskEvent(task, 'check.ended', { checkId: id, status: check.status }); });
    } catch {
      try { check.status = 'needs_recovery'; check.validity = 'stale'; check.reason = 'check_result_unknown'; check.version++; this.#store.put('check', id, check); }
      catch { this.#storageFault(); }
    } finally { this.#checkExecutions.delete(id); }
  }
  cancelCheck(id: string, body: Body, key: string): Promise<CheckRun> {
    return this.#command('/checks/' + id + '/cancel', key, body, async () => {
      keys(body, ['expectedVersion']); const check = this.check(id); this.#version(check, body.expectedVersion); requireValue(check.status === 'running', 409, 'check_not_running');
      return () => { check.reason = 'cancel_requested'; check.version++; this.#store.put('check', id, check); return { kind: 'check', id }; };
    }, () => this.#checkExecutions.get(id)?.cancel());
  }
  recoverCheck(id: string, body: Body, key: string): Promise<CheckRun> {
    return this.#command('/checks/' + id + '/recover', key, body, async () => {
      keys(body, ['expectedVersion']); const check = this.check(id); this.#version(check, body.expectedVersion);
      requireValue(check.status === 'needs_recovery', 409, 'check_not_recoverable');
      const exit = this.#confirmedCheckExit(check); requireValue(exit, 409, 'process_exit_unconfirmed');
      requireValue(!this.#store.list<Run>('run').some(r => r.status === 'running') && !this.#store.list<CheckRun>('check').some(c => c.status === 'running') && !this.#checkExecutions.has(id), 409, 'active_run');
      const repo = await this.#repoFor(check.taskId);
      const leasePath = this.#workspaceLeases.get(this.task(check.taskId).workspaceId)?.path ?? this.#leasePath;
      try { await readFile(leasePath + '.quarantine'); throw new ApiError(409, 'workspace_quarantined'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      const current = await captureChanges(repo); requireValue(current.completeness === 'complete', 409, 'workspace_unverifiable');
      return () => {
        Object.assign(check, exit.result, { endedAt: exit.confirmedAt, reason: 'recovered_confirmed_exit', validity: 'stale', version: check.version + 1 });
        this.#store.put('check', id, check); const task = this.task(check.taskId); task.version++;
        this.#taskEvent(task, 'check.recovered', { checkId: id, status: check.status });
        return { kind: 'check', id };
      };
    });
  }
  async #leaseWorkspace(workspace: StoredWorkspace) {
    if (this.#workspaceLeases.has(workspace.id)) return;
    const path = await workspaceLeasePath({ cwd: workspace.cwd, baseHead: workspace.baseHead!, kind: 'external_worktree' });
    const release = acquireLease(path);
    try { await readFile(path + '.quarantine'); throw Error('workspace_quarantined'); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') { release(); throw e; } }
    this.#workspaceLeases.set(workspace.id, { path, release });
  }
  async #repoFor(id: string): Promise<Repository> {
    if (!this.#projects) return this.#repo;
    const task = this.task(id), workspace = this.#store.get<StoredWorkspace>('private', 'workspace:' + task.workspaceId);
    requireValue(this.workspace(id).status === 'ready' && workspace, 409, 'workspace_not_ready');
    const registry = await this.#taskRegistry(task);
    requireValue(workspace.baseHead === task.executionBinding?.baselineCommit && workspace.projectId === task.projectId && workspace.taskId === task.id, 409, 'execution_binding_unavailable');
    await registry.verify(workspace); await this.#leaseWorkspace(workspace);
    return { cwd: workspace.cwd, baseHead: workspace.baseHead!, kind: 'external_worktree' };
  }
  async #taskRegistry(task: Task) { requireValue(this.#bindings, 409, 'execution_binding_unavailable'); return this.#bindings.validate(this.#bindings.storedFor(task)); }
  #taskPresets(task: Task) { if (!this.#bindings) return this.#presets; const ids = this.#bindings.checkPresetIds(task); return this.#presets.filter(p => ids.includes(p.id)); }
  #taskAuthorized(task: Task) { if (!this.#bindings) return true; try { this.#bindings.registryFor(this.#bindings.storedFor(task)); return true; } catch { return false; } }
  workspace(id: string): Workspace {
    const task = this.task(id);
    return this.#store.get<Workspace>('workspace', task.workspaceId) ?? { id: task.workspaceId, taskId: id, projectId: task.projectId, status: this.#projects ? 'unprepared' : 'ready', baseHead: this.#projects ? undefined : this.#repo.baseHead };
  }
  prepareWorkspace(id: string, body: Body, key: string): Promise<Workspace> {
    return this.#command('/tasks/' + id + '/workspace', key, body, async () => {
      keys(body, ['expectedVersion']); const task = this.task(id); this.#version(task, body.expectedVersion);
      await this.#flows.assertTask(task);
      requireValue(this.#projects, 409, 'legacy_workspace_bound');
      requireValue(!this.#busy(), 409, 'active_run');
      requireValue(this.workspace(id).status === 'unprepared', 409, 'workspace_already_prepared');
      const registry = await this.#taskRegistry(task);
      const stored: StoredWorkspace = { id: task.workspaceId, taskId: id, projectId: task.projectId, status: 'preparing', baseHead: task.executionBinding!.baselineCommit, branch: 'codex/task-' + id, cwd: resolve(registry.workspaceRoot, task.workspaceId) };
      const { cwd, gitDir, ...workspace } = stored;
      return () => {
        this.#store.put('private', 'workspace:' + workspace.id, stored); this.#store.put('workspace', workspace.id, workspace);
        task.version++; this.#taskEvent(task, 'workspace.preparing'); return { kind: 'workspace', id: workspace.id };
      };
    }, ref => {
      const work = new Promise<void>(r => setImmediate(r)).then(async () => {
        const stored = this.#store.get<StoredWorkspace>('private', 'workspace:' + ref.id)!;
        let result: StoredWorkspace;
        try { result = await (await this.#taskRegistry(this.task(stored.taskId))).create(stored); await this.#leaseWorkspace(result); }
        catch (error) {
          const conflict = /workspace_(path|branch)_conflict/.test(String(error));
          result = { ...stored, status: conflict ? 'failed' : 'needs_recovery', reason: conflict ? 'workspace_conflict' : 'preparation_unconfirmed' };
        }
        try {
          this.#store.transaction(() => {
            const { cwd, gitDir, ...workspace } = result;
            this.#store.put('private', 'workspace:' + ref.id, result); this.#store.put('workspace', ref.id, workspace);
            const task = this.task(stored.taskId); task.version++; this.#taskEvent(task, 'workspace.' + result.status);
          });
        } catch { this.#storageFault(); }
      });
      this.#workers.add(work); void work.finally(() => this.#workers.delete(work)).catch(() => {});
    });
  }
  task(id: string): Task { const task = this.#store.get<Task>('task', id); requireValue(task, 404, 'not_found'); return task; }
  run(id: string): Run { const run = this.#store.get<Run>('run', id); requireValue(run, 404, 'not_found'); return { ...run, modelEvidence: run.modelEvidence ?? { status: 'unknown', source: run.model ? 'legacy_unspecified' : 'unknown' } }; }
  runDetail(id: string): Run & { input?: string } {
    return { ...this.run(id), input: this.#store.get<{ input: string }>('private', 'input:' + id)?.input };
  }
  tasks(cursor = 0, limit = 50, filters: { projectId?: string; status?: string } = {}) {
    requireValue(Number.isSafeInteger(cursor) && cursor >= 0 && Number.isSafeInteger(limit) && limit >= 1 && limit <= 200);
    requireValue(filters.status === undefined || ['draft', 'ready', 'in_progress', 'in_review', 'accepted'].includes(filters.status));
    const tasks = this.#store.list<Task>('task'); requireValue(cursor <= tasks.length);
    const items: Task[] = []; let next = cursor;
    while (next < tasks.length && items.length < limit) { const task = tasks[next++]; if ((!filters.projectId || task.projectId === filters.projectId) && (!filters.status || task.status === filters.status)) items.push(task); }
    return { items, nextCursor: next < tasks.length ? next : null };
  }
  detail(id: string) {
    return this.#store.transaction(() => {
      const task = this.task(id), run = task.latestRunId ? this.run(task.latestRunId) : undefined;
      const workspace = this.workspace(id);
      const checkRunning = this.#store.list<CheckRun>('check').some(check => check.taskId === id && check.status === 'running');
      const recoverableCheck = this.recovery(id).items.some(item => item.kind === 'check' && item.recoverable);
      const actions = this.#fault || this.#closing || task.blockedReason ? [] : run && active(run) ? (run.phase === 'executing' && this.#executions.has(run.id) ? ['interrupt'] : []) : checkRunning ? ['cancel_check'] : !this.#taskAuthorized(task) ? [] : recoverableCheck ? ['recover_check'] : this.#busy() ? [] : workspace.status !== 'ready' ? [...(!task.latestRunId ? ['edit'] : []), ...(workspace.status === 'unprepared' ? ['prepare_workspace'] : [])] : task.status === 'draft' ? ['edit'] : task.status === 'ready' ? ['edit', 'start'] : ['snapshot', 'feedback', ...(this.#taskPresets(task).some(presetAvailable) && this.changes(id)?.runId === run?.id ? ['check'] : []), ...(run?.status === 'succeeded' ? ['accept'] : [])];
      return { task, run, workspace, snapshot: this.changes(id), lastEventSeq: this.#store.lastSeq(id),
        availableActions: actions.filter(action => action !== 'interrupt' || this.#agents.get(task.agentInstanceId).capabilities.some(c => c.name === 'interrupt' && c.businessSupport === 'implemented')) };
    });
  }
  events(id: string, after = 0, limit = 50) {
    this.task(id); requireValue(Number.isSafeInteger(after) && after >= 0 && after <= this.#store.lastSeq(id));
    requireValue(Number.isSafeInteger(limit) && limit >= 1 && limit <= 200);
    return this.#store.events(id, after, limit);
  }
  changes(id: string): Snapshot | undefined {
    this.task(id); const last = this.#store.get<{ id: string }>('private', 'snapshot:' + id);
    return last ? this.#store.get<Snapshot>('snapshot', last.id) : undefined;
  }
  file(snapshotId: string, fileId: string) {
    const snapshot = this.#store.get<Snapshot>('snapshot', snapshotId);
    const file = snapshot?.files.find(f => f.id === fileId); requireValue(file, 404, 'not_found'); return file;
  }
  #version(object: { version: number }, expected: unknown) { if (!Number.isSafeInteger(expected) || object.version !== expected) throw new ApiError(409, 'version_conflict', object.version); }
  #healthy() { requireValue(!this.#fault && !this.#closing, 503, 'storage_unavailable'); }
  #serialize<T>(fn: () => Promise<T>): Promise<T> {
    const work = this.#queue.then(fn); this.#queue = work.catch(() => {}); return work;
  }
  #command<T>(scope: string, key: string, body: Body, prepare: () => Promise<() => Ref>, onNew?: (ref: Ref) => void): Promise<T> {
    return this.#serialize(async () => {
      this.#healthy(); requireValue(text(key, 128));
      const id = JSON.stringify([scope, key]), digest = createHash('sha256').update(canonical(body)).digest('hex');
      const prior = this.#store.get<{ digest: string; ref: Ref }>('idempotency', id);
      if (prior) { requireValue(prior.digest === digest, 409, 'idempotency_conflict'); return this.#store.get<T>(prior.ref.kind, prior.ref.id)!; }
      const commit = await prepare();
      let ref: Ref;
      try { ref = this.#store.transaction(() => { const result = commit(); this.#store.put('idempotency', id, { digest, ref: result }); return result; }); }
      catch (e) { if (!(e instanceof ApiError)) this.#storageFault(); throw e; }
      onNew?.(ref);
      return this.#store.get<T>(ref.kind, ref.id)!;
    });
  }
  #taskEvent(task: Task, type = 'task.updated', extra: Body = {}) {
    this.#store.put('task', task.id, task); this.#store.append(task.id, type, { version: task.version, status: task.status, ...extra }, task.latestRunId);
  }
  #invalidate(task: Task, reason: string) {
    if (!task.acceptedSnapshotId && !this.#store.list<Acceptance>('acceptance').some(a => a.taskId === task.id && a.valid)) return;
    for (const a of this.#store.list<Acceptance>('acceptance').filter(a => a.taskId === task.id && a.valid)) {
      a.valid = false; a.invalidatedAt = now(); a.invalidatedReason = reason; this.#store.put('acceptance', a.id, a);
      this.#store.append(task.id, 'task.acceptance_invalidated', { acceptanceId: a.id, snapshotId: a.snapshotId, reason, version: task.version + 1 }, task.latestRunId);
    }
    delete task.acceptedSnapshotId; task.status = 'in_review'; task.version++;
    this.#taskEvent(task);
  }
  createTask(body: Body, key: string): Promise<Task> {
    return this.#command('/tasks', key, body, async () => {
      keys(body, ['title', 'goal', 'acceptanceCriteria', 'agentInstanceId', 'projectId']);
      requireValue(typeof body.agentInstanceId === 'string');
      requireValue(this.#agents.get(body.agentInstanceId).available, 422, 'engine_not_integrated');
      const agentBinding = this.#agents.binding(body.agentInstanceId);
      requireValue(text(body.title, 200) && typeof body.goal === 'string' && body.goal.length <= 64000 && Array.isArray(body.acceptanceCriteria) && body.acceptanceCriteria.length <= 50 && body.acceptanceCriteria.every(v => text(v, 2000)));
      if (typeof body.projectId === 'string' && this.#store.get('project-space', body.projectId)) { const capability = this.project(body.projectId).execution; requireValue(capability.supported, 422, capability.reason === 'binding_refresh_required' ? 'binding_refresh_required' : capability.reason === 'binding_unavailable' ? 'execution_binding_unavailable' : 'execution_binding_required'); }
      requireValue(this.#projects ? typeof body.projectId === 'string' && this.#store.get('project-space', body.projectId) : body.projectId === undefined || body.projectId === 'local-project', 422, 'project_not_found');
      requireValue(this.#projects || this.#store.list('task').length === 0, 409, 'workspace_bound');
      const projectId = this.#projects ? body.projectId as string : 'local-project';
      const binding = this.#bindings?.current(projectId);
      if (this.#bindings) { requireValue(binding, 422, 'execution_binding_required'); await this.#bindings.validate(binding); }
      const task: Task = { schemaVersion: 1, id: randomUUID(), projectId, workspaceId: this.#projects ? randomUUID() : 'local-workspace', title: body.title as string, goal: body.goal as string, acceptanceCriteria: body.acceptanceCriteria as string[], agentInstanceId: body.agentInstanceId, agentBinding, status: text(body.goal) && body.acceptanceCriteria.length ? 'ready' : 'draft', ...(binding ? { executionBinding: this.#bindings!.reference(binding) } : {}), version: 1, createdAt: now() };
      return () => { this.#taskEvent(task, 'task.created'); return { kind: 'task', id: task.id }; };
    });
  }
  updateTask(id: string, body: Body, key: string): Promise<Task> {
    return this.#command('/tasks/' + id, key, body, async () => {
      keys(body, ['expectedVersion', 'title', 'goal', 'acceptanceCriteria']); const task = this.task(id); this.#version(task, body.expectedVersion);
      requireValue(!this.#flows.managed(task), 409, 'workflow_managed_task');
      requireValue(!task.latestRunId, 409, 'task_started');
      const updated = { ...task, ...body };
      requireValue(text(updated.title, 200) && typeof updated.goal === 'string' && updated.goal.length <= 64000 && Array.isArray(updated.acceptanceCriteria) && updated.acceptanceCriteria.length <= 50 && updated.acceptanceCriteria.every(v => text(v, 2000)));
      task.title = updated.title; task.goal = updated.goal; task.acceptanceCriteria = updated.acceptanceCriteria;
      task.status = text(task.goal) && task.acceptanceCriteria.length ? 'ready' : 'draft'; task.version++;
      return () => { this.#taskEvent(task); return { kind: 'task', id }; };
    });
  }
  startRun(id: string, body: Body, key: string): Promise<Run> {
    return this.#command('/tasks/' + id + '/runs', key, body, async () => {
      keys(body, ['expectedVersion', 'input']); const task = this.task(id);
      await this.#flows.assertTask(task);
      requireValue(!this.#busy(), 409, 'active_run'); this.#version(task, body.expectedVersion);
      const route = this.#agents.assert(task.agentBinding, task.agentInstanceId);
      const session = this.#sessionFor(task, route.engineId);
      requireValue(task.status === 'ready' || task.status === 'in_review' || task.status === 'accepted', 409, 'task_not_ready');
      requireValue(task.latestRunId ? text(body.input) : body.input === undefined);
      const repo = await this.#repoFor(id);
      const changes = await captureChanges(repo); requireValue(changes.head === repo.baseHead, 409, 'workspace_head_changed');
      const run: Run = { schemaVersion: 1, id: randomUUID(), taskId: id, agentInstanceId: task.agentInstanceId, agentBinding: task.agentBinding, engineId: route.engineId, ...(session ? { sessionRef: session.id } : {}), modelEvidence: { status: 'unknown', source: 'unknown' }, status: 'running', phase: 'starting', version: 1, startedAt: now() };
      const input = task.latestRunId ? body.input as string : `${task.goal}\n\n验收条件：\n${task.acceptanceCriteria.map(c => '- ' + c).join('\n')}`;
      return () => {
        this.#invalidate(task, 'new_run'); task.status = 'in_progress'; task.latestRunId = run.id; task.version++;
        this.#store.put('run', run.id, run); this.#store.put('private', 'input:' + run.id, { input });
        this.#flows.recordRun(task, run);
        this.#store.append(id, 'run.created', { runId: run.id, version: 1, status: run.status, phase: run.phase }, run.id); this.#taskEvent(task);
        return { kind: 'run', id: run.id };
      };
    }, ref => {
      const work = new Promise<void>(resolve => setImmediate(resolve)).then(() => this.#execute(ref.id));
      this.#workers.add(work); void work.finally(() => this.#workers.delete(work)).catch(() => {});
    });
  }
  #finish(id: string, status: Run['status'], reason?: string) {
    const run = this.run(id); if (!active(run)) return;
    const previousStatus = run.status; run.status = status; run.phase = 'ended'; run.outcomeReason = reason; run.version++;
    if (status !== 'needs_recovery') run.endedAt = now();
    const task = this.task(run.taskId); task.status = status === 'needs_recovery' ? 'in_progress' : 'in_review'; task.blockedReason = status === 'needs_recovery' ? 'result_unknown' : undefined; task.version++;
    this.#store.put('run', id, run); this.#store.append(task.id, 'run.status_changed', { version: run.version, previousStatus, status, phase: run.phase, reason }, id); this.#taskEvent(task);
  }
  #storageFault() { this.#fault = true; for (const execution of this.#executions.values()) void execution.close().catch(() => {}); for (const check of this.#checkExecutions.values()) check.cancel(); }
  async #execute(id: string) {
    let execution: Execution | undefined;
    let exited = false;
    let leasePath = this.#leasePath;
    try {
      if (this.#closing) { this.#store.transaction(() => this.#finish(id, 'needs_recovery', 'service_stopped')); return; }
      const run = this.run(id), input = this.#store.get<{ input: string }>('private', 'input:' + id)!.input;
      const repo = await this.#repoFor(run.taskId);
      leasePath = this.#workspaceLeases.get(this.task(run.taskId).workspaceId)?.path ?? this.#leasePath;
      let bytes = 0, events = 0;
      const write = (fn: () => void) => { try { this.#store.transaction(fn); } catch (e) { this.#storageFault(); throw e; } };
      const task = this.task(run.taskId), route = this.#agents.assert(run.agentBinding, run.agentInstanceId);
      const priorSession = this.#sessionFor(task, route.engineId, id);
      const currentRound = () => this.run(id).status === 'running' && this.task(run.taskId).latestRunId === id;
      execution = await route.adapter.start({ cwd: repo.cwd, input, sessionId: priorSession?.nativeSessionId,
        onSession: nativeSessionId => {
          if (!currentRound()) return;
          requireValue(text(nativeSessionId, 200) && !/[\r\n\x00]/.test(nativeSessionId), 409, 'native_session_invalid');
          requireValue(!priorSession || priorSession.nativeSessionId === nativeSessionId, 409, 'native_session_mismatch');
          const existing = this.taskSession(task.id).session;
          requireValue(!existing || existing.nativeSessionId === nativeSessionId, 409, 'native_session_mismatch');
          requireValue(!this.#store.list<NativeSession>('native-session').some(s => s.taskId !== task.id && s.engineId === route.engineId && s.agentBinding?.instanceId === task.agentInstanceId && s.nativeSessionId === nativeSessionId), 409, 'native_session_already_owned');
          write(() => {
            const session: NativeSession = existing ?? { id: randomUUID(), taskId: task.id, workspaceId: task.workspaceId, engineId: route.engineId, agentBinding: task.agentBinding, nativeSessionId, ownership: 'verified', createdAt: now() };
            this.#store.put('native-session', session.id, session);
            const currentTask = this.task(task.id); currentTask.nativeSessionRef = session.id; this.#store.put('task', task.id, currentTask);
            const current = this.run(id); current.sessionRef = session.id; this.#store.put('run', id, current);
          });
        },
        onTurn: nativeTurnId => {
          if (!currentRound()) return;
          requireValue(text(nativeTurnId, 200) && !/[\r\n\x00]/.test(nativeTurnId), 409, 'native_turn_invalid');
          write(() => { const current = this.run(id); requireValue(!current.nativeTurnId || current.nativeTurnId === nativeTurnId, 409, 'native_turn_mismatch'); current.nativeTurnId = nativeTurnId; this.#store.put('run', id, current); });
        },
        onModel: (model, source = 'adapter_reported') => {
          if (!currentRound()) return;
          requireValue(text(model, 200));
          requireValue(['adapter_reported', 'thread_configuration', 'model_rerouted', 'assistant_message'].includes(source));
          write(() => { const current = this.run(id); current.model = model; current.modelEvidence = source === 'adapter_reported' ? { status: 'reported', actualModel: model, source } : source === 'model_rerouted' || source === 'assistant_message' ? { status: 'unknown', configuredModel: current.modelEvidence?.configuredModel, routingModel: model, source } : { status: 'unknown', configuredModel: model, source }; this.#store.put('run', id, current); });
        },
        emit: (event: AdapterEvent) => {
          if (!currentRound()) return;
          requireValue(['message.delta', 'message.completed', 'activity.started', 'activity.completed', 'diagnostic.recorded'].includes(event.type), 400, 'invalid_adapter_event');
          bytes += Buffer.byteLength(JSON.stringify(event)); events++;
          if (bytes > 10 * 1024 * 1024 || events > 100000) throw Error('visible output limit');
          write(() => { const current = this.run(id); this.#store.append(run.taskId, event.type, { ...event.data, origin: { instanceId: run.agentInstanceId, engineId: run.engineId, agentBinding: run.agentBinding, sessionRef: current.sessionRef, nativeTurnId: current.nativeTurnId } }, id); });
        },
      });
      this.#executions.set(id, execution);
      if (this.#closing || this.#fault) { await execution.close(); throw Error('service stopping'); }
      write(() => { const current = this.run(id); current.phase = 'executing'; current.version++; this.#store.put('run', id, current); this.#store.append(run.taskId, 'run.status_changed', { version: current.version, previousStatus: current.status, status: current.status, phase: current.phase }, id); });
      const result = await execution.result;
      await execution.close(); exited = true;
      write(() => this.#finish(id, result.status, result.reason));
    } catch (error) {
      let exitUnknown = Boolean((error as { processExitUnconfirmed?: boolean }).processExitUnconfirmed);
      if (execution && !exited) { try { await execution.close(); exited = true; } catch { exitUnknown = true; } }
      if (exitUnknown) {
        await writeFile(leasePath + '.quarantine', JSON.stringify({ schemaVersion: 1, reason: 'owned_process_exit_unconfirmed', createdAt: now() })).catch(() => { this.#retainLeases.add(leasePath); this.#fault = true; });
      }
      if (!this.#fault) {
        try { this.#store.transaction(() => this.#finish(id, !exitUnknown && (error as { definitive?: boolean }).definitive ? 'failed' : 'needs_recovery', exitUnknown ? 'process_exit_unconfirmed' : (error as { definitive?: boolean }).definitive ? 'start_rejected' : 'result_unknown')); }
        catch { this.#storageFault(); }
      }
    } finally {
      this.#executions.delete(id);
    }
  }
  interrupt(id: string, body: Body, key: string): Promise<Run> {
    return this.#command('/runs/' + id + '/interrupt', key, body, async () => {
      keys(body, ['expectedVersion']); const run = this.run(id); this.#version(run, body.expectedVersion);
      requireValue(this.#agents.get(run.agentInstanceId).capabilities.some(c => c.name === 'interrupt' && c.businessSupport === 'implemented'), 409, 'engine_capability_unsupported');
      requireValue(run.status === 'running' && run.phase === 'executing' && this.#executions.has(id), 409, 'run_not_interruptible');
      return () => { run.phase = 'stopping'; run.version++; this.#store.put('run', id, run); this.#store.append(run.taskId, 'run.status_changed', { version: run.version, previousStatus: run.status, status: run.status, phase: run.phase }, id); return { kind: 'run', id }; };
    }, () => { void this.#executions.get(id)!.interrupt().catch(() => { if (!this.#fault) try { this.#store.transaction(() => this.#finish(id, 'needs_recovery', 'interrupt_unconfirmed')); } catch { this.#storageFault(); } }); });
  }
  snapshot(id: string, body: Body, key: string): Promise<Snapshot> {
    return this.#command('/tasks/' + id + '/snapshots', key, body, async () => {
      keys(body, ['expectedVersion']); const task = this.task(id); this.#version(task, body.expectedVersion);
      await this.#flows.assertTask(task);
      requireValue(!this.#busy(), 409, 'active_run');
      const run = task.latestRunId ? this.run(task.latestRunId) : undefined; requireValue(run && !active(run), 409, 'active_run');
      const snapshot: Snapshot = { ...await captureChanges(await this.#repoFor(id)), schemaVersion: 1, id: randomUUID(), taskId: id, runId: run.id, createdAt: now() };
      return () => {
        const accepted = task.acceptedSnapshotId ? this.#store.get<Snapshot>('snapshot', task.acceptedSnapshotId) : undefined;
        if (accepted && (accepted.contentDigest !== snapshot.contentDigest || snapshot.completeness !== 'complete')) this.#invalidate(task, 'workspace_changed');
        this.#store.put('snapshot', snapshot.id, snapshot); this.#store.put('private', 'snapshot:' + id, { id: snapshot.id });
        this.#store.append(id, 'changes.snapshot_created', { snapshotId: snapshot.id, completeness: snapshot.completeness, checks: snapshot.checks }, run.id);
        return { kind: 'snapshot', id: snapshot.id };
      };
    });
  }
  accept(id: string, body: Body, key: string): Promise<Task> {
    return this.#command('/tasks/' + id + '/accept', key, body, async () => {
      keys(body, ['expectedVersion', 'snapshotId']); const task = this.task(id); this.#version(task, body.expectedVersion);
      await this.#flows.assertTask(task);
      requireValue(!this.#busy(), 409, 'active_run');
      requireValue(task.latestRunId && this.run(task.latestRunId).status === 'succeeded', 409, 'run_not_successful');
      const snapshot = this.#store.get<Snapshot>('snapshot', String(body.snapshotId));
      requireValue(snapshot?.taskId === id && snapshot.runId === task.latestRunId && snapshot.completeness === 'complete', 409, 'snapshot_stale');
      const current = await captureChanges(await this.#repoFor(id));
      if (current.contentDigest !== snapshot.contentDigest || current.completeness !== 'complete') {
        this.#store.transaction(() => this.#invalidate(task, 'workspace_changed'));
        throw new ApiError(409, 'snapshot_stale');
      }
      return () => {
        this.#invalidate(task, 'reaccepted'); task.status = 'accepted'; task.acceptedSnapshotId = snapshot.id; task.version++;
        const acceptance: Acceptance = { schemaVersion: 1, id: randomUUID(), taskId: id, runId: snapshot.runId, snapshotId: snapshot.id, contentDigest: snapshot.contentDigest, acceptedAt: now(), valid: true };
        this.#store.put('acceptance', acceptance.id, acceptance); this.#store.put('task', id, task);
        this.#store.append(id, 'task.accepted', { acceptanceId: acceptance.id, snapshotId: snapshot.id, version: task.version, status: task.status }, snapshot.runId);
        return { kind: 'task', id };
      };
    });
  }
  close(): Promise<void> {
    this.#closed ??= (async () => {
      this.#closing = true; await this.#queue;
      for (const check of this.#checkExecutions.values()) check.cancel();
      await Promise.allSettled([...this.#executions.values()].map(e => e.close()));
      await Promise.allSettled([...this.#workers]);
      this.#store.close(); for (const lease of this.#workspaceLeases.values()) if (!this.#retainLeases.has(lease.path)) lease.release(); if (!this.#retainLeases.has(this.#leasePath)) this.#release();
    })(); return this.#closed;
  }
}

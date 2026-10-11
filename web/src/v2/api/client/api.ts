import type { Event, ReviewFile, Run, Snapshot, Task, Project, Workspace, CheckRun, CheckSummary, CheckPreset, TaskStatus, AcceptanceSummary, Overview, AttentionPage, RecoveryItem } from '../backend/types.ts';
import type { ProjectDetail, RepositoryInspection, RepositoryAssociation } from '../backend/types.ts';
import type { ExecutionBinding, BindingStatus } from '../backend/types.ts';
import type { WorkflowDraft, WorkflowView, WorkflowApproval, WorkflowConfirmation } from '../backend/types.ts';
import type { AgentInstance, NativeSession } from '../backend/types.ts';
export type { AgentBinding, AgentInstance, AgentCapability, NativeSession, ModelEvidence } from '../backend/types.ts';
export type { WorkflowDraft, WorkflowView, WorkflowApproval, WorkflowConfirmation, WorkflowRole, WorkflowMember, WorkflowNode, WorkflowNodeState, WorkflowLink } from '../backend/types.ts';
export type { ExecutionBinding, BindingStatus, TaskExecutionBinding } from '../backend/types.ts';
export type { ProjectDetail, ProjectSpace, RepositoryInspection, RepositoryAssociation } from '../backend/types.ts';

export type { Event, ReviewFile, Run, Snapshot, Task } from '../backend/types.ts';
export type { Project, Workspace, CheckPreset, CheckRun, CheckSummary } from '../backend/types.ts';
export type { Acceptance, AcceptanceSummary, Overview, AttentionItem, AttentionPage, RecoveryItem } from '../backend/types.ts';
export type Bootstrap = {
  mode?: 'legacy' | 'project';
  executionMode?: 'codex' | 'deterministic';
  checkPresets?: (CheckPreset & { available: boolean })[];
  schemaVersion: 1;
  project: { id: string; name: string };
  workspace: { id: string; projectId: string; kind: string; baseHead: string; availability: string };
  engines: { id: string; integrationStatus: string }[];
  instances: { id: string; engineId: string; name: string; availability: string; capabilities: { name: string; adapterSupport: string; verification: string; evidenceRef: string }[] }[];
  storageHealthy: boolean;
};
export type TaskDetail = { task: Task; run?: Run; snapshot?: Snapshot; workspace?: Workspace; checks?: CheckSummary; acceptance?: AcceptanceSummary; recovery?: { items: RecoveryItem[] }; workflowAuthorization?: { managed: boolean; eligible: boolean; reason?: string }; agentAuthorization?: { eligible: boolean; reason?: string }; lastEventSeq: number; availableActions: string[] };
export type TaskInput = { projectId?: string; title: string; goal: string; acceptanceCriteria: string[]; agentInstanceId: string };
export type Version = { expectedVersion: number };
type Fetch = typeof globalThis.fetch;
type Options = { baseUrl: string; getToken: () => string; fetch?: Fetch };

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly currentVersion?: number;
  constructor(status: number, code: string, currentVersion?: number) {
    super(`API ${status}: ${code}`); this.name = 'ApiClientError'; this.status = status; this.code = code; this.currentVersion = currentVersion;
  }
}
export class EventStreamError extends Error {
  readonly after: number;
  readonly code: 'disconnected' | 'invalid_event' | 'frame_too_large';
  constructor(after: number, code: EventStreamError['code']) {
    super(`Event stream ${code}; resume after ${after}`); this.name = 'EventStreamError'; this.after = after; this.code = code;
  }
}
function cursor(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('Invalid event cursor');
}
const id = encodeURIComponent;

/** Browser-safe client. Credentials stay in the caller's memory; writes never retry automatically. */
export class ApiClient {
  #base: string;
  #token: () => string;
  #fetch: Fetch;
  constructor(options: Options) {
    const url = new URL(options.baseUrl);
    if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new TypeError('Expected a local HTTP origin');
    this.#base = url.origin + '/api/v1'; this.#token = options.getToken; this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }
  async #response(path: string, method: string, body?: unknown, key?: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const token = this.#token();
    if (!token || /[\r\n]/.test(token)) throw new TypeError('Invalid access token');
    const headers: Record<string, string> = { Authorization: 'Bearer ' + token };
    if (body !== undefined) {
      if (!key || key.length > 128 || /[\r\n]/.test(key)) throw new TypeError('An explicit idempotency key is required');
      headers['Content-Type'] = 'application/json'; headers['Idempotency-Key'] = key;
    }
    const response = await this.#fetch(this.#base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal, redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
    if (!response.ok) {
      let code = 'invalid_response', currentVersion: number | undefined;
      try { const value = await response.json(); if (typeof value?.error?.code === 'string' && /^[a-z_]{1,80}$/.test(value.error.code)) code = value.error.code; if (code === 'version_conflict' && Number.isSafeInteger(value.currentVersion) && value.currentVersion >= 0) currentVersion = value.currentVersion; }
      catch { signal?.throwIfAborted(); /* Do not expose arbitrary response bodies. */ }
      throw new ApiClientError(response.status, code, currentVersion);
    }
    return response;
  }
  async #json<T>(path: string, method = 'GET', body?: unknown, key?: string, signal?: AbortSignal): Promise<T> {
    const response = await this.#response(path, method, body, key, signal);
    try { return await response.json() as T; }
    catch { signal?.throwIfAborted(); throw new ApiClientError(response.status, 'invalid_response'); }
  }
  bootstrap(signal?: AbortSignal) { return this.#json<Bootstrap>('/bootstrap', 'GET', undefined, undefined, signal); }
  agentInstances(signal?: AbortSignal) { return this.#json<{ items: AgentInstance[] }>('/agent-instances', 'GET', undefined, undefined, signal); }
  agentInstance(instanceId: string, signal?: AbortSignal) { return this.#json<AgentInstance>(`/agent-instances/${id(instanceId)}`, 'GET', undefined, undefined, signal); }
  taskSession(taskId: string, signal?: AbortSignal) { return this.#json<{ session: NativeSession | null }>(`/tasks/${id(taskId)}/session`, 'GET', undefined, undefined, signal); }
  overview(signal?: AbortSignal, filters: { projectId?: string } = {}) { const query = new URLSearchParams(); if (filters.projectId) query.set('projectId', filters.projectId); return this.#json<Overview>('/overview?' + query, 'GET', undefined, undefined, signal); }
  attention(cursor = 0, limit = 50, signal?: AbortSignal, filters: { projectId?: string } = {}) { const query = new URLSearchParams({ cursor: String(cursor), limit: String(limit) }); if (filters.projectId) query.set('projectId', filters.projectId); return this.#json<AttentionPage>('/attention?' + query, 'GET', undefined, undefined, signal); }
  acceptance(taskId: string, signal?: AbortSignal) { return this.#json<AcceptanceSummary>(`/tasks/${id(taskId)}/acceptance`, 'GET', undefined, undefined, signal); }
  recovery(taskId: string, signal?: AbortSignal) { return this.#json<{ items: RecoveryItem[] }>(`/tasks/${id(taskId)}/recovery`, 'GET', undefined, undefined, signal); }
  recoverCheck(checkId: string, body: Version, key: string, signal?: AbortSignal) { return this.#json<CheckRun>(`/checks/${id(checkId)}/recover`, 'POST', body, key, signal); }
  tasks(cursor = 0, limit = 50, signal?: AbortSignal, filters: { projectId?: string; status?: TaskStatus } = {}) { const query = new URLSearchParams({ cursor: String(cursor), limit: String(limit) }); if (filters.projectId) query.set('projectId', filters.projectId); if (filters.status) query.set('status', filters.status); return this.#json<{ items: Task[]; nextCursor: number | null }>(`/tasks?${query}`, 'GET', undefined, undefined, signal); }
  projects(signal?: AbortSignal) { return this.#json<{ items: Project[] }>('/projects', 'GET', undefined, undefined, signal); }
  workflow(projectId: string, signal?: AbortSignal) { return this.#json<WorkflowView>(`/projects/${id(projectId)}/workflow`, 'GET', undefined, undefined, signal); }
  workflowRevisions(projectId: string, signal?: AbortSignal) { return this.#json<{ items: WorkflowDraft[] }>(`/projects/${id(projectId)}/workflow-revisions`, 'GET', undefined, undefined, signal); }
  saveWorkflow(projectId: string, body: Version & Pick<WorkflowDraft, 'roles' | 'members' | 'ownerMemberId' | 'nodes'>, key: string, signal?: AbortSignal) { return this.#json<WorkflowDraft>(`/projects/${id(projectId)}/workflow`, 'POST', body, key, signal); }
  approveWorkflow(projectId: string, body: Version & { revision: number; nodeIds: string[] }, key: string, signal?: AbortSignal) { return this.#json<WorkflowApproval>(`/projects/${id(projectId)}/workflow-approvals`, 'POST', body, key, signal); }
  linkWorkflowTask(projectId: string, body: Version & { revision: number; nodeId: string; taskId?: string }, key: string, signal?: AbortSignal) { return this.#json<Task>(`/projects/${id(projectId)}/workflow-tasks`, 'POST', body, key, signal); }
  confirmWorkflowNode(projectId: string, body: Version & { revision: number; nodeId: string; acceptanceId: string }, key: string, signal?: AbortSignal) { return this.#json<WorkflowConfirmation>(`/projects/${id(projectId)}/workflow-confirmations`, 'POST', body, key, signal); }
  executionGrants(signal?: AbortSignal) { return this.#json<{ items: { id: string; name: string; available: boolean; reason?: string }[] }>('/execution-grants', 'GET', undefined, undefined, signal); }
  executionBinding(projectId: string, signal?: AbortSignal) { return this.#json<BindingStatus>(`/projects/${id(projectId)}/execution-binding`, 'GET', undefined, undefined, signal); }
  bindProjectExecution(projectId: string, body: Version & { grantId: string; inspectionId: string; baselineCommit: string; acknowledgeUncommittedExcluded: true }, key: string, signal?: AbortSignal) { return this.#json<ExecutionBinding>(`/projects/${id(projectId)}/execution-binding`, 'POST', body, key, signal); }
  project(projectId: string, signal?: AbortSignal) { return this.#json<ProjectDetail>(`/projects/${id(projectId)}`, 'GET', undefined, undefined, signal); }
  createProject(body: { name: string; description?: string }, key: string, signal?: AbortSignal) { return this.#json<ProjectDetail>('/projects', 'POST', body, key, signal); }
  updateProject(projectId: string, body: Version & { name?: string; description?: string }, key: string, signal?: AbortSignal) { return this.#json<ProjectDetail>(`/projects/${id(projectId)}`, 'PATCH', body, key, signal); }
  inspectProjectRepository(projectId: string, body: Version & { path: string }, key: string, signal?: AbortSignal) { return this.#json<RepositoryInspection>(`/projects/${id(projectId)}/repository-inspections`, 'POST', body, key, signal); }
  confirmProjectRepository(projectId: string, body: Version & { inspectionId: string; baselineCommit: string; acknowledgeUncommittedExcluded: true }, key: string, signal?: AbortSignal) { return this.#json<RepositoryAssociation>(`/projects/${id(projectId)}/repository`, 'POST', body, key, signal); }
  projectRepository(projectId: string, signal?: AbortSignal) { return this.#json<RepositoryAssociation | null>(`/projects/${id(projectId)}/repository`, 'GET', undefined, undefined, signal); }
  prepareWorkspace(taskId: string, body: Version, key: string, signal?: AbortSignal) { return this.#json<Workspace>(`/tasks/${id(taskId)}/workspace`, 'POST', body, key, signal); }
  startCheck(taskId: string, body: Version & { presetId: string; snapshotId: string }, key: string, signal?: AbortSignal) { return this.#json<CheckRun>(`/tasks/${id(taskId)}/checks`, 'POST', body, key, signal); }
  checks(taskId: string, signal?: AbortSignal) { return this.#json<{ items: CheckRun[]; summary: CheckSummary }>(`/tasks/${id(taskId)}/checks`, 'GET', undefined, undefined, signal); }
  cancelCheck(checkId: string, body: Version, key: string, signal?: AbortSignal) { return this.#json<CheckRun>(`/checks/${id(checkId)}/cancel`, 'POST', body, key, signal); }
  task(taskId: string, signal?: AbortSignal) { return this.#json<TaskDetail>(`/tasks/${id(taskId)}`, 'GET', undefined, undefined, signal); }
  run(runId: string, signal?: AbortSignal) { return this.#json<Run & { input?: string }>(`/runs/${id(runId)}`, 'GET', undefined, undefined, signal); }
  changes(taskId: string, signal?: AbortSignal) { return this.#json<Snapshot | null>(`/tasks/${id(taskId)}/changes`, 'GET', undefined, undefined, signal); }
  file(snapshotId: string, fileId: string, signal?: AbortSignal) { return this.#json<ReviewFile>(`/snapshots/${id(snapshotId)}/files/${id(fileId)}`, 'GET', undefined, undefined, signal); }
  events(taskId: string, after = 0, limit = 50, signal?: AbortSignal) {
    cursor(after); return this.#json<{ items: Event[]; nextCursor: number }>(`/tasks/${id(taskId)}/events?after=${after}&limit=${limit}`, 'GET', undefined, undefined, signal);
  }
  createTask(body: TaskInput, key: string, signal?: AbortSignal) { return this.#json<Task>('/tasks', 'POST', body, key, signal); }
  updateTask(taskId: string, body: Version & Partial<Omit<TaskInput, 'agentInstanceId' | 'projectId'>>, key: string, signal?: AbortSignal) { return this.#json<Task>(`/tasks/${id(taskId)}`, 'PATCH', body, key, signal); }
  startRun(taskId: string, body: Version & { input?: string }, key: string, signal?: AbortSignal) { return this.#json<Run>(`/tasks/${id(taskId)}/runs`, 'POST', body, key, signal); }
  interrupt(runId: string, body: Version, key: string, signal?: AbortSignal) { return this.#json<Run>(`/runs/${id(runId)}/interrupt`, 'POST', body, key, signal); }
  snapshot(taskId: string, body: Version, key: string, signal?: AbortSignal) { return this.#json<Snapshot>(`/tasks/${id(taskId)}/snapshots`, 'POST', body, key, signal); }
  accept(taskId: string, body: Version & { snapshotId: string }, key: string, signal?: AbortSignal) { return this.#json<Task>(`/tasks/${id(taskId)}/accept`, 'POST', body, key, signal); }

  /** One connection, no silent retry. Resume explicitly from the last delivered seq. */
  async *streamEvents(taskId: string, options: { after?: number; signal?: AbortSignal } = {}): AsyncGenerator<Event, void> {
    let after = options.after ?? 0; cursor(after);
    const controller = new AbortController();
    const abort = () => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) abort(); else options.signal?.addEventListener('abort', abort, { once: true });
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await this.#response(`/tasks/${id(taskId)}/events/stream?after=${after}`, 'GET', undefined, undefined, controller.signal);
      if (response.headers.get('content-type')?.split(';')[0].trim() !== 'text/event-stream' || !response.body) {
        await response.body?.cancel(); throw new ApiClientError(response.status, 'invalid_response');
      }
      reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8', { fatal: true });
      let pending = '', data: string[] = [], frameId = '', type = '', size = 0;
      const maxFrame = 12 * 1024 * 1024;
      while (true) {
        controller.signal.throwIfAborted();
        const chunk = await reader.read();
        if (chunk.done) throw new EventStreamError(after, 'disconnected');
        try { pending += decoder.decode(chunk.value, { stream: true }); }
        catch { throw new EventStreamError(after, 'invalid_event'); }
        let end: number;
        while ((end = pending.indexOf('\n')) >= 0) {
          controller.signal.throwIfAborted();
          const line = pending.slice(0, end).replace(/\r$/, ''); pending = pending.slice(end + 1);
          size += line.length;
          if (size > maxFrame) throw new EventStreamError(after, 'frame_too_large');
          if (!line) {
            if (data.length) {
              let value: Event;
              try { value = JSON.parse(data.join('\n')) as Event; } catch { throw new EventStreamError(after, 'invalid_event'); }
              if (!value || value.schemaVersion !== 1 || value.taskId !== taskId || !Number.isSafeInteger(value.seq) || value.seq < 1 || String(value.seq) !== frameId || value.type !== type || typeof value.id !== 'string' || typeof value.occurredAt !== 'string' || !value.data || typeof value.data !== 'object' || Array.isArray(value.data)) throw new EventStreamError(after, 'invalid_event');
              if (value.seq > after) {
                if (value.seq !== after + 1) throw new EventStreamError(after, 'invalid_event');
                after = value.seq; yield value;
              }
            }
            data = []; frameId = ''; type = ''; size = 0;
          } else if (!line.startsWith(':')) {
            const colon = line.indexOf(':');
            const name = colon < 0 ? line : line.slice(0, colon);
            const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
            if (name === 'data') data.push(value);
            else if (name === 'id') frameId = value;
            else if (name === 'event') type = value;
          }
        }
        if (pending.length + size > maxFrame) throw new EventStreamError(after, 'frame_too_large');
      }
    } catch (error) {
      if (options.signal?.aborted) throw options.signal.reason;
      if (error instanceof ApiClientError || error instanceof EventStreamError) throw error;
      throw new EventStreamError(after, 'disconnected');
    } finally {
      options.signal?.removeEventListener('abort', abort); controller.abort();
      await reader?.cancel().catch(() => {}); reader?.releaseLock();
    }
  }
}

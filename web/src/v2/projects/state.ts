import { ApiClient, ApiClientError } from '../api/client/api.ts';
import type { ProjectDetail, RepositoryInspection, RepositoryAssociation } from '../api/client/api.ts';
export type Draft = { name: string; description: string };
export function canConfirmRepository(i: RepositoryInspection | null, p: ProjectDetail | null, acknowledged: boolean, now = Date.now()) {
  return Boolean(i && p && acknowledged && i.confirmable && i.repository.head && i.projectId === p.id && i.projectVersion === p.version && Date.parse(i.expiresAt) > now);
}
export function projectError(e: unknown): string {
  if (!(e instanceof ApiClientError) || e.status >= 500 || e.code === 'invalid_response') return '连接中断，结果未知。输入已保留；请核对后重试原请求。';
  const text: Record<string, string> = {
    version_conflict: '版本冲突。已重读最新版本，草稿仍保留。比较后再明确保存。',
    inspection_stale: '检查版本已过时，请重新检查。', inspection_expired: '检查已过期，请重新检查。',
    repository_changed: '仓库已变化，请重新检查后确认。', no_commit_baseline: '仓库没有 commit 基线，不能确认。',
    repository_scan_limited: '仓库扫描超过限制，未能完整检查；不能当作干净仓库。',
    repository_scan_unsupported: '仓库包含无法完整核验的内容，不能确认。',
    repository_unavailable: '仓库不可访问，请核对路径与权限后重新检查。',
    repository_root_required: '请输入 Git 仓库根目录，不能使用子目录。',
    invalid_repository_path: '请输入已有仓库的绝对路径。', bare_repository_unsupported: '暂不支持裸仓库。',
    invalid_baseline: '基线不符合本次检查，请重新检查。', invalid_input: '输入不符合接口约束，请检查后再提交。',
  };
  return `${text[e.code] ?? '请求被服务拒绝，请核对连接与输入。'} (${e.status} ${e.code})`;
}
type State = { items: {id:string;name:string}[]; selected: string | null; detail: ProjectDetail | null; inspection: RepositoryInspection | null; association: RepositoryAssociation | null; repositoryLoaded: boolean; loading: boolean; listLoading: boolean; writing: boolean; error: string | null; listError: string | null; uncertain: boolean };
type Operation = { signature: string; key: string };
/** One controller per in-memory connection. No credentials or write intents are persisted. */
export class ProjectController {
  private client: ApiClient;
  private value: State = { items:[], selected:null, detail:null, inspection:null, association:null, repositoryLoaded:false, loading:false, listLoading:false, writing:false, error:null, listError:null, uncertain:false };
  private listeners = new Set<() => void>();
  private drafts = new Map<string, Draft>();
  private operations = new Map<string, Operation>();
  private reads?: AbortController;
  private listRead?: AbortController;
  private epoch = 0;
  private detailRead = 0;
  private repositoryRead = 0;
  private busy = false;
  constructor(client: ApiClient) { this.client = client; }
  getSnapshot = () => this.value;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private update(part: Partial<State>) { this.value = {...this.value,...part}; this.listeners.forEach(f => f()); }
  draft(id: string) { return this.drafts.get(id); }
  setDraft(id: string, draft: Draft) { this.drafts.set(id, draft); }
  dispose() { this.epoch++; this.reads?.abort(); this.listRead?.abort(); }
  async list() {
    this.listRead?.abort(); const read = this.listRead = new AbortController();
    this.update({listLoading:true,listError:null});
    try { const page = await this.client.projects(read.signal); if (!read.signal.aborted) this.update({items:page.items}); }
    catch(e) { if (!read.signal.aborted) this.update({listError:projectError(e)}); }
    finally { if (!read.signal.aborted) this.update({listLoading:false}); }
  }
  async select(id: string | null) {
    this.reads?.abort(); const read = this.reads = new AbortController(); const epoch = ++this.epoch;
    this.update({selected:id, detail:null, inspection:null, association:null, repositoryLoaded:false, loading:!!id,error:null,uncertain:false});
    if (!id) return;
    try {
      const detail = await this.client.project(id, read.signal);
      if (read.signal.aborted || epoch !== this.epoch) return;
      if (detail.id !== id) throw new Error('identity_mismatch');
      if (!this.drafts.has(id)) this.drafts.set(id, {name:detail.name,description:detail.description});
      if (this.value.detail && detail.version < this.value.detail.version) return;
      this.update({detail});
    } catch(e) { if (!read.signal.aborted && epoch === this.epoch) this.update({error:projectError(e)}); }
    finally { if (!read.signal.aborted && epoch === this.epoch) this.update({loading:false}); }
  }
  async reread(id = this.value.selected) {
    if (!id) return;
    const epoch = this.epoch; const request = ++this.detailRead;
    try {
      const detail = await this.client.project(id, this.reads?.signal);
      if (epoch !== this.epoch || this.value.selected !== id || request !== this.detailRead) return;
      if (detail.id !== id) throw new Error('identity_mismatch');
      this.update({detail});
    } catch(e) {
      if (epoch === this.epoch && request === this.detailRead && !this.reads?.signal.aborted) this.update({error:(this.value.error ? this.value.error+' ' : '')+'最新版本读取失败，请重新读取。'+projectError(e)});
    }
  }
  private async write<T>(scope: string, body: unknown, action: (key:string) => Promise<T>): Promise<T | undefined> {
    if (this.busy) return;
    this.busy = true; const epoch = this.epoch;
    const signature = JSON.stringify(body);
    const previous = this.operations.get(scope);
    const op = previous?.signature === signature ? previous : {signature,key:crypto.randomUUID()};
    this.operations.set(scope,op); this.update({writing:true,error:null,uncertain:false});
    try { const result = await action(op.key); this.operations.delete(scope); return result; }
    catch(e) {
      const unknown = !(e instanceof ApiClientError) || e.code === 'invalid_response' || e.status >= 500;
      if (!unknown) this.operations.delete(scope);
      if (epoch === this.epoch) {
        this.update({error:projectError(e),uncertain:unknown});
        if (e instanceof ApiClientError && ['repository_changed','inspection_stale','inspection_expired','invalid_baseline','version_conflict'].includes(e.code)) this.update({inspection:null});
        if (e instanceof ApiClientError && e.code === 'version_conflict') {
          try { await this.reread(); } catch { /* Preserve the conflict and draft; latest version unavailable. */ }
        }
      }
    } finally { this.busy = false; this.update({writing:false}); }
  }
  async create(body: Draft | {name:string;description?:string}) {
    const epoch = this.epoch;
    const result = await this.write('create',body,key => this.client.createProject(body,key));
    if (result && epoch === this.epoch) { await this.list(); return result; }
  }
  async save() {
    const p = this.value.detail; if (!p) return;
    const epoch = this.epoch; const body = {...this.drafts.get(p.id)!,expectedVersion:p.version};
    const result = await this.write(`edit:${p.id}`,body,key => this.client.updateProject(p.id,body,key));
    if (result && epoch === this.epoch) { await this.reread(p.id); await this.list(); }
  }
  async inspect(path: string) {
    const p = this.value.detail; if (!p) return;
    const epoch = this.epoch; this.update({inspection:null});
    const result = await this.write(`inspect:${p.id}`,{path,expectedVersion:p.version},key => this.client.inspectProjectRepository(p.id,{path,expectedVersion:p.version},key));
    if (result && epoch === this.epoch && result.projectId === p.id) this.update({inspection:result});
  }
  async confirm(acknowledged: boolean) {
    const p = this.value.detail, i = this.value.inspection;
    if (!canConfirmRepository(i,p,acknowledged) || !i || !p) return;
    const epoch = this.epoch;
    const body = {expectedVersion:p.version,inspectionId:i.id,baselineCommit:i.repository.head!,acknowledgeUncommittedExcluded:true as const};
    const result = await this.write(`confirm:${p.id}`,body,key => this.client.confirmProjectRepository(p.id,body,key));
    if (result && epoch === this.epoch) { this.repositoryRead++; this.update({association:result,repositoryLoaded:true,inspection:null}); await this.reread(p.id); }
  }
  async repository() {
    const id = this.value.selected; if (!id) return; const epoch = this.epoch; const request = ++this.repositoryRead;
    try { const association = await this.client.projectRepository(id,this.reads?.signal); if (epoch === this.epoch && request === this.repositoryRead && (!association || association.projectId === id)) this.update({association,repositoryLoaded:true}); }
    catch(e) { if (epoch === this.epoch && request === this.repositoryRead) this.update({error:projectError(e)}); }
  }
}

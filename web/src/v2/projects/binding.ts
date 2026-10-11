import { ApiClient, ApiClientError } from '../api/client/api.ts';
import type { BindingStatus, ExecutionBinding, ProjectDetail, RepositoryAssociation } from '../api/client/api.ts';

type Grant = Awaited<ReturnType<ApiClient['executionGrants']>>['items'][number];
type BindBody = Parameters<ApiClient['bindProjectExecution']>[1];
type Pending = { projectId: string; body: BindBody; key: string };
type BindingState = {
  projectId: string | null; project: ProjectDetail | null; association: RepositoryAssociation | null;
  grants: Grant[]; status: BindingStatus | null; loading: boolean; writing: boolean;
  error: string | null; pending: Pending | null; receipt: ExecutionBinding | null; requiresInspection: boolean;
};
const REASONS: Record<string,string> = {
  execution_binding_required: '尚未绑定执行授权。请先检查并确认仓库，再选择匹配的受信授权。',
  binding_refresh_required: '仓库关联已更新。请核对最新关联并显式刷新执行绑定；旧任务仍使用原修订。',
  binding_unavailable: '已保存的执行绑定当前不可用。请重新核验绑定，按具体原因检查本机授权与仓库身份。',
  execution_binding_unavailable: '实际执行核验未通过。请返回项目设置重新核验绑定；ready 不代表仍有执行权限。',
  grant_not_authorized: '受信授权未登记或已撤销。请由本机启动配置登记/恢复授权，然后重新核验；网页不能授予信任。',
  grant_repository_mismatch: '所选授权与已确认的仓库不匹配。请选择匹配授权；不能用任意路径替换授权。',
  association_stale: '绑定依据的仓库关联已过时。请重新检查、明确确认仓库，再重新选择绑定。',
  repository_changed: '仓库在确认后已变化。请重新检查并确认 HEAD，再显式绑定。',
  binding_change_forbidden: '已有任务的项目不能更换授权项。保留原授权；需要另一仓库时创建新项目空间。',
  active_run: '服务仍有运行、检查、准备或未知执行占用。等待真实终态，或按服务提供的恢复入口处理后再明确提交。',
  grant_configuration_changed: '本机授权的仓库、工作区根身份或检查范围已改变。请恢复原配置/身份后重新核验；不同仓库应登记新的授权 ID。',
  grant_repository_unavailable: '受信仓库不可访问。请恢复本机仓库路径与访问权限，再重新核验。',
  version_conflict: '项目版本冲突。已重读最新事实；请重新核对并明确确认，不会自动重发旧正文。',
  trusted_configuration: '来自受信启动配置。登录、额度与实际执行结果仍需单独验证。',
};
export function bindingReason(reason?: string) { return reason ? REASONS[reason] ?? reason : '服务未提供具体原因，请重新核验绑定。'; }
function errorText(e: unknown) {
  if (!(e instanceof ApiClientError) || e.status >= 500 || e.code === 'invalid_response') return '绑定响应未知。请核对当前绑定，或用原键和原正文显式重试；不会自动创建第二次操作。';
  return bindingReason(e.code) + ' (' + e.status + ' ' + e.code + ')';
}
function empty(projectId: string | null, writing = false, pending: Pending | null = null): BindingState {
  return {projectId,project:null,association:null,grants:[],status:null,loading:!!projectId,writing,error:null,pending,receipt:null,requiresInspection:false};
}
/** Per in-memory connection: read cancellation never cancels an accepted server write. */
export class BindingController {
  private client: ApiClient;
  private onSaved: () => Promise<void>;
  private value = empty(null);
  private listeners = new Set<() => void>();
  private read?: AbortController;
  private epoch = 0;
  private busy = false;
  private pending = new Map<string,Pending>();
  private blockedInspections = new Map<string,string>();
  constructor(client: ApiClient, onSaved: () => Promise<void> = async () => {}) { this.client=client;this.onSaved=onSaved; }
  getSnapshot = () => this.value;
  subscribe = (fn: () => void) => {this.listeners.add(fn);return () => {this.listeners.delete(fn);};};
  private update(part: Partial<BindingState>) {this.value={...this.value,...part};this.listeners.forEach(fn=>fn());}
  dispose() {this.epoch++;this.read?.abort();}
  async select(id: string | null) {
    this.read?.abort();this.epoch++;
    this.value=empty(id,this.busy,id ? this.pending.get(id) ?? null : null);this.update({});
    if(id) await this.refresh();
  }
  async refresh() {
    const id=this.value.projectId;if(!id)return;
    this.read?.abort();const read=this.read=new AbortController();const epoch=this.epoch;
    this.update({loading:true});
    try {
      const [project,association,grants,status]=await Promise.all([
        this.client.project(id,read.signal),this.client.projectRepository(id,read.signal),
        this.client.executionGrants(read.signal),this.client.executionBinding(id,read.signal),
      ]);
      if(read.signal.aborted || epoch!==this.epoch)return;
      if(project.id!==id || (association && association.projectId!==id) || (status.binding && status.binding.projectId!==id)) throw new ApiClientError(200,'identity_mismatch');
      this.update({project,association,grants:grants.items,status,requiresInspection:!!association && this.blockedInspections.get(id)===association.inspectionId});
    } catch(e) {if(!read.signal.aborted && epoch===this.epoch)this.update({project:null,association:null,grants:[],status:null,error:'执行绑定核验失败。'+errorText(e)});}
    finally {if(!read.signal.aborted && epoch===this.epoch)this.update({loading:false});}
  }
  canBind(grantId: string, acknowledged: boolean) {
    const s=this.value,p=s.project,a=s.association;
    return !!(p && a && !this.busy && !s.loading && !s.pending && !s.requiresInspection && this.blockedInspections.get(p.id)!==a.inspectionId && acknowledged && a.projectId===p.id &&
      a.baselineCommit===p.repository?.baselineCommit && a.confirmedAt===p.repository.confirmedAt &&
      a.uncommittedChangesIncluded===false && s.grants.some(g=>g.id===grantId && g.available));
  }
  async bind(grantId: string, acknowledged: boolean) {
    if(!this.canBind(grantId,acknowledged))return;
    const p=this.value.project!,a=this.value.association!;
    const intent:Pending={projectId:p.id,key:crypto.randomUUID(),body:{expectedVersion:p.version,grantId,inspectionId:a.inspectionId,baselineCommit:a.baselineCommit,acknowledgeUncommittedExcluded:true}};
    this.pending.set(p.id,intent);await this.send(intent);
  }
  async retry() {const intent=this.value.pending;if(intent && !this.busy)await this.send(intent);}
  discard() {
    if(this.busy || !this.value.projectId)return;
    this.pending.delete(this.value.projectId);this.update({pending:null,error:'仅放弃本地重试记录，不撤销服务器可能已保存的绑定。请重新核验事实后再提交新操作。'});
  }
  private async send(intent: Pending) {
    this.busy=true;const epoch=this.epoch;
    this.update({writing:true,pending:intent,error:null,receipt:null});
    let succeeded=false;
    try {
      const binding=await this.client.bindProjectExecution(intent.projectId,intent.body,intent.key);
      if(binding.projectId!==intent.projectId || binding.grantId!==intent.body.grantId || binding.baselineCommit!==intent.body.baselineCommit || !binding.id || !Number.isSafeInteger(binding.revision) || binding.revision<1) throw new ApiClientError(200,'invalid_response');
      this.pending.delete(intent.projectId);succeeded=true;
      if(epoch===this.epoch) this.update({receipt:binding,pending:null});
    } catch(e) {
      const unknown=!(e instanceof ApiClientError) || e.status>=500 || e.code==='invalid_response';
      if(!unknown)this.pending.delete(intent.projectId);
      if(!unknown && e instanceof ApiClientError && ['repository_changed','association_stale'].includes(e.code)) this.blockedInspections.set(intent.projectId,intent.body.inspectionId);
      if(epoch===this.epoch) {
        this.update({error:errorText(e),pending:this.pending.get(intent.projectId)??null});
        if(!unknown)await this.refresh();
      }
    } finally {
      this.busy=false;
      this.update({writing:false,pending:this.value.projectId ? this.pending.get(this.value.projectId)??null : null,requiresInspection:!!this.value.association && this.blockedInspections.get(this.value.association.projectId)===this.value.association.inspectionId});
    }
    if(succeeded && epoch===this.epoch) {
      await this.refresh();
      if(epoch===this.epoch) {try {await this.onSaved();}catch{this.update({error:'绑定已保存，但项目页面重读失败。请重新读取项目；不要据此判断绑定失败。'});}}
    }
  }
}

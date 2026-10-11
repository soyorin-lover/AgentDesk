import { useAgentInstances } from '../live/instances.tsx';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { WorkflowController } from '../workflow/state.ts';
import { WorkflowPage } from '../workflow/WorkflowPage.tsx';
import { ApiClient } from '../api/client/api.ts';
import type { AttentionItem } from '../api/backend/types.ts';
import type { ProjectDetail, RepositoryInspection } from '../api/client/api.ts';
import type { LiveConnection } from '../live/session.ts';
import { useLiveSession } from '../live/session.ts';
import { LiveWorkbench } from '../live/LiveWorkbench.tsx';
import { Dialog } from '../backend/Dialog.tsx';
import { I, Spinner } from '../icons.tsx';
import { BindingController, bindingReason } from './binding.ts';
import { ExecutionBindingSettings } from './ExecutionBinding.tsx';
import { ProjectController, canConfirmRepository, type Draft } from './state.ts';

function route() {
  const match = /^#\/project\/([^/]+)(\/tasks(?:\/([^/]+))?)?$/.exec(window.location.hash);
  try { return {id:match ? decodeURIComponent(match[1]) : null,tasks:!!match?.[2],taskId:match?.[3]?decodeURIComponent(match[3]):null}; } catch { return {id:null,tasks:false,taskId:null}; }
}
export function projectHref(id: string, tasks = false) { return `#/project/${encodeURIComponent(id)}${tasks ? '/tasks' : ''}`; }
function go(id: string | null, tasks = false) { window.location.hash = id ? projectHref(id,tasks) : '#/'; }

export function ProjectPortal({ connection, onDisconnect }: {connection:LiveConnection;onDisconnect:()=>void}) {
  const client = useMemo(() => new ApiClient({baseUrl:connection.origin,getToken:()=>connection.token}),[connection.origin,connection.token]);
  const instances=useAgentInstances(client);
  const controller = useMemo(() => new ProjectController(client),[client]);
  const workflow = useMemo(()=>new WorkflowController(client),[client]);
  const state = useSyncExternalStore(controller.subscribe,controller.getSnapshot);
  const bindingController = useMemo(() => new BindingController(client,async()=>{await controller.reread();await controller.repository();}),[client,controller]);
  const bindingState = useSyncExternalStore(bindingController.subscribe,bindingController.getSnapshot);
  const [location,setLocation] = useState(route);
  const [attentionOpen,setAttentionOpen]=useState(false);
  const [attention,setAttention]=useState<AttentionItem[]>([]);
  const [attentionError,setAttentionError]=useState('');
  const [attentionMore,setAttentionMore]=useState(false);
  useEffect(()=>{if(!attentionOpen)return;const abort=new AbortController();setAttentionError('');void client.attention(0,50,abort.signal).then(v=>{setAttention(v.items);setAttentionMore(v.nextCursor!==null);}).catch(()=>{if(!abort.signal.aborted)setAttentionError('待处理事项读取失败，请关闭后重新打开。');});return()=>abort.abort();},[client,attentionOpen]);
  const [creating,setCreating] = useState(false);
  const [online,setOnline] = useState(navigator.onLine);
  useEffect(() => { const on = () => setLocation(route()); window.addEventListener('hashchange',on); return () => window.removeEventListener('hashchange',on); },[]);
  useEffect(() => { const on = () => setOnline(navigator.onLine); window.addEventListener('online',on);window.addEventListener('offline',on);return () => {window.removeEventListener('online',on);window.removeEventListener('offline',on);}; },[]);
  useEffect(() => { void controller.list(); return () => controller.dispose(); },[controller]);
  useEffect(() => { void controller.select(location.id); },[controller,location.id]);
  useEffect(()=>{void bindingController.select(location.id);return ()=>bindingController.dispose();},[bindingController,location.id]);
  useEffect(()=>{if(state.detail?.id===location.id)void bindingController.refresh();},[bindingController,location.id,state.detail?.id,state.detail?.version]);
  useEffect(()=>{workflow.activate();return()=>workflow.dispose();},[workflow]);
  useEffect(()=>{void workflow.select(location.id);},[workflow,location.id]);
  useEffect(()=>{if(!location.id)return;const timer=setInterval(()=>{const current=workflow.getSnapshot();if(document.visibilityState==='visible'&&!current.loading&&!current.writing)void workflow.refresh();},5000);return()=>clearInterval(timer);},[workflow,location.id]);
  const project = state.detail?.id === location.id ? state.detail : null;
  const executionAllowed = project?.execution.supported && bindingState.projectId===project.id && bindingState.status?.available===true;
  return <div className="project-app">
    <header className="project-topbar">
      <button className="icon-btn global-back" aria-label={location.tasks ? '返回项目工作区' : '返回项目首页'} disabled={!location.id} onClick={() => go(location.tasks ? location.id : null)}><I n="back" s={24}/></button>
      <strong>AgentDesk</strong><span className="meta">{project?.name ?? '项目管理'}</span><span className="ctx__grow"/>
      <span className="tag">本机 HTTP · 项目数据</span><button className="btn" onClick={()=>setAttentionOpen(true)}>待我处理</button><button className="btn" onClick={onDisconnect}>连接设置</button><a className="btn btn--quiet" href="#/preview">交互预览</a>
    </header>
    {!online && <div className="banner banner--warn" role="status">网络已离线。保留已读内容和草稿，恢复后请显式刷新或重试。</div>}
    {location.tasks && project ? <ProjectWorkbench key={`${connection.origin}:${project.id}`} connection={connection} project={project} allowCreate={!!executionAllowed} workflow={workflow} requestedTaskId={location.taskId}/> :
    <main className="project-scroll"><div className={"project-page"+(location.id?" project-page--workspace":"")}>
      {!location.id ? <>
        <div className="project-heading"><div><p className="eyebrow">你的开发空间</p><h1>我的项目</h1><p className="lead">安排下一步工作，让每个 Agent 各司其职。</p></div><button className="btn btn--primary" onClick={()=>setCreating(true)}><I n="plus"/>新建项目</button></div>
        <div className="row gap-3"><button className="btn" disabled={state.listLoading} onClick={()=>void controller.list()}>{state.listLoading ? <Spinner/> : <I n="refresh"/>}刷新项目</button><span className="meta">列表只展示已保存的名称；仓库和执行能力进入项目后读取。</span></div>
        {state.listError && <div className="banner banner--bad mt-6" role="alert">{state.listError}</div>}
        {state.listLoading && !state.items.length ? <p role="status">正在读取项目…</p> : !state.items.length && !state.listError ? <div className="empty project-empty"><I n="branch" s={32}/><h2>还没有项目</h2><p>创建一个项目，开始安排你的第一个 Agent 任务。</p><button className="btn" onClick={()=>setCreating(true)}>创建第一个项目</button></div> :
        <div className="project-grid">{state.items.map(p=><a className="project-card" key={p.id} href={projectHref(p.id)}><span className="project-card__icon"><I n="branch" s={24}/></span><h2>{p.name}</h2><span className="meta">打开项目 <I n="chevR"/></span></a>)}</div>}
      </> : state.loading ? <div className="empty" role="status"><Spinner s={24}/><p>正在读取项目…</p></div> : project ? <>
        <div className="project-heading"><div><p className="eyebrow">项目工作区</p><h1>{project.name}</h1><p className="lead project-description">{project.description || '还没有项目说明'}</p></div><button className="btn" onClick={()=>void controller.reread().catch(()=>controller.select(project.id))}><I n="refresh"/>重新读取</button></div>
        {state.error && <ErrorMessage text={state.error} uncertain={state.uncertain}/>}
        <WorkflowPage connection={connection} instances={instances} key={project.id} controller={workflow} binding={bindingState.status?.binding??null} scope={connection.origin+":"+project.id} onProject={id=>go(id)} onTask={id=>{window.location.hash=projectHref(project.id,true)+"/"+encodeURIComponent(id);}}/>
        <details className="project-setup"><summary>项目设置与仓库 · 按需配置</summary><div className="project-sections"><section className="project-section"><h2>工作与会话</h2><p>流程节点任务在上方显式创建；这里可查看已有任务与创建独立任务。</p>
          {executionAllowed ? <><p>此项目有受支持的执行配置。登录、额度和运行结果仍需单独确认。</p><button className="btn btn--primary" onClick={()=>go(project.id,true)}>进入任务工作台</button></> : <><div className="banner banner--warn">{project.repository ? '仓库已关联，仍需受支持执行绑定。' : '项目空间已保存；执行需要受支持的仓库绑定。'} <span>{bindingReason(project.execution.reason)}</span> <span className="mono">{project.execution.reason}</span></div><button className="btn" disabled>执行暂不可用</button>{bindingState.status?.binding && <button className="btn" onClick={()=>go(project.id,true)}>查看已有任务</button>}</>}
        </section>
        <ExecutionBindingSettings key={"binding:"+project.id} controller={bindingController}/>
        <fieldset className="project-edit-fields" disabled={bindingState.writing}>
        <ProjectSettings key={project.id} controller={controller} project={project}/>
        <RepositoryImport key={`repository:${project.id}`} controller={controller} project={project}/></fieldset></div></details>
      </> : <div className="empty"><h2>项目读取失败</h2><p role="alert">{state.error}</p><button className="btn" onClick={()=>void controller.select(location.id)}>重试读取</button></div>}
    </div></main>}
    {attentionOpen&&<Dialog title="待我处理" onClose={()=>setAttentionOpen(false)} footer={<button className="btn" onClick={()=>setAttentionOpen(false)}>关闭</button>}>{attentionError?<p role="alert">{attentionError}</p>:attention.length?attention.map(i=><article key={i.id} className="workflow-edit-card"><strong>{i.title}</strong><p>{({review:"本轮执行结束，可以审查成果",run_failed:"执行失败，请核对运行记录",run_recovery:"执行结果未知，需要核查",check_failed:"检查未通过",check_recovery:"检查结果未知，需要核查",prepare_workspace:"尚未准备工作区",workspace_recovery:"工作区状态需要核查",task_details:"查看任务详情"} as Record<string,string>)[i.kind]??i.kind}</p><button className="btn" onClick={()=>{setAttentionOpen(false);window.location.hash=projectHref(i.projectId,true)+"/"+encodeURIComponent(i.taskId);}}>前往处理 →</button></article>):<p>没有已读取的待处理事项。</p>}{attentionMore&&<p className="meta">此处只显示前 50 项；其余任务可进入对应项目查看。</p>}<p className="meta">来自服务结构化事项，不从聊天文字推断。关闭窗口不会清除事项。</p></Dialog>}
    {creating && <CreateProject controller={controller} onClose={()=>setCreating(false)}/>}
  </div>;
}
function ErrorMessage({text,uncertain}:{text:string;uncertain?:boolean}) { return <div className="banner banner--bad" role="alert"><div>{text}{uncertain && <p>再次提交相同内容将重试原键与原载荷；更改内容是新操作。可以先刷新项目列表核对。</p>}</div></div>; }
function Fields({draft,onChange}:{draft:Draft;onChange:(d:Draft)=>void}) { return <div className="project-fields"><label>项目名称<input className="input" value={draft.name} maxLength={200} required onChange={e=>onChange({...draft,name:e.target.value})}/></label><label>项目说明<textarea className="input" value={draft.description} maxLength={8000} rows={4} onChange={e=>onChange({...draft,description:e.target.value})}/></label></div>; }
function CreateProject({controller,onClose}:{controller:ProjectController;onClose:()=>void}) {
  const state = useSyncExternalStore(controller.subscribe,controller.getSnapshot);
  const [draft,setDraft] = useState<Draft>(()=>controller.draft('$create') ?? {name:'',description:''});
  const change = (d:Draft) => {setDraft(d);controller.setDraft('$create',d);};
  const submit = async () => { const p = await controller.create(draft); if (p) {controller.setDraft('$create',{name:'',description:''});onClose();go(p.id);} };
  return <Dialog title="新建项目" onClose={onClose} footer={<><button className="btn" onClick={onClose}>关闭</button><button className="btn btn--primary" disabled={state.writing || !draft.name.trim()} onClick={()=>void submit()}>{state.writing ? '正在保存…' : state.uncertain ? '重试原请求 / 提交更改' : '创建项目'}</button></>}><p>先给项目起个名字。创建后可接入已有 Git 仓库，再安排任务。当前网页暂不支持创建目录或系统选目录。</p><Fields draft={draft} onChange={change}/>{state.error && <ErrorMessage text={state.error} uncertain={state.uncertain}/>}</Dialog>;
}
function ProjectSettings({controller,project}:{controller:ProjectController;project:ProjectDetail}) {
  const state = useSyncExternalStore(controller.subscribe,controller.getSnapshot);
  const [draft,setDraft] = useState<Draft>(()=>controller.draft(project.id) ?? {name:project.name,description:project.description});
  const change = (d:Draft) => {setDraft(d);controller.setDraft(project.id,d);};
  return <section className="project-section"><h2>项目设置</h2><p className="meta">当前服务版本 {project.version}；保存使用显式版本与幂等键。</p>
    <Fields draft={draft} onChange={change}/><div className="project-compare"><span>服务当前名称：{project.name}</span><span>服务当前说明：{project.description || '空'}</span></div>
    <button className="btn" disabled={state.writing || !draft.name.trim()} onClick={()=>void controller.save()}>{state.writing ? '正在提交…' : state.uncertain ? '重试相同编辑 / 提交更改' : '保存我的草稿'}</button>
  </section>;
}
function RepositoryFacts({inspection}:{inspection:RepositoryInspection}) {
  const r = inspection.repository;
  return <div className="repository-facts"><dl><dt>真实根目录</dt><dd className="mono">{r.path}</dd><dt>分支状态</dt><dd>{r.headState} · {r.branch ?? '无分支'}</dd><dt>完整 HEAD</dt><dd className="mono">{r.head ?? '无 commit 基线，不能确认'}</dd><dt>已暂存 / 未暂存 / 未跟踪 / 冲突</dt><dd>{r.changes.staged} / {r.changes.unstaged} / {r.changes.untracked} / {r.changes.conflicted}</dd><dt>检查时间 / 过期时间</dt><dd>{new Date(inspection.checkedAt).toLocaleString()} / {new Date(inspection.expiresAt).toLocaleString()}</dd></dl><h3>已有 worktree（{r.worktrees.length}）</h3><ul>{r.worktrees.map((w,index)=><li key={index}><span className="mono">{w.path}</span><br/>{w.branch ?? 'detached'} · <span className="mono">{w.head ?? '无 HEAD'}</span>{w.locked && ' · locked'}{w.prunable && ' · prunable'}</li>)}</ul></div>;
}
function RepositoryImport({controller,project}:{controller:ProjectController;project:ProjectDetail}) {
  const state = useSyncExternalStore(controller.subscribe,controller.getSnapshot);
  const [path,setPath] = useState(''); const [submittedPath,setSubmittedPath] = useState<string | null>(null); const [ack,setAck] = useState(false); const [now,setNow] = useState(Date.now());
  useEffect(()=>{setAck(false);},[state.inspection?.id]);
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return ()=>clearInterval(timer);},[]);
  const i = state.inspection;
  return <section className="project-section"><h2>接入已有 Git 仓库</h2><p>只读检查分支、完整 HEAD、未提交改动和 worktree。网页没有系统目录选择器，请输入仓库根目录绝对路径。</p>
    {project.repository && <div className="repository-saved"><strong>已保存的基线</strong><p className="mono">{project.repository.baselineCommit}</p><p>确认时间 {new Date(project.repository.confirmedAt).toLocaleString()}。这是确认当时的事实，不表示当前仓库仍相同或干净。</p><button className="btn" disabled={state.writing} onClick={()=>void controller.repository()}>读取已保存关联详情</button>{state.repositoryLoaded && (state.association ? <p className="mono">{state.association.repository.path}</p> : <p>没有关联记录</p>)}</div>}
    <label className="project-path">仓库根目录绝对路径<input className="input mono" value={path} disabled={state.writing} maxLength={4096} onChange={e=>{setPath(e.target.value);setAck(false);setSubmittedPath(null);}} spellCheck={false}/></label>
    <button className="btn" disabled={!path.trim() || state.writing} onClick={()=>{setAck(false);setSubmittedPath(path);void controller.inspect(path);}}>{state.writing ? '正在提交…' : state.uncertain ? '重试检查原请求' : '只读检查仓库'}</button>
    {i && <div className="repository-inspection"><RepositoryFacts inspection={i}/>{!i.confirmable ? <p role="status">没有 commit 基线，不能确认。请在外部工具显式处理后重新检查。</p> : Date.parse(i.expiresAt)<=now ? <p role="status">检查已过期，请重新检查。</p> : <>
      <label className="repository-ack"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/>我确认以本次检查的完整 HEAD 为基线；未提交改动不会进入新 worktree，也不会被保存、覆盖或自动提交。</label>
      <button className="btn btn--primary" disabled={state.writing || path !== submittedPath || !canConfirmRepository(i,project,ack,now)} onClick={()=>void controller.confirm(ack)}>确认本次 HEAD 并保存关联</button>
    </>}</div>}
  </section>;
}
function ProjectWorkbench({connection,project,allowCreate,workflow,requestedTaskId}:{connection:LiveConnection;project:ProjectDetail;allowCreate:boolean;workflow:WorkflowController;requestedTaskId:string|null}) {
  const live = useLiveSession({connection,transport:'http',projectId:project.id,projectName:project.name,allowCreate});
  useEffect(()=>{if(requestedTaskId)live.setTaskId(requestedTaskId);},[requestedTaskId,live.setTaskId]);
  useEffect(()=>{const timer=setTimeout(()=>void workflow.refresh(),250);return()=>clearTimeout(timer);},[workflow,live.state.transcript.after,live.state.fetchedAt]);
  const [second,setSecond]=useState<string|null>(null);
  const compare=useLiveSession({connection,transport:'http',projectId:project.id,projectName:project.name,allowCreate:false,lane:'compare',enabled:!!second});
  useEffect(()=>{compare.setTaskId(second);},[second,compare.setTaskId]);
  useEffect(()=>{if(second===live.taskId)setSecond(null);},[second,live.taskId]);
  return <div className={'node-workspace'+(second?' node-workspace--dual':'')}><div className="comparison-toolbar"><label>临时查看第二会话<select className="input" value={second??''} onChange={e=>setSecond(e.target.value||null)}><option value="">单会话</option>{live.tasks.filter(t=>t.id!==live.taskId).map(t=><option key={t.id} value={t.id}>{t.title}</option>)}</select></label>{second&&<button className="btn" onClick={()=>setSecond(null)}>返回单会话</button>}<span className="meta">同项目独立任务 · 仅比较会话，后端仍全局串行</span>{live.nextCursor!==null&&<button className="btn" disabled={live.listBusy} onClick={()=>void live.loadMore()}>载入更多任务</button>}</div><div className="session-panes"><section aria-label="主任务会话"><LiveWorkbench live={live}/></section>{second&&<section aria-label="第二任务会话"><LiveWorkbench live={compare}/></section>}</div></div>;
}



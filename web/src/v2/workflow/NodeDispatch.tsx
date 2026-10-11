import { useEffect, useState } from 'react';
import { Dialog } from '../backend/Dialog.tsx';
import { useLiveSession, type LiveConnection } from '../live/session.ts';
export function NodeDispatch({connection,projectId,taskId,disabled,onTask}:{connection:LiveConnection;projectId:string;taskId:string;disabled:boolean;onTask:()=>void}) {
 const live=useLiveSession({connection,projectId,transport:'http',allowCreate:false,lane:'node-detail'});
 useEffect(()=>{live.setTaskId(taskId);},[taskId,live.setTaskId]);
 const [confirm,setConfirm]=useState<number|null>(null);
 const d=live.state.detail,task=d?.task,workspace=live.workspace;
 const canStart=!disabled&&!live.writing&&live.actions.includes('start')&&task?.id===taskId;
 return <div className="node-dispatch">
 {live.state.error&&<p role="alert">{live.state.error.title} · {live.state.error.detail}</p>}
 {live.state.loading&&<p className="meta">正在核对执行条件…</p>}
 {live.actions.includes('prepare_workspace')&&<><button className="btn" disabled={disabled||live.writing} onClick={()=>live.run({kind:'prepare',taskId})}>准备任务工作区</button><p className="meta">创建独立 Git 工作区和分支，不启动 Agent。</p></>}
 <button className="btn btn--primary" disabled={!canStart} onClick={()=>task&&setConfirm(task.version)}>下发任务</button>
 {!canStart&&task&&<p className="meta">{d?.workflowAuthorization?.eligible===false?'当前计划未授权，或任务属于旧计划。':d?.agentAuthorization?.eligible===false?'固定 Agent 配置不能授权，请重新检查配置。':task.blockedReason?'执行结果未知，请先核查已有运行。':d?.run?.status==='running'?'这项任务正在执行。':workspace?.status!=='ready'?'请先准备工作区，等服务确认就绪。':'当前暂不能下发，请刷新核对依赖或服务占用。'} 当前服务一次只执行一项任务，没有等待队列。</p>}
 <button className="btn" onClick={onTask}>进入任务工作台 →</button>
 {live.notice&&<p role="status">{live.notice}</p>}
 {live.writeError&&<div role="alert"><p>{live.writeError.title} · {live.writeError.detail}</p>{live.pending&&<button className="btn" disabled={live.writing} onClick={live.retryPending}>重试原请求</button>}<p className="meta">尚未确认成功，不会显示为排队或执行中。</p></div>}
 {confirm!==null&&task&&<Dialog title="确认下发任务" onClose={()=>setConfirm(null)} footer={<><button className="btn" onClick={()=>setConfirm(null)}>取消</button><button className="btn btn--primary" disabled={!canStart||task.version!==confirm} onClick={()=>{live.run({kind:'start',taskId});setConfirm(null);}}>确认下发</button></>}><p>将启动这项任务，调用模型并消耗额度。</p><dl className="binding-facts"><dt>任务</dt><dd>{task.title}</dd><dt>执行者</dt><dd>{live.instances.items.find(i=>i.id===task.agentInstanceId)?.name??task.agentInstanceId}</dd><dt>工作区</dt><dd className="mono">{workspace?.id??'尚未读取'} · {workspace?.branch??'分支未读取'}（接口未提供目录路径）</dd><dt>代码基线</dt><dd className="mono">{task.executionBinding?.baselineCommit??'尚未读取'}</dd><dt>执行目标</dt><dd>{task.goal}</dd></dl><p>下发后留在蓝图。以服务返回的真实状态为准；执行结束后仍需审查成果。</p>{task.version!==confirm&&<p role="alert">任务已变化，请取消后重新核对。</p>}</Dialog>}
 </div>;
}


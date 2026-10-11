import { useState, useSyncExternalStore } from 'react';
import type { TaskExecutionBinding } from '../api/backend/types.ts';
import type { useAgentInstances } from '../live/instances.tsx';
import { WorkflowController, validateDraft, workflowReason } from './state.ts';
import { applyNodeForm, type NodeForm } from './node-edit.ts';
const forms=new Map<string,NodeForm>();
export function NodeEditor({controller,instances,binding,nodeId,scope,onClose,previewOnly=false}:{controller:WorkflowController;instances:ReturnType<typeof useAgentInstances>;binding:TaskExecutionBinding|null;nodeId:string|null;scope:string;previewOnly?:boolean;onClose:()=>void}) {
 const state=useSyncExternalStore(controller.subscribe,controller.getSnapshot),key=scope+':'+(nodeId??'new');
 const [form,setForm]=useState<NodeForm>(()=>{const n=state.draft?.nodes.find(n=>n.id===nodeId);return forms.get(key)??{id:n?.id??'task-'+crypto.randomUUID(),name:n?.name??'',goal:n?.goal??'',criteria:n?.acceptanceCriteria.join('\n')??'',instanceId:n?.agentInstanceId??instances.items[0]?.id??'',dependencyIds:n?.dependencyIds??[],parentId:n?.parentId??''};});
 const [review,setReview]=useState(false),[ack,setAck]=useState(false),[error,setError]=useState('');
 const change=(p:Partial<NodeForm>)=>{const next={...form,...p};forms.set(key,next);setForm(next);setReview(false);setAck(false);};
 const draft=state.draft;if(!draft)return <p>正在读取计划…</p>;
 const stage=()=>{try{const next=applyNodeForm(draft,form,binding,instances.items.find(i=>i.id===form.instanceId)?.name??form.instanceId);const errors=validateDraft(next);if(errors.length)throw Error('请填写名称、任务说明和验收条件，并检查执行者与依赖。');controller.setDraft(next);setError('');setReview(true);}catch(e){setError(String(e instanceof Error?e.message:e));}};
 const save=async()=>{await controller.save();const s=controller.getSnapshot();if(!s.error&&!s.pending&&!s.dirty){forms.delete(key);onClose();}};
 return <div className="blueprint-editor"><p className="meta">先保存为计划，再单独批准。保存不会启动 Agent。</p>
 {review?<><div className="blueprint-summary"><h3>{form.name}</h3><p>{form.goal}</p><p>执行者：{instances.items.find(i=>i.id===form.instanceId)?.name??form.instanceId}</p><p>验收：{form.criteria}</p></div><p className="banner banner--warn">保存会撤销旧计划的全部后续批准。已有任务、会话和代码保留；新计划批准后需要创建新任务。</p>
 {state.draftVersion!==state.view?.version&&<p>计划已更新。请比较后再保存。<button className="btn" onClick={()=>{controller.adoptCurrentVersion();setReview(false);setAck(false);}}>采用当前版本，返回编辑</button></p>}
 <label className="repository-ack"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/>我理解旧批准将失效，历史记录保留。</label><div className="row"><button className="btn" onClick={()=>setReview(false)}>返回编辑</button><button className="btn btn--primary" disabled={previewOnly||!ack||state.loading||state.writing||!!controller.pendingProjectId()||state.draftVersion!==state.view?.version} onClick={()=>void save()}>确认保存计划</button></div></>:<fieldset disabled={state.writing||!!controller.pendingProjectId()} className="blueprint-fields">
 <label>任务名称<input className="input" maxLength={200} value={form.name} onChange={e=>change({name:e.target.value})}/></label>
 <label>任务说明<textarea className="input" rows={5} maxLength={64000} value={form.goal} onChange={e=>change({goal:e.target.value})}/></label>
 <label>交给谁？<select aria-label="交给谁？" className="input" value={form.instanceId} onChange={e=>change({instanceId:e.target.value})}><option value="" disabled>选择 Agent</option>{!instances.items.some(i=>i.id===form.instanceId)&&form.instanceId&&<option value={form.instanceId}>{form.instanceId} · 信息未读取</option>}{instances.items.map(i=><option key={i.id} value={i.id}>{i.name}{!i.available?' · 暂不支持执行':''}</option>)}</select></label>
 <label>怎样算完成？<textarea className="input" rows={3} value={form.criteria} onChange={e=>change({criteria:e.target.value})} placeholder="每行一条验收条件"/></label>
 <details><summary>前置任务与层级</summary><p className="meta">前置任务决定执行条件；层级只整理结构。</p>{draft.nodes.filter(n=>n.id!==form.id).map(n=><label className="repository-ack" key={n.id}><input type="checkbox" checked={form.dependencyIds.includes(n.id)} onChange={e=>change({dependencyIds:e.target.checked?[...form.dependencyIds,n.id]:form.dependencyIds.filter(id=>id!==n.id)})}/>{n.name}</label>)}<label>放在哪个任务下面？<select className="input" value={form.parentId} onChange={e=>change({parentId:e.target.value})}><option value="">顶层</option>{draft.nodes.filter(n=>n.id!==form.id).map(n=><option key={n.id} value={n.id}>{n.name}</option>)}</select></label></details>
 {!binding&&!nodeId&&<p>新增任务前，请到项目设置确认执行仓库与代码基线。</p>}
 <button className="btn btn--primary" disabled={!form.name.trim()||!form.goal.trim()||!form.criteria.trim()||!form.instanceId||(!binding&&!nodeId)||state.loading} onClick={stage}>审阅并保存计划</button></fieldset>}
 {(error||state.error)&&<p role="alert">{error||workflowReason(state.error!)}</p>}<p className="meta">收起面板保留本页草稿；刷新网页不保留。</p></div>;
}



import type { AgentInstance, Run, TaskDetail, WorkflowNode } from '../api/client/api.ts';
export const engineName=(id?:string)=>id==='codex'?'Codex':id==='claude_code'?'Claude':id==='deepseek_harness'?'DeepSeek':id??'工具未知';
export const engineMark=(id?:string)=>id==='codex'?'G':id==='claude_code'?'C':id==='deepseek_harness'?'D':'?';
export function modelLabels(run?:Pick<Run,'model'|'modelEvidence'>):string[]{
 const e=run?.modelEvidence;
 return [e?.status==='reported'&&e.actualModel?'实际模型 · '+e.actualModel:'实际模型未知',...(e?.configuredModel?['配置模型 · '+e.configuredModel]:[]),...(e?.routingModel?['路由模型 · '+e.routingModel]:[])];
}
export function authorizedActions(detail:TaskDetail|null,instance?:AgentInstance):string[]{
 const capability:Record<string,string>={start:'start',feedback:'continue',interrupt:'interrupt'};
 return (detail?.availableActions??[]).filter(a=>{
  if(!capability[a])return true;
  if((a==='start'||a==='feedback')&&(detail?.agentAuthorization?.eligible===false||detail?.workflowAuthorization?.eligible===false))return false;
  return !!instance?.capabilities.some(c=>c.name===capability[a]&&c.businessSupport==='implemented');
 });
}
export function withInstance<T extends Pick<WorkflowNode,'agentInstanceId'|'agentBinding'>>(node:T,id:string):T{
 if(node.agentInstanceId===id)return {...node};
 const {agentBinding:_binding,...rest}=node;return {...rest,agentInstanceId:id} as T;
}

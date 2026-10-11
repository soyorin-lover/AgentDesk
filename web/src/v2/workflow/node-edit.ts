import type { WorkflowNode, TaskExecutionBinding } from '../api/backend/types.ts';
import type { EditableWorkflow } from './state.ts';
import { withInstance } from '../live/evidence.ts';
export type NodeForm = {id:string;name:string;goal:string;criteria:string;instanceId:string;dependencyIds:string[];parentId:string};
export function applyNodeForm(draft:EditableWorkflow,form:NodeForm,binding:TaskExecutionBinding|null,instanceName:string):EditableWorkflow {
 const d=structuredClone(draft),old=d.nodes.find(n=>n.id===form.id);
 if(!old&&!binding)throw Error('请先在项目设置中确认执行仓库和代码基线。');
 let member=d.members.find(m=>m.id===old?.memberId&&m.agentInstanceId===form.instanceId)??d.members.find(m=>m.agentInstanceId===form.instanceId);
 if(!member){const id=crypto.randomUUID();const roleId='role-'+id,memberId='agent-'+id;d.roles.push({id:roleId,name:instanceName,responsibility:'完成分配的任务',defaultAgentInstanceId:form.instanceId});member={id:memberId,name:instanceName,roleId,agentInstanceId:form.instanceId};d.members.push(member);}
 const node:WorkflowNode={...(old?withInstance(old,form.instanceId):{}),id:form.id,name:form.name.trim(),goal:form.goal.trim(),acceptanceCriteria:form.criteria.split('\n').map(s=>s.trim()).filter(Boolean),roleId:member.roleId,memberId:member.id,agentInstanceId:form.instanceId,dependencyIds:[...form.dependencyIds],executionBinding:old?.executionBinding??{id:binding!.id,revision:binding!.revision,grantId:binding!.grantId,baselineCommit:binding!.baselineCommit}};
 delete node.parentId;if(form.parentId)node.parentId=form.parentId;
 d.nodes=old?d.nodes.map(n=>n.id===node.id?node:n):[...d.nodes,node];return d;
}

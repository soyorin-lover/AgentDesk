import { useState } from 'react';
import type { WorkflowView } from '../api/backend/types.ts';
const notes=new Map<string,string>();
export function PlannerPanel({scope,preview,onPreview}:{scope:string;preview:boolean;onPreview:(show:boolean)=>void}) {
 const [note,setNote]=useState(notes.get(scope)??'');
 return <div className="planner-panel"><span className="tag">交互预览 · 未连接 Agent</span><h3>一起把下一步想清楚</h3><p>先讨论目标，再审阅候选计划。聊天建议不会自动加入正式蓝图。</p><div className="planner-example"><span className="eyebrow">示例策划建议</span><p>可以先明确日志格式，再分别完成解析器和界面，最后联调。</p><ol><li>确定日志格式与验收</li><li>实现日志解析器</li><li>制作日志查看界面</li><li>联合检查</li></ol><button className="btn" onClick={()=>onPreview(!preview)}>{preview?'返回正式蓝图':'查看示例候选计划'}</button></div><label className="blueprint-note">你的想法<textarea className="input" rows={4} value={note} onChange={e=>{notes.set(scope,e.target.value);setNote(e.target.value);}} placeholder="先记下想讨论的目标…"/></label><button className="btn btn--primary" disabled>策划发送暂未接通</button><p className="meta">这里只保留本页笔记，不发送消息。独立策划会话与 AI 生成结构化计划需要后端支持。</p></div>;
}
export function candidateView(view:WorkflowView):WorkflowView {
 const names=['确定日志格式与验收','实现日志解析器','制作日志查看界面','联合检查'];
 return {...view,roles:[],members:[],links:[],approvals:[],nodeStates:[],nodes:names.map((name,i)=>({id:'preview-'+i,name,goal:'示例候选，尚未保存',acceptanceCriteria:[],roleId:'preview',memberId:'preview',agentInstanceId:i===2?'preview-claude':'preview-codex',dependencyIds:i===0?[]:i===3?['preview-1','preview-2']:['preview-0'],executionBinding:{id:'preview',revision:0,grantId:'preview',baselineCommit:'preview'}}))};
}

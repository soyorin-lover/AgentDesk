import type { AcceptanceSummary } from '../api/backend/types.ts';
const known = new Set(['start','feedback','snapshot','check','cancel_check','prepare_workspace','edit','interrupt','accept','recover_check']);
export function visibleActions(actions:string[]) { return actions.filter(a=>known.has(a)); }
export function taskBelongsToProject(task:{projectId:string}, projectId?:string) { return !projectId || task.projectId === projectId; }
export function acceptanceView(summary?: AcceptanceSummary) {
  if (!summary) return {valid:false,text:'接受有效性尚未核验'};
  const text = {not_accepted:'尚未接受',valid:'当前接受有效',invalid:'上次接受已失效',unverifiable:'接受有效性无法核验'}[summary.status];
  return {valid:summary.status==='valid',text:text+(summary.reason ? `：${summary.reason}` : '')};
}

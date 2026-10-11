import type { AttentionItem, CheckRun, Run, Task, Workspace } from './types.ts';

/** Persistent facts only. No filesystem scan, invented approval or model availability. */
export function attentionItems(tasks: Task[], runs: Run[], checks: CheckRun[], workspace: (id: string) => Workspace): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const task of tasks) {
    const add = (kind: AttentionItem['kind'], resourceId: string, reason?: string) => items.push({ id: kind + ':' + resourceId, taskId: task.id, projectId: task.projectId, title: task.title, kind, resourceId, reason });
    const ws = workspace(task.id);
    if (ws.status === 'unprepared') add('prepare_workspace', ws.id);
    if (ws.status === 'failed' || ws.status === 'needs_recovery') add('workspace_recovery', ws.id, ws.reason);
    if (task.status === 'draft') add('task_details', task.id);
    for (const run of runs.filter(r => r.taskId === task.id && r.status === 'needs_recovery')) add('run_recovery', run.id, run.outcomeReason);
    for (const check of checks.filter(c => c.taskId === task.id && c.status === 'needs_recovery')) add('check_recovery', check.id, check.reason);
    const latestRun = runs.find(r => r.id === task.latestRunId);
    if (latestRun?.status === 'failed' || latestRun?.status === 'aborted') add('run_failed', latestRun.id, latestRun.outcomeReason ?? latestRun.status);
    if (task.status === 'in_review' && latestRun?.status === 'succeeded') add('review', task.id);
    const latestCheck = checks.filter(c => c.taskId === task.id).at(-1);
    if (latestCheck && latestCheck.runId === task.latestRunId && ['failed', 'cancelled', 'timed_out'].includes(latestCheck.status)) add('check_failed', latestCheck.id, latestCheck.reason ?? latestCheck.status);
  }
  return items;
}

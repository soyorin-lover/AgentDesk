import type { Event, TaskDetail } from './api.ts';
export function runInput(detail: TaskDetail, input?: string): { expectedVersion: number; input?: string } {
  const feedback = Boolean(detail.task.latestRunId);
  if (detail.task.blockedReason || !detail.availableActions.includes(feedback ? 'feedback' : 'start')) throw Error('Execution unavailable');
  if (!feedback) return { expectedVersion: detail.task.version };
  if (!input?.trim() || input.length > 64000) throw Error('Feedback required');
  return { expectedVersion: detail.task.version, input: input.trim() };
}
export type Transcript = { after: number; messages: { id: string; runId?: string; text: string }[]; rounds: { id: string; startedAt: string; status?: string }[]; activity: string; diagnostics: string[] };
export function emptyTranscript(): Transcript { return { after: 0, messages: [], rounds: [], activity: '', diagnostics: [] }; }
/** The UI and replay use the same reducer. Execution state always comes from TaskDetail. */
export function appendEvent(state: Transcript, event: Event): Transcript {
  if (event.seq <= state.after) return state;
  if (event.seq !== state.after + 1) throw Error('Event sequence gap');
  const next = { ...state, after: event.seq };
  const data = event.data;
  if (event.type === 'run.created' && event.runId && !state.rounds.some(r => r.id === event.runId)) {
    next.rounds = [...state.rounds, { id: event.runId, startedAt: event.occurredAt, status: typeof data.status === 'string' ? data.status : undefined }];
  } else if (event.type === 'run.status_changed' && event.runId && typeof data.status === 'string') {
    next.rounds = state.rounds.map(r => r.id === event.runId ? { ...r, status: data.status as string } : r);
  }
  if ((event.type === 'message.delta' || event.type === 'message.completed') && typeof data.messageId === 'string' && typeof data.text === 'string') {
    const index = state.messages.findIndex(m => m.id === data.messageId && m.runId === event.runId);
    const previous = index >= 0 ? state.messages[index] : undefined;
    const message = { id: data.messageId, runId: event.runId, text: event.type === 'message.completed' ? data.text : (previous?.text ?? '') + data.text };
    next.messages = [...state.messages];
    if (index >= 0) next.messages[index] = message; else next.messages.push(message);
  } else if (event.type.startsWith('activity.') && typeof data.category === 'string') {
    next.activity = data.category;
  } else if (event.type === 'diagnostic.recorded' && typeof data.category === 'string') {
    next.diagnostics = [...state.diagnostics, data.category + (typeof data.code === 'string' ? ' · ' + data.code : '')];
  }
  return next;
}

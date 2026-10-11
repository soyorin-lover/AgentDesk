import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyTranscript, appendEvent, runInput } from '../src/client/execution.ts';
import type { TaskDetail } from '../src/client/api.ts';
import type { Event } from '../src/backend/types.ts';
const event = (seq: number, type: string, data: Record<string, unknown>, runId = 'r1'): Event => ({ schemaVersion: 1, id: `e${seq}`, taskId: 't1', runId, seq, occurredAt: '2026-10-08T00:00:00Z', type, data });
test('execution transcript restores chunks and replaces them with complete text without duplication', () => {
  let state = emptyTranscript();
  const events = [event(1, 'message.delta', { messageId: 'm1', text: '你好' }), event(2, 'message.delta', { messageId: 'm1', text: '，世界' }), event(3, 'message.completed', { messageId: 'm1', text: '你好，世界' })];
  for (const item of events) state = appendEvent(state, item);
  assert.equal(state.messages[0].text, '你好，世界');
  assert.equal(state.after, 3);
  assert.equal(appendEvent(state, events[1]), state);
  state = appendEvent(state, event(4, 'message.completed', { messageId: 'm1', text: '下一轮' }, 'r2'));
  assert.equal(state.messages.length, 2);
});
test('execution transcript keeps activity and safe diagnostic categories; gaps cannot silently lose events', () => {
  let state = appendEvent(emptyTranscript(), event(1, 'activity.started', { category: 'reasoning' }));
  assert.equal(state.activity, 'reasoning');
  state = appendEvent(state, event(2, 'diagnostic.recorded', { category: 'request_denied', code: 'interactive_requests_unavailable' }));
  assert.equal(state.diagnostics[0], 'request_denied · interactive_requests_unavailable');
  assert.throws(() => appendEvent(state, event(4, 'task.updated', {})), /gap/);
});
test('feedback uses the current task version and cannot run while unavailable or unknown', () => {
  const detail: TaskDetail = { task: { schemaVersion: 1, id: 't1', projectId: 'p', workspaceId: 'w', title: '任务', goal: '目标', acceptanceCriteria: ['条件'], agentInstanceId: 'codex-local', status: 'in_review', latestRunId: 'r1', version: 8, createdAt: '' }, lastEventSeq: 3, availableActions: ['feedback'] };
  assert.deepEqual(runInput(detail, '  我的目标  '), { expectedVersion: 8, input: '我的目标' });
  assert.throws(() => runInput(detail, ' '), /Feedback required/);
  assert.throws(() => runInput({ ...detail, availableActions: [] }, '重跑'), /unavailable/);
  assert.throws(() => runInput({ ...detail, task: { ...detail.task, blockedReason: 'result_unknown' } }, '重跑'), /unavailable/);
  assert.deepEqual(runInput({ ...detail, task: { ...detail.task, latestRunId: undefined, status: 'ready' }, availableActions: ['start'] }), { expectedVersion: 8 });
});
test('execution rounds preserve creation order and independent terminal states when replayed', () => {
  let state = appendEvent(emptyTranscript(), event(1, 'run.created', { status: 'running' }));
  state = appendEvent(state, event(2, 'run.status_changed', { status: 'succeeded' }));
  state = appendEvent(state, event(3, 'run.created', { status: 'running' }, 'r2'));
  assert.deepEqual(state.rounds.map(r => [r.id, r.status]), [['r1', 'succeeded'], ['r2', 'running']]);
  assert.equal(appendEvent(state, event(3, 'run.created', { status: 'running' }, 'r2')).rounds.length, 2);
});

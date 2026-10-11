import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  presentCheck,
  presentCheckRun,
  progressSentence,
  workspaceText,
} from './presentation.ts';
import type { CheckRun, CheckSummary, Workspace } from '../api/backend/types.ts';

/* ─────────────────────────────────────────────────────────────
   呈现规则的确定性测试

   重点不是「函数返回了字符串」，而是几条不能被混淆的产品不变式：
   只有 passed + current 能说「当前版本检查通过」；
   过时的通过不能变成通过；未运行不是通过；
   未准备/准备中/失败/待恢复的工作区都不能启动。
   ───────────────────────────────────────────────────────────── */

test('not_run 不是通过，也不能声称通过', () => {
  const p = presentCheck({ status: 'not_run' });
  assert.equal(p.key, 'not_run');
  assert.equal(p.canClaimPassed, false);
  assert.notEqual(p.tone, 'ok');
  assert.match(p.detail, /不等于通过/);
});

test('summary 缺失时按未运行处理', () => {
  assert.equal(presentCheck(undefined).key, 'not_run');
});

test('只有 passed + current 可以说「当前版本检查通过」', () => {
  const p = presentCheck({ status: 'passed', validity: 'current', checkId: 'c1' });
  assert.equal(p.key, 'passed_current');
  assert.equal(p.canClaimPassed, true);
  assert.equal(p.label, '当前版本检查通过');
  assert.equal(p.tone, 'ok');
});

test('passed + stale 显示为旧版本通过，且不得是绿色通过', () => {
  const p = presentCheck({ status: 'passed', validity: 'stale', checkId: 'c1' });
  assert.equal(p.key, 'passed_stale');
  assert.equal(p.canClaimPassed, false);
  assert.equal(p.tone, 'wait');
  assert.match(p.label, /旧版本/);
  assert.match(p.detail, /重新检查/);
});

test('failed 无论是 current 还是 stale 都不能变成通过', () => {
  for (const validity of ['current', 'stale'] as const) {
    const p = presentCheck({ status: 'failed', validity, checkId: 'c1' });
    assert.equal(p.canClaimPassed, false);
    assert.equal(p.tone, 'bad');
    assert.match(p.label, /失败/);
  }
});

test('failed + stale 明确说明过时，但仍保留「确实失败过」', () => {
  const p = presentCheck({ status: 'failed', validity: 'stale', checkId: 'c1' });
  assert.equal(p.key, 'failed_stale');
  assert.match(p.detail, /不能代表当前版本/);
  assert.match(p.detail, /不会因为过时而变成通过/);
});

test('五种状态在措辞上彼此可区分', () => {
  const keys = [
    presentCheck({ status: 'not_run' }).key,
    presentCheck({ status: 'running', validity: 'stale' }).key,
    presentCheck({ status: 'passed', validity: 'current' }).key,
    presentCheck({ status: 'passed', validity: 'stale' }).key,
    presentCheck({ status: 'failed', validity: 'current' }).key,
    presentCheck({ status: 'cancelled', validity: 'stale' }).key,
    presentCheck({ status: 'timed_out', validity: 'stale' }).key,
    presentCheck({ status: 'needs_recovery', validity: 'stale' }).key,
  ];
  assert.equal(new Set(keys).size, keys.length);
});

test('cancelled 与 timed_out 都不是通过，也不能当成失败来冒充结论', () => {
  const cancelled = presentCheck({ status: 'cancelled', validity: 'current' });
  assert.equal(cancelled.canClaimPassed, false);
  assert.match(cancelled.detail, /不代表通过/);

  const timedOut = presentCheck({ status: 'timed_out', validity: 'current' });
  assert.equal(timedOut.canClaimPassed, false);
  assert.match(timedOut.detail, /不等于测试失败/);
});

test('needs_recovery 说明结果未知并要求人工核查', () => {
  const p = presentCheck({ status: 'needs_recovery', validity: 'stale' });
  assert.equal(p.tone, 'wait');
  assert.equal(p.canClaimPassed, false);
  assert.match(p.detail, /无法确认/);
  assert.match(p.detail, /人工核查/);
});

test('检查记录：过时的那一条带出显式提示', () => {
  const run = checkRun({ status: 'passed', validity: 'stale' });
  const p = presentCheckRun(run);
  assert.equal(p.key, 'passed_stale');
  assert.equal(p.staleNote, '这一条针对的是更早的版本');

  const current = presentCheckRun(checkRun({ status: 'passed', validity: 'current' }));
  assert.equal(current.staleNote, undefined);
});

test('运行中的检查不带「过时」提示（还没有结论）', () => {
  const p = presentCheckRun(checkRun({ status: 'running', validity: 'stale' }));
  assert.equal(p.staleNote, undefined);
  assert.equal(p.key, 'running');
});

test('工作区四种阻塞状态都不能启动，只有 ready 可以', () => {
  const statuses: Array<Workspace['status']> = [
    'unprepared',
    'preparing',
    'ready',
    'failed',
    'needs_recovery',
  ];
  for (const status of statuses) {
    const text = workspaceText({ id: 'w', taskId: 't', projectId: 'p', status });
    assert.ok(text, `${status} 必须有文案`);
    assert.equal(text.blocksStart, status !== 'ready', `${status} 的 blocksStart 判定错误`);
  }});

test('工作区的五种措辞彼此不同', () => {
  const labels = (['unprepared', 'preparing', 'ready', 'failed', 'needs_recovery'] as const).map(
    (status) => workspaceText({ id: 'w', taskId: 't', projectId: 'p', status })!.label,
  );
  assert.equal(new Set(labels).size, labels.length);
});

test('待恢复的工作区不承诺自动重放', () => {
  const text = workspaceText({ id: 'w', taskId: 't', projectId: 'p', status: 'needs_recovery' })!;
  assert.match(text.detail, /不提供自动重放/);
});

test('四个阶段措辞互不相同，且接受不写成集成', () => {
  const done = progressSentence({ runSucceeded: true, accepted: false, integrated: false, verified: false });
  const accepted = progressSentence({ runSucceeded: true, accepted: true, integrated: false, verified: false });
  assert.match(done, /执行完成/);
  assert.match(done, /未接受/);
  assert.match(accepted, /已接受/);
  assert.match(accepted, /未提交、未集成、未验收/);
  assert.notEqual(done, accepted);

  const fresh = progressSentence({ runSucceeded: false, accepted: false, integrated: false, verified: false });
  assert.equal(fresh, '尚未完成一次执行');
});

function checkRun(patch: Partial<CheckRun>): CheckRun {
  return {
    schemaVersion: 1,
    id: 'chk-1',
    taskId: 't-1',
    runId: 'run-1',
    snapshotId: 'snap-1',
    contentDigest: 'abc',
    presetId: 'whitespace',
    preset: { id: 'whitespace', name: 'Git whitespace', executable: 'git', args: ['diff', '--check'], timeoutMs: 15000, outputBytes: 65536 },
    status: 'passed',
    validity: 'current',
    startedAt: '2026-10-09T01:00:00.000Z',
    stdout: '',
    stderr: '',
    truncated: false,
    version: 1,
    ...patch,
  };
}

const _summaryTypeCheck: CheckSummary = { status: 'passed', validity: 'current' };
void _summaryTypeCheck;

import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { BackendService } from '../src/backend/service.ts';
import { CodexAdapter } from '../src/backend/adapter.ts';
import { startHttp } from '../src/backend/http.ts';
import { createSample, checkSample, auditSample, git } from '../src/workspace.ts';

// Explicit real-model verification, always in a new ignored sample. Never targets user repositories.
async function main() {
  const mainProject = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const root = join(mainProject, '.agentdesk', 'backend-verification', new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8));
  await mkdir(root, { recursive: true });
  const workspace = await createSample(root, 'repo'); const baselineHead = (await git(workspace, ['rev-parse', 'HEAD'])).trim();
  const adapter = new CodexAdapter({ binary: process.env.CODEX_BIN, model: process.env.CODEX_MODEL, transport: process.env.CODEX_TRANSPORT === 'http' ? 'http' : 'default' });
  const service = await BackendService.open({ workspace, database: join(root, 'state.sqlite'), mainProject: join(mainProject, 'src'), adapter });
  // Dedicated samples are beneath ignored project data; only this harness opts in by passing a narrower exclusion.
  const http = await startHttp(service);
  const headers = { Authorization: 'Bearer ' + http.token, 'Content-Type': 'application/json' };
  const report: Record<string, unknown> = { startedAt: new Date().toISOString(), platform: process.platform, node: process.version, modelRequested: process.env.CODEX_MODEL ?? 'advertised-default', transport: process.env.CODEX_TRANSPORT ?? 'default', checks: [], actualModel: undefined };
  const checks = report.checks as Record<string, unknown>[];
  const post = async (path: string, body: unknown, key = randomUUID()) => {
    const response = await fetch(http.url + '/api/v1' + path, { method: 'POST', headers: { ...headers, 'Idempotency-Key': key }, body: JSON.stringify(body) });
    const data = await response.json(); assert.ok(response.ok, 'API request failed: ' + response.status); return data;
  };
  const get = async (path: string) => { const response = await fetch(http.url + '/api/v1' + path, { headers }); assert.equal(response.status, 200); return response.json(); };
  const terminal = async (id: string) => {
    const deadline = Date.now() + 150000;
    while (Date.now() < deadline) { const run = await get('/runs/' + id); if (run.status !== 'running') { report.actualModel = run.model; return run; } await new Promise(r => setTimeout(r, 250)); }
    throw Error('verification timeout');
  };
  try {
    const task = await post('/tasks', { title: '真实 API 样例', goal: 'Only update sample.txt to exactly backend-first followed by one newline. Do not change any other file, do not run tests, do not commit. Reply briefly after the edit.', acceptanceCriteria: ['sample.txt exact content: backend-first plus newline; only this file changed'], agentInstanceId: 'codex-local' });
    const key = randomUUID(); const run = await post(`/tasks/${task.id}/runs`, { expectedVersion: task.version }, key);
    assert.equal((await post(`/tasks/${task.id}/runs`, { expectedVersion: task.version }, key)).id, run.id);
    const first = await terminal(run.id); checks.push({ name: 'first-run', status: first.status, reason: first.outcomeReason }); assert.equal(first.status, 'succeeded');
    await checkSample(workspace, 'backend-first\n', true);
    const snapshot = await post(`/tasks/${task.id}/snapshots`, { expectedVersion: (await get('/tasks/' + task.id)).task.version });
    assert.equal(snapshot.completeness, 'complete'); assert.equal(snapshot.files.length, 1); assert.equal(snapshot.checks, 'not_run');
    const accepted = await post(`/tasks/${task.id}/accept`, { expectedVersion: (await get('/tasks/' + task.id)).task.version, snapshotId: snapshot.id }); assert.equal(accepted.status, 'accepted');
    checks.push({ name: 'review-and-accept', status: 'passed', digest: snapshot.contentDigest });
    const feedback = await post(`/tasks/${task.id}/runs`, { expectedVersion: accepted.version, input: 'Now update only sample.txt to exactly backend-second followed by one newline. Do not commit or change other files. Reply briefly.' });
    const second = await terminal(feedback.id); checks.push({ name: 'feedback-run', status: second.status, reason: second.outcomeReason }); assert.equal(second.status, 'succeeded');
    await checkSample(workspace, 'backend-second\n', true);
    const finalSnap = await post(`/tasks/${task.id}/snapshots`, { expectedVersion: (await get('/tasks/' + task.id)).task.version });
    const final = await post(`/tasks/${task.id}/accept`, { expectedVersion: (await get('/tasks/' + task.id)).task.version, snapshotId: finalSnap.id }); assert.equal(final.status, 'accepted');
    const events = await get(`/tasks/${task.id}/events?after=0&limit=200`); assert.ok(events.items.some((event: any) => event.type === 'message.completed'));
    assert.equal((await get(`/tasks/${task.id}/events?after=${events.nextCursor}`)).items.length, 0);
    checks.push({ name: 'feedback-review-and-event-replay', status: 'passed', eventCount: events.items.length, digest: finalSnap.contentDigest });
    const long = await post(`/tasks/${task.id}/runs`, { expectedVersion: final.version, input: 'Do not use any tools or modify files. Produce a very long numbered plain text list from 1 to 10000 with one full sentence on each item, without summarizing or skipping. Start writing immediately.' });
    const wait = Date.now() + 60000; let flowing = false;
    while (Date.now() < wait) { const latest = await get('/runs/' + long.id); if (latest.status !== 'running') break; const log = await get(`/tasks/${task.id}/events?after=${events.nextCursor}&limit=200`); if (log.items.some((e: any) => e.runId === long.id && e.type === 'message.delta')) { flowing = true; break; } await new Promise(r => setTimeout(r, 250)); }
    if (flowing) {
      const current = await get('/runs/' + long.id);
      await post(`/runs/${long.id}/interrupt`, { expectedVersion: current.version });
      const stopped = await terminal(long.id); checks.push({ name: 'interrupt', status: stopped.status }); assert.equal(stopped.status, 'aborted');
      await checkSample(workspace, 'backend-second\n', true);
    } else { checks.push({ name: 'interrupt', status: 'not-triggered' }); process.exitCode = 2; }
    report.status = process.exitCode ? 'incomplete' : 'passed';
  } catch { report.status = 'failed'; process.exitCode = 1; }
  finally {
    await http.close(); await service.close();
    report.workspaceAudit = await auditSample(workspace, baselineHead);
    report.endedAt = new Date().toISOString();
    await writeFile(join(root, 'summary.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`Backend verification ${report.status}; evidence: ${join(root, 'summary.json')}`);
    console.log(JSON.stringify({ checks, workspaceAudit: report.workspaceAudit }));
  }
}
main().catch(() => { console.error('Backend verification setup failed'); process.exitCode = 1; });

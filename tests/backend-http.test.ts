import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { get } from 'node:http';
import { createSample } from '../src/workspace.ts';
import { BackendService } from '../src/backend/service.ts';
import { CodexAdapter } from '../src/backend/adapter.ts';
import { startHttp } from '../src/backend/http.ts';

test('HTTP requires local host/origin and bearer token; execution and SSE use persisted events', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agentdesk-http-'));
  const cwd = await createSample(root, 'repo');
  const service = await BackendService.open({ workspace: cwd, database: join(root, 'state.sqlite'), mainProject: process.cwd(), adapter: new CodexAdapter({ binary: process.execPath, args: [fileURLToPath(new URL('./fixtures/peer.mjs', import.meta.url))] }) });
  const http = await startHttp(service, { port: 0 });
  const headers = { Authorization: 'Bearer ' + http.token, 'Content-Type': 'application/json' };
  try {
    assert.equal((await fetch(http.url + '/api/v1/bootstrap')).status, 401);
    const hostileHostStatus = await new Promise<number | undefined>((resolve, reject) => {
      get(http.url + '/api/v1/bootstrap', { headers: { ...headers, Host: 'evil.invalid' } }, response => { response.resume(); response.once('end', () => resolve(response.statusCode)); }).once('error', reject);
    });
    assert.equal(hostileHostStatus, 403);
    assert.equal((await fetch(http.url + '/api/v1/bootstrap', { headers: { ...headers, Origin: 'https://evil.invalid' } })).status, 403);
    assert.equal((await fetch(http.url + '/api/v1/bootstrap', { headers })).status, 200);
    const create = async (body: unknown) => fetch(http.url + '/api/v1/tasks', { method: 'POST', headers: { ...headers, 'Idempotency-Key': 'create' }, body: JSON.stringify(body) });
    assert.equal((await create({ title: 'no', goal: 'x', acceptanceCriteria: ['x'], agentInstanceId: 'codex-local', cwd: 'injected' })).status, 400);
    const task = await (await create({ title: '接口测试', goal: 'short', acceptanceCriteria: ['回复'], agentInstanceId: 'codex-local' })).json();
    const start = async () => fetch(http.url + `/api/v1/tasks/${task.id}/runs`, { method: 'POST', headers: { ...headers, 'Idempotency-Key': 'start' }, body: JSON.stringify({ expectedVersion: task.version }) });
    const response = await start(); assert.equal(response.status, 202); const run = await response.json();
    assert.equal((await (await start()).json()).id, run.id);
    const until = Date.now() + 5000;
    while (service.run(run.id).status === 'running') { if (Date.now() > until) throw Error('run timeout'); await new Promise(r => setTimeout(r, 20)); }
    assert.equal(service.run(run.id).status, 'succeeded');
    const controller = new AbortController();
    const stream = await fetch(http.url + `/api/v1/tasks/${task.id}/events/stream?after=0`, { headers, signal: controller.signal });
    assert.equal(stream.headers.get('content-type'), 'text/event-stream; charset=utf-8');
    const reader = stream.body!.getReader(); let received = '';
    try { while (!received.includes('message.completed')) { const chunk = await reader.read(); received += new TextDecoder().decode(chunk.value); } } finally { controller.abort(); await reader.cancel().catch(() => {}); }
    assert.ok(received.includes('id: 1\n'));
    const events = await (await fetch(http.url + `/api/v1/tasks/${task.id}/events?after=0&limit=200`, { headers })).json();
    const cursor = events.nextCursor;
    assert.equal((await (await fetch(http.url + `/api/v1/tasks/${task.id}/events?after=${cursor}`, { headers })).json()).items.length, 0);
    assert.equal((await fetch(http.url + `/api/v1/tasks/${task.id}/events?after=99999`, { headers })).status, 400);
  } finally { await http.close(); await service.close(); }
});

test('SSE delivers an event larger than the HTTP writable high water mark', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agentdesk-sse-large-')); const cwd = await createSample(root, 'repo');
  const service = await BackendService.open({ workspace: cwd, database: join(root, 'state.sqlite'), mainProject: process.cwd(), adapter: new CodexAdapter({ binary: process.execPath, args: [fileURLToPath(new URL('./fixtures/peer.mjs', import.meta.url))] }) });
  const http = await startHttp(service, { port: 0 });
  try {
    const task = await service.createTask({ title: 'large event', goal: 'large-reply', acceptanceCriteria: ['输出'], agentInstanceId: 'codex-local' }, 'create');
    const run = await service.startRun(task.id, { expectedVersion: task.version }, 'start');
    const deadline = Date.now() + 5000;
    while (service.run(run.id).status === 'running') { if (Date.now() > deadline) throw Error('timeout'); await new Promise(r => setTimeout(r, 10)); }
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const response = await fetch(http.url + `/api/v1/tasks/${task.id}/events/stream`, { headers: { Authorization: 'Bearer ' + http.token }, signal: controller.signal });
      const reader = response.body!.getReader(); let output = '';
      while (!output.includes('event: message.completed\n')) { const chunk = await reader.read(); if (chunk.done) break; output += new TextDecoder().decode(chunk.value); }
      assert.ok(output.includes('event: message.completed\n')); controller.abort(); await reader.cancel().catch(() => {});
    } finally { clearTimeout(timer); controller.abort(); }
  } finally { await http.close(); await service.close(); }
});

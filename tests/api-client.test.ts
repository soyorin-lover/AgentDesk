import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSample } from '../src/workspace.ts';
import { BackendService } from '../src/backend/service.ts';
import { startHttp } from '../src/backend/http.ts';
import { ApiClient, ApiClientError, EventStreamError } from '../src/client/api.ts';
import type { Event } from '../src/backend/types.ts';

const token = 't'.repeat(32);
const event = (seq: number): Event => ({ schemaVersion: 1, id: `e${seq}`, taskId: 'task', seq, occurredAt: '2026-10-08T00:00:00Z', type: 'message.delta', data: { text: '中文😀' } });
const frame = (seq: number) => `id: ${seq}\r\nevent: message.delta\r\ndata: ${JSON.stringify(event(seq))}\r\n\r\n`;
function response(text: string, bytewise = false) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream<Uint8Array>({ start(controller) {
    if (bytewise) for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
    else controller.enqueue(bytes);
    controller.close();
  } }), { headers: { 'Content-Type': 'text/event-stream' } });
}

test('API client uses actual authenticated HTTP, explicit idempotency and version conflicts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agentdesk-client-'));
  const workspace = await createSample(root, 'repo');
  const service = await BackendService.open({ workspace, mainProject: process.cwd(), database: join(root, 'state.sqlite'), adapter: { async start() { throw Error('must not call model'); } } });
  const http = await startHttp(service);
  const client = new ApiClient({ baseUrl: http.url, getToken: () => http.token });
  try {
    assert.equal((await client.bootstrap()).instances[0].id, 'codex-local');
    const input = { title: '客户端', goal: '目标', acceptanceCriteria: ['条件'], agentInstanceId: 'codex-local' };
    const first = await client.createTask(input, 'create');
    assert.equal((await client.createTask(input, 'create')).id, first.id);
    await assert.rejects(client.createTask({ ...input, title: '不同请求' }, 'create'), (e: unknown) => e instanceof ApiClientError && e.status === 409 && e.code === 'idempotency_conflict');
    await assert.rejects(client.updateTask(first.id, { title: '修改', expectedVersion: 999 }, 'edit'), (e: unknown) => e instanceof ApiClientError && e.code === 'version_conflict');
    const detail = await client.task(first.id);
    assert.deepEqual(detail.availableActions, ['edit', 'start']);
    const page = await client.events(first.id, 0);
    assert.equal(page.items[0].type, 'task.created');
    const controller = new AbortController();
    const stream = client.streamEvents(first.id, { after: 0, signal: controller.signal });
    try { assert.equal((await stream.next()).value?.seq, 1); }
    finally { controller.abort(); await stream.return(); }
    assert.equal((await client.tasks()).items.length, 1);
  } finally { await http.close(); await service.close(); }
});

test('SSE preserves split UTF-8, ignores heartbeat/replay and reconnects from delivered cursor', async () => {
  const urls: string[] = [], auth: string[] = [];
  let calls = 0;
  const client = new ApiClient({ baseUrl: 'http://localhost:4317', getToken: () => token, fetch: async (url, init) => {
    urls.push(String(url)); auth.push(new Headers(init?.headers).get('Authorization')!);
    return response(calls++ === 0 ? ': heartbeat\r\n\r\n' + frame(1) + frame(1) + frame(2) : frame(2) + frame(3), true);
  } });
  const received: Event[] = [];
  await assert.rejects(async () => { for await (const item of client.streamEvents('task')) received.push(item); }, (e: unknown) => e instanceof EventStreamError && e.after === 2);
  await assert.rejects(async () => { for await (const item of client.streamEvents('task', { after: 2 })) received.push(item); }, (e: unknown) => e instanceof EventStreamError && e.after === 3);
  assert.deepEqual(received.map(x => x.seq), [1, 2, 3]);
  assert.equal(received[0].data.text, '中文😀');
  assert.ok(urls[1].endsWith('/tasks/task/events/stream?after=2'));
  assert.ok(urls.every(x => !x.includes(token)));
  assert.deepEqual(auth, ['Bearer ' + token, 'Bearer ' + token]);
});

test('SSE rejects gaps, cross-task events and mismatched envelope without advancing cursor', async () => {
  for (const text of [frame(2), frame(1).replace('"taskId":"task"', '"taskId":"other"'), frame(1).replace('id: 1', 'id: 8')]) {
    const client = new ApiClient({ baseUrl: 'http://localhost:4317', getToken: () => token, fetch: async () => response(text) });
    await assert.rejects(client.streamEvents('task').next(), (e: unknown) => e instanceof EventStreamError && e.after === 0 && e.code === 'invalid_event');
  }
});

test('request errors are structured and never retry writes or expose response text', async () => {
  let calls = 0;
  const client = new ApiClient({ baseUrl: 'http://localhost:4317', getToken: () => token, fetch: async () => {
    calls++; return new Response(`secret ${token}`, { status: 503 });
  } });
  await assert.rejects(client.startRun('task', { expectedVersion: 1 }, 'run'), (e: unknown) => e instanceof ApiClientError && e.code === 'invalid_response' && !String(e).includes(token));
  assert.equal(calls, 1);
});

test('client rejects remote/credential URLs and suppresses redirects and browser credentials', async () => {
  for (const baseUrl of ['https://example.com', 'http://evil.invalid', 'http://u:p@localhost:4317', 'http://localhost:4317/path', 'http://localhost:4317/?token=x']) {
    assert.throws(() => new ApiClient({ baseUrl, getToken: () => token }));
  }
  let options: RequestInit | undefined;
  const client = new ApiClient({ baseUrl: 'http://127.0.0.1:4317/', getToken: () => token, fetch: async (_url, init) => { options = init; return Response.json({}); } });
  await client.bootstrap();
  assert.equal(options?.redirect, 'error');
  assert.equal(options?.credentials, 'omit');
  assert.equal(options?.cache, 'no-store');
});

test('client completes execution, snapshot acceptance and feedback over real HTTP without a model', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agentdesk-client-flow-'));
  const workspace = await createSample(root, 'repo');
  let executions = 0;
  const service = await BackendService.open({ workspace, mainProject: process.cwd(), database: join(root, 'state.sqlite'), adapter: {
    async start(context) {
      if (executions) assert.equal(context.sessionId, 'client-fixture-session');
      context.onSession(context.sessionId ?? 'client-fixture-session');
      await writeFile(join(workspace, 'sample.txt'), `client version ${++executions}\n`);
      return { result: Promise.resolve({ status: 'succeeded' as const }), async interrupt() {}, async close() {} };
    },
  } });
  const http = await startHttp(service);
  const client = new ApiClient({ baseUrl: http.url, getToken: () => http.token });
  const finish = async (runId: string) => {
    const deadline = Date.now() + 3000;
    while ((await client.run(runId)).status === 'running') { if (Date.now() > deadline) throw Error('timeout'); await new Promise(r => setTimeout(r, 10)); }
  };
  try {
    const task = await client.createTask({ title: '闭环', goal: '修改', acceptanceCriteria: ['审查'], agentInstanceId: 'codex-local' }, 'create');
    const first = await client.startRun(task.id, { expectedVersion: task.version }, 'first');
    await finish(first.id);
    assert.ok((await client.run(first.id)).input?.includes('修改'));
    const snapshot = await client.snapshot(task.id, { expectedVersion: (await client.task(task.id)).task.version }, 'snapshot');
    assert.equal(snapshot.checks, 'not_run');
    assert.equal((await client.changes(task.id))?.id, snapshot.id);
    assert.ok((await client.file(snapshot.id, snapshot.files[0].id)).diff?.includes('client version 1'));
    const accepted = await client.accept(task.id, { expectedVersion: (await client.task(task.id)).task.version, snapshotId: snapshot.id }, 'accept');
    assert.equal(accepted.acceptedSnapshotId, snapshot.id);
    const second = await client.startRun(task.id, { expectedVersion: accepted.version, input: '再修改一次' }, 'feedback');
    await finish(second.id);
    assert.equal((await client.run(second.id)).input, '再修改一次');
    const detail = await client.task(task.id);
    assert.equal(detail.task.status, 'in_review');
    assert.equal(detail.task.acceptedSnapshotId, undefined);
    await assert.rejects(client.accept(task.id, { expectedVersion: detail.task.version, snapshotId: snapshot.id }, 'old-accept'), (e: unknown) => e instanceof ApiClientError && e.code === 'snapshot_stale');
    assert.equal(executions, 2);
  } finally { await http.close(); await service.close(); }
});

test('leaving event iteration cancels the reader and explicit abort interrupts a pending read', async () => {
  let aborted = 0;
  const bodies: ReadableStream<Uint8Array>[] = [];
  const client = new ApiClient({ baseUrl: 'http://localhost:4317', getToken: () => token, fetch: async (_url, init) => {
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode(frame(1)));
      init?.signal?.addEventListener('abort', () => { aborted++; controller.error(init.signal?.reason); }, { once: true });
    } });
    bodies.push(body);
    return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
  } });
  for await (const item of client.streamEvents('task')) { assert.equal(item.seq, 1); break; }
  assert.equal(aborted, 1);
  assert.equal(bodies[0].locked, false);
  const controller = new AbortController();
  const stream = client.streamEvents('task', { signal: controller.signal });
  await stream.next();
  const next = stream.next(); controller.abort();
  await assert.rejects(next, (e: unknown) => e instanceof Error && e.name === 'AbortError');
  assert.equal(bodies[1].locked, false);
});

test('invalid UTF-8 is a protocol error rather than a retryable transport disconnect', async () => {
  const client = new ApiClient({ baseUrl: 'http://localhost:4317', getToken: () => token, fetch: async () => new Response(new Uint8Array([0xff]), { headers: { 'Content-Type': 'text/event-stream' } }) });
  await assert.rejects(client.streamEvents('task').next(), (e: unknown) => e instanceof EventStreamError && e.code === 'invalid_event' && e.after === 0);
});

test('aborting JSON bodies preserves cancellation for successful and error HTTP responses', async () => {
  for (const status of [200, 401]) {
    const controller = new AbortController();
    const client = new ApiClient({ baseUrl: 'http://localhost:4317', getToken: () => token, fetch: async (_url, init) => new Response(new ReadableStream({ start(body) {
      body.enqueue(new TextEncoder().encode('{'));
      init?.signal?.addEventListener('abort', () => body.error(init.signal?.reason), { once: true });
    } }), { status }) });
    const pending = client.bootstrap(controller.signal); controller.abort();
    await assert.rejects(pending, (e: unknown) => e instanceof Error && e.name === 'AbortError');
  }
});

test('aborting after a delivered event prevents delivery of additional buffered frames', async () => {
  const controller = new AbortController();
  const client = new ApiClient({ baseUrl: 'http://localhost:4317', getToken: () => token, fetch: async () => response(frame(1) + frame(2)) });
  const stream = client.streamEvents('task', { signal: controller.signal });
  assert.equal((await stream.next()).value?.seq, 1);
  controller.abort();
  await assert.rejects(stream.next(), (e: unknown) => e instanceof Error && e.name === 'AbortError');
});

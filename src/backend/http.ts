import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { BackendService } from './service.ts';
import { ApiError, requireValue } from './errors.ts';
type HttpOptions = { port?: number; token?: string; allowedOrigins?: string[] };
async function jsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  requireValue(request.headers['content-type']?.split(';')[0] === 'application/json', 415, 'json_required');
  const chunks: Buffer[] = []; let bytes = 0;
  for await (const chunk of request) { bytes += chunk.length; requireValue(bytes <= 256 * 1024, 413, 'request_too_large'); chunks.push(chunk); }
  try { const body = JSON.parse(Buffer.concat(chunks).toString('utf8')); requireValue(body && typeof body === 'object' && !Array.isArray(body)); return body; }
  catch { throw new ApiError(400, 'invalid_json'); }
}
function number(value: string | null, fallback: number) { if (value === null) return fallback; requireValue(/^\d+$/.test(value)); const n = Number(value); requireValue(Number.isSafeInteger(n)); return n; }
function send(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); response.end(JSON.stringify(body));
}
export async function startHttp(service: BackendService, options: HttpOptions = {}) {
  const token = options.token || randomBytes(32).toString('hex');
  requireValue(token.length >= 32 && token.length <= 256);
  const origins = new Set(options.allowedOrigins || []);
  for (const origin of origins) { const url = new URL(origin); requireValue(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname) && origin === url.origin); }
  const streams = new Set<ServerResponse>(); let actualPort = 0;
  const server = createServer((req, res) => {
    void (async () => {
      requireValue(req.headers.host === `127.0.0.1:${actualPort}` || req.headers.host === `localhost:${actualPort}`, 403, 'host_forbidden');
      const origin = req.headers.origin;
      requireValue(!origin || origins.has(origin), 403, 'origin_forbidden');
      if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
      if (req.method === 'OPTIONS') {
        requireValue(origin && origins.has(origin), 403, 'origin_forbidden');
        res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, Idempotency-Key, Last-Event-ID', 'Access-Control-Max-Age': '600' }); res.end(); return;
      }
      const supplied = req.headers.authorization || '', wanted = 'Bearer ' + token;
      requireValue(Buffer.byteLength(supplied) === Buffer.byteLength(wanted) && timingSafeEqual(Buffer.from(supplied), Buffer.from(wanted)), 401, 'unauthorized');
      const url = new URL(req.url || '/', 'http://127.0.0.1'); const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      requireValue(parts[0] === 'api' && parts[1] === 'v1', 404, 'not_found');
      const [, , resource, id, action, fileId] = parts; requireValue(parts.length <= 6, 404, 'not_found');
      if (req.method === 'GET') {
        if (resource === 'agent-instances' && parts.length === 3) { send(res, 200, service.agentInstances()); return; }
        if (resource === 'agent-instances' && parts.length === 4) { send(res, 200, service.agentInstance(id)); return; }
        if (resource === 'tasks' && action === 'session' && parts.length === 5) { send(res, 200, service.taskSession(id)); return; }
        if (resource === 'projects' && action === 'workflow' && parts.length === 5) { send(res, 200, await service.workflow(id)); return; }
        if (resource === 'projects' && action === 'workflow-revisions' && parts.length === 5) { send(res, 200, service.workflowRevisions(id)); return; }
        if (resource === 'execution-grants' && parts.length === 3) { send(res, 200, service.executionGrants()); return; }
        if (resource === 'projects' && action === 'execution-binding' && parts.length === 5) { send(res, 200, await service.executionBinding(id)); return; }
        if (resource === 'overview' && parts.length === 3) { send(res, 200, service.overview(url.searchParams.get('projectId') ?? undefined)); return; }
        if (resource === 'attention' && parts.length === 3) { send(res, 200, service.attention(number(url.searchParams.get('cursor'), 0), number(url.searchParams.get('limit'), 50), url.searchParams.get('projectId') ?? undefined)); return; }
        if (resource === 'projects' && parts.length === 3) { send(res, 200, { items: service.projects() }); return; }
        if (resource === 'projects' && parts.length === 4) { send(res, 200, service.project(id)); return; }
        if (resource === 'projects' && action === 'repository' && parts.length === 5) { send(res, 200, service.projectRepository(id)); return; }
        if (resource === 'bootstrap' && parts.length === 3) { send(res, 200, service.bootstrap()); return; }
        if (resource === 'runs' && parts.length === 4) { send(res, 200, service.runDetail(id)); return; }
        if (resource === 'snapshots' && action === 'files' && parts.length === 6) { send(res, 200, service.file(id, fileId)); return; }
        if (resource === 'tasks') {
          if (parts.length === 3) { send(res, 200, service.tasks(number(url.searchParams.get('cursor'), 0), number(url.searchParams.get('limit'), 50), { projectId: url.searchParams.get('projectId') ?? undefined, status: url.searchParams.get('status') ?? undefined })); return; }
          if (parts.length === 4) { send(res, 200, await service.queryDetail(id)); return; }
          if (action === 'acceptance' && parts.length === 5) { send(res, 200, await service.queryAcceptance(id)); return; }
          if (action === 'recovery' && parts.length === 5) { send(res, 200, service.recovery(id)); return; }
          if (action === 'checks' && parts.length === 5) { send(res, 200, await service.listChecks(id)); return; }
          if (action === 'changes' && parts.length === 5) { send(res, 200, service.changes(id) ?? null); return; }
          if (action === 'events') {
            let after = number(url.searchParams.get('after') ?? (typeof req.headers['last-event-id'] === 'string' ? req.headers['last-event-id'] : null), 0);
            const limit = number(url.searchParams.get('limit'), 50), items = service.events(id, after, limit);
            if (parts.length === 5) { send(res, 200, { items, nextCursor: items.at(-1)?.seq ?? after }); return; }
            if (fileId === 'stream' && parts.length === 6) {
              requireValue(streams.size < 8, 503, 'stream_limit'); streams.add(res);
              res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' }); res.flushHeaders();
              let lastHeartbeat = Date.now(), blocked = false;
              let stall: ReturnType<typeof setTimeout> | undefined;
              const write = (frame: string) => {
                if (res.write(frame)) return true;
                // write(false) has accepted this frame. Wait before producing the next one.
                blocked = true; stall = setTimeout(() => res.destroy(), 5000); stall.unref();
                return false;
              };
              res.on('drain', () => { blocked = false; clearTimeout(stall); });
              const pump = () => {
                if (blocked || res.destroyed) return;
                try {
                  for (const event of service.events(id, after, 50)) {
                    after = event.seq;
                    if (!write(`id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)) return;
                  }
                  if (Date.now() - lastHeartbeat > 15000) { lastHeartbeat = Date.now(); write(': heartbeat\n\n'); }
                } catch { res.destroy(); }
              };
              const interval = setInterval(pump, 250); interval.unref();
              res.once('close', () => { clearInterval(interval); clearTimeout(stall); streams.delete(res); });
              res.once('error', () => res.destroy()); pump(); return;
            }
          }
        }
      }
      if (req.method === 'POST' || req.method === 'PATCH') {
        const key = req.headers['idempotency-key']; requireValue(typeof key === 'string'); const body = await jsonBody(req);
        if (resource === 'projects') {
          if (req.method === 'POST' && parts.length === 5 && action === 'workflow') { send(res, 200, await service.saveWorkflow(id, body, key)); return; }
          if (req.method === 'POST' && parts.length === 5 && action === 'workflow-approvals') { send(res, 200, await service.approveWorkflow(id, body, key)); return; }
          if (req.method === 'POST' && parts.length === 5 && action === 'workflow-tasks') { send(res, 200, await service.linkWorkflowTask(id, body, key)); return; }
          if (req.method === 'POST' && parts.length === 5 && action === 'workflow-confirmations') { send(res, 200, await service.confirmWorkflowNode(id, body, key)); return; }
          if (req.method === 'POST' && parts.length === 5 && action === 'execution-binding') { send(res, 200, await service.bindProjectExecution(id, body, key)); return; }
          if (req.method === 'POST' && parts.length === 3) { send(res, 201, await service.createProject(body, key)); return; }
          if (req.method === 'PATCH' && parts.length === 4) { send(res, 200, await service.updateProject(id, body, key)); return; }
          if (req.method === 'POST' && parts.length === 5 && action === 'repository-inspections') { send(res, 201, await service.inspectProjectRepository(id, body, key)); return; }
          if (req.method === 'POST' && parts.length === 5 && action === 'repository') { send(res, 200, await service.confirmProjectRepository(id, body, key)); return; }
        }
        if (resource === 'tasks') {
          if (req.method === 'POST' && parts.length === 3) { send(res, 201, await service.createTask(body, key)); return; }
          if (req.method === 'PATCH' && parts.length === 4) { send(res, 200, await service.updateTask(id, body, key)); return; }
          if (req.method === 'POST' && parts.length === 5) {
            if (action === 'workspace') { send(res, 202, await service.prepareWorkspace(id, body, key)); return; }
            if (action === 'checks') { send(res, 202, await service.startCheck(id, body, key)); return; }
            if (action === 'runs') { send(res, 202, await service.startRun(id, body, key)); return; }
            if (action === 'snapshots') { send(res, 201, await service.snapshot(id, body, key)); return; }
            if (action === 'accept') { send(res, 200, await service.accept(id, body, key)); return; }
          }
        }
        if (resource === 'runs' && action === 'interrupt' && parts.length === 5 && req.method === 'POST') { send(res, 202, await service.interrupt(id, body, key)); return; }
        if (resource === 'checks' && action === 'cancel' && parts.length === 5 && req.method === 'POST') { send(res, 202, await service.cancelCheck(id, body, key)); return; }
        if (resource === 'checks' && action === 'recover' && parts.length === 5 && req.method === 'POST') { send(res, 200, await service.recoverCheck(id, body, key)); return; }
      }
      throw new ApiError(404, 'not_found');
    })().catch(error => {
      if (res.headersSent) { res.destroy(); return; }
      const safe = error instanceof ApiError ? error : new ApiError(503, 'storage_unavailable');
      send(res, safe.status, { error: { code: safe.code, message: safe.code, retryable: false }, ...(safe.currentVersion !== undefined ? { currentVersion: safe.currentVersion } : {}) });
    });
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 0, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
  actualPort = (server.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${actualPort}`, token, close: () => new Promise<void>((resolve, reject) => {
    for (const stream of streams) stream.destroy();
    server.close(error => error ? reject(error) : resolve()); server.closeAllConnections();
  }) };
}

import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, realpath, lstat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BackendService } from '../src/backend/service.ts';
import { startHttp } from '../src/backend/http.ts';
import type { EngineAdapter, ExecutionResult } from '../src/backend/types.ts';
import { createSample } from '../src/workspace.ts';

// Development-only entry point: no Codex adapter, model SDK or subprocess fallback.
function fixtureEngine(workspaceRoots: string[]): EngineAdapter {
  return { async start(context) {
    const roots = await Promise.all(workspaceRoots.map(root => realpath(root))), cwd = await realpath(context.cwd);
    if (!roots.some(root => { const part = relative(root, cwd); return Boolean(part) && !part.startsWith('..') && !isAbsolute(part); })) throw Error('fixture workspace required');
    const sample = join(cwd, 'sample.txt');
    if (await realpath(sample) !== sample || !(await lstat(sample)).isFile() || (await lstat(sample)).nlink !== 1) throw Error('regular fixture sample required');
    context.onSession(context.sessionId ?? 'fixture-' + randomUUID());
    context.onModel('deterministic-fixture');
    let stopped = false, wake!: () => void;
    const wait = new Promise<void>(r => { wake = r; });
    const timer = setTimeout(wake, 1200);
    const result = (async (): Promise<ExecutionResult> => {
      await wait; clearTimeout(timer);
      if (stopped) return { status: 'aborted' };
      try {
        const messageId = randomUUID();
        context.emit({ type: 'message.delta', data: { messageId, chunkIndex: 0, text: '确定性样例执行：正在修改 sample.txt。' } });
        await writeFile(sample, `integration fixture ${randomUUID()}\n`);
        context.emit({ type: 'message.completed', data: { messageId, text: '确定性样例执行完成：仅修改 sample.txt，未调用模型。可生成快照并运行检查。' } });
        return { status: 'succeeded' };
      } catch { return { status: 'failed', reason: 'fixture_write_failed' }; }
    })();
    const stop = async () => { stopped = true; wake(); await result; };
    return { result, interrupt: stop, close: stop };
  } };
}

export async function startIntegration(options: { mainProject: string; port: number; additionalProject?: boolean }) {
  if (options.additionalProject !== undefined && typeof options.additionalProject !== 'boolean') throw Error('invalid additionalProject option');
  const parent = resolve(options.mainProject, '.agentdesk', 'project-integration');
  await mkdir(parent, { recursive: true });
  const data = await mkdtemp(join(parent, 'session-'));
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'agentdesk-http-integration-'));
  const source = await createSample(fixtureRoot, 'source');
  const workspaceRoot = join(fixtureRoot, 'workspaces'), database = join(data, 'state.sqlite');
  const additionalProject = options.additionalProject ? { grantId: 'integration-second', source: await createSample(fixtureRoot, 'second-source'), workspaceRoot: join(fixtureRoot, 'second-workspaces') } : undefined;
  const allowedOrigins = ['http://localhost:5311', 'http://127.0.0.1:5311'];
  const checkPresets = [
    { id: 'sample-pass', name: '样例检查通过（真实 Node 进程）', args: ['-e', 'const fs=require("node:fs");if(!fs.readFileSync("sample.txt","utf8").startsWith("integration fixture "))process.exit(1);console.log("sample passed")'], timeoutMs: 5000 },
    { id: 'sample-fail', name: '样例检查失败（预期退出 1）', args: ['-e', 'console.error("intentional fixture failure");process.exit(1)'], timeoutMs: 5000 },
    { id: 'sample-timeout', name: '样例检查超时（预期超时）', args: ['-e', 'setTimeout(()=>{},30000)'], timeoutMs: 1500 },
    { id: 'sample-cancel', name: '样例检查取消（等待取消）', args: ['-e', 'setTimeout(()=>{},30000)'], timeoutMs: 15000 },
  ].map(preset => ({ ...preset, executable: process.execPath, outputBytes: 4096 }));
  const service = await BackendService.open({ mainProject: options.mainProject, projects: [{ id: 'integration-fixture', name: '确定性执行联调（真实后端）', path: source }], workspaceRoot, executionGrants: additionalProject ? [{ id: additionalProject.grantId, name: '第二个确定性联调授权', path: additionalProject.source, workspaceRoot: additionalProject.workspaceRoot, checkPresetIds: ['sample-pass'] }] : undefined, database, checkPresets, adapter: fixtureEngine([workspaceRoot, ...(additionalProject ? [additionalProject.workspaceRoot] : [])]), executionMode: 'deterministic' });
  let http;
  try { http = await startHttp(service, { port: options.port, allowedOrigins }); }
  catch (error) { await service.close(); throw error; }
  const tokenFile = join(data, 'access-token');
  const info = { url: http.url, execution: 'deterministic-fixture', mode: 'project', database, source, workspaceRoot, tokenFile, allowedOrigins, pid: process.pid, ...(additionalProject ? { additionalProject } : {}) };
  try {
    await writeFile(tokenFile, http.token, { flag: 'wx', mode: 0o600 });
    await writeFile(join(data, 'connection.json'), JSON.stringify(info, null, 2), { flag: 'wx', mode: 0o600 });
  } catch (error) { await http.close(); await service.close(); throw error; }
  return { info, token: http.token, close: async () => { await http.close(); await service.close(); } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.AGENTDESK_INTEGRATION_PORT ?? 4318);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('invalid integration port');
  const multi = process.env.AGENTDESK_INTEGRATION_MULTIPROJECT;
  if (multi !== undefined && multi !== '0' && multi !== '1') throw Error('invalid multi-project option');
  const server = await startIntegration({ mainProject: fileURLToPath(new URL('..', import.meta.url)), port, additionalProject: multi === '1' });
  console.log(`AgentDesk integration API: ${server.info.url}\nExecution: deterministic-fixture; NO MODEL CALLS\nConnection file: ${join(resolve(server.info.database, '..'), 'connection.json')}`);
  let stopping = false;
  const stop = () => { if (stopping) return; stopping = true; void server.close().catch(() => { process.exitCode = 1; }); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}

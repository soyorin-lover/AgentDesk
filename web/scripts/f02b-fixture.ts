// Run: node scripts/f02b-fixture.ts [--reuse <root>] [--port <port>]
// System temp is intentional: the frontend ignore list has no private fixture directory.
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, chmod, realpath, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, basename, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';


const args = process.argv.slice(2);
function option(name: string) { const i = args.indexOf(name); if (i < 0) return undefined; if (!args[i + 1] || args[i + 1].startsWith('--')) throw Error(`Missing ${name} value`); return args[i + 1]; }
const backend = resolve(process.env.AGENTDESK_BACKEND_ROOT ?? fileURLToPath(new URL('../../../AgentDesk', import.meta.url)));
const load = (path: string) => import(pathToFileURL(join(backend, path)).href);
const { BackendService } = await load('src/backend/service.ts');
const { startHttp } = await load('src/backend/http.ts');
const { createSample, git } = await load('src/workspace.ts');
const reuse = option('--reuse');
const root = reuse ? resolve(reuse) : await mkdtemp(join(tmpdir(), 'agentdesk-f02b-'));
const markerPath = join(root, 'f02b-fixture.json');
const paths = { source: join(root, 'source'), dirty: join(root, 'dirty'), database: join(root, 'state.sqlite'), workspaceRoot: join(root, 'workspaces') };
if (reuse) {
  const marker = JSON.parse(await readFile(markerPath, 'utf8'));
  if (!basename(root).startsWith('agentdesk-f02b-') || marker.kind !== 'agentdesk-f02b' || marker.root !== root) throw Error('Not an owned F02b fixture root');
} else {
  await createSample(root, 'source'); await createSample(root, 'dirty');
  await writeFile(join(paths.dirty, 'sample.txt'), 'second committed baseline\n'); await git(paths.dirty, ['add', 'sample.txt']); await git(paths.dirty, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'second baseline']);
  await writeFile(join(paths.dirty, 'sample.txt'), 'staged fixture\n'); await git(paths.dirty, ['add', 'sample.txt']);
  await writeFile(join(paths.dirty, 'sample.txt'), 'unstaged fixture\n'); await writeFile(join(paths.dirty, 'untracked.txt'), 'untracked fixture\n');
  
  
  await writeFile(markerPath, JSON.stringify({ kind: 'agentdesk-f02b', root, backend, ...paths }, null, 2), { flag: 'wx', mode: 0o600 });
}
const port = Number(option('--port') ?? 0);
if (!Number.isInteger(port) || port < 0 || port > 65535 || [4317, 4318, 4319, 5311, 5331].includes(port)) throw Error('Use a new port or 0 for dynamic allocation');
const allowedOrigins = ['http://localhost:5331', 'http://127.0.0.1:5331'];
// This adapter is deliberately local and deterministic. No Codex adapter or SDK is imported.
const adapter = { async start(context: { cwd: string; sessionId?: string; onSession(id: string): void; onModel(model: string): void; emit(event: { type: string; data: Record<string, unknown> }): void }) {
  const cwd = await realpath(context.cwd);
  const roots = await Promise.all([paths.workspaceRoot, additionalProject.workspaceRoot].map(path => realpath(path)));
  const workspaceRoot = roots.find(rootPath => { const part = relative(rootPath, cwd); return part && !part.startsWith('..') && !isAbsolute(part); });
  if (!workspaceRoot) throw Error('owned fixture worktree required');
  const part = relative(workspaceRoot, cwd);
  if (!part || part.startsWith('..') || isAbsolute(part)) throw Error('owned fixture worktree required');
  const sample = join(cwd, 'sample.txt'), stat = await lstat(sample);
  if (await realpath(sample) !== sample || !stat.isFile() || stat.nlink !== 1) throw Error('regular owned sample required');
  context.onSession(context.sessionId ?? 'f02b-fixture-' + randomUUID()); context.onModel('deterministic-f02b-fixture');
  let stopped = false, wake!: () => void;
  const waiting = new Promise<void>(r => { wake = r; }); const timer = setTimeout(wake, 1200);
  const result = (async () => {
    const messageId = randomUUID();
    context.emit({ type: 'message.delta', data: { messageId, chunkIndex: 0, text: '确定性 fixture：正在更新自有 sample.txt，未调用模型。' } });
    await waiting; clearTimeout(timer);
    if (stopped) return { status: 'aborted' };
    try {
      await writeFile(sample, context.sessionId ? 'f02b fixture follow-up\n' : 'f02b fixture first-run\n');
      context.emit({ type: 'message.completed', data: { messageId, text: '确定性 fixture 完成：仅修改 sample.txt。可生成快照和运行真实 Node 检查。' } });
      return { status: 'succeeded' };
    } catch { return { status: 'failed', reason: 'fixture_write_failed' }; }
  })();
  const stop = async () => { stopped = true; wake(); await result; };
  return { result, interrupt: stop, close: stop };
} };
const checkPresets = [
  { id: 'sample-pass', name: '样例检查通过（真实 Node）', args: ['-e', 'const fs=require("node:fs");if(!fs.readFileSync("sample.txt","utf8").startsWith("f02b fixture "))process.exit(1);console.log("fixture sample passed")'], timeoutMs: 5000 },
  { id: 'sample-fail', name: '样例检查失败（预期）', args: ['-e', 'console.error("intentional fixture failure");process.exit(1)'], timeoutMs: 5000 },
  { id: 'sample-timeout', name: '样例检查超时（预期）', args: ['-e', 'setTimeout(()=>{},30000)'], timeoutMs: 1500 },
  { id: 'sample-cancel', name: '样例检查取消', args: ['-e', 'setTimeout(()=>{},30000)'], timeoutMs: 15000 },
].map(preset => ({ ...preset, executable: process.execPath, outputBytes: 4096 }));
const additionalProject = { id: 'f02b-extra', grantId: 'f02b-extra', name: 'F02b 第二仓库授权', path: paths.dirty, source: paths.dirty, workspaceRoot: join(root, 'extra-workspaces'), checkPresetIds: ['sample-pass'] };
const config = { executionGrants: [{ id: additionalProject.id, name: additionalProject.name, path: additionalProject.path, workspaceRoot: additionalProject.workspaceRoot, checkPresetIds: additionalProject.checkPresetIds }], mainProject: backend, projects: [{ id: 'f02b-fixture', name: 'F02b 独立测试配置', path: paths.source }], workspaceRoot: paths.workspaceRoot, database: paths.database, executionMode: 'deterministic', adapter, checkPresets };
let service = await BackendService.open(config);
let http: Awaited<ReturnType<typeof startHttp>>;
try { http = await startHttp(service, { port, allowedOrigins }); } catch (error) { await service.close(); throw error; }
const tokenFile = join(root, 'access-token');
await writeFile(tokenFile, http.token, { mode: 0o600 }); if (process.platform !== 'win32') await chmod(tokenFile, 0o600);
const connection = { root, url: http.url, tokenFile, allowedOrigins, additionalProject, grantId: additionalProject.grantId, ...paths, pid: process.pid, noModelCalls: true };
await writeFile(join(root, 'connection.json'), JSON.stringify(connection, null, 2), { mode: 0o600 });
async function close() { await http.close(); await service.close(); }
{
  console.log('F02b fixture API: ' + http.url + '\nConnection file: ' + join(root, 'connection.json') + '\nToken file (not printed): ' + tokenFile + '\nNo model execution; stop this process with Ctrl+C; restart with --reuse ' + JSON.stringify(root));
  let stopping = false;
  const stop = () => { if (stopping) return; stopping = true; void close().catch(() => { process.exitCode = 1; }); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}




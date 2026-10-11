import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BackendService } from './backend/service.ts';
import { CodexAdapter } from './backend/adapter.ts';
import { ClaudeAdapter } from './backend/claude-adapter.ts';
import { startHttp } from './backend/http.ts';

async function main() {
  const path = process.argv[2] === '--config' && process.argv.length === 4 ? process.argv[3] : process.env.AGENTDESK_CONFIG;
  if (!path) throw Error('Use npm run serve -- --config <local-config.json>');
  const config = JSON.parse(await readFile(path, 'utf8'));
  const mainProject = fileURLToPath(new URL('..', import.meta.url));
  const dataRoot = resolve(mainProject, '.agentdesk');
  if (!config || Boolean(config.workspace) === Boolean(config.projects)) throw Error('choose workspace or projects configuration');
  if (config.workspace !== undefined && (typeof config.workspace !== 'string' || !isAbsolute(config.workspace))) throw Error('config.workspace must be an absolute dedicated repository path');
  if (config.projects && (!Array.isArray(config.projects) || typeof config.workspaceRoot !== 'string' || !isAbsolute(config.workspaceRoot))) throw Error('project mode requires projects and an absolute workspaceRoot');
  if (Object.keys(config).some(k => !['workspace', 'projects', 'workspaceRoot', 'executionGrants', 'checkPresets', 'database', 'port', 'allowedOrigins', 'codexBinary', 'model', 'transport', 'agentInstances'].includes(k))) throw Error('unknown configuration field');
  if (config.transport !== undefined && !['default', 'http'].includes(config.transport)) throw Error('invalid transport');
  if (config.port !== undefined && (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535)) throw Error('invalid port');
  if (config.projects && typeof config.database !== 'string') throw Error('project mode requires an explicit independent database');
  const database = resolve(config.database || resolve(dataRoot, 'backend', 'state.sqlite'));
  const part = relative(dataRoot, database);
  if (!part || part.startsWith('..') || isAbsolute(part)) throw Error('database must be inside the ignored .agentdesk directory');
  if (config.codexBinary !== undefined && typeof config.codexBinary !== 'string') throw Error('invalid executable');
  if (config.model !== undefined && typeof config.model !== 'string') throw Error('invalid model');
  if (config.allowedOrigins !== undefined && (!Array.isArray(config.allowedOrigins) || !config.allowedOrigins.every((x: unknown) => typeof x === 'string'))) throw Error('invalid origins');
  if (config.agentInstances !== undefined && (!Array.isArray(config.agentInstances) || config.agentInstances.length > 100)) throw Error('invalid agentInstances');
  const agentInstances = (config.agentInstances ?? []).map((entry: Record<string, unknown>) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || Object.keys(entry).some(k => !['id', 'name', 'engineId', 'codexBinary', 'claudeBinary', 'claudeVersion', 'model', 'transport'].includes(k))) throw Error('invalid agent instance');
    if (typeof entry.id !== 'string' || typeof entry.name !== 'string' || !['codex', 'claude_code', 'deepseek_harness'].includes(entry.engineId as string)) throw Error('invalid agent instance');
    if ((entry.codexBinary !== undefined && typeof entry.codexBinary !== 'string') || (entry.model !== undefined && typeof entry.model !== 'string') || (entry.transport !== undefined && !['default', 'http'].includes(entry.transport as string))) throw Error('invalid agent selectors');
    if (entry.engineId !== 'codex' && ['codexBinary', 'transport'].some(k => entry[k] !== undefined)) throw Error('unsupported agent selectors');
    if (entry.engineId !== 'claude_code' && ['claudeBinary', 'claudeVersion'].some(k => entry[k] !== undefined)) throw Error('unsupported agent selectors');
    if (entry.engineId === 'deepseek_harness' && entry.model !== undefined) throw Error('unsupported agent selectors');
    let adapter;
    if (entry.engineId === 'codex') adapter = new CodexAdapter({ binary: entry.codexBinary as string | undefined || config.codexBinary || process.env.CODEX_BIN, model: entry.model as string | undefined, transport: entry.transport as 'default' | 'http' | undefined });
    else if (entry.engineId === 'claude_code' && entry.claudeBinary !== undefined) {
      if (typeof entry.claudeBinary !== 'string' || typeof entry.claudeVersion !== 'string') throw Error('invalid claude selectors');
      adapter = new ClaudeAdapter({ binary: entry.claudeBinary, version: entry.claudeVersion, model: entry.model as string | undefined });
    } else if (entry.claudeVersion !== undefined || entry.model !== undefined) throw Error('unsupported agent selectors');
    return { id: entry.id, name: entry.name, engineId: entry.engineId as 'codex' | 'claude_code' | 'deepseek_harness', ...(adapter ? { adapter } : {}) };
  });
  const service = await BackendService.open({ workspace: config.workspace, projects: config.projects, workspaceRoot: config.workspaceRoot, executionGrants: config.executionGrants, checkPresets: config.checkPresets, database, mainProject, adapter: new CodexAdapter({ binary: config.codexBinary || process.env.CODEX_BIN, model: config.model, transport: config.transport }), agentInstances });
  let http;
  try { http = await startHttp(service, { port: config.port ?? 4317, allowedOrigins: config.allowedOrigins }); }
  catch (error) { await service.close(); throw error; }
  const tokenPath = resolve(dirname(database), 'access-token');
  try {
    await mkdir(dirname(tokenPath), { recursive: true });
    await writeFile(tokenPath, http.token, { mode: 0o600 }); if (process.platform !== 'win32') await chmod(tokenPath, 0o600);
  } catch (error) { await http.close(); await service.close(); throw error; }
  console.log(`AgentDesk API: ${http.url}\nLocal access token file: ${tokenPath}\nTask text, visible replies and review diffs are stored locally. Raw protocol/tool output and credentials are not stored.\nNo model execution until an explicit task start request.`);
  let stopping = false;
  const close = () => { if (stopping) return; stopping = true; void http.close().then(() => service.close()).catch(() => { process.exitCode = 1; }); };
  process.on('SIGINT', close); process.on('SIGTERM', close);
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'backend startup failed'); process.exitCode = 1; });

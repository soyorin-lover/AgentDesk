import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createSample } from '../src/workspace.ts';
import { BackendService } from '../src/backend/service.ts';
import { projectFixture } from './backend-fixtures.ts';

async function openAfterOwnedCrash(config: Parameters<typeof BackendService.open>[0]) {
  const until = Date.now() + 10000;
  while (true) {
    try { return await BackendService.open(config); }
    catch (error) {
      // Windows can briefly report an exited PID alive; a concurrent Git process can also
      // reuse that PID. Preserve the conservative lease check and wait, never force it.
      if (!(error instanceof Error) || error.message !== 'workspace/database locked' || Date.now() >= until) throw error;
      await new Promise(r => setTimeout(r, 50));
    }
  }
}

test('abrupt service process death recovers records and leases without replaying an active run', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agentdesk-crash-')), workspace = await createSample(root, 'repo'), database = join(root, 'state.sqlite');
  const child = spawn(process.execPath, [fileURLToPath(new URL('./fixtures/backend-crash.ts', import.meta.url)), workspace, database, process.cwd()], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  const exited = new Promise<void>(resolve => child.once('close', () => resolve()));
  let ids: { taskId: string; runId: string };
  try {
    ids = await new Promise((resolve, reject) => {
      let text = ''; const timer = setTimeout(() => reject(Error('crash fixture timeout')), 30000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(Error('crash fixture exited before ready: ' + code)); });
      child.stdout.on('data', chunk => { text += chunk; if (text.includes('\n')) { clearTimeout(timer); resolve(JSON.parse(text.split('\n')[0])); } });
    });
  } finally { child.kill(); await exited; }
  let called = false;
  const service = await openAfterOwnedCrash({ workspace, database, mainProject: process.cwd(), adapter: { start: async () => { called = true; throw Error('must not replay'); } } });
  try { assert.equal(service.run(ids!.runId).status, 'needs_recovery'); assert.equal(service.task(ids!.taskId).blockedReason, 'result_unknown'); assert.equal(called, false); }
  finally { await service.close(); }
});

test('abrupt backend exit during an actual check leaves a durable unknown outcome', async () => {
  const { config, root } = await projectFixture(); const marker = join(root, 'started'), configPath = join(root, 'check-config.json');
  const checkPresets = [{ id: 'crash', name: 'Crash fixture', executable: process.execPath, args: ['-e', `require('fs').writeFileSync(${JSON.stringify(marker)},JSON.stringify({pid:process.pid}),{flag:'wx'});setTimeout(()=>{},20000)`], timeoutMs: 25000, outputBytes: 100 }];
  const { adapter, ...serializable } = config;
  await writeFile(configPath, JSON.stringify({ ...serializable, checkPresets }));
  const child = spawn(process.execPath, [fileURLToPath(new URL('./fixtures/backend-check-crash.ts', import.meta.url)), configPath, marker], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  const exited = new Promise<void>(r => child.once('close', () => r()));
  let ids: { taskId: string; checkId: string };
  try {
    ids = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('check crash fixture timeout')), 45000); let buffer = '';
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(Error('check crash fixture exited before ready: ' + code)); });
      child.stdout.on('data', chunk => { buffer += chunk; if (buffer.includes('\n')) { clearTimeout(timer); resolve(JSON.parse(buffer.split('\n')[0])); } });
    });
  } finally {
    child.kill(); await exited;
    // This PID comes only from the exclusively created marker of our own finite-lived fixture.
    // Killing that known test child after the backend dies does not provide backend exit evidence.
    try { const owned = JSON.parse(await readFile(marker, 'utf8')); process.kill(owned.pid); }
    catch (error) { if (!['ENOENT', 'ESRCH'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; }
  }
  const s = await openAfterOwnedCrash({ ...config, checkPresets });
  try {
    assert.equal(s.check(ids!.checkId).status, 'needs_recovery');
    assert.equal((await s.queryDetail(ids!.taskId)).checks.status, 'needs_recovery');
    await assert.rejects(s.startRun(ids!.taskId, { expectedVersion: s.task(ids!.taskId).version, input: 'retry' }, 'retry'), /active_run/);
  } finally { await s.close(); }
});

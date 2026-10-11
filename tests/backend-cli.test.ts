import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createSample, exec } from '../src/workspace.ts';
import { BackendService } from '../src/backend/service.ts';
import { projectFixture } from './backend-fixtures.ts';

test('CLI releases listener and leases when writing the access token fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agentdesk-cli-')); const workspace = await createSample(root, 'repo');
  const data = join(process.cwd(), '.agentdesk', 'cli-tests', randomUUID()); await mkdir(join(data, 'access-token'), { recursive: true });
  const database = join(data, 'state.sqlite'), configPath = join(data, 'config.json');
  await writeFile(configPath, JSON.stringify({ workspace, database, port: 0 }));
  await assert.rejects(exec(process.execPath, ['src/serve.ts', '--config', configPath], { cwd: process.cwd(), timeout: 5000, windowsHide: true }), (error: any) => {
    assert.equal(error.killed, false, 'failed startup must terminate itself'); assert.equal(error.code, 1); return true;
  });
  const service = await BackendService.open({ workspace, database, mainProject: process.cwd(), adapter: { start: async () => { throw Error('not called'); } } }); await service.close();
});

test('CLI accepts independent trusted project and check preset configuration', async () => {
  const { config } = await projectFixture();
  const data = join(process.cwd(), '.agentdesk', 'cli-tests', randomUUID()); await mkdir(join(data, 'access-token'), { recursive: true });
  const database = join(data, 'state.sqlite'), configPath = join(data, 'config.json');
  const { adapter, mainProject, ...local } = config;
  await writeFile(configPath, JSON.stringify({ ...local, database, port: 0, checkPresets: [{ id: 'git', name: 'Whitespace', executable: 'git', args: ['diff', '--check'], timeoutMs: 1000, outputBytes: 100 }] }));
  await assert.rejects(exec(process.execPath, ['src/serve.ts', '--config', configPath], { cwd: process.cwd(), timeout: 5000, windowsHide: true }), (error: any) => {
    assert.equal(error.killed, false); assert.equal(error.code, 1); assert.match(error.stderr, /EISDIR|illegal operation|permission denied/i); return true;
  });
  const s = await BackendService.open({ ...config, database }); await s.close();
});

test('CLI rejects arbitrary Claude launch arguments, shell wrappers and unverified versions before opening storage', async () => {
  const data = join(process.cwd(), '.agentdesk', 'cli-tests', randomUUID()); await mkdir(data, { recursive: true });
  const configPath = join(data, 'config.json');
  for (const selectors of [{ args: ['--dangerously-skip-permissions'] }, { claudeBinary: 'claude.cmd', claudeVersion: '2.1.284' }, { claudeBinary: process.execPath, claudeVersion: '2.1.999' }]) {
    await writeFile(configPath, JSON.stringify({ workspace: process.cwd(), database: join(data, 'state.sqlite'), port: 0, agentInstances: [{ id: 'claude-dev', name: 'Claude', engineId: 'claude_code', ...selectors }] }));
    await assert.rejects(exec(process.execPath, ['src/serve.ts', '--config', configPath], { cwd: process.cwd(), timeout: 5000, windowsHide: true }), (error: any) => {
      assert.equal(error.killed, false); assert.equal(error.code, 1); assert.match(error.stderr, /invalid agent instance|invalid_claude_configuration/); return true;
    });
  }
});

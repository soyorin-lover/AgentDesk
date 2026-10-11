import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFile, readFile, rename } from 'node:fs/promises';
import { BackendService } from '../src/backend/service.ts';
import { DatabaseSync } from 'node:sqlite';
import { git } from '../src/workspace.ts';
import { executeCheck } from '../src/backend/checks.ts';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { spawn } from 'node:child_process';
import { FixtureEngine, projectFixture, taskInput, settled, waitFor } from './backend-fixtures.ts';

export async function checkFixture(checkExecutor?: typeof executeCheck) {
  const { config, root } = await projectFixture(); const engine = new FixtureEngine(); config.adapter = engine;
  const presets = [
    { id: 'pass', name: 'Pass', executable: process.execPath, args: ['-e', 'console.log("ok")'], timeoutMs: 3000, outputBytes: 100 },
    { id: 'fail', name: 'Fail', executable: process.execPath, args: ['-e', 'console.error("bad");process.exit(2)'], timeoutMs: 3000, outputBytes: 100 },
    { id: 'timeout', name: 'Timeout', executable: process.execPath, args: ['-e', 'setInterval(()=>{},100)'], timeoutMs: 100, outputBytes: 100 },
    { id: 'cancel', name: 'Cancel', executable: process.execPath, args: ['-e', 'setInterval(()=>{},100)'], timeoutMs: 10000, outputBytes: 100 },
    { id: 'output', name: 'Output', executable: process.execPath, args: ['-e', 'process.stdout.write("汉".repeat(10000));process.stderr.write("x".repeat(10000))'], timeoutMs: 3000, outputBytes: 100 },
    { id: 'mutate', name: 'Mutate', executable: process.execPath, args: ['-e', 'require("fs").writeFileSync("sample.txt","check modified")'], timeoutMs: 3000, outputBytes: 100 },
    { id: 'script', name: 'Script', executable: 'unsafe.cmd', args: [], timeoutMs: 3000, outputBytes: 100 },
  ];
  const s = await BackendService.open({ ...config, checkPresets: presets, checkExecutor });
  const t = await s.createTask(taskInput, 't'); await s.prepareWorkspace(t.id, { expectedVersion: t.version }, 'p'); await settled(s, t.id);
  const r = await s.startRun(t.id, { expectedVersion: s.task(t.id).version }, 'r'); await waitFor(() => engine.contexts.length === 1);
  engine.finish({ status: 'succeeded' }); await waitFor(() => s.run(r.id).status === 'succeeded');
  const snap = await s.snapshot(t.id, { expectedVersion: s.task(t.id).version }, 'snapshot');
  return { s, t, snap, root, engine, config: { ...config, checkPresets: presets } };
}
export async function finished(s: BackendService, id: string) { await waitFor(() => s.check(id).status !== 'running'); return s.check(id); }

test('real bounded checks report exit codes, timeouts, cancellation and UTF-8 truncation', async () => {
  const { s, t, snap } = await checkFixture();
  try {
    for (const [presetId, expected] of [['pass', 'passed'], ['fail', 'failed'], ['timeout', 'timed_out'], ['output', 'passed'], ['cancel', 'cancelled']]) {
      const body = { expectedVersion: s.task(t.id).version, presetId, snapshotId: snap.id };
      const c = await s.startCheck(t.id, body, presetId);
      assert.ok(s.detail(t.id).availableActions.includes('cancel_check'));
      assert.equal((await s.startCheck(t.id, body, presetId)).id, c.id);
      await assert.rejects(s.startRun(t.id, { expectedVersion: s.task(t.id).version, input: 'busy' }, 'busy-' + presetId), /active_run/);
      if (presetId === 'cancel') await s.cancelCheck(c.id, { expectedVersion: c.version }, 'cancel');
      const result = await finished(s, c.id); assert.equal(result.status, expected);
      if (presetId === 'output') { assert.equal(result.truncated, true); assert.ok(Buffer.byteLength(result.stdout + result.stderr) <= 100); }
      if (presetId === 'fail') assert.equal(result.exitCode, 2);
    }
    await assert.rejects(s.startCheck(t.id, { expectedVersion: s.task(t.id).version, presetId: 'script', snapshotId: snap.id }, 'script'), /check_unavailable/);
    await assert.rejects(s.startCheck(t.id, { expectedVersion: s.task(t.id).version, presetId: 'unknown', snapshotId: snap.id }, 'unknown'), /preset_not_found/);
  } finally { await s.close(); }
});

test('check validity rechecks disk, index, latest snapshot and latest model run', async () => {
  const { s, t, snap, engine, config } = await checkFixture();
  try {
    assert.equal((await s.listChecks(t.id)).summary.status, 'not_run');
    const runCheck = async (presetId: string, snapshotId: string, key: string) => {
      const c = await s.startCheck(t.id, { expectedVersion: s.task(t.id).version, presetId, snapshotId }, key); return finished(s, c.id);
    };
    const c = await runCheck('pass', snap.id, 'pass');
    assert.equal((await s.listChecks(t.id)).summary.validity, 'current');
    const cwd = join(config.workspaceRoot, t.workspaceId);
    await writeFile(join(cwd, 'sample.txt'), 'staged'); await git(cwd, ['add', 'sample.txt']);
    await writeFile(join(cwd, 'sample.txt'), 'baseline\n');
    assert.equal((await s.listChecks(t.id)).summary.validity, 'stale', 'index change invalidates unchanged worktree bytes');
    await writeFile(join(cwd, 'sample.txt'), 'external');
    assert.equal((await s.listChecks(t.id)).items.find(x => x.id === c.id)?.validity, 'stale');
    const next = await s.snapshot(t.id, { expectedVersion: s.task(t.id).version }, 'next');
    const mutated = await runCheck('mutate', next.id, 'mutate');
    assert.equal(mutated.status, 'passed'); assert.equal(mutated.validity, 'stale');
    const final = await s.snapshot(t.id, { expectedVersion: s.task(t.id).version }, 'final');
    const current = await runCheck('pass', final.id, 'current');
    const r = await s.startRun(t.id, { expectedVersion: s.task(t.id).version, input: 'next' }, 'feedback');
    await waitFor(() => engine.contexts.length === 2);
    assert.equal((await s.listChecks(t.id)).items.find(x => x.id === current.id)?.validity, 'stale');
    await assert.rejects(s.startCheck(t.id, { expectedVersion: s.task(t.id).version, presetId: 'pass', snapshotId: final.id }, 'busy'), /active_run/);
    engine.finish({ status: 'succeeded' }); await waitFor(() => s.run(r.id).status === 'succeeded');
    await assert.rejects(s.startCheck(t.id, { expectedVersion: s.task(t.id).version, presetId: 'pass', snapshotId: final.id }, 'old'), /snapshot_stale/);
  } finally { await s.close(); }
});

test('restart preserves an unfinished check as unknown and blocks both resource types', async () => {
  const { s, t, snap, config } = await checkFixture();
  await s.close();
  const db = new DatabaseSync(config.database);
  const unknown = { schemaVersion: 1, id: 'interrupted-check', taskId: t.id, runId: snap.runId, snapshotId: snap.id, contentDigest: snap.contentDigest, presetId: 'pass', status: 'running', validity: 'stale', startedAt: new Date().toISOString(), stdout: '', stderr: '', truncated: false, version: 1 };
  db.prepare('INSERT INTO documents(kind,id,value) VALUES(?,?,?)').run('check', unknown.id, JSON.stringify(unknown)); db.close();
  const restarted = await BackendService.open(config);
  try {
    assert.equal(restarted.check(unknown.id).status, 'needs_recovery');
    assert.equal((await restarted.queryDetail(t.id)).availableActions.length, 0);
    await assert.rejects(restarted.startRun(t.id, { expectedVersion: restarted.task(t.id).version, input: 'retry' }, 'retry'), /active_run/);
    await assert.rejects(restarted.startCheck(t.id, { expectedVersion: restarted.task(t.id).version, presetId: 'pass', snapshotId: snap.id }, 'retry-check'), /active_run/);
  } finally { await restarted.close(); }
});

test('failed startup releases already acquired task workspace leases', async () => {
  const { s, t, snap, config } = await checkFixture(); await s.close();
  const db = new DatabaseSync(config.database);
  db.prepare('INSERT INTO documents(kind,id,value) VALUES(?,?,?)').run('check', 'unknown', JSON.stringify({ id: 'unknown', taskId: t.id, status: 'running', validity: 'stale', version: 1 }));
  db.exec("CREATE TRIGGER reject_recovery BEFORE UPDATE ON documents WHEN NEW.kind='check' BEGIN SELECT RAISE(ABORT,'fixture startup failure'); END;");
  try { await assert.rejects(BackendService.open(config), /fixture startup failure/); }
  finally { db.exec('DROP TRIGGER reject_recovery'); db.close(); }
  const recovered = await BackendService.open(config);
  try { assert.equal(recovered.workspace(t.id).status, 'ready', 'failed open must not retain task leases'); }
  finally { await recovered.close(); }
});

test('executor reports needs_recovery when its owned child never confirms close', async () => {
  const child = Object.assign(new EventEmitter(), { pid: 12345, stdout: new PassThrough(), stderr: new PassThrough(), kill: () => false });
  const execution = executeCheck({ id: 'unknown', name: 'Unknown close fixture', executable: 'fixture', args: [], timeoutMs: 10, outputBytes: 100 }, process.cwd(), (() => child) as unknown as typeof spawn);
  const result = await execution.result;
  assert.equal(result.status, 'needs_recovery'); assert.equal(result.reason, 'process_exit_unconfirmed'); assert.equal(result.exitCode, undefined);
});

test('unknown check exit quarantines before a failing Git scan and blocks another database', async () => {
  let started = false, finish!: (value: Awaited<ReturnType<typeof executeCheck>['result']>) => void;
  const result = new Promise<Awaited<ReturnType<typeof executeCheck>['result']>>(r => { finish = r; });
  const { s, t, snap, config, root } = await checkFixture(() => { started = true; return { result, cancel: () => {} }; });
  const cwd = join(config.workspaceRoot, t.workspaceId), gitFile = join(cwd, '.git');
  const savedGitFile = join(cwd, '.agentdesk-saved-git'), gitDir = (await git(cwd, ['rev-parse', '--absolute-git-dir'])).trim(); let moved = false;
  try {
    const c = await s.startCheck(t.id, { expectedVersion: s.task(t.id).version, presetId: 'pass', snapshotId: snap.id }, 'unknown');
    await waitFor(() => started); await rename(gitFile, savedGitFile); moved = true;
    finish({ status: 'needs_recovery', reason: 'process_exit_unconfirmed', stdout: '', stderr: '', truncated: false });
    await finished(s, c.id);
    assert.match(await readFile(join(gitDir, 'agentdesk-backend.lock.quarantine'), 'utf8'), /check_process_exit_unconfirmed/);
    await rename(savedGitFile, gitFile); moved = false; await s.close();
    await assert.rejects(BackendService.open({ workspace: cwd, database: join(root, 'other.sqlite'), mainProject: process.cwd(), adapter: config.adapter }), /workspace_quarantined/);
  } finally { if (moved) await rename(savedGitFile, gitFile); await s.close(); }
});

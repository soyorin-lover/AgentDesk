import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { CodexSession, type TurnResult } from './codex/session.ts';
import { createSample, checkSample, auditSample, git, exec } from './workspace.ts';
import { samplePatchAllowed } from './codex/approval.ts';

/** This command deliberately cannot target an arbitrary user repository. */
async function main() {
  const phase = process.argv[2] || 'all';
  if (!['baseline', 'interaction', 'approvals', 'parallel', 'all'].includes(phase)) throw new Error('Usage: npm run verify:codex -- [baseline|interaction|approvals|parallel|all]');
  const binary = process.env.CODEX_BIN || 'codex';
  const transport = process.env.CODEX_TRANSPORT || 'default';
  if (!['default', 'http'].includes(transport)) throw new Error('CODEX_TRANSPORT must be default or http');
  const serverArgs = transport === 'http' ? [
    '-c', 'model_provider="agentdesk_http_probe"',
    '-c', 'model_providers.agentdesk_http_probe={name="OpenAI",wire_api="responses",requires_openai_auth=true,supports_websockets=false,request_max_retries=0,stream_max_retries=0,stream_idle_timeout_ms=15000}',
    'app-server', '--listen', 'stdio://',
  ] : undefined;
  const project = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8);
  const root = join(project, '.agentdesk', 'runs', runId);
  await mkdir(root, { recursive: true });
  const sessions: CodexSession[] = [];
  const samples: { cwd: string; name: string; head: string }[] = [];
  const report: any = { runId, phase, transport, startedAt: new Date().toISOString(), platform: process.platform, node: process.version, checks: [], processes: [], workspaces: [], linux: 'not verified' };
  const save = () => writeFile(join(root, 'summary.json'), JSON.stringify(report, null, 2) + '\n');
  const safeError = (error: any) => {
    const message = String(error?.message || error);
    // Never persist arbitrary upstream error text, commands, paths, or credentials.
    if (/timed out/.test(message)) return 'timeout';
    if (/sample content/.test(message)) return 'sample-content-mismatch';
    if (/unexpected workspace/.test(message)) return 'unexpected-workspace-change';
    if (/turn failed/.test(message)) return 'turn-failed';
    if (/interrupt not confirmed/.test(message)) return 'interrupt-not-confirmed';
    if (/ENOENT/.test(message)) return 'executable-not-found';
    return 'assertion-or-protocol-error';
  };
  async function check(name: string, task: () => Promise<any>) {
    console.log(`START ${name}`);
    try {
      const evidence = await task();
      report.checks.push({ name, status: evidence?.status || 'passed', ...evidence });
      console.log(`${report.checks.at(-1).status.toUpperCase()} ${name}`);
    } catch (error) {
      report.checks.push({ name, status: 'failed', reason: safeError(error) });
      console.log(`FAILED ${name}: ${safeError(error)}`);
    }
    await save();
    return report.checks.at(-1).status !== 'failed';
  }
  async function connect(onRequest?: ConstructorParameters<typeof CodexSession>[2]) {
    const s = new CodexSession(binary, serverArgs, onRequest);
    sessions.push(s);
    const hello = await s.initialize();
    report.serverUserAgent = hello.userAgent;
    report.selectedModel = await s.discoverModel(process.env.CODEX_MODEL);
    return s;
  }
  async function sample(name: string) {
    const cwd = await createSample(root, name);
    samples.push({ cwd, name, head: (await git(cwd, ['rev-parse', 'HEAD'])).trim() });
    return cwd;
  }
  function evidence(r: TurnResult) {
    return { threadId: r.threadId, turnId: r.turnId, terminalStatus: r.status, textBytes: Buffer.byteLength(r.text) };
  }
  async function diffEvidence(cwd: string, expected: string, filename: string, changed = true) {
    const { diff } = await checkSample(cwd, expected, changed);
    await writeFile(join(root, filename), diff);
    return { diffFile: filename, diffSha256: createHash('sha256').update(diff).digest('hex'), exactContent: true, onlyExpectedFileChanged: true };
  }
  try {
    report.codex = (await exec(binary, ['--version'], { windowsHide: true, timeout: 15_000 })).stdout.trim();
    report.git = (await exec('git', ['--version'], { windowsHide: true, timeout: 15_000 })).stdout.trim();
    const login = await exec(binary, ['login', 'status'], { windowsHide: true, timeout: 15_000 });
    report.loggedIn = /Logged in/.test(login.stdout + login.stderr);
    assert.ok(report.loggedIn, 'Codex login required');
    if (phase === 'baseline' || phase === 'all') {
      const cwd = await sample('single');
      let s: CodexSession;
      let threadId: string;
      const token = 'CONTEXT_' + randomUUID().replaceAll('-', '');
      if (!await check('initialize', async () => { s = await connect(); return { pid: s.rpc.child.pid }; })) return;
      if (!await check('text', async () => {
        const created = await s.createThread(cwd);
        threadId = created.thread.id;
        report.model = created.model;
        report.modelProvider = created.modelProvider;
        const r = await s.runTurn(threadId, `Remember this marker for later: ${token}. Reply with exactly READY. Do not use tools.`);
        assert.ok(r.text.includes('READY'));
        assert.ok(s.eventCounts['item/agentMessage/delta'] > 0);
        await checkSample(cwd, 'baseline\n', false);
        return { ...evidence(r), textDeltaObserved: true };
      })) return;
      if (!await check('file-change', async () => {
        const r = await s.runTurn(threadId, 'Change only sample.txt to exactly "verified" followed by one newline. Do not commit. Use apply_patch. Reply DONE.');
        return { ...evidence(r), ...await diffEvidence(cwd, 'verified\n', 'single.diff') };
      })) return;
      if (!await check('context', async () => {
        const r = await s.runTurn(threadId, 'Reply with exactly the marker I asked you to remember. Do not use tools.');
        assert.equal(r.text.trim(), token);
        return { ...evidence(r), exactMarker: true };
      })) return;
      if (!await check('reconnect-resume', async () => {
        await s.close();
        const oldPid = s.rpc.child.pid;
        s = await connect();
        const resumed = await s.resumeThread(threadId, cwd);
        assert.equal(resumed.thread.id, threadId);
        const r = await s.runTurn(threadId, 'Reply with exactly the marker I asked you to remember before reconnection. Do not use tools.');
        assert.equal(r.text.trim(), token);
        await checkSample(cwd, 'verified\n', true);
        return { ...evidence(r), exactMarker: true, previousPid: oldPid, currentPid: s.rpc.child.pid };
      })) return;
    }
    if (phase === 'interaction' || phase === 'all') {
      const cwd = await sample('interaction');
      await check('steer-and-interrupt', async () => {
        const s = await connect();
        const { thread } = await s.createThread(cwd);
        // A long text-only generation avoids starting a shell process that could outlive the turn.
        const streaming = s.rpc.waitFor('item/agentMessage/delta', p => p.threadId === thread.id, 45_000);
        void streaming.catch(() => {});
        const h = await s.startTurn(thread.id, 'Without tools, slowly enumerate integers from 1 to 10000, one per line. Do not finish early.');
        await Promise.race([streaming, h.completion.then(r => { throw new Error(`turn ${r.status}${r.errorCode ? ': ' + r.errorCode : ''}`); })]);
        const steered = await s.steer(h, 'Continue enumerating, prefix each later number with CHECK-. Do not use tools.');
        assert.equal(steered.turnId, h.turnId);
        const r = await s.interrupt(h);
        await checkSample(cwd, 'baseline\n', false);
        return { ...evidence(r), textDeltaBeforeSteer: true, steerAccepted: true, interruptedConfirmed: true };
      });
    }
    if (phase === 'approvals' || phase === 'all') {
      for (const decision of ['decline', 'accept'] as const) {
        const cwd = await sample('approval-' + decision);
        await check('approval-' + decision, async () => {
          const seen: any[] = [];
          let expectedThread: string;
          const s = await connect(async m => {
            const allowed = samplePatchAllowed(m, s.proposedChanges.get(m.params?.itemId), expectedThread, cwd);
            seen.push({ method: m.method, decision: allowed ? decision : 'decline', itemId: m.params?.itemId });
            if (m.method === 'item/fileChange/requestApproval' || m.method === 'item/commandExecution/requestApproval') return { decision: allowed ? decision : 'decline' };
            throw new Error('unsupported server request');
          });
          const created = await s.createThread(cwd, { sandbox: 'read-only', approvalPolicy: 'on-request', approvalsReviewer: 'user' });
          const { thread } = created;
          assert.equal(created.approvalPolicy, 'on-request');
          assert.equal(created.approvalsReviewer, 'user');
          assert.equal(created.sandbox.type, 'readOnly');
          expectedThread = thread.id;
          const r = await s.runTurn(thread.id, 'This is a controlled host approval test. Invoke the native apply_patch tool exactly once with the patch below. The host is ready to approve or decline it. Do not stop merely because the sandbox is read-only; request approval through the normal tool flow. If denied, stop without retries or another tool. Do not run shell commands.\n*** Begin Patch\n*** Update File: sample.txt\n@@\n-baseline\n+approved\n*** End Patch');
          const triggered = seen.some(q => q.method === 'item/fileChange/requestApproval');
          const diff = await diffEvidence(cwd, decision === 'accept' && triggered ? 'approved\n' : 'baseline\n', 'approval-' + decision + '.diff', decision === 'accept' && triggered);
          return { ...evidence(r), ...diff, effectiveApprovalPolicy: created.approvalPolicy, effectiveSandbox: created.sandbox.type, requests: seen, status: triggered ? 'passed' : 'not-triggered' };
        });
      }
    }
    if (phase === 'parallel' || phase === 'all') {
      const workspaces = await Promise.all(['parallel-a', 'parallel-b'].map(name => sample(name)));
      await check('parallel-isolation', async () => {
        const s = await connect();
        const threads = await Promise.all(workspaces.map(cwd => s.createThread(cwd)));
        const started = Date.now();
        const turns = await Promise.all(threads.map((t, i) => s.startTurn(t.thread.id, `Change only sample.txt to exactly "parallel-${i}" followed by a newline using apply_patch. Do not commit. Reply DONE.`)));
        const results = await Promise.all(turns.map(h => h.completion));
        assert.ok(results.every(r => r.status === 'completed'));
        const intervals = results.map(r => s.turnTimes.get(r.turnId));
        assert.ok(intervals.every(t => t?.completed !== undefined));
        const overlapMs = Math.min(...intervals.map(t => t!.completed!)) - Math.max(...intervals.map(t => t!.started));
        assert.ok(overlapMs > 0, 'turn lifecycle events must actually overlap');
        const diffs = await Promise.all(workspaces.map((cwd, i) => diffEvidence(cwd, `parallel-${i}\n`, `parallel-${i}.diff`)));
        return { runs: results.map(evidence), diffs, elapsedMs: Date.now() - started, overlapMs, bothStartsAcceptedBeforeAwaitingCompletion: true };
      });
    }
  } catch (error) {
    report.checks.push({ name: 'preflight', status: 'failed', reason: safeError(error) });
  } finally {
    for (const s of sessions) {
      try { await s.close(); }
      catch { report.checks.push({ name: 'cleanup', status: 'failed', reason: 'own-process-exit-timeout' }); }
      report.processes.push({ pid: s.rpc.child.pid, exited: s.rpc.exited, stderrBytes: s.rpc.stderrBytes, events: s.eventCounts, diagnostics: s.diagnostics });
    }
    for (const sample of samples) {
      try {
        const audit = await auditSample(sample.cwd, sample.head);
        report.workspaces.push({ name: sample.name, ...audit });
        if (audit.unexpectedChanges || !audit.headUnchanged) report.checks.push({ name: 'workspace-audit', status: 'failed', reason: 'unexpected-workspace-change' });
      } catch { report.checks.push({ name: 'workspace-audit', status: 'failed', reason: 'workspace-unreadable' }); }
    }
    report.finishedAt = new Date().toISOString();
    const expected = phase === 'all' ? ['initialize', 'text', 'file-change', 'context', 'reconnect-resume', 'steer-and-interrupt', 'approval-decline', 'approval-accept', 'parallel-isolation'] : phase === 'baseline' ? ['initialize', 'text', 'file-change', 'context', 'reconnect-resume'] : phase === 'interaction' ? ['steer-and-interrupt'] : phase === 'approvals' ? ['approval-decline', 'approval-accept'] : ['parallel-isolation'];
    for (const name of expected) {
      if (!report.checks.some((c: any) => c.name === name)) report.checks.push({ name, status: 'not-run', reason: 'prerequisite-failed' });
    }
    await save();
    console.log(`Evidence: ${join(root, 'summary.json')}`);
    if (report.checks.some((c: any) => c.status === 'failed')) process.exitCode = 1;
    else if (report.checks.some((c: any) => c.status !== 'passed')) process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error('Verification could not start; check executable configuration and runtime directory access.'); process.exitCode = 1; });
}

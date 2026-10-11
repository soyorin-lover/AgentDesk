import { spawn } from 'node:child_process';
import type { CheckPreset, CheckRun } from './types.ts';

export function validatePresets(presets: CheckPreset[]) {
  if (!Array.isArray(presets) || presets.length > 30) throw Error('invalid check presets');
  const ids = new Set<string>();
  for (const p of presets) {
    if (!p || Object.keys(p).some(k => !['id', 'name', 'executable', 'args', 'timeoutMs', 'outputBytes'].includes(k)) || !/^[a-zA-Z0-9_-]{1,80}$/.test(p.id) || ids.has(p.id) || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 200 || typeof p.executable !== 'string' || !p.executable.trim() || p.executable.includes('\0') || !Array.isArray(p.args) || p.args.length > 100 || !p.args.every(a => typeof a === 'string' && !a.includes('\0') && a.length <= 64000) || !Number.isSafeInteger(p.timeoutMs) || p.timeoutMs < 10 || p.timeoutMs > 600000 || !Number.isSafeInteger(p.outputBytes) || p.outputBytes < 1 || p.outputBytes > 1024 * 1024) throw Error('invalid check preset');
    ids.add(p.id);
  }
  return presets.map(p => ({ ...p, args: [...p.args] }));
}
export function presetAvailable(preset: CheckPreset) { return !/\.(cmd|bat)$/i.test(preset.executable); }
type Result = Pick<CheckRun, 'status' | 'exitCode' | 'stdout' | 'stderr' | 'truncated' | 'reason'>;
function utf8(bytes: Buffer) {
  for (let n = 0; n <= 3 && n <= bytes.length; n++) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, bytes.length - n)); } catch { /* incomplete trailing code point */ }
  }
  // Arbitrary executable output need not be UTF-8; keep the stored text within its raw byte budget.
  let result = bytes.toString('utf8'); while (Buffer.byteLength(result) > bytes.length) result = result.slice(0, -1); return result;
}
export function executeCheck(preset: CheckPreset, cwd: string, spawnProcess: typeof spawn = spawn) {
  let stopReason: 'cancelled' | 'timed_out' | undefined, finished = false;
  let stop: () => void = () => { stopReason ??= 'cancelled'; };
  const result = new Promise<Result>(resolve => {
    let stdout = Buffer.alloc(0), stderr = Buffer.alloc(0), bytes = 0, truncated = false;
    let deadline: ReturnType<typeof setTimeout> | undefined, grace: ReturnType<typeof setTimeout> | undefined;
    const done = (status: Result['status'], exitCode?: number | null, reason?: string) => {
      if (finished) return; finished = true; clearTimeout(deadline); clearTimeout(grace);
      resolve({ status, exitCode, reason, stdout: utf8(stdout), stderr: utf8(stderr), truncated });
    };
    let child;
    try { child = spawnProcess(preset.executable, preset.args, { cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch { done('failed', undefined, 'spawn_failed'); return; }
    const append = (chunk: Buffer, stream: 'stdout' | 'stderr') => {
      if (finished) return;
      const remaining = Math.max(0, preset.outputBytes - bytes), kept = chunk.subarray(0, remaining);
      bytes += kept.length; if (kept.length !== chunk.length) truncated = true;
      if (stream === 'stdout') stdout = Buffer.concat([stdout, kept]); else stderr = Buffer.concat([stderr, kept]);
    };
    child.stdout.on('data', chunk => append(chunk, 'stdout')); child.stderr.on('data', chunk => append(chunk, 'stderr'));
    child.once('error', () => { if (!child.pid) done('failed', undefined, 'spawn_failed'); else done('needs_recovery', undefined, 'process_exit_unconfirmed'); });
    child.once('close', code => done(stopReason ?? (code === 0 ? 'passed' : 'failed'), code));
    stop = () => {
      if (finished || grace) return;
      stopReason ??= 'cancelled';
      try { child.kill(); } catch { /* wait for close or mark unknown */ }
      grace = setTimeout(() => done('needs_recovery', undefined, 'process_exit_unconfirmed'), 1500);
    };
    deadline = setTimeout(() => { stopReason = 'timed_out'; stop(); }, preset.timeoutMs);
  });
  return { result, cancel: () => stop() };
}

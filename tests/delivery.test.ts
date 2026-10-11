import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { once } from 'node:events';

test('delivery fixture uses current checkout, matches browser contracts and closes through IPC', { timeout: 45000 }, async () => {
  const child = spawn(process.execPath, ['scripts/f03-fixture.ts', '--f04', '--port', '0'], {
    cwd: resolve('web'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const exited = once(child, 'exit');
  let output = '', errors = '';
  child.stderr!.on('data', chunk => { errors += chunk; });
  try {
    const path = await new Promise<string>((accept, reject) => {
      const timer = setTimeout(() => reject(Error('Fixture startup timed out')), 30000);
      child.once('error', reject);
      child.once('exit', code => { clearTimeout(timer); reject(Error(`Fixture exited ${code}: ${errors}`)); });
      child.stdout!.on('data', chunk => {
        output += chunk;
        const match = /Connection file: ([^\r\n]+)/.exec(output);
        if (match) { clearTimeout(timer); accept(match[1]); }
      });
    });
    const connection = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(connection.noModelCalls, true);
    assert.equal(connection.backendSnapshot.path, process.cwd());
    assert.equal(connection.backendSnapshot.kind, 'current-checkout');
    const token = await readFile(connection.tokenFile, 'utf8');
    const response = await fetch(connection.url + '/api/v1/bootstrap', { headers: { Authorization: 'Bearer ' + token } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).executionMode, 'deterministic');
  } finally {
    if (child.connected) child.send({ type: 'shutdown' });
    const force = setTimeout(() => child.kill('SIGKILL'), 5000);
    let limit: ReturnType<typeof setTimeout> | undefined;
    try {
      const [code] = await Promise.race([exited, new Promise<never>((_, reject) => { limit = setTimeout(() => reject(Error('Owned fixture did not close')), 10000); })]);
      assert.equal(code, 0, errors);
    } finally { clearTimeout(force); clearTimeout(limit); }
  }
});

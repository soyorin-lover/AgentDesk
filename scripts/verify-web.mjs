// Owns its Vite server and deterministic fixture; never starts a real model.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const web = join(root, 'web');
const require = createRequire(join(web, 'package.json'));
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href);
const server = await createServer({ root: web, server: { host: '127.0.0.1', port: 0, strictPort: true, open: false } });
let fixture, exited;
try {
  await server.listen();
  const origin = 'http://127.0.0.1:' + server.httpServer.address().port;
  fixture = spawn(process.execPath, ['scripts/f03-fixture.ts', '--f04', '--port', '0', '--frontend-origin', origin], {
    cwd: web, windowsHide: true, stdio: ['ignore', 'pipe', 'inherit', 'ipc'],
  });
  exited = once(fixture, 'exit');
  const connection = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(Error('Fixture startup timed out')), 30000);
    fixture.once('error', reject);
    fixture.once('exit', code => { clearTimeout(timer); reject(Error('Fixture exited during startup: ' + code)); });
    fixture.stdout.on('data', chunk => {
      output += chunk;
      const match = /Connection file: ([^\r\n]+)/.exec(output);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  console.log('Owned frontend: ' + origin + '; deterministic HTTP/Git/SQLite fixture, no model calls.');
  const smoke = spawn(process.execPath, ['scripts/interaction-v1-smoke.mjs', connection], {
    cwd: web, windowsHide: true, stdio: 'inherit', env: { ...process.env, AGENTDESK_FRONTEND_URL: origin },
  });
  const [code] = await once(smoke, 'exit');
  if (code !== 0) throw Error('Browser verification failed: ' + code);
} finally {
  try {
    if (fixture?.connected) fixture.send({ type: 'shutdown' });
    if (exited) {
      const force = setTimeout(() => fixture.kill('SIGKILL'), 5000);
      let limit;
      try {
        await Promise.race([exited, new Promise((_, reject) => { limit = setTimeout(() => reject(Error('Owned fixture did not close')), 10000); })]);
      } finally { clearTimeout(force); clearTimeout(limit); }
    }
  } finally { await server.close(); }
}

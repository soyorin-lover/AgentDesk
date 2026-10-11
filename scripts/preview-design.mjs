import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const port = Number(process.env.AGENTDESK_DESIGN_PORT || 5320);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('invalid preview port');
const server = createServer(async (req, res) => {
  if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host) || req.method !== 'GET' || !['/', '/?legacy=1'].includes(req.url)) {
    res.writeHead(404); res.end(); return;
  }
  try {
    const file = req.url === '/?legacy=1' ? 'workflow-preview-v1.html' : 'workflow-preview.html';
    const html = await readFile(new URL(`../docs/prototypes/${file}`, import.meta.url));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(html);
  } catch {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('设计稿暂时无法读取。');
  }
});
server.listen(port, '127.0.0.1', () => console.log(`AgentDesk design preview: http://127.0.0.1:${port}/`));

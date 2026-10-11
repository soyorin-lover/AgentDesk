import { createInterface } from 'node:readline';
const send = (x) => process.stdout.write(JSON.stringify(x) + '\n');
let initialized = false;
let active;
createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line);
  if (!m.method) return;
  if (m.method === 'initialize') send({ id: m.id, result: { userAgent: 'fixture' } });
  if (m.method === 'initialized') initialized = true;
  if (m.method === 'model/list') send({ id: m.id, result: { data: [{ model: 'fixture-default', isDefault: true }], nextCursor: null } });
  const threadResult = () => ({ thread: { id: m.params.threadId || 'thread-1' }, ...(process.argv.includes('--missing-model') ? {} : { model: process.argv.includes('--different-model') ? 'fixture-returned' : m.params.model || 'fixture-default' }),
    ...(process.argv.includes('--missing-cwd') ? {} : { cwd: process.argv.includes('--wrong-cwd') ? m.params.cwd + '/other' : m.params.cwd }),
    ...(process.argv.includes('--missing-approval') ? {} : { approvalPolicy: process.argv.includes('--wrong-approval') ? 'on-request' : m.params.approvalPolicy }),
    ...(process.argv.includes('--missing-sandbox') ? {} : { sandbox: { type: process.argv.includes('--wrong-sandbox') ? 'dangerFullAccess' : 'workspaceWrite' } }) });
  if (m.method === 'thread/start') send(initialized ? { id: m.id, result: threadResult() } : { id: m.id, error: { code: -32000, message: 'not initialized' } });
  if (m.method === 'thread/resume') send({ id: m.id, result: threadResult() });
  if (m.method === 'turn/start') {
    const text = m.params.input[0].text;
    const reply = text.startsWith('large-reply') ? 'x'.repeat(128 * 1024) : 'fixture text';
    const turn = { id: `turn-${m.id}`, status: text === 'fail' ? 'failed' : 'completed', error: text === 'fail' ? { message: 'fixture failure' } : null, items: [] };
    if (text === 'long' || text === 'late') {
      active = { threadId: m.params.threadId, turn };
      if (text === 'late') { const late = active; setTimeout(() => send({ method: 'turn/completed', params: late }), 100); }
    }
    else {
      if (text === 'correlation') {
        for (const identity of [{}, { threadId: m.params.threadId }, { turnId: turn.id }, { threadId: 'other', turnId: turn.id }, { threadId: m.params.threadId, turnId: 'other' }]) {
          send({ method: 'item/completed', params: { ...identity, item: { id: 'foreign', type: 'agentMessage', text: 'foreign' } } });
          send({ method: 'item/started', params: { ...identity, item: { id: 'foreign', type: 'commandExecution' } } });
          send({ method: 'model/rerouted', params: { ...identity, fromModel: 'fixture-default', toModel: 'foreign' } });
        }
        send({ method: 'model/rerouted', params: { threadId: m.params.threadId, turnId: turn.id, fromModel: 'fixture-default', toModel: 'fixture-rerouted', reason: 'highRisk' } });
      }
      if (text === 'stale-first') send({ method: 'turn/completed', params: { threadId: m.params.threadId, turn: { id: 'old-turn', status: 'completed' } } });
      send({ method: 'item/agentMessage/delta', params: { threadId: m.params.threadId, turnId: turn.id, itemId: 'message-1', delta: reply } });
      send({ method: 'item/completed', params: { threadId: m.params.threadId, turnId: turn.id, item: { id: 'message-1', type: 'agentMessage', text: reply } } });
      send({ method: 'turn/completed', params: { threadId: m.params.threadId, turn } });
    }
    send({ id: m.id, result: { turn: { ...turn, status: 'inProgress' } } });
  }
  if (m.method === 'turn/interrupt') {
    send({ id: m.id, result: {} });
    send({ method: 'turn/completed', params: { ...active, turn: { ...active.turn, status: 'interrupted' } } });
  }
  if (m.method === 'echo') send({ id: m.id, result: m.params });
  if (m.method === 'error') send({ id: m.id, error: { code: -32602, message: 'bad params' } });
  if (m.method === 'exit') process.exit(7);
  if (m.method === 'bad') process.stdout.write('not json\n');
  if (m.method === 'truncated') { process.stdout.write('{"id":'); process.exit(0); }
  if (m.method === 'fragment') {
    const b = Buffer.from(JSON.stringify({ id: m.id, result: '你好' }) + '\r\n');
    for (const byte of b) process.stdout.write(Buffer.from([byte]));
  }
  if (m.method === 'server-request') {
    const q = { id: 'server-1', method: 'approval', params: {} };
    send(q); send(q);
    setTimeout(() => { send(q); send({ id: m.id, result: true }); }, 30);
  }
  if (m.method === 'conflicting-server-request') {
    send({ id: 'conflict', method: 'approval', params: { action: 'one' } });
    send({ id: 'conflict', method: 'approval', params: { action: 'two' } });
  }
  if (m.method === 'hang') { setInterval(() => {}, 1000); send({ id: m.id, result: true }); }
  if (m.method === 'event') {
    send({ method: 'done', params: { value: 42 } });
    send({ id: m.id, result: true });
  }
  if (m.method === 'patch-event') {
    send({ method: 'item/started', params: { threadId: 'thread-1', turnId: 'turn-1', item: { id: 'patch-1', type: 'fileChange', changes: [{ path: 'sample.txt', diff: '+approved', kind: { type: 'update' } }] } } });
    send({ id: m.id, result: true });
  }
  if (m.method === 'delay') setTimeout(() => send({ id: m.id, result: 'late' }), 80);
});

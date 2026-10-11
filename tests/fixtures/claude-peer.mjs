// Deterministic CLI transport; never launches Claude or calls a model.
const args = process.argv.slice(2), scenario = args.shift();
if (args.includes('--version')) {
  console.log(scenario === 'wrong-version' ? '2.1.999 (Claude Code)' : '2.1.284 (Claude Code)');
  process.exit(0);
}
let input = '';
for await (const chunk of process.stdin) input += chunk;
const session = args[args.indexOf(args.includes('--resume') ? '--resume' : '--session-id') + 1];
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
if (scenario === 'malformed') { console.log('not json'); process.exit(0); }
send({ type: 'system', subtype: 'init', session_id: session, cwd: process.cwd(), model: 'fixture-config', permissionMode: 'dontAsk' });
if (scenario === 'missing-result') process.exit(0);
if (scenario === 'wrong-session') {
  send({ type: 'assistant', session_id: 'foreign', parent_tool_use_id: null, message: { id: 'wrong', content: [{ type: 'text', text: 'must not leak' }] } });
  process.exit(0);
}
send({ type: 'assistant', uuid: 'sub', session_id: session, parent_tool_use_id: 'nested', message: { id: 'sub', content: [{ type: 'text', text: 'private child' }] } });
send({ type: 'assistant', uuid: 'a', session_id: session, parent_tool_use_id: null, message: { id: 'message-1', model: 'fixture-header', content: [{ type: 'text', text: input }, { type: 'thinking', thinking: 'private' }] } });
send({ type: 'result', subtype: scenario === 'error' ? 'error_during_execution' : 'success', is_error: scenario === 'error', session_id: session, result: input });
if (scenario === 'hold') setInterval(() => {}, 1000);
else if (scenario === 'bad-exit') process.exitCode = 1;

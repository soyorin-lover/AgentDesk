import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import type { EngineAdapter, Execution, ExecutionContext, ExecutionResult, AgentCapability } from './types.ts';

type Options = { binary: string; version: string; model?: string; turnTimeoutMs?: number };
type Launcher = (binary: string, args: string[], options: SpawnOptionsWithoutStdio) => ChildProcessWithoutNullStreams;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const tools = ['Read', 'Glob', 'Grep', 'Edit', 'Write'];

// A close event, rather than kill() acceptance or stdout EOF, is exit evidence.
class CliProcess {
  child: ChildProcessWithoutNullStreams;
  closed: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  exited = false;
  error?: NodeJS.ErrnoException;
  constructor(binary: string, args: string[], cwd: string, launch: Launcher) {
    this.child = launch(binary, args, { cwd, shell: false, windowsHide: true });
    this.closed = new Promise(resolveExit => {
      this.child.on('error', e => { this.error = e; });
      this.child.on('close', (code, signal) => { this.exited = true; resolveExit({ code, signal }); });
    });
    // Drain without retaining potentially sensitive diagnostics or tool output.
    this.child.stderr.resume();
    this.child.stdin.on('error', e => { this.error = e; });
  }
  async close() {
    if (this.exited) return;
    this.child.stdin.destroy(); this.child.kill();
    const force = setTimeout(() => { if (!this.exited) this.child.kill('SIGKILL'); }, 2000);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([this.closed, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('process_exit_unconfirmed')), 6000); })]); }
    finally { clearTimeout(force); clearTimeout(timer); }
  }
}

export class ClaudeAdapter implements EngineAdapter {
  readonly engineId = 'claude_code';
  #options: Options;
  #launch: Launcher;
  #identity: string;
  constructor(options: Options, dependencies?: { spawn: Launcher }) {
    if (!options || !isAbsolute(options.binary) || /\.(cmd|bat|ps1)$/i.test(options.binary) || options.version !== '2.1.284') throw Error('invalid_claude_configuration');
    if (options.model !== undefined && (typeof options.model !== 'string' || !options.model || options.model.length > 200 || /[\x00\r\n]/.test(options.model))) throw Error('invalid_claude_configuration');
    if (options.turnTimeoutMs !== undefined && (!Number.isSafeInteger(options.turnTimeoutMs) || options.turnTimeoutMs < 100 || options.turnTimeoutMs > 3600000)) throw Error('invalid_claude_configuration');
    this.#options = { ...options }; this.#launch = dependencies?.spawn ?? spawn;
    this.#identity = createHash('sha256').update(JSON.stringify({ ...this.#options, turnTimeoutMs: options.turnTimeoutMs ?? 120000, policy: 'claude-print-files-v1', ...(dependencies ? { transport: randomUUID() } : {}) })).digest('hex');
  }
  get configurationIdentity() { return this.#identity; }
  get configuredModel() { return this.#options.model; }
  get capabilities(): AgentCapability[] {
    return (['start', 'continue', 'interrupt', 'approval', 'recovery'] as const).map(name => ({ name, businessSupport: ['start', 'continue'].includes(name) ? 'implemented' : 'unsupported', protocolSupport: ['start', 'continue'].includes(name) ? 'implemented' : 'not_integrated', verification: ['start', 'continue'].includes(name) ? 'fixture_verified' : 'unverified', evidenceRef: 'docs/BACKEND-BATCH-08B-API.md;tests/backend-claude.test.ts' }));
  }
  async #verifyVersion(cwd: string) {
    let proc: CliProcess | undefined, timer: ReturnType<typeof setTimeout> | undefined;
    try {
      proc = new CliProcess(this.#options.binary, ['--version'], cwd, this.#launch);
      let output = '';
      proc.child.stdout.setEncoding('utf8');
      proc.child.stdout.on('data', text => { if (output.length < 4096) output += text; });
      proc.child.stdin.end();
      const exit = await Promise.race([proc.closed, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('engine_version_unavailable')), 10000); })]);
      if (exit.code !== 0 || proc.error || output.trim() !== `${this.#options.version} (Claude Code)`) throw Error('engine_version_mismatch');
    } catch (error) {
      let processExitUnconfirmed = false;
      await proc?.close().catch(() => { processExitUnconfirmed = true; });
      throw Object.assign(Error(error instanceof Error && error.message === 'engine_version_mismatch' ? error.message : 'engine_version_unavailable'), { definitive: true, processExitUnconfirmed });
    } finally { clearTimeout(timer); }
  }
  async start(context: ExecutionContext): Promise<Execution> {
    if (context.sessionId !== undefined && !uuid.test(context.sessionId)) throw Object.assign(Error('native_session_invalid'), { definitive: true });
    await this.#verifyVersion(context.cwd);
    const sessionId = context.sessionId ?? randomUUID();
    const args = ['--print', '--verbose', '--output-format', 'stream-json', '--input-format', 'text',
      '--safe-mode', '--restricted', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
      '--permission-mode', 'dontAsk', '--permission-prompts', 'none', '--disable-slash-commands',
      '--tools', tools.join(','), '--allowedTools', tools.join(','), '--disallowedTools', 'mcp__*',
      '--append-system-prompt', 'Work only on the user task in this working directory. Do not delegate, inspect credentials, modify global configuration, commit, push, merge, deploy, or delete the workspace. Only bounded file tools are available; commands and interactive approvals are unavailable. Report changes and checks honestly.',
      ...(this.#options.model ? ['--model', this.#options.model] : []),
      ...(context.sessionId ? ['--resume', sessionId] : ['--session-id', sessionId])];
    let proc: CliProcess;
    try { proc = new CliProcess(this.#options.binary, args, context.cwd, this.#launch); }
    catch { throw Object.assign(Error('engine_start_failed'), { definitive: true }); }
    let rejectResult!: (e: Error) => void, resolveResult!: (r: ExecutionResult) => void;
    const result = new Promise<ExecutionResult>((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
    void result.catch(() => {});
    let initialized = false, terminal: ExecutionResult | undefined, failed = false, closing = false, buffer = '', bytes = 0;
    const seen = new Set<string>(), textByMessage = new Map<string, string>();
    const fail = (code: string) => { if (!failed) { failed = true; rejectResult(Error(code)); } };
    const consume = (m: any) => {
      if (!m || typeof m !== 'object' || Array.isArray(m) || typeof m.type !== 'string') throw Error('invalid_frame');
      if (m.type === 'system' && m.subtype === 'init') {
        if (initialized || m.session_id !== sessionId || typeof m.cwd !== 'string' || resolve(m.cwd) !== resolve(context.cwd) || m.permissionMode !== 'dontAsk') throw Error('invalid_init');
        initialized = true; context.onSession(sessionId);
        if (typeof m.model === 'string' && m.model) context.onModel(m.model, 'thread_configuration');
        return;
      }
      if (!['assistant', 'user', 'result'].includes(m.type)) {
        if (m.type === 'control_request' || m.type === 'control_response') throw Error('unsupported_control');
        return; // Ignore new informational system types; never retain raw payloads.
      }
      if (!initialized || m.session_id !== sessionId || terminal) throw Error('unowned_or_late_event');
      if (m.type !== 'result' && m.parent_tool_use_id !== null) return;
      if (m.type === 'result') {
        if (typeof m.is_error !== 'boolean' || typeof m.subtype !== 'string') throw Error('invalid_terminal');
        if (m.is_error || m.subtype.startsWith('error_')) terminal = { status: 'failed', reason: 'engine_failed' };
        else if (m.subtype === 'success') terminal = Array.isArray(m.permission_denials) && m.permission_denials.length ? { status: 'failed', reason: 'permission_denied' } : { status: 'succeeded' };
        else throw Error('unknown_terminal');
        return;
      }
      if (typeof m.uuid !== 'string' || seen.has(m.uuid)) return;
      seen.add(m.uuid);
      if (m.type === 'assistant') {
        if (typeof m.message?.id !== 'string' || !Array.isArray(m.message.content)) throw Error('invalid_assistant');
        if (typeof m.message.model === 'string' && m.message.model) context.onModel(m.message.model, 'assistant_message');
        for (const block of m.message.content) {
          if (block.type === 'text' && typeof block.text === 'string') {
            const text = (textByMessage.get(m.message.id) ?? '') + block.text; textByMessage.set(m.message.id, text);
            context.emit({ type: 'message.completed', data: { messageId: m.message.id, text } });
          } else if (block.type === 'tool_use') {
            if (!tools.includes(block.name) || typeof block.id !== 'string') throw Error('unsupported_tool');
            context.emit({ type: 'activity.started', data: { activityId: block.id, category: ['Edit', 'Write'].includes(block.name) ? 'file_change' : 'tool', status: 'running' } });
          }
        }
      } else if (Array.isArray(m.message?.content)) {
        for (const block of m.message.content) if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') context.emit({ type: 'activity.completed', data: { activityId: block.tool_use_id, category: 'tool', status: block.is_error ? 'failed' : 'completed' } });
      }
    };
    proc.child.stdout.setEncoding('utf8');
    proc.child.stdout.on('data', (chunk: string) => {
      if (failed || closing) return;
      bytes += Buffer.byteLength(chunk); buffer += chunk;
      if (bytes > 16 * 1024 * 1024 || Buffer.byteLength(buffer) > 8 * 1024 * 1024) { fail('claude_output_limit'); return; }
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1);
        if (!line) continue;
        try { consume(JSON.parse(line)); } catch { fail('claude_protocol_invalid'); break; }
      }
    });
    proc.child.stdin.on('error', () => fail('claude_input_unconfirmed'));
    proc.child.stdin.end(context.input);
    const timeout = setTimeout(() => fail('claude_result_timeout'), this.#options.turnTimeoutMs ?? 120000);
    void proc.closed.then(exit => {
      clearTimeout(timeout);
      if (failed) return;
      if (closing || proc.error || buffer.trim() || !terminal || exit.signal || exit.code === null || (terminal.status === 'succeeded' && exit.code !== 0)) { fail('claude_result_unknown'); return; }
      resolveResult(terminal);
    });
    return { result, interrupt: async () => { throw Error('engine_capability_unsupported'); }, close: async () => { closing = !proc.exited; clearTimeout(timeout); await proc.close(); } };
  }
}

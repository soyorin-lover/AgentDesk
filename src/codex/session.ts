import { RpcClient, type Message } from './rpc.ts';
import { diagnostic } from './diagnostics.ts';
import type { FileProposal } from './approval.ts';

export type TurnResult = { threadId: string; turnId: string; status: string; text: string; errorCode?: string };
export type TurnHandle = { threadId: string; turnId: string; completion: Promise<TurnResult> };
export class CodexSession {
  rpc: RpcClient;
  eventCounts: Record<string, number> = {};
  diagnostics: { method: string; kind: string }[] = [];
  model: string | undefined;
  proposedChanges = new Map<string, FileProposal>();
  turnTimes = new Map<string, { started: number; completed?: number }>();
  #text = new Map<string, string[]>();
  #busy = new Set<string>();

  constructor(binary = process.env.CODEX_BIN || 'codex', args = ['app-server', '--listen', 'stdio://'], onRequest?: (m: Message) => Promise<any>, options: { onEvent?: (m: Message) => void; collectText?: boolean } = {}) {
    this.rpc = new RpcClient(binary, args, {
      onRequest,
      onEvent: m => {
        this.eventCounts[m.method!] = (this.eventCounts[m.method!] || 0) + 1;
        if (m.method === 'turn/started') this.turnTimes.set(m.params.turn.id, { started: performance.now() });
        if (m.method === 'turn/completed') {
          const time = this.turnTimes.get(m.params.turn.id);
          if (time) time.completed = performance.now();
        }
        if (m.method === 'item/started' && m.params.item.type === 'fileChange') {
          this.proposedChanges.set(m.params.item.id, { threadId: m.params.threadId, turnId: m.params.turnId, itemId: m.params.item.id, changes: (m.params.item.changes || []).map((c: any) => ({ path: c.path, kind: c.kind })) });
        }
        if (m.method === 'error' || m.method === 'warning' || m.method === 'configWarning') {
          this.diagnostics.push(diagnostic(m.method, m.params));
        }
        if (m.method === 'turn/completed' && m.params.turn.error) {
          this.diagnostics.push(diagnostic(m.method, m.params.turn.error));
        }
        if (options.collectText !== false && m.method === 'item/completed' && m.params.item.type === 'agentMessage') {
          const key = m.params.turnId;
          const messages = this.#text.get(key) || [];
          messages.push(m.params.item.text);
          this.#text.set(key, messages);
        }
        options.onEvent?.(m);
      },
    });
  }

  async initialize() {
    const result = await this.rpc.request('initialize', {
      clientInfo: { name: 'agentdesk_probe', title: 'AgentDesk batch 01', version: '0.0.1' },
      capabilities: { experimentalApi: false, requestAttestation: false },
    });
    this.rpc.notify('initialized');
    return result;
  }

  createThread(cwd: string, overrides: Record<string, any> = {}) {
    return this.rpc.request('thread/start', {
      cwd, approvalPolicy: 'never', sandbox: 'workspace-write',
      ...(this.model ? { model: this.model } : {}),
      config: { model_reasoning_effort: 'low' },
      baseInstructions: 'You are a minimal protocol verification agent. Follow only the user task. Do not delegate or use external integrations. Only edit the explicitly named sample file. Do not read credentials, global configuration, or files outside the sample repository.',
      ...overrides,
    });
  }

  resumeThread(threadId: string, cwd: string, overrides: Record<string, any> = {}) {
    return this.rpc.request('thread/resume', { threadId, cwd, approvalPolicy: 'never', sandbox: 'workspace-write', ...(this.model ? { model: this.model } : {}), ...overrides });
  }

  async discoverModel(requested?: string) {
    let cursor: string | undefined;
    const models: any[] = [];
    do {
      const page = await this.rpc.request('model/list', { ...(cursor ? { cursor } : {}) });
      models.push(...page.data);
      cursor = page.nextCursor || undefined;
    } while (cursor);
    const selected = requested ? models.find(m => m.model === requested) : models.find(m => m.isDefault);
    if (!selected) throw new Error('requested/default model is not advertised by server');
    if (typeof selected.model !== 'string') throw new Error('invalid model identifier');
    this.model = selected.model;
    return selected.model as string;
  }

  async startTurn(threadId: string, text: string, timeoutMs = 120_000, overrides: Record<string, any> = {}): Promise<TurnHandle> {
    if (this.#busy.has(threadId)) throw new Error('thread already has an active turn');
    this.#busy.add(threadId);
    let turnId: string | undefined;
    const candidates = new Map<string, any>();
    let finish!: (params: any) => void, fail!: (error: Error) => void;
    const terminal = new Promise<any>((resolve, reject) => { finish = resolve; fail = reject; });
    const timer = setTimeout(() => fail(new Error('turn/completed event timed out')), timeoutMs);
    const unsubscribe = this.rpc.subscribe(m => {
      if (m.method !== 'turn/completed' || m.params.threadId !== threadId) return;
      if (turnId) { if (m.params.turn.id === turnId) finish(m.params); }
      else { if (candidates.size >= 32) { fail(new Error('too many early terminal events')); return; } candidates.set(m.params.turn.id, m.params); }
    }, fail);
    const completion = terminal.then(p => {
      const messages = this.#text.get(p.turn.id) || [];
      this.#text.delete(p.turn.id);
      return { threadId, turnId: p.turn.id, status: p.turn.status, text: messages.join('\n'), errorCode: p.turn.error?.codexErrorInfo ? JSON.stringify(p.turn.error.codexErrorInfo) : undefined };
    }).catch(async error => { await this.close(); throw error; }).finally(() => { clearTimeout(timer); unsubscribe(); this.#busy.delete(threadId); });
    // A notification may fail before the start RPC settles. Always attach a rejection handler.
    void completion.catch(() => {});
    try {
      const result = await this.rpc.request('turn/start', { threadId, input: [{ type: 'text', text, text_elements: [] }], effort: 'low', ...overrides });
      turnId = result.turn.id;
      if (candidates.has(turnId!)) finish(candidates.get(turnId!));
      candidates.clear();
      return { threadId, turnId: result.turn.id, completion };
    } catch (error) {
      fail(error as Error);
      // The acceptance outcome is ambiguous on timeout: retire this connection.
      await this.close();
      throw error;
    }
  }

  async runTurn(threadId: string, text: string, timeoutMs = 120_000) {
    const handle = await this.startTurn(threadId, text, timeoutMs);
    const result = await handle.completion;
    if (result.turnId !== handle.turnId || result.status !== 'completed') throw new Error(`turn ${result.status}${result.errorCode ? ': ' + result.errorCode : ''}`);
    return result;
  }

  steer(handle: TurnHandle, text: string) {
    return this.rpc.request('turn/steer', { threadId: handle.threadId, expectedTurnId: handle.turnId, input: [{ type: 'text', text, text_elements: [] }] });
  }

  async interrupt(handle: TurnHandle) {
    await this.rpc.request('turn/interrupt', { threadId: handle.threadId, turnId: handle.turnId });
    const result = await handle.completion;
    if (result.turnId !== handle.turnId || result.status !== 'interrupted') throw new Error(`interrupt not confirmed: ${result.status}`);
    return result;
  }

  close() { return this.rpc.close(); }
}

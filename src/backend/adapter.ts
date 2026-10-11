import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { CodexSession } from '../codex/session.ts';
import { RpcError, type Message } from '../codex/rpc.ts';
import { diagnostic } from '../codex/diagnostics.ts';
import type { EngineAdapter, ExecutionContext, Execution, ExecutionResult } from './types.ts';
type AdapterOptions = { binary?: string; args?: string[]; model?: string; transport?: 'default' | 'http'; turnTimeoutMs?: number };
export class CodexAdapter implements EngineAdapter {
  #options: AdapterOptions;
  #configurationIdentity: string;
  constructor(options: AdapterOptions = {}) {
    this.#options = { ...options, ...(options.args ? { args: [...options.args] } : {}) };
    this.#configurationIdentity = createHash('sha256').update(JSON.stringify({ binary: options.binary || 'codex', args: options.args ?? null, model: options.model ?? null, transport: options.transport ?? 'default', turnTimeoutMs: options.turnTimeoutMs ?? 120000, executionPolicyVersion: 1 })).digest('hex');
  }
  get configurationIdentity() { return this.#configurationIdentity; }
  get configuredModel() { return this.#options.model; }
  async start(context: ExecutionContext): Promise<Execution> {
    const chunks = new Map<string, number>();
    let ownThread: string | undefined, ownTurn: string | undefined;
    const early: Message[] = [];
    let earlyBytes = 0, stage = 'setup';
    const emit = (m: Message) => {
      const p = m.params;
      const scoped = ['item/agentMessage/delta', 'item/started', 'item/completed', 'model/rerouted'].includes(m.method!);
      if (scoped && (!ownThread || !ownTurn || p?.threadId !== ownThread || p?.turnId !== ownTurn)) return;
      if (p?.threadId && p.threadId !== ownThread) return;
      if (p?.turnId && p.turnId !== ownTurn) return;
      if (m.method === 'model/rerouted' && typeof p.toModel === 'string' && p.toModel.length > 0) {
        context.onModel(p.toModel, 'model_rerouted');
        return;
      }
      if (m.method === 'item/agentMessage/delta' && typeof p.itemId === 'string' && typeof p.delta === 'string') {
        const chunkIndex = chunks.get(p.itemId) || 0; chunks.set(p.itemId, chunkIndex + 1);
        context.emit({ type: 'message.delta', data: { messageId: p.itemId, chunkIndex, text: p.delta } });
      } else if (m.method === 'item/completed' && p.item?.type === 'agentMessage' && typeof p.item.id === 'string' && typeof p.item.text === 'string') {
        context.emit({ type: 'message.completed', data: { messageId: p.item.id, text: p.item.text } });
      } else if ((m.method === 'item/started' || m.method === 'item/completed') && typeof p.item?.id === 'string' && typeof p.item.type === 'string' && p.item.type !== 'agentMessage') {
        const categories: Record<string, string> = { commandExecution: 'command', fileChange: 'file_change', reasoning: 'reasoning', plan: 'plan' };
        context.emit({ type: m.method === 'item/started' ? 'activity.started' : 'activity.completed', data: { activityId: p.item.id, category: categories[p.item.type] || 'tool', status: m.method === 'item/started' ? 'running' : 'completed' } });
      } else if (m.method === 'error' || m.method === 'warning' || m.method === 'configWarning') {
        const d = diagnostic(m.method, p); context.emit({ type: 'diagnostic.recorded', data: { category: d.kind, ...(d.errorCode ? { code: d.errorCode } : {}) } });
      }
    };
    const onRequest = async (m: Message) => {
      context.emit({ type: 'diagnostic.recorded', data: { category: 'request_denied', code: 'interactive_requests_unavailable' } });
      if (m.method === 'item/fileChange/requestApproval' || m.method === 'item/commandExecution/requestApproval') return { decision: 'decline' };
      if (m.method === 'item/permissions/requestApproval') return { permissions: {}, scope: 'turn' };
      throw new RpcError(-32601, 'Unsupported server request');
    };
    const args = this.#options.args || (this.#options.transport === 'http' ? [
      '-c', 'model_provider="agentdesk_local_http"',
      '-c', 'model_providers.agentdesk_local_http={name="OpenAI",wire_api="responses",requires_openai_auth=true,supports_websockets=false,request_max_retries=0,stream_max_retries=0,stream_idle_timeout_ms=15000}',
      'app-server', '--listen', 'stdio://',
    ] : ['app-server', '--listen', 'stdio://']);
    const session = new CodexSession(this.#options.binary || 'codex', args, onRequest, { collectText: false, onEvent: m => {
      if (ownTurn) emit(m);
      else {
        // Buffer only normalized-event candidates, never tool output deltas or raw protocol history.
        if (!['item/agentMessage/delta', 'item/started', 'item/completed', 'model/rerouted', 'error', 'warning', 'configWarning'].includes(m.method!)) return;
        earlyBytes += Buffer.byteLength(JSON.stringify(m));
        if (early.length >= 2000 || earlyBytes > 10 * 1024 * 1024) throw Error('early event limit');
        early.push(m);
      }
    } });
    try {
      await session.initialize();
      await session.discoverModel(this.#options.model);
      stage = context.sessionId ? 'resume' : 'thread';
      const policy = { approvalPolicy: 'never', sandbox: 'workspace-write', baseInstructions: 'Work only on the user task in the assigned repository. Do not delegate, use external integrations, inspect credentials or global configuration, commit, push, merge, deploy, or delete the workspace. Report what changed and what was actually checked. Approval and interactive user requests are unavailable in this batch.' };
      const thread = context.sessionId ? await session.resumeThread(context.sessionId, context.cwd, policy) : await session.createThread(context.cwd, policy);
      if (context.sessionId && thread.thread.id !== context.sessionId) throw Error('resume session mismatch');
      if (typeof thread.cwd !== 'string' || !thread.cwd || resolve(thread.cwd) !== resolve(context.cwd)) throw Error('workspace mismatch');
      if (thread.approvalPolicy !== 'never') throw Error('approval policy mismatch');
      if (thread.sandbox?.type !== 'workspaceWrite') throw Error('sandbox policy mismatch');
      if (typeof thread.thread?.id !== 'string' || !thread.thread.id) throw Error('invalid thread identity');
      ownThread = thread.thread.id; context.onSession(ownThread!);
      // This is server-returned thread configuration, not physical model telemetry.
      if (typeof thread.model === 'string' && thread.model.length > 0) context.onModel(thread.model, 'thread_configuration');
      stage = 'turn';
      const handle = await session.startTurn(ownThread!, context.input, this.#options.turnTimeoutMs ?? 120000, {
        approvalPolicy: 'never', sandboxPolicy: { type: 'workspaceWrite', writableRoots: [context.cwd], networkAccess: false, excludeTmpdirEnvVar: true, excludeSlashTmp: true },
      });
      ownTurn = handle.turnId;
      if (typeof ownTurn !== 'string' || !ownTurn) throw Error('invalid turn identity');
      context.onTurn?.(ownTurn);
      try { for (const event of early) emit(event); } catch (e) { await session.close(); throw e; } finally { early.length = 0; }
      const result = handle.completion.then((turn): ExecutionResult => {
        if (turn.status === 'completed') return { status: 'succeeded' };
        if (turn.status === 'interrupted') return { status: 'aborted' };
        if (turn.status === 'failed') return { status: 'failed', reason: 'engine_failed' };
        throw Error('unknown terminal status');
      });
      void result.catch(() => {});
      return { result, close: () => session.close(), interrupt: async () => {
        // RPC acceptance is not interruption confirmation. The result promise owns the actual terminal.
        await session.rpc.request('turn/interrupt', { threadId: handle.threadId, turnId: handle.turnId });
      } };
    } catch (error) {
      let processExitUnconfirmed = false;
      await session.close().catch(() => { processExitUnconfirmed = true; });
      const definite = error instanceof RpcError || stage === 'setup' || (error as NodeJS.ErrnoException).code === 'ENOENT';
      const safe = new Error('engine_start_failed') as Error & { definitive: boolean; processExitUnconfirmed: boolean }; safe.definitive = definite; safe.processExitUnconfirmed = processExitUnconfirmed; throw safe;
    }
  }
}

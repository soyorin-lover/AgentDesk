import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { isDeepStrictEqual } from 'node:util';

export type Message = { id?: string | number; method?: string; params?: any; result?: any; error?: { code: number; message: string } };
type Options = {
  cwd?: string;
  onRequest?: (message: Message) => Promise<any>;
  onEvent?: (message: Message) => void;
};
type Pending = { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
type Waiter = { method: string; predicate: (params: any) => boolean; resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
export class RpcError extends Error {
  code: number;
  constructor(code: number, message: string) { super(`RPC ${code}: ${message}`); this.name = 'RpcError'; this.code = code; }
}

/** Minimal App Server JSONL transport. No jsonrpc field is sent. */
export class RpcClient {
  child: ChildProcessWithoutNullStreams;
  exited = false;
  stderrBytes = 0;
  #options: Options;
  #decoder = new StringDecoder('utf8');
  #buffer = '';
  #nextId = 0;
  #failure: Error | undefined;
  #pending = new Map<number | string, Pending>();
  #waiters = new Set<Waiter>();
  #observers = new Set<{ event: (message: Message) => void; failure: (error: Error) => void }>();
  #serverRequests = new Map<string, { request: Message; answer: Promise<Message> }>();
  #closed: Promise<void>;
  #closing: Promise<void> | undefined;

  constructor(binary: string, args: string[], options: Options = {}) {
    this.#options = options;
    this.child = spawn(binary, args, { cwd: options.cwd, stdio: 'pipe', shell: false, windowsHide: true });
    this.#closed = new Promise(resolve => this.child.once('close', () => { this.exited = true; resolve(); }));
    this.child.on('error', error => this.#fail(error));
    this.child.stdin.on('error', error => this.#fail(error));
    this.child.stderr.on('data', chunk => { this.stderrBytes += chunk.length; });
    this.child.stdout.on('data', chunk => this.#read(this.#decoder.write(chunk)));
    this.child.stdout.on('end', () => {
      this.#read(this.#decoder.end());
      if (this.#buffer.trim()) this.#fail(new Error('truncated JSONL frame'));
    });
    this.child.on('exit', (code, signal) => this.#fail(new Error(`App Server exited (code=${code}, signal=${signal})`)));
  }

  request<T = any>(method: string, params: any, timeoutMs = 30_000): Promise<T> {
    if (this.#failure) return Promise.reject(this.#failure);
    const id = ++this.#nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.#pending.delete(id); reject(new Error(`${method} timed out`)); }, timeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      try { this.#send({ id, method, params }); }
      catch (error) { this.#fail(error as Error); }
    });
  }

  notify(method: string, params?: any) { this.#send({ method, ...(params === undefined ? {} : { params }) }); }

  subscribe(event: (message: Message) => void, failure: (error: Error) => void): () => void {
    const observer = { event, failure };
    this.#observers.add(observer);
    if (this.#failure) failure(this.#failure);
    return () => { this.#observers.delete(observer); };
  }

  waitFor(method: string, predicate: (params: any) => boolean, timeoutMs = 120_000): Promise<any> {
    if (this.#failure) return Promise.reject(this.#failure);
    return new Promise((resolve, reject) => {
      const waiter: Waiter = { method, predicate, resolve, reject, timer: setTimeout(() => {
        this.#waiters.delete(waiter); reject(new Error(`${method} event timed out`));
      }, timeoutMs) };
      this.#waiters.add(waiter);
    });
  }

  close(): Promise<void> {
    this.#closing ??= this.#close();
    return this.#closing;
  }

  async #close() {
    this.#fail(new Error('App Server closed'));
    this.child.stdin.end();
    const force = setTimeout(() => { if (!this.exited) this.child.kill(); }, 2_000);
    const deadline = setTimeout(() => { if (!this.exited) this.child.kill('SIGKILL'); }, 4_000);
    const watchdog = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new Error('own App Server process did not exit')), 6_000);
      this.#closed.then(() => clearTimeout(timer));
    });
    try { await Promise.race([this.#closed, watchdog]); }
    finally { clearTimeout(force); clearTimeout(deadline); }
  }

  #send(message: Message) {
    if (this.#failure) throw this.#failure;
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }

  #read(text: string) {
    if (this.#failure) return;
    this.#buffer += text;
    if (Buffer.byteLength(this.#buffer) > 8 * 1024 * 1024) { this.#fail(new Error('JSONL frame exceeds 8 MiB')); return; }
    let end: number;
    while ((end = this.#buffer.indexOf('\n')) >= 0) {
      const line = this.#buffer.slice(0, end).trim();
      this.#buffer = this.#buffer.slice(end + 1);
      if (!line) continue;
      try {
        const m = JSON.parse(line);
        if (!m || typeof m !== 'object' || Array.isArray(m)) throw new Error('invalid JSONL message');
        this.#dispatch(m);
      } catch { this.#fail(new Error('invalid JSONL protocol message')); return; }
    }
  }

  #dispatch(m: Message) {
    if (m.method) {
      if (m.id !== undefined) { void this.#serve(m); return; }
      this.#options.onEvent?.(m);
      for (const observer of this.#observers) observer.event(m);
      for (const w of this.#waiters) {
        if (w.method === m.method && w.predicate(m.params)) {
          clearTimeout(w.timer); this.#waiters.delete(w); w.resolve(m.params);
        }
      }
      return;
    }
    if (m.id === undefined || (!('result' in m) && !m.error)) throw new Error('invalid response');
    const pending = this.#pending.get(m.id);
    if (!pending) return; // late / duplicate response
    clearTimeout(pending.timer); this.#pending.delete(m.id);
    if (m.error) pending.reject(new RpcError(m.error.code, m.error.message));
    else pending.resolve(m.result);
  }

  async #serve(m: Message) {
    const key = JSON.stringify(m.id);
    const prior = this.#serverRequests.get(key);
    if (prior && !isDeepStrictEqual(prior.request, m)) {
      this.#fail(new Error('conflicting server request id'));
      return;
    }
    let answer = prior?.answer;
    if (!answer) {
      answer = (async (): Promise<Message> => {
        if (!this.#options.onRequest) return { id: m.id, error: { code: -32601, message: 'Unsupported server request' } };
        try { return { id: m.id, result: await this.#options.onRequest(m) }; }
        catch (error) { return { id: m.id, error: { code: error instanceof RpcError ? error.code : -32603, message: error instanceof RpcError && error.code === -32601 ? 'Unsupported server request' : 'Server request handler failed' } }; }
      })();
      this.#serverRequests.set(key, { request: structuredClone(m), answer });
    }
    const response = await answer;
    try { this.#send(response); } catch { /* connection already failed */ }
    // Retain a bounded replay cache; pending requests are never evicted.
    if (this.#serverRequests.size > 512) {
      const first = this.#serverRequests.keys().next().value;
      if (first !== undefined && first !== key) {
        void this.#serverRequests.get(first)?.answer.then(() => this.#serverRequests.delete(first));
      }
    }
  }

  #fail(error: Error) {
    if (this.#failure) return;
    this.#failure ??= error;
    for (const p of this.#pending.values()) { clearTimeout(p.timer); p.reject(this.#failure); }
    this.#pending.clear();
    for (const w of this.#waiters) { clearTimeout(w.timer); w.reject(this.#failure); }
    this.#waiters.clear();
    for (const observer of this.#observers) observer.failure(this.#failure);
    this.#observers.clear();
  }
}

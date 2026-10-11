import type {
  Acceptance,
  CheckPreset,
  CheckRun,
  CheckSummary,
  Event,
  ReviewFile,
  Run,
  Snapshot,
  Task,
  Workspace,
} from '../api/backend/types.ts';

/* ─────────────────────────────────────────────────────────────
   AgentDesk HTTP API 的**确定性进程内替身**

   为什么存在：本机没有真实后端进程在跑，但前端 `ApiClient` 必须能被端到端
   驱动与测试。替身是一个 `fetch` 兼容函数，按
   `E:\Coding project\AgentDesk\src\backend\http.ts` 的路由与状态码、
   `src\backend\service.ts` 的语义（版本、幂等、闸门、availableActions、
   validity 重算）复现契约，于是 UI 代码在「真实 HTTP」与「替身」两种模式
   下完全相同。

   它不调用任何模型，所有输出都是固定字符串；同一调用序列永远得到逐字节
   相同的响应。它**不假装**自己是真实后端：没有真实进程、没有真实仓库、
   没有真实检查执行。

   硬性约定：
   1. 没有 `Math.random`，内容里也不出现 `Date.now()`。时间来自注入的固定
      基准时钟 + 单调 tick，因此 `occurredAt` 跨进程稳定。
   2. 标识符来自单调计数器：t-1 / ws-1 / run-1 / snap-1 / chk-1 / acc-1 /
      ev-<taskId>-<seq> / m-<n>。
   3. 异步工作跑在真实 `setTimeout` 上（20–60ms），并登记进待处理集合，
      `settle()` 等它静默。`#slow` 那类**故意长跑**的工作不登记，
      否则 settle() 会挂到 30 秒以上（见 `#afterLong` 的注释）。
   ───────────────────────────────────────────────────────────── */

/* ── 对外常量 ─────────────────────────────────────────────── */

/** 替身的来源。必须是 ApiClient 接受的本地 HTTP 来源。 */
export const DOUBLE_ORIGIN = 'http://127.0.0.1:4317';
/** 固定令牌；长度必须 ≥ 32（真实后端 http.ts 也这么要求）。 */
export const DOUBLE_TOKEN = 'agentdesk-double-token-0123456789abcdef';
/** 唯一的项目。 */
export const DOUBLE_PROJECT: { id: string; name: string } = { id: 'proj-double', name: 'AgentDesk 替身项目' };
/** 固定的项目基线提交号（40 位十六进制，与真实后端同形）。 */
export const DOUBLE_BASE_HEAD = '4f3c2b1a09e8d7c6b5a4938271605f4e3d2c1b0a';
/** 固定基准时钟：2026-10-09T01:00:00Z。所有 occurredAt 由它加 tick 推出。 */
export const DOUBLE_DEFAULT_STARTED_AT = Date.parse('2026-10-09T01:00:00.000Z');
/** 本批唯一被集成的执行实例。 */
export const DOUBLE_AGENT_INSTANCE_ID = 'codex-local';
/** 默认放行的浏览器来源（与 vite 的端口约定一致）。 */
export const DOUBLE_ORIGINS: readonly string[] = ['http://localhost:5311', 'http://localhost:5273', 'http://localhost:5173'];

/**
 * 检查预设表。四个可用、一个不可用：
 * `check.cmd` 会被后端判为不可用（Windows 上会走 shell 解析）。
 */
export const DOUBLE_PRESETS: CheckPreset[] = [
  { id: 'whitespace', name: 'Git whitespace', executable: 'git', args: ['diff', '--check'], timeoutMs: 15000, outputBytes: 65536 },
  { id: 'unit', name: 'Node 单元测试', executable: 'node', args: ['--test'], timeoutMs: 60000, outputBytes: 65536 },
  { id: 'slow', name: '长时间检查', executable: 'node', args: ['--version'], timeoutMs: 600000, outputBytes: 65536 },
  { id: 'timeout', name: '会超时的检查', executable: 'git', args: ['status'], timeoutMs: 10, outputBytes: 65536 },
  { id: 'windows-script', name: 'Windows 批处理（不可用）', executable: 'check.cmd', args: [], timeoutMs: 1000, outputBytes: 1024 },
];

/* ── 选项与返回类型 ───────────────────────────────────────── */

export interface DoubleOptions {
  /** 固定基准 epoch 毫秒；默认 2026-10-09T01:00:00Z */
  startedAt?: number;
  token?: string;
  projects?: { id: string; name: string }[];
  checkPresets?: CheckPreset[];
  /** 默认 http://localhost:5311 / 5273 / 5173 */
  allowedOrigins?: string[];
}

export interface DoubleState {
  mode: 'project' | 'legacy';
  tasks: Task[];
  workspaces: Workspace[];
  runs: Run[];
  events: Record<string, Event[]>;
  snapshots: Snapshot[];
  checks: CheckRun[];
  acceptances: Acceptance[];
  /** 读取时刻各任务的当前内容摘要（真实后端是在读时重算的） */
  contentDigest: Record<string, string>;
}

export interface DoubleBackend {
  /** `fetch` 兼容函数；传给 `new ApiClient({ ..., fetch })`。 */
  fetch: typeof globalThis.fetch;
  /** 等待所有待处理的异步步骤（定时器、进行中的运行/检查/工作区准备）。 */
  settle(): Promise<void>;
  /** 供断言使用的确定性状态快照。 */
  state(): DoubleState;
  /** 模拟外部改动：该任务的内容摘要变化，从而让旧快照/旧检查/旧接受失效。 */
  simulateExternalChange(taskId: string): void;
}

/* ── 内部工具 ─────────────────────────────────────────────── */

type Json = Record<string, unknown>;
type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT' | 'OPTIONS';
type Ref = { kind: 'task' | 'run' | 'workspace' | 'snapshot' | 'check'; id: string };
/** 需要独立编号的对象种类 —— 标识符因此可预测：t-1 / ws-1 / run-1 / … */
type CounterKind = 'task' | 'workspace' | 'run' | 'snapshot' | 'check' | 'acceptance';
type Outcome = { status: number; body: unknown } & Ref;

/** 请求处理失败：status + code 直接映射到 http.ts 的错误体形状。 */
class DoubleApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(`HTTP ${status}: ${code}`);
    this.name = 'DoubleApiError';
    this.status = status;
    this.code = code;
  }
}

/** 错误 Response。只在这里用 `new Response`，避免消费方不读 body 时的惰性告警。 */
function errorResponse(status: number, code: string): Response {
  return new Response(JSON.stringify({ error: { code, message: code, retryable: false } }), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

/** 取浏览器/进程时区（如 "+08:00"）。Intl 在浏览器与 Node 都可用，无需 Node API。 */
function zoneOffset(): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZoneName: 'longOffset' }).formatToParts(new Date(0));
    const name = parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
    return name === 'GMT' ? '+00:00' : name.replace('GMT', '');
  } catch {
    return '+00:00';
  }
}

/** "+08:00" → 毫秒偏移。 */
function offsetMilliseconds(offset: string): number {
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(offset);
  if (!match) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3])) * 60 * 1000;
}

/** epoch 毫秒 → 带固定偏移的 ISO 字符串（例 2026-10-09T09:00:00+08:00）。 */
function toIso(epochMs: number, offset: string): string {
  return new Date(epochMs + offsetMilliseconds(offset)).toISOString().replace('Z', offset);
}

/**
 * FNV-1a 摘要，与 `src/v2/backend/demo.ts` 的 `digest()` **同一算法同一渲染**：
 * 8 位十六进制重复两次 → 16 位小写十六进制。演示模式与替身因此得到同一摘要。
 */
function fnv1aDigest(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0').repeat(2).slice(0, 16);
}

/* ── 列表游标 ─────────────────────────────────────────────── */

/**
 * 任务列表的不透明游标，编码为 `"{绝对微秒}-{计数器}"`。
 * 时间部分用整数毫秒（`new Date()` 的必然结果）乘 1000，加进程内单调计数器，
 * 于是既处处升序、又不受基准时钟被回拨影响。真实后端的游标同样不透明。
 */
function encodeCursor(epochMs: number, counter: number): string {
  return `${epochMs * 1000}-${counter.toString(36)}`;
}

function decodeCursor(value: string): { epoch: number; counter: number } {
  const match = /^(\d+)-([0-9a-z]+)$/.exec(value);
  if (!match) throw new DoubleApiError(422, 'invalid_cursor');
  const micros = Number(match[1]);
  const counter = Number.parseInt(match[2]!, 36);
  if (!Number.isSafeInteger(micros) || micros <= 0) throw new DoubleApiError(422, 'invalid_cursor');
  if (!Number.isSafeInteger(counter) || counter <= 0) throw new DoubleApiError(422, 'invalid_cursor');
  return { epoch: micros / 1000, counter };
}

/* ── 请求体规范化 ─────────────────────────────────────────── */

/** JSON 指针转义（RFC 6901）。数组下标必须编码，否则不是合法指针。 */
function escapePointer(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

/**
 * 与真实后端 `canonical()` 同义的稳定序列化：对象按 key 排序、数组保持顺序、
 * 语义与 `JSON.stringify` 一致（`undefined` 在对象属性中被丢弃、在数组里变 null）。
 * 幂等判定就建立在它之上：「同一个键 + 逐字节相同的规范化请求体 → 返回首次结果」。
 */
function collect(value: unknown, path: string, out: Record<string, string>): void {
  if (value === null) {
    out[path] = 'null';
    return;
  }
  const kind = typeof value;
  if (kind === 'string') {
    out[path] = JSON.stringify(value);
    return;
  }
  if (kind === 'boolean') {
    out[path] = value ? 'true' : 'false';
    return;
  }
  if (kind === 'number') {
    out[path] = Number.isFinite(value as number) ? JSON.stringify(value) : 'null';
    return;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      out[path] = '[]';
      return;
    }
    value.forEach((item, index) => collect(item, `${path}/${index}`, out));
    return;
  }
  if (kind === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    if (entries.length === 0) {
      out[path] = '{}';
      return;
    }
    for (const [key, item] of entries) collect(item, `${path}/${escapePointer(key)}`, out);
    return;
  }
  // undefined / function / symbol：与 JSON.stringify 对对象属性的处理一致 —— 丢弃
}

function canonicalBody(value: unknown): string {
  const out: Record<string, string> = {};
  collect(value, '', out);
  return JSON.stringify(
    Object.keys(out)
      .sort()
      .map((key) => [key, out[key]]),
  );
}

/* ── 字段校验（对齐 service.ts 的 text() / keys() 语义）──── */

/** 非空白且长度受限的字符串（真实后端 `text()` 的等价物）。 */
function isText(value: unknown, max = 64000): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

/** 只允许出现列出的键（真实后端 `keys()` 的等价物）；多余字段 → 422 invalid_input。 */
function assertKeys(body: Json, allowed: string[]): void {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new DoubleApiError(422, 'invalid_input');
  if (!Object.keys(body).every((key) => allowed.includes(key))) throw new DoubleApiError(422, 'invalid_input');
}

/** `keepalive` 请求可能把 body 传成 ArrayBuffer；替身只接受字符串（ApiClient 就是字符串）。 */
function decodeBody(body: BodyInit | null | undefined): Json {
  if (typeof body !== 'string' || body.length === 0) throw new DoubleApiError(422, 'invalid_input');
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new DoubleApiError(422, 'invalid_input');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new DoubleApiError(422, 'invalid_input');
  return parsed as Json;
}

/** 中止 → 异常。优先 DOMException（Node 与浏览器都有），环境没有时退回同名 Error。 */
function abortError(reason?: unknown): unknown {
  if (reason !== undefined && reason !== null) return reason;
  if (typeof DOMException === 'function') return new DOMException('The operation was aborted.', 'AbortError');
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
}

/** 定时器/句柄若支持 `unref`（Node），就解除它对事件循环的持有。 */
function unref(handle: unknown): void {
  const maybe = handle as { unref?: () => void } | null;
  if (maybe && typeof maybe.unref === 'function') maybe.unref();
}

/* ── 静态能力描述（与 service.bootstrap() 同形）──────────── */

const ENGINES = [
  { id: 'codex', integrationStatus: 'verified_probe' },
  { id: 'claude_code', integrationStatus: 'not_integrated' },
  { id: 'deepseek_harness', integrationStatus: 'not_integrated' },
];

const INSTANCES = [
  {
    id: DOUBLE_AGENT_INSTANCE_ID,
    engineId: 'codex',
    name: '本机 Codex',
    availability: 'not_probed',
    capabilities: ['execute', 'interrupt'].map((name) => ({
      name,
      adapterSupport: 'implemented',
      verification: 'unverified',
      evidenceRef: 'CODEX-BATCH-01-RESULTS.md: historical Windows probe only',
    })),
  },
];

/* ── 内部记录 ─────────────────────────────────────────────── */

/** 一个任务的全部从属记录。全局表存对象本体，这里只存 id，避免出现两份真相。 */
type TaskEntry = {
  task: Task;
  workspace: Workspace;
  /** 列表游标；创建时确定，分页因此稳定 */
  cursor: string;
  /** 内容修订号：初始 1，外部改动 +1，运行成功 +1 */
  revision: number;
  /** 该任务自己的事件序号，从 1 严格递增 */
  seq: number;
  events: Event[];
  /** runId → 本轮的用户输入（后端存私有记录，只有 GET /runs/:id 回传） */
  inputs: Map<string, string>;
  /** 本任务产生过的快照 id，按顺序 */
  snapshotIds: string[];
  currentSnapshotId: string | null;
  checkIds: string[];
  acceptanceIds: string[];
};

/** 工作区准备的终态。 */
type PrepareOutcome = { status: 'ready' | 'failed' | 'needs_recovery'; reason?: string };

/**
 * 从任务标题推导准备结果（确定性、无随机）：
 *   #conflict → failed / workspace_conflict
 *   #recover  → needs_recovery / preparation_unconfirmed
 *   其他      → ready
 */
function prepareOutcome(title: string): PrepareOutcome {
  if (title.includes('#conflict')) return { status: 'failed', reason: 'workspace_conflict' };
  if (title.includes('#recover')) return { status: 'needs_recovery', reason: 'preparation_unconfirmed' };
  return { status: 'ready' };
}

/* ── 替身本体 ─────────────────────────────────────────────── */

class DoubleApi {
  readonly token: string;
  readonly project: { id: string; name: string };
  readonly projects: { id: string; name: string }[];
  readonly presets: CheckPreset[];
  readonly allowedOrigins: Set<string>;

  /** 固定基准时钟与单调 tick：时间戳 = 基准 + tick，因此跨进程稳定。 */
  #base: number;
  #tick = 0;
  #timezone = zoneOffset();
  /** 全局单调游标序列：产生的每个对象都取一个，游标因此处处升序。 */
  #cursorSeq = 0;

  #counters: Record<CounterKind, number> = {
    task: 0,
    workspace: 0,
    run: 0,
    snapshot: 0,
    check: 0,
    acceptance: 0,
  };

  #entries = new Map<string, TaskEntry>();
  /** workspaceId → taskId，供幂等重放找对象 */
  #workspaceOwner = new Map<string, string>();
  #runs = new Map<string, Run>();
  #snapshots = new Map<string, Snapshot>();
  #checks = new Map<string, CheckRun>();
  #acceptances = new Map<string, Acceptance>();
  /** 幂等表：`METHOD path\0key` → 首次结果的摘要、状态与引用 */
  #idempotency = new Map<string, { digest: string; status: number } & Ref>();
  /** 仍在跑的长时间检查：checkId → 取消函数（`slow` 预设靠它停住） */
  #checkExecutions = new Map<string, () => void>();

  /* ── 异步登记：settle() 的唯一依据 ─────────────────────── */

  #timers = new Map<string, Promise<void>>();
  #timerHandles = new Map<string, ReturnType<typeof setTimeout>>();
  /** 故意长跑的工作（`#slow`）：不登记进 #timers，settle() 不等它 */
  #long = new Set<Promise<void>>();
  #workerErrors: unknown[] = [];

  constructor(options: DoubleOptions) {
    this.token = options.token ?? DOUBLE_TOKEN;
    this.projects = options.projects?.length ? options.projects.map((item) => ({ ...item })) : [{ ...DOUBLE_PROJECT }];
    this.project = this.projects[0]!;
    this.presets = (options.checkPresets ?? DOUBLE_PRESETS).map((preset) => ({ ...preset, args: [...preset.args] }));
    this.allowedOrigins = new Set(options.allowedOrigins ?? DOUBLE_ORIGINS);
    this.#base = options.startedAt ?? DOUBLE_DEFAULT_STARTED_AT;
  }

  /* ── 时间与标识符 ─────────────────────────────────────── */

  #now(): string {
    return toIso(this.#base + this.#tick++, this.#timezone);
  }

  #next(kind: CounterKind): string {
    const prefix: Record<CounterKind, string> = { task: 't', workspace: 'ws', run: 'run', snapshot: 'snap', check: 'chk', acceptance: 'acc' };
    return `${prefix[kind]}-${++this.#counters[kind]}`;
  }

  #nextCursor(): string {
    return encodeCursor(this.#base, ++this.#cursorSeq);
  }

  /* ── 异步步骤 ─────────────────────────────────────────── */

  /**
   * 登记一步短跑异步工作。所有「会发生」的事情都必须走这里，
   * `settle()` 才能等到静默。同一个 key 只保留最后一个定时器。
   */
  #after(delayMs: number, key: string, job: () => void): void {
    const previous = this.#timerHandles.get(key);
    if (previous !== undefined) clearTimeout(previous);
    const promise = new Promise<void>((resolve) => {
      const handle = setTimeout(() => {
        this.#timers.delete(key);
        this.#timerHandles.delete(key);
        try {
          job();
        } catch (error) {
          // 工作步骤出错不能静默丢弃，否则测试只会看到「卡住」；交给 settle() 抛出。
          this.#workerErrors.push(error);
        }
        resolve();
      }, delayMs);
      this.#timerHandles.set(key, handle);
    });
    this.#timers.set(key, promise);
  }

  /**
   * 故意长跑的工作（`#slow` 预设的自然收尾、`#slow` 运行的自然结束）。
   *
   * 它**不**登记进 `#timers`，所以 `settle()` 不会等它 —— 否则每次 settle()
   * 都要挂 30 秒以上，而「运行一直进行中」正是替身要演示的状态。
   * 代价是 settle() 之后它仍然待办，调用方需显式收尾（中断运行 / 取消检查）；
   * 句柄已 unref，长时间不收尾也不会拖住 Node 进程退出。
   */
  #afterLong(delayMs: number, job: () => void): void {
    const promise = new Promise<void>((resolve) => {
      const handle = setTimeout(() => {
        this.#long.delete(promise);
        try {
          job();
        } catch (error) {
          this.#workerErrors.push(error);
        }
        resolve();
      }, delayMs);
      unref(handle);
    });
    this.#long.add(promise);
  }

  /** 等待所有已登记的步骤静默；期间若又登记了新步骤，继续等。 */
  async settle(): Promise<void> {
    const deadline = Date.now() + 5000;
    for (;;) {
      const pending = [...this.#timers.values()];
      if (pending.length === 0) break;
      if (Date.now() > deadline) throw new Error('double.settle(): 等待异步步骤超过 5 秒，疑似步骤互相触发');
      await Promise.allSettled(pending);
    }
    // 让已排入微任务的收尾跑完
    await Promise.resolve();
    const failure = this.#workerErrors.shift();
    if (failure !== undefined) throw failure;
  }

  /* ── 事件 ─────────────────────────────────────────────── */

  /** 追加任务事件。data 里带 version/status，调用方可用同名键覆盖（与后端一致）。 */
  #append(entry: TaskEntry, type: string, data: Json = {}, runId?: string): Event {
    const seq = ++entry.seq;
    const event: Event = {
      schemaVersion: 1,
      id: `ev-${entry.task.id}-${seq}`,
      taskId: entry.task.id,
      ...(runId !== undefined ? { runId } : {}),
      seq,
      occurredAt: this.#now(),
      type,
      data: { version: entry.task.version, status: entry.task.status, ...data },
    };
    entry.events.push(event);
    return event;
  }

  /* ── 内容摘要与快照 ───────────────────────────────────── */

  #digest(entry: TaskEntry): string {
    return fnv1aDigest(`${entry.task.id}:${entry.revision}`);
  }

  #currentSnapshot(entry: TaskEntry): Snapshot | undefined {
    return entry.currentSnapshotId ? this.#snapshots.get(entry.currentSnapshotId) : undefined;
  }

  /**
   * 读时重算 validity：只有
   *   状态不在 running/needs_recovery
   *   && runId === 任务当前 latestRunId
   *   && snapshotId === 当前快照
   *   && contentDigest === 当前内容摘要
   * 才算 current，否则 stale。GET /tasks/:id 与 GET /tasks/:id/checks 都调用它。
   */
  #recomputeValidity(entry: TaskEntry): void {
    const latestRunId = entry.task.latestRunId;
    const snapshot = this.#currentSnapshot(entry);
    const digest = this.#digest(entry);
    for (const id of entry.checkIds) {
      const check = this.#checks.get(id)!;
      check.validity =
        check.status !== 'running' &&
        check.status !== 'needs_recovery' &&
        check.runId === latestRunId &&
        check.snapshotId === snapshot?.id &&
        check.contentDigest === digest
          ? 'current'
          : 'stale';
    }
  }

  /** 检查摘要取**最后一次**检查；一次都没有时是 not_run。 */
  #summary(entry: TaskEntry): CheckSummary {
    const latestId = entry.checkIds.at(-1);
    const latest = latestId ? this.#checks.get(latestId) : undefined;
    if (!latest) return { status: 'not_run' };
    return { status: latest.status, validity: latest.validity, checkId: latest.id };
  }

  /* ── 忙 / 闸门 / 动作 ─────────────────────────────────── */

  #active(run: Run | undefined): boolean {
    return run !== undefined && (run.status === 'running' || run.status === 'needs_recovery');
  }

  #busy(): boolean {
    for (const run of this.#runs.values()) if (this.#active(run)) return true;
    for (const check of this.#checks.values()) {
      if (check.status === 'running' || check.status === 'needs_recovery') return true;
    }
    return false;
  }

  /** `.cmd` / `.bat` 不可执行（Windows 上会走 shell 解析），其余可用。 */
  #presetAvailable(preset: CheckPreset): boolean {
    return !/\.(cmd|bat)$/i.test(preset.executable);
  }

  /**
   * availableActions：与 `service.ts detail()` 的分支顺序逐条对齐。
   * 阻断原因 / 运行 / 检查 / 全局忙 / 工作区 / 任务状态，任何一层命中就返回。
   *
   * 第 2 层用**本任务返回的检查**里是否还有 running（并且是先重算过 validity 的），
   * 而不是"是否曾经有过 running"。差别在于：一个停在 running 却已不再计入返回列表的
   * 检查不会把用户永久挡在动作之外 —— 否则连"取消"都会因为 409 check_not_running 而失效。
   */
  #availableActions(entry: TaskEntry): string[] {
    const task = entry.task;
    // 需要恢复的任务（blockedReason 立起）不给任何动作：状态不可判定时不许继续推进
    if (task.blockedReason) return [];
    const run = task.latestRunId ? this.#runs.get(task.latestRunId) : undefined;
    if (this.#active(run)) return run && run.phase === 'executing' ? ['interrupt'] : [];
    if (this.#checksView(entry).items.some((check) => check.status === 'running')) return ['cancel_check'];
    if (this.#busy()) return [];
    if (entry.workspace.status !== 'ready') {
      return [...(task.latestRunId ? [] : ['edit']), ...(entry.workspace.status === 'unprepared' ? ['prepare_workspace'] : [])];
    }
    if (task.status === 'draft') return ['edit'];
    if (task.status === 'ready') return ['edit', 'start'];
    return [
      'snapshot',
      'feedback',
      ...(this.presets.some((preset) => this.#presetAvailable(preset)) && this.#currentSnapshot(entry)?.runId === run?.id ? ['check'] : []),
      ...(run?.status === 'succeeded' ? ['accept'] : []),
    ];
  }

  /* ── 版本与失效 ───────────────────────────────────────── */

  #version(object: { version: number }, expected: unknown): void {
    if (expected === undefined) throw new DoubleApiError(422, 'expected_version_required');
    if (!Number.isSafeInteger(expected) || object.version !== expected) throw new DoubleApiError(409, 'version_conflict');
  }

  /**
   * 让已接受的结果失效：旧接受置 valid:false 并逐个记事件，任务回到 in_review。
   * 与真实后端 `#invalidate` 同语义（先记失效事件，再回到 in_review）。
   */
  #invalidate(entry: TaskEntry, reason: string): void {
    if (!entry.task.acceptedSnapshotId) return;
    for (const id of entry.acceptanceIds) {
      const acceptance = this.#acceptances.get(id)!;
      if (!acceptance.valid) continue;
      acceptance.valid = false;
      this.#append(entry, 'task.acceptance_invalidated', {
        acceptanceId: acceptance.id,
        snapshotId: acceptance.snapshotId,
        reason,
        version: entry.task.version + 1,
      });
    }
    delete entry.task.acceptedSnapshotId;
    entry.task.status = 'in_review';
    entry.task.version++;
    this.#append(entry, 'task.updated');
  }

  /* ── 读取视图 ─────────────────────────────────────────── */

  #entry(id: string): TaskEntry {
    const entry = this.#entries.get(id);
    if (!entry) throw new DoubleApiError(404, 'not_found');
    return entry;
  }

  #taskDetail(entry: TaskEntry): Json {
    this.#recomputeValidity(entry);
    const task = entry.task;
    const snapshot = this.#currentSnapshot(entry);
    return {
      task,
      ...(task.latestRunId ? { run: this.#runs.get(task.latestRunId) } : {}),
      workspace: entry.workspace,
      ...(snapshot ? { snapshot } : {}),
      checks: this.#summary(entry),
      lastEventSeq: entry.seq,
      availableActions: this.#availableActions(entry),
    };
  }

  /** 返回前先重算 validity；快照与摘要都取自重算之后的值。 */
  #checksView(entry: TaskEntry): { items: CheckRun[]; summary: CheckSummary } {
    this.#recomputeValidity(entry);
    return { items: entry.checkIds.map((id) => this.#checks.get(id)!), summary: this.#summary(entry) };
  }

  /* ── 快照内容（确定性 diff 文本）──────────────────────── */

  /**
   * 两个文本文件的统一 diff。格式是真实统一 diff 文本
   * （`@@ -旧起,旧数 +新起,新数 @@` hunk 头 + 逐行标记），
   * 前端的 backend/diff.ts 直接按这个格式解析；内容随修订号变化。
   */
  #snapshotFiles(snapshotId: string, revision: number, digest: string): ReviewFile[] {
    const greeting = [
      'diff --git a/src/app/greeting.ts b/src/app/greeting.ts',
      '--- a/src/app/greeting.ts',
      '+++ b/src/app/greeting.ts',
      `@@ -1,4 +1,6 @@ export function greet(name: string) {`,
      ` // 第 ${revision} 轮（摘要 ${digest}）`,
      ' export function greet(name: string) {',
      `-  return 'Hello, ' + name`,
      `+  const trimmed = name.trim()`,
      `+  return \`Hello, \${trimmed}\``,
      ' }',
    ].join('\n');
    const readme = [
      'diff --git a/README.md b/README.md',
      '--- a/README.md',
      '+++ b/README.md',
      `@@ -3,4 +3,6 @@`,
      ' ## 用法',
      '-npm run sync',
      '+npm run sync -- --since=<cursor>',
      '+',
      `+本次改动在第 ${revision} 轮由确定性替身生成。`,
      ' 更多见 docs/',
    ].join('\n');
    return [
      { id: `${snapshotId}-src/app/greeting.ts`, path: 'src/app/greeting.ts', kind: 'text', diff: greeting },
      { id: `${snapshotId}-README.md`, path: 'README.md', kind: 'text', diff: readme, stagedDiff: readme },
    ];
  }

  /* ── 写操作：任务 ─────────────────────────────────────── */

  #createTask(body: Json): Outcome {
    // 判定顺序与 service.ts createTask 一致：引擎 → 语法 → 项目
    if (body.agentInstanceId !== DOUBLE_AGENT_INSTANCE_ID) throw new DoubleApiError(422, 'engine_not_integrated');
    const valid =
      isText(body.title, 200) &&
      typeof body.goal === 'string' &&
      body.goal.length <= 64000 &&
      Array.isArray(body.acceptanceCriteria) &&
      body.acceptanceCriteria.length <= 50 &&
      body.acceptanceCriteria.every((value) => isText(value, 2000));
    if (!valid) throw new DoubleApiError(422, 'invalid_input');
    if (body.projectId !== this.project.id) throw new DoubleApiError(422, 'project_not_found');

    const id = this.#next('task');
    const workspaceId = this.#next('workspace');
    const goal = body.goal as string;
    const criteria = body.acceptanceCriteria as string[];
    const task: Task = {
      schemaVersion: 1,
      id,
      projectId: this.project.id,
      workspaceId,
      title: body.title as string,
      goal,
      acceptanceCriteria: criteria,
      agentInstanceId: DOUBLE_AGENT_INSTANCE_ID,
      // 目标非空白且验收条件非空 → ready，否则草稿（与后端一致）
      status: isText(goal) && criteria.length > 0 ? 'ready' : 'draft',
      version: 1,
      createdAt: this.#now(),
    };
    const entry: TaskEntry = {
      task,
      // 新任务的默认工作区是 unprepared，没有分支也没有基线
      workspace: { id: workspaceId, taskId: id, projectId: this.project.id, status: 'unprepared' },
      cursor: this.#nextCursor(),
      revision: 1,
      seq: 0,
      events: [],
      inputs: new Map(),
      snapshotIds: [],
      currentSnapshotId: null,
      checkIds: [],
      acceptanceIds: [],
    };
    this.#entries.set(id, entry);
    this.#workspaceOwner.set(workspaceId, id);
    this.#append(entry, 'task.created');
    return { status: 201, body: task, kind: 'task', id };
  }

  #updateTask(id: string, body: Json): Outcome {
    assertKeys(body, ['expectedVersion', 'title', 'goal', 'acceptanceCriteria']);
    const entry = this.#entry(id);
    this.#version(entry.task, body.expectedVersion);
    // 已经开跑的任务不能再改目标：改动会让「接受」的语义崩塌
    if (entry.task.latestRunId) throw new DoubleApiError(409, 'task_started');
    const merged = {
      title: body.title === undefined ? entry.task.title : body.title,
      goal: body.goal === undefined ? entry.task.goal : body.goal,
      acceptanceCriteria: body.acceptanceCriteria === undefined ? entry.task.acceptanceCriteria : body.acceptanceCriteria,
    };
    const valid =
      isText(merged.title, 200) &&
      typeof merged.goal === 'string' &&
      merged.goal.length <= 64000 &&
      Array.isArray(merged.acceptanceCriteria) &&
      merged.acceptanceCriteria.length <= 50 &&
      merged.acceptanceCriteria.every((value) => isText(value, 2000));
    if (!valid) throw new DoubleApiError(422, 'invalid_input');
    entry.task.title = merged.title as string;
    entry.task.goal = merged.goal as string;
    entry.task.acceptanceCriteria = merged.acceptanceCriteria as string[];
    entry.task.status = isText(entry.task.goal) && entry.task.acceptanceCriteria.length > 0 ? 'ready' : 'draft';
    entry.task.version++;
    this.#append(entry, 'task.updated');
    return { status: 200, body: entry.task, kind: 'task', id };
  }

  /* ── 写操作：工作区 ───────────────────────────────────── */

  #prepareWorkspace(id: string, body: Json): Outcome {
    assertKeys(body, ['expectedVersion']);
    const entry = this.#entry(id);
    this.#version(entry.task, body.expectedVersion);
    // 只有 unprepared 能准备；重复准备是显式冲突，而不是静默幂等
    if (entry.workspace.status !== 'unprepared') throw new DoubleApiError(409, 'workspace_already_prepared');

    // 同步落到 preparing（202 返回后立刻可读），异步再收敛到终态
    entry.workspace.status = 'preparing';
    entry.workspace.baseHead = DOUBLE_BASE_HEAD;
    entry.workspace.branch = `codex/task-${id}`;
    delete entry.workspace.reason;
    entry.task.version++;
    this.#append(entry, 'workspace.preparing');

    const outcome = prepareOutcome(entry.task.title);
    this.#after(30, `workspace:${entry.workspace.id}`, () => {
      entry.workspace.status = outcome.status;
      if (outcome.reason) entry.workspace.reason = outcome.reason;
      else delete entry.workspace.reason;
      entry.task.version++;
      this.#append(entry, `workspace.${outcome.status}`);
    });
    return { status: 202, body: entry.workspace, kind: 'workspace', id: entry.workspace.id };
  }

  /* ── 写操作：运行 ─────────────────────────────────────── */

  #startRun(id: string, body: Json): Outcome {
    assertKeys(body, ['expectedVersion', 'input']);
    const entry = this.#entry(id);
    // 忙的判定在版本之前（与后端一致：409 active_run 优先于 version_conflict）
    if (this.#busy()) throw new DoubleApiError(409, 'active_run');
    this.#version(entry.task, body.expectedVersion);
    const status = entry.task.status;
    if (!(status === 'ready' || status === 'in_review' || status === 'accepted')) throw new DoubleApiError(409, 'task_not_ready');

    const previousRunId = entry.task.latestRunId;
    let input: string;
    if (previousRunId) {
      // 反馈轮：必须带非空白 input
      if (!isText(body.input, 64000)) throw new DoubleApiError(422, 'invalid_input');
      input = body.input as string;
    } else {
      // 首轮：不接受 input —— 后端把输入推导为目标 + 验收条件，
      // 并把它存在私有记录里由 GET /runs/:id 回传（替身照做，因此行为一致）
      if (body.input !== undefined) throw new DoubleApiError(422, 'invalid_input');
      input = `${entry.task.goal}\n\n验收条件：\n${entry.task.acceptanceCriteria.map((item) => `- ${item}`).join('\n')}`;
    }

    const runId = this.#next('run');
    const run: Run = {
      schemaVersion: 1,
      id: runId,
      taskId: id,
      agentInstanceId: entry.task.agentInstanceId,
      engineId: 'codex',
      status: 'running',
      phase: 'starting',
      version: 1,
      startedAt: this.#now(),
    };

    this.#invalidate(entry, 'new_run');
    entry.task.status = 'in_progress';
    entry.task.latestRunId = runId;
    entry.task.version++;
    this.#runs.set(runId, run);
    entry.inputs.set(runId, input);
    this.#append(entry, 'run.created', { runId, version: 1, status: run.status, phase: run.phase }, runId);
    this.#append(entry, 'task.updated', { runId });

    this.#runSteps(entry, run, input);
    return { status: 202, body: run, kind: 'run', id: runId };
  }

  /** 一个运行的确定性脚本：starting → executing → 活动/消息 → 终态。 */
  #runSteps(entry: TaskEntry, run: Run, input: string): void {
    const runNumber = Number(/(\d+)$/.exec(run.id)?.[1] ?? '1');

    // 1) 进入 executing
    this.#after(20, `run:${run.id}:phase`, () => {
      if (run.status !== 'running') return;
      run.phase = 'executing';
      run.version++;
      this.#append(entry, 'run.status_changed', { runId: run.id, previousStatus: 'running', status: 'running', phase: 'executing' }, run.id);
    });

    // 2) 活动：四类各一条，起止成对；起点类别随轮次轮转，不同轮次因此可区分
    const categories = ['read', 'search', 'command', 'edit'] as const;
    for (let index = 0; index < 4; index++) {
      const category = categories[(index + runNumber) % categories.length]!;
      const activityId = `a-${run.id}-${index + 1}`;
      const at = 40 + index * 10;
      this.#after(at, `run:${run.id}:act-start:${index}`, () => {
        if (run.status !== 'running') return;
        this.#append(entry, 'activity.started', { activityId, category, status: 'running' }, run.id);
      });
      this.#after(at + 5, `run:${run.id}:act-end:${index}`, () => {
        if (run.status !== 'running') return;
        this.#append(entry, 'activity.completed', { activityId, category, status: 'ok' }, run.id);
      });
    }

    // 3) 回复：固定字符串，没有任何模型输出。分几段 delta，最后补一条 completed。
    const reply = this.#replyText(runNumber, input);
    const messageId = `m-${runNumber}`;
    const segments = [reply.slice(0, 14), reply.slice(14, 30), reply.slice(30)];
    segments.forEach((text, index) => {
      if (!text) return;
      this.#after(95 + index * 10, `run:${run.id}:delta:${index}`, () => {
        if (run.status !== 'running') return;
        this.#append(entry, 'message.delta', { messageId, text }, run.id);
      });
    });
    this.#after(130, `run:${run.id}:message`, () => {
      if (run.status !== 'running') return;
      this.#append(entry, 'message.completed', { messageId, text: reply }, run.id);
    });

    // 刻意**不**自动生成快照：真实后端只在用户显式调用快照接口时才产出，
    // 替身必须保留这道人工把关，否则界面会误以为随时都有可接受的东西。

    // 4) 终态由输入中的标记决定
    if (input.includes('#slow')) {
      // 长跑：30 秒后才自然结束，期间用户可中断。settle() 不等它。
      this.#afterLong(30000, () => {
        if (run.status !== 'running') return;
        this.#finishRun(entry, run, 'succeeded');
      });
    } else if (input.includes('#fail')) {
      this.#after(150, `run:${run.id}:finish`, () => this.#finishRun(entry, run, 'failed', 'start_rejected'));
    } else if (input.includes('#recover')) {
      this.#after(150, `run:${run.id}:finish`, () => this.#finishRun(entry, run, 'needs_recovery', 'result_unknown'));
    } else {
      this.#after(150, `run:${run.id}:finish`, () => this.#finishRun(entry, run, 'succeeded'));
    }
  }

  /** 固定回复文本。不调用模型，只按输入中的标记与轮次拼接。 */
  #replyText(runNumber: number, input: string): string {
    if (input.includes('#fail')) {
      return `第 ${runNumber} 轮：执行被拒绝（替身输出，含 #fail）。这是替身按输入里的 #fail 标记给出的确定性结果，没有调用任何模型。`;
    }
    if (input.includes('#recover')) {
      return `第 ${runNumber} 轮：结果未知（替身输出，含 #recover）。替身按输入里的 #recover 标记把本轮置为需要恢复，任务因此仍停在进行中。`;
    }
    if (input.includes('#slow')) {
      return `第 ${runNumber} 轮：仍在执行（替身输出，含 #slow）。替身会一直停在 executing，直到你中断它。`;
    }
    return `第 ${runNumber} 轮：已完成（替身输出）。本轮改动来自确定性替身，没有调用任何模型；请人工核对后再生成快照。`;
  }

  /** 运行收尾：写状态、写事件、更新任务状态与阻断原因。 */
  #finishRun(entry: TaskEntry, run: Run, status: 'succeeded' | 'failed' | 'aborted' | 'needs_recovery', reason?: string): void {
    if (!(run.status === 'running' || run.status === 'needs_recovery')) return;
    const previousStatus = run.status;
    run.status = status;
    run.phase = 'ended';
    if (reason !== undefined) run.outcomeReason = reason;
    else delete run.outcomeReason;
    run.version++;
    // needs_recovery 没有确定的结束时间：结果未知就是未知
    if (status === 'needs_recovery') delete run.endedAt;
    else run.endedAt = this.#now();
    this.#append(entry, 'run.status_changed', { runId: run.id, previousStatus, status, phase: run.phase, reason }, run.id);

    // 结果不可判定时替身记一条诊断，把原因摆在事件流里（消息本身仍是执行输出）。
    // 这是替身自己产生的可见故障信号，不依赖模型。
    if (status === 'needs_recovery' || status === 'failed') {
      this.#append(entry, 'diagnostic.recorded', { runId: run.id, severity: 'error', code: reason ?? 'result_unknown', message: reason ?? 'result_unknown' }, run.id);
    }

    if (status === 'needs_recovery') {
      // 结果未知：任务留在进行中，并把 blockedReason 立起来（此时 availableActions 为空）
      entry.task.status = 'in_progress';
      entry.task.blockedReason = 'result_unknown';
    } else {
      delete entry.task.blockedReason;
      // 成功的一轮会推进内容修订号 —— 于是旧快照、旧检查、旧接受全部失效
      if (status === 'succeeded') entry.revision++;
      entry.task.status = 'in_review';
    }
    entry.task.version++;
    this.#append(entry, 'task.updated', { runId: run.id });
  }

  /* ── 写操作：中断 ─────────────────────────────────────── */

  #interrupt(runId: string, body: Json): Outcome {
    assertKeys(body, ['expectedVersion']);
    const run = this.#runs.get(runId);
    if (!run) throw new DoubleApiError(404, 'not_found');
    // 版本用**运行**的版本，不是任务版本
    this.#version(run, body.expectedVersion);
    if (!(run.status === 'running' && run.phase === 'executing')) throw new DoubleApiError(409, 'run_not_interruptible');

    const entry = this.#entry(run.taskId);
    run.phase = 'stopping';
    run.version++;
    this.#append(entry, 'run.status_changed', { runId: run.id, previousStatus: run.status, status: run.status, phase: run.phase }, run.id);

    // 中止本身是异步的：先返回 202，稍后才收到终态 aborted
    this.#after(30, `run:${run.id}:abort`, () => {
      if (run.status !== 'running') return;
      this.#finishRun(entry, run, 'aborted');
    });
    return { status: 202, body: run, kind: 'run', id: run.id };
  }

  /* ── 写操作：快照 ─────────────────────────────────────── */

  #snapshot(id: string, body: Json): Outcome {
    assertKeys(body, ['expectedVersion']);
    const entry = this.#entry(id);
    this.#version(entry.task, body.expectedVersion);
    if (this.#busy()) throw new DoubleApiError(409, 'active_run');
    const run = entry.task.latestRunId ? this.#runs.get(entry.task.latestRunId) : undefined;
    // 必须存在一个非活动的最新运行
    if (!run || this.#active(run)) throw new DoubleApiError(409, 'active_run');

    const snapshotId = this.#next('snapshot');
    const digest = this.#digest(entry);
    const checkedAt = this.#now();
    const snapshot: Snapshot = {
      baseHead: DOUBLE_BASE_HEAD,
      head: DOUBLE_BASE_HEAD,
      contentDigest: digest,
      files: this.#snapshotFiles(snapshotId, entry.revision, digest),
      completeness: 'complete',
      checks: 'not_run',
      lastCheckedAt: checkedAt,
      schemaVersion: 1,
      id: snapshotId,
      taskId: id,
      runId: run.id,
      createdAt: this.#now(),
    };
    this.#snapshots.set(snapshotId, snapshot);
    entry.snapshotIds.push(snapshotId);
    entry.currentSnapshotId = snapshotId;
    this.#append(entry, 'changes.snapshot_created', { snapshotId, completeness: snapshot.completeness, checks: snapshot.checks }, run.id);
    return { status: 201, body: snapshot, kind: 'snapshot', id: snapshotId };
  }

  /* ── 写操作：检查 ─────────────────────────────────────── */

  #startCheck(taskId: string, body: Json): Outcome {
    assertKeys(body, ['expectedVersion', 'presetId', 'snapshotId']);
    const entry = this.#entry(taskId);
    this.#version(entry.task, body.expectedVersion);
    if (this.#busy()) throw new DoubleApiError(409, 'active_run');
    const preset = this.presets.find((item) => item.id === body.presetId);
    if (!preset) throw new DoubleApiError(422, 'preset_not_found');
    if (!this.#presetAvailable(preset)) throw new DoubleApiError(422, 'check_unavailable');

    if (typeof body.snapshotId !== 'string') throw new DoubleApiError(409, 'snapshot_stale');
    const snapshot = this.#snapshots.get(body.snapshotId);
    if (!snapshot) throw new DoubleApiError(409, 'snapshot_stale');
    // 快照必须是：本任务的、属于当前最新运行的、complete、且仍是当前快照、摘要仍匹配内容
    const stale =
      snapshot.taskId !== taskId ||
      snapshot.runId !== entry.task.latestRunId ||
      snapshot.completeness !== 'complete' ||
      entry.currentSnapshotId !== snapshot.id ||
      snapshot.contentDigest !== this.#digest(entry);
    if (stale) throw new DoubleApiError(409, 'snapshot_stale');

    const checkId = this.#next('check');
    const check: CheckRun = {
      schemaVersion: 1,
      id: checkId,
      taskId,
      runId: snapshot.runId,
      snapshotId: snapshot.id,
      contentDigest: snapshot.contentDigest,
      presetId: preset.id,
      preset,
      status: 'running',
      validity: 'stale',
      startedAt: this.#now(),
      stdout: '',
      stderr: '',
      truncated: false,
      version: 1,
    };
    this.#checks.set(checkId, check);
    entry.checkIds.push(checkId);
    entry.task.version++;
    this.#append(entry, 'check.created', { checkId });

    this.#scheduleCheck(entry, check);
    return { status: 202, body: check, kind: 'check', id: checkId };
  }

  /** 检查收尾：落终态、推进版本、重算 validity、记事件。 */
  #endCheck(entry: TaskEntry, check: CheckRun, patch: Partial<CheckRun>): void {
    if (check.status !== 'running') return;
    Object.assign(check, patch);
    check.endedAt = this.#now();
    check.version++;
    this.#checkExecutions.delete(check.id);
    this.#recomputeValidity(entry);
    entry.task.version++;
    this.#append(entry, 'check.ended', { checkId: check.id, status: check.status });
  }

  /** 按 preset.id 分派固定的检查结果。 */
  #scheduleCheck(entry: TaskEntry, check: CheckRun): void {
    switch (check.preset.id) {
      case 'whitespace':
        this.#after(40, `check:${check.id}`, () =>
          this.#endCheck(entry, check, { status: 'passed', exitCode: 0, stdout: 'src/app/greeting.ts:1: trailing whitespace.\n', stderr: '', truncated: false }),
        );
        return;
      case 'unit':
        this.#after(40, `check:${check.id}`, () =>
          this.#endCheck(entry, check, {
            status: 'failed',
            exitCode: 1,
            stdout: '> node --test\n# Subtest: greeting\nnot ok 1 - greeting\n# pass 4\n# fail 1\n',
            stderr: 'AssertionError [ERR_ASSERTION]: 期望 "Hello, Ada"，实际 "Hello,  Ada"\n',
            truncated: false,
          }),
        );
        return;
      case 'timeout':
        // timeoutMs 极小（10ms）：替身直接给出 timed_out，不做真实计时
        this.#after(40, `check:${check.id}`, () =>
          this.#endCheck(entry, check, { status: 'timed_out', exitCode: null, stdout: '', stderr: '', truncated: false, reason: 'timeout' }),
        );
        return;
      case 'slow': {
        // 一直 running，直到被取消。刻意不登记进 #timers：settle() 不等它。
        let cancelled = false;
        this.#checkExecutions.set(check.id, () => {
          if (cancelled) return;
          cancelled = true;
          this.#endCheck(entry, check, { status: 'cancelled', reason: 'cancel_requested', exitCode: null, stdout: '', stderr: '', truncated: false });
        });
        this.#afterLong(600000, () => {
          if (cancelled || check.status !== 'running') return;
          this.#endCheck(entry, check, { status: 'timed_out', exitCode: null, stdout: '', stderr: '', truncated: false, reason: 'timeout' });
        });
        return;
      }
      default:
        // 到不了这里：未知 preset 在 #startCheck 就被 422 preset_not_found 挡下
        this.#after(40, `check:${check.id}`, () => this.#endCheck(entry, check, { status: 'passed', exitCode: 0, stdout: '', stderr: '', truncated: false }));
        return;
    }
  }

  #cancelCheck(checkId: string, body: Json): Outcome {
    assertKeys(body, ['expectedVersion']);
    const check = this.#checks.get(checkId);
    if (!check) throw new DoubleApiError(404, 'not_found');
    // 版本用**检查**的版本
    this.#version(check, body.expectedVersion);
    if (check.status !== 'running') throw new DoubleApiError(409, 'check_not_running');

    const entry = this.#entry(check.taskId);
    const cancel = this.#checkExecutions.get(checkId);
    if (cancel) cancel();
    else {
      // 没有执行句柄时也要落确定的终态
      this.#endCheck(entry, check, { status: 'cancelled', reason: 'cancel_requested', exitCode: null, stdout: '', stderr: '', truncated: false });
    }
    this.#recomputeValidity(entry);
    return { status: 202, body: check, kind: 'check', id: checkId };
  }

  /* ── 写操作：接受 ─────────────────────────────────────── */

  #accept(id: string, body: Json): Outcome {
    assertKeys(body, ['expectedVersion', 'snapshotId']);
    const entry = this.#entry(id);
    this.#version(entry.task, body.expectedVersion);
    if (this.#busy()) throw new DoubleApiError(409, 'active_run');
    const latestRunId = entry.task.latestRunId;
    const run = latestRunId ? this.#runs.get(latestRunId) : undefined;
    if (!run || run.status !== 'succeeded') throw new DoubleApiError(409, 'run_not_successful');

    if (typeof body.snapshotId !== 'string') throw new DoubleApiError(409, 'snapshot_stale');
    const snapshot = this.#snapshots.get(body.snapshotId);
    if (!snapshot) throw new DoubleApiError(409, 'snapshot_stale');
    const stale =
      snapshot.taskId !== id ||
      snapshot.runId !== latestRunId ||
      snapshot.completeness !== 'complete' ||
      entry.currentSnapshotId !== snapshot.id ||
      snapshot.contentDigest !== this.#digest(entry);
    if (stale) throw new DoubleApiError(409, 'snapshot_stale');

    this.#invalidate(entry, 'reaccepted');
    entry.task.status = 'accepted';
    entry.task.acceptedSnapshotId = snapshot.id;
    entry.task.version++;
    const acceptance: Acceptance = {
      schemaVersion: 1,
      id: this.#next('acceptance'),
      taskId: id,
      runId: snapshot.runId,
      snapshotId: snapshot.id,
      acceptedAt: this.#now(),
      valid: true,
    };
    this.#acceptances.set(acceptance.id, acceptance);
    entry.acceptanceIds.push(acceptance.id);
    this.#append(
      entry,
      'task.accepted',
      { acceptanceId: acceptance.id, snapshotId: snapshot.id, version: entry.task.version, status: entry.task.status },
      snapshot.runId,
    );
    return { status: 200, body: entry.task, kind: 'task', id };
  }

  /* ── 读操作 ───────────────────────────────────────────── */

  #bootstrap(): Json {
    return {
      schemaVersion: 1,
      mode: 'project',
      project: this.project,
      workspace: {
        id: 'unbound',
        projectId: this.project.id,
        kind: 'task_worktrees',
        baseHead: DOUBLE_BASE_HEAD,
        availability: 'per_task',
      },
      checkPresets: this.presets.map((preset) => ({ ...preset, available: this.#presetAvailable(preset) })),
      engines: ENGINES,
      instances: INSTANCES,
      storageHealthy: true,
    };
  }

  #taskList(query: URLSearchParams): Json {
    const all = [...this.#entries.values()];
    const cursorText = query.get('cursor') ?? '0';
    const limitText = query.get('limit') ?? '50';
    // 游标是不透明字符串；同时接受纯数字下标（便于直接取第 N 页），
    // 两者都表示「过滤前的原始下标」，过滤时下标照常前进。
    let startIndex: number;
    if (/^\d+$/.test(cursorText)) startIndex = Number(cursorText);
    else {
      const decoded = decodeCursor(cursorText);
      startIndex = Number.MAX_SAFE_INTEGER;
      for (let index = 0; index < all.length; index++) {
        if (decodeCursor(all[index]!.cursor).counter > decoded.counter) {
          startIndex = index;
          break;
        }
      }
    }
    const limit = /^\d+$/.test(limitText) ? Number(limitText) : Number.NaN;
    const projectId = query.get('projectId') ?? undefined;
    const status = query.get('status') ?? undefined;
    if (!Number.isSafeInteger(startIndex) || startIndex < 0 || startIndex > all.length) throw new DoubleApiError(422, 'invalid_cursor');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new DoubleApiError(422, 'invalid_limit');
    if (status !== undefined && !['draft', 'ready', 'in_progress', 'in_review', 'accepted'].includes(status)) {
      throw new DoubleApiError(422, 'invalid_status');
    }

    const items: Task[] = [];
    let next = startIndex;
    while (next < all.length && items.length < limit) {
      const task = all[next++]!.task;
      if ((!projectId || task.projectId === projectId) && (!status || task.status === status)) items.push(task);
    }
    return { items, nextCursor: next < all.length ? all[next]!.cursor : null };
  }

  #events(entry: TaskEntry, after: number, limit: number): Json {
    if (!Number.isSafeInteger(after) || after < 0 || after > entry.seq) throw new DoubleApiError(422, 'invalid_cursor');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new DoubleApiError(422, 'invalid_limit');
    const items = entry.events.filter((event) => event.seq > after).slice(0, limit);
    return { items, nextCursor: items.at(-1)?.seq ?? after };
  }

  #number(value: string | null, fallback: number): number {
    if (value === null) return fallback;
    if (!/^\d+$/.test(value)) throw new DoubleApiError(422, 'invalid_cursor');
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) throw new DoubleApiError(422, 'invalid_cursor');
    return parsed;
  }

  /* ── 路由 ─────────────────────────────────────────────── */

  /**
   * 处理一个请求。顺序对齐 http.ts：来源 → 令牌 → 路由 → 写守卫（content-type、
   * 幂等键）→ 命令（幂等判定 → 执行）。任何 DoubleApiError 统一收敛成
   * `{error:{code,message:code,retryable:false}}`。
   */
  async handle(
    url: URL,
    method: Method,
    headers: Headers,
    body: BodyInit | null | undefined,
    signal: AbortSignal | null,
  ): Promise<Response> {
    try {
      // 来源：存在时必须放行。缺失视为进程内调用 —— 替身本来就是被进程内调用的
      const origin = headers.get('origin');
      if (origin && !this.allowedOrigins.has(origin)) throw new DoubleApiError(403, 'origin_forbidden');

      // 令牌必须逐字节等于 `Bearer <token>`
      if (headers.get('authorization') !== `Bearer ${this.token}`) throw new DoubleApiError(401, 'unauthorized');

      const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      if (parts.length < 3 || parts[0] !== 'api' || parts[1] !== 'v1' || parts.length > 6) throw new DoubleApiError(404, 'not_found');
      const [, , resource, id, action, extra] = parts;

      if (method === 'GET') return this.#read(url, resource, id, action, extra, parts.length, signal);
      if (method !== 'POST' && method !== 'PATCH') throw new DoubleApiError(404, 'not_found');

      // 写守卫：content-type、幂等键、JSON 对象体
      if (headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json') throw new DoubleApiError(415, 'json_required');
      const key = headers.get('idempotency-key');
      if (typeof key !== 'string' || key.length === 0 || key.length > 128) throw new DoubleApiError(422, 'idempotency_key_required');
      const payload = decodeBody(body);

      // 幂等：同一个键 + 逐字节相同的规范化请求体 → 原样返回首次结果
      const scope = `${method} ${url.pathname}\u0000${key}`;
      const digest = canonicalBody(payload);
      const prior = this.#idempotency.get(scope);
      if (prior) {
        if (prior.digest !== digest) throw new DoubleApiError(409, 'idempotency_conflict');
        return this.#json(prior.status, this.#replay(prior));
      }

      let outcome: Outcome | undefined;
      if (resource === 'tasks') {
        if (method === 'POST' && parts.length === 3) outcome = this.#createTask(payload);
        else if (method === 'PATCH' && parts.length === 4) outcome = this.#updateTask(id!, payload);
        else if (method === 'POST' && parts.length === 5) {
          if (action === 'workspace') outcome = this.#prepareWorkspace(id!, payload);
          else if (action === 'checks') outcome = this.#startCheck(id!, payload);
          else if (action === 'runs') outcome = this.#startRun(id!, payload);
          else if (action === 'snapshots') outcome = this.#snapshot(id!, payload);
          else if (action === 'accept') outcome = this.#accept(id!, payload);
        }
      } else if (resource === 'runs' && action === 'interrupt' && parts.length === 5 && method === 'POST') {
        outcome = this.#interrupt(id!, payload);
      } else if (resource === 'checks' && action === 'cancel' && parts.length === 5 && method === 'POST') {
        outcome = this.#cancelCheck(id!, payload);
      }
      if (!outcome) throw new DoubleApiError(404, 'not_found');

      this.#idempotency.set(scope, { digest, status: outcome.status, kind: outcome.kind, id: outcome.id });
      return this.#json(outcome.status, outcome.body);
    } catch (error) {
      if (error instanceof DoubleApiError) return errorResponse(error.status, error.code);
      // 未预期的内部错误：与 http.ts 一样收敛为 storage_unavailable
      return errorResponse(503, 'storage_unavailable');
    }
  }

  #read(url: URL, resource: string | undefined, id: string | undefined, action: string | undefined, extra: string | undefined, length: number, signal: AbortSignal | null): Response {
    if (resource === 'projects' && length === 3) return this.#json(200, { items: this.projects });
    if (resource === 'agent-instances' && length === 3) return this.#json(200,{items:INSTANCES.map(i=>({id:i.id,name:i.name,engineId:i.engineId,available:true,identityEvidence:'runtime_object',health:{login:'unknown',quota:'unknown',online:'unknown'},capabilities:['start','continue','interrupt','approval','recovery'].map(name=>({name,businessSupport:['start','continue','interrupt'].includes(name)?'implemented':'unsupported',protocolSupport:'implemented',verification:'unverified',evidenceRef:'explicit frontend fetch double'}))}))});
    if (resource === 'tasks' && action === 'session' && length === 5) return this.#json(200,{session:null});
    if (resource === 'bootstrap' && length === 3) return this.#json(200, this.#bootstrap());
    if (resource === 'runs' && length === 4) {
      const run = this.#runs.get(id!);
      if (!run) throw new DoubleApiError(404, 'not_found');
      const input = this.#entry(run.taskId).inputs.get(run.id);
      return this.#json(200, { ...run, ...(input !== undefined ? { input } : {}) });
    }
    if (resource === 'snapshots' && action === 'files' && length === 6) {
      const snapshot = this.#snapshots.get(id!);
      const file = snapshot?.files.find((item) => item.id === extra);
      if (!file) throw new DoubleApiError(404, 'not_found');
      return this.#json(200, file);
    }
    if (resource === 'tasks') {
      if (length === 3) return this.#json(200, this.#taskList(url.searchParams));
      if (length === 4) return this.#json(200, this.#taskDetail(this.#entry(id!)));
      if (action === 'checks' && length === 5) return this.#json(200, this.#checksView(this.#entry(id!)));
      if (action === 'events' && length === 5) {
        const entry = this.#entry(id!);
        return this.#json(200, this.#events(entry, this.#number(url.searchParams.get('after'), 0), this.#number(url.searchParams.get('limit'), 50)));
      }
      if (action === 'events' && extra === 'stream' && length === 6) {
        const entry = this.#entry(id!);
        const after = this.#number(url.searchParams.get('after'), 0);
        if (!Number.isSafeInteger(after) || after < 0 || after > entry.seq) throw new DoubleApiError(422, 'invalid_cursor');
        return this.#stream(entry, after, signal);
      }
    }
    throw new DoubleApiError(404, 'not_found');
  }

  /** 幂等重放：把首次结果的引用还原成当前对象。 */
  #replay(ref: Ref): unknown {
    switch (ref.kind) {
      case 'task':
        return this.#entry(ref.id).task;
      case 'run': {
        const run = this.#runs.get(ref.id);
        if (!run) throw new DoubleApiError(404, 'not_found');
        return run;
      }
      case 'workspace': {
        const owner = this.#workspaceOwner.get(ref.id);
        if (!owner) throw new DoubleApiError(404, 'not_found');
        return this.#entry(owner).workspace;
      }
      case 'snapshot': {
        const snapshot = this.#snapshots.get(ref.id);
        if (!snapshot) throw new DoubleApiError(404, 'not_found');
        return snapshot;
      }
      case 'check': {
        const check = this.#checks.get(ref.id);
        if (!check) throw new DoubleApiError(404, 'not_found');
        return check;
      }
    }
  }

  #json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  }

  /**
   * SSE 流。契约要点：
   *   - `content-type` 以 `text/event-stream` 开头（客户端按 ';' 切分后比较首段）
   *   - 帧格式 `id: <seq>\nevent: <type>\ndata: <json>\n\n`，seq 严格连续
   *   - **永不自己关闭**：每 50ms 轮询一次事件日志，每 15s 发一条 `: heartbeat` 注释
   *   - 只用真正的 `ReadableStream`，不是 DOM 的 `EventSource`
   */
  #stream(entry: TaskEntry, after: number, signal: AbortSignal | null): Response {
    const encoder = new TextEncoder();
    let last = after;
    let heartbeatAt = Date.now();
    let interval: ReturnType<typeof setInterval> | null = null;
    const stop = (): void => {
      if (interval !== null) {
        clearInterval(interval);
        interval = null;
      }
    };

    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        const pump = (): void => {
          if (signal?.aborted) {
            stop();
            try {
              controller.close();
            } catch {
              /* 已经关闭 */
            }
            return;
          }
          try {
            for (const event of entry.events) {
              if (event.seq <= last) continue;
              last = event.seq;
              controller.enqueue(encoder.encode(`id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
            }
            if (Date.now() - heartbeatAt > 15000) {
              heartbeatAt = Date.now();
              controller.enqueue(encoder.encode(': heartbeat\n\n'));
            }
          } catch {
            // 消费者已经取消：停掉轮询，不当作错误
            stop();
          }
        };
        // 关键：先立刻泵一次，客户端 await 到响应之后才能同步读到已有事件
        pump();
        interval = setInterval(pump, 50);
        unref(interval);
      },
      cancel: () => stop(),
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      },
    });
  }

  /* ── 对外接口：state / 外部改动注入 ───────────────────── */

  state(): DoubleState {
    const events: Record<string, Event[]> = {};
    const contentDigest: Record<string, string> = {};
    for (const entry of this.#entries.values()) {
      events[entry.task.id] = entry.events;
      contentDigest[entry.task.id] = this.#digest(entry);
    }
    return {
      mode: 'project',
      tasks: [...this.#entries.values()].map((entry) => entry.task),
      workspaces: [...this.#entries.values()].map((entry) => entry.workspace),
      runs: [...this.#runs.values()],
      events,
      snapshots: [...this.#snapshots.values()],
      checks: [...this.#checks.values()],
      acceptances: [...this.#acceptances.values()],
      contentDigest,
    };
  }

  simulateExternalChange(taskId: string): void {
    const entry = this.#entry(taskId);
    // 外部改动也会提升内容修订号：旧快照/旧检查/旧接受随之失效
    entry.revision++;
    this.#append(entry, 'task.updated');
  }
}

/* ── 工厂 ─────────────────────────────────────────────────── */

/**
 * 创建一个进程内替身。返回的 `fetch` 可直接传给 `ApiClient`；
 * `settle()` 把异步步骤推到静默；`state()` 用于断言内部状态。
 */
export function createDoubleBackend(options: DoubleOptions = {}): DoubleBackend {
  const api = new DoubleApi(options);

  const fetchLike: typeof globalThis.fetch = async (input, init) => {
    const signal = init?.signal ?? null;
    // 已经中止：立刻抛出，不做任何工作
    if (signal?.aborted) throw abortError(signal.reason);

    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const absolute = /^[a-z][a-z0-9+.-]*:/i.test(raw);
    const url = absolute ? new URL(raw) : new URL(raw, DOUBLE_ORIGIN);
    if (absolute && url.origin !== DOUBLE_ORIGIN) throw new DoubleApiError(404, 'not_found');

    const method = (
      init?.method ?? (typeof input === 'object' && 'method' in input ? (input as Request).method : 'GET')
    ).toUpperCase() as Method;
    const headers = new Headers(init?.headers);

    // 用真实定时器跨过一个宏任务：保证 202 在异步步骤之前就被观察到
    await new Promise<void>((resolve, reject) => {
      const handle = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, 0);
      const onAbort = (): void => {
        clearTimeout(handle);
        reject(abortError(signal?.reason));
      };
      if (signal?.aborted) onAbort();
      else signal?.addEventListener('abort', onAbort, { once: true });
    });

    const response = await api.handle(url, method, headers, init?.body, signal);
    // 请求处理期间被中止：不把半成品交给调用方
    if (signal?.aborted) throw abortError(signal.reason);
    return response;
  };

  return {
    fetch: fetchLike,
    settle: () => api.settle(),
    state: () => api.state(),
    simulateExternalChange: (taskId: string) => api.simulateExternalChange(taskId),
  };
}

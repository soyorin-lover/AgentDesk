import { ApiClient, ApiClientError } from './client/api.ts';

/* ─────────────────────────────────────────────────────────────
   连接真实后端（只读）
   复用 AgentDesk 的 src/client/api.ts（原样 vendored，见 README）。
   令牌只保存在调用方的内存中，不写 localStorage / URL / 源码。
   ───────────────────────────────────────────────────────────── */

export interface Conn {
  /** 服务来源，例如 http://127.0.0.1:4317 */
  origin: string;
  token: string;
}

export interface LiveTaskRow {
  id: string;
  title: string;
  /** 后端 Task.status 原文 */
  status: string;
  /** 最新 Run 状态与阶段；没有 Run 时为 null */
  runStatus: string | null;
  runPhase: string | null;
  runModel: string | null;
}

export interface LiveSnapshot {
  projectName: string;
  workspaceKind: string;
  baseHead: string;
  engines: { id: string; integrationStatus: string }[];
  instances: { id: string; engineId: string; name: string; availability: string }[];
  tasks: LiveTaskRow[];
  /** 后端还有更多任务未取回 */
  hasMore: boolean;
  fetchedAt: number;
}

export interface LiveError {
  kind: 'auth' | 'network' | 'config' | 'data';
  title: string;
  detail: string;
}

export type LiveResult = { ok: true; snapshot: LiveSnapshot } | { ok: false; error: LiveError };

/** 去掉首尾空白与结尾斜杠；客户端本身会校验是否为 localhost HTTP 来源 */
export function normalizeOrigin(input: string): string {
  return input.trim().replace(/\/+$/, '');
}

/** 一次最多读取的任务数，避免对单任务后端发出无界请求 */
const TASK_LIMIT = 25;

function fail(kind: LiveError['kind'], title: string, detail: string): LiveResult {
  return { ok: false, error: { kind, title, detail } };
}

/**
 * 读取 bootstrap 与任务列表。只做读操作。
 * 每个任务额外取一次详情以拿到最新运行的 status/phase —— 后端 b不加这个字段，
 * 而列表页需要它。
 */
export async function loadLive(conn: Conn, signal?: AbortSignal): Promise<LiveResult> {
  const origin = normalizeOrigin(conn.origin);
  const token = conn.token.trim();

  if (!origin) return fail('config', '还没有填服务地址', '例如 http://127.0.0.1:4317');
  if (!token) return fail('config', '还没有填令牌', '令牌在服务启动时生成，保存在数据库同目录的 access-token 文件里。');

  let client: ApiClient;
  try {
    client = new ApiClient({ baseUrl: origin, getToken: () => token });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('access token'))
      return fail('auth', '令牌格式不可用', '令牌不能为空，也不能包含换行。请从 access-token 文件重新复制。');
    return fail(
      'config',
      '服务地址不可用',
      '只接受本机 HTTP 地址，且不能带路径或查询串：例如 http://127.0.0.1:4317',
    );
  }

  try {
    const boot = await client.bootstrap(signal);
    const page = await client.tasks(0, TASK_LIMIT, signal);

    // 逐个补齐最新运行信息。顺序执行，避免对本机服务造成并发压力。
    const tasks: LiveTaskRow[] = [];
    for (const t of page.items) {
      let runStatus: string | null = null;
      let runPhase: string | null = null;
      let runModel: string | null = null;
      try {
        const detail = await client.task(t.id, signal);
        runStatus = detail.run?.status ?? null;
        runPhase = detail.run?.phase ?? null;
        runModel = detail.run?.model ?? null;
      } catch {
        // 单个任务详情失败不影响列表；运行列留空并保持可读
      }
      tasks.push({
        id: t.id,
        title: t.title,
        status: t.status,
        runStatus,
        runPhase,
        runModel,
      });
    }

    return {
      ok: true,
      snapshot: {
        projectName: boot.project?.name ?? '(未命名项目)',
        workspaceKind: boot.workspace?.kind ?? '',
        baseHead: boot.workspace?.baseHead ?? '',
        engines: boot.engines ?? [],
        instances: boot.instances ?? [],
        tasks,
        hasMore: page.nextCursor !== null && page.nextCursor !== undefined,
        fetchedAt: Date.now(),
      },
    };
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;

    if (e instanceof ApiClientError) {
      if (e.status === 401)
        return fail(
          'auth',
          '认证失败（401）',
          '令牌不正确。服务每次启动会重新生成 access-token，请确认用的是当前这次启动的值。',
        );
      if (e.status === 403)
        return fail('auth', '被拒绝（403）', `来源可能不在后端的 allowedOrigins 里。机器错误码：${e.code}`);
      if (e.status === 404)
        return fail('data', '接口不存在（404）', '这个地址上没有 /api/v1。请确认端口指向的是 AgentDesk 服务。');
      return fail('data', `请求失败（${e.status}）`, `机器错误码：${e.code}`);
    }

    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('access token'))
      return fail('auth', '令牌格式不可用', '令牌不能为空，也不能包含换行。');
    if (msg.includes('local HTTP origin'))
      return fail(
        'config',
        '服务地址不可用',
        '只接受 http 的本机地址（localhost 或 127.0.0.1），且不能带路径。',
      );
    return fail(
      'network',
      '连接不上服务',
      '请确认后端已启动（npm run serve），并且这个地址和端口与它打印的一致。' +
        (msg ? ` 原始信息：${msg}` : ''),
    );
  }
}

/** 在页面上把后端的原始状态值转成可读标签 */
export const TASK_STATUS_TEXT: Record<string, string> = {
  draft: '草稿',
  ready: '就绪',
  in_progress: '处理中',
  in_review: '待审查',
  accepted: '已接受',
};

export const RUN_STATUS_TEXT: Record<string, string> = {
  running: '执行中',
  succeeded: '执行完成',
  failed: '执行失败',
  aborted: '已中止',
  needs_recovery: '结果未知 · 待恢复',
};

export const PHASE_TEXT: Record<string, string> = {
  starting: '启动中',
  executing: '执行中',
  stopping: '正在停止',
  ended: '已结束',
};

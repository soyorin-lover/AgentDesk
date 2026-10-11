import { authorizedActions } from './evidence.ts';
import { useAgentInstances } from './instances.tsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ApiClient,
  ApiClientError,
  EventStreamError,
  type Bootstrap,
  type CheckRun,
  type CheckSummary,
  type Task,
  type TaskDetail,
  type TaskInput,
  type Workspace,
} from '../api/client/api.ts';
import type { Run, NativeSession, TaskStatus, Event as ApiEvent } from '../api/backend/types.ts';
import { visibleActions, taskBelongsToProject } from './scope.ts';
import { appendEvent, emptyTranscript, type Transcript } from '../api/client/execution.ts';
import { presentError, type ErrorPresentation } from './presentation.ts';

/* ─────────────────────────────────────────────────────────────
   真实后端的会话层

   三条硬规则在这里集中实现，组件不需要各自再想一遍：

   1. 幂等：每个写意图带一个 crypto.randomUUID() 键与当时的 expectedVersion，
      完整保存。网络不确定时用户点「重试原请求」→ 原键 + 原载荷重发，
      绝不自动重复启动新的执行。
   2. 版本：version_conflict 时重新读取最新版本与动作，保留用户草稿，
      由用户决定是否重发。不静默改版本后重发。
   3. 隔离：事件游标、消息、检查、接受都按 taskId 分开保存。
      切换任务不会把上一个任务的数据带过来，也不会取消后端运行。

   202 只表示意图已记录。真正的结果一律来自后续查询。

   生命周期只有一个来源：epoch。任务切换、写入完成后的重读、
   事件流断线后的重连，都通过 +1 触发同一段逻辑重跑，
   并在续跑前先中止上一次的订阅 —— 否则会有两个订阅同时写状态。
   ───────────────────────────────────────────────────────────── */

/** 一个待发送的写意图。键与载荷一起保存，供原样重试。 */
export type LiveIntent =
  | { kind: 'prepare'; taskId: string }
  | { kind: 'start'; taskId: string; input?: string }
  | { kind: 'interrupt'; taskId: string; runId: string }
  | { kind: 'snapshot'; taskId: string }
  | { kind: 'check'; taskId: string; presetId: string; snapshotId: string }
  | { kind: 'cancelCheck'; taskId: string; checkId: string }
  | { kind: 'recoverCheck'; taskId: string; checkId: string }
  | { kind: 'accept'; taskId: string; snapshotId: string }
  | { kind: 'create'; body: TaskInput };

export interface PendingRequest {
  intent: LiveIntent;
  key: string;
  /** 该意图所需的版本：中断用 run.version，取消检查用 check.version，其余用 task.version */
  expectedVersion: number;
}

export interface LiveTaskState {
  detail: TaskDetail | null;
  transcript: Transcript;
  /** 每轮的用户输入；后端把它存在私有记录里，需要逐轮读取 */
  inputs: Record<string, string | null>;
  runs: Record<string, Run>;
  session: NativeSession | null;
  checks: { items: CheckRun[]; summary: CheckSummary } | null;
  /**
   * 最近一次「接受已失效」的事实。
   * 后端没有接受列表端点，只能从事件里取；保留它可以显示
   * 「已失效 + 原因」，而不是退回一个含糊的「未接受」。
   */
  invalidated: { reason: string; snapshotId: string } | null;
  loading: boolean;
  error: ErrorPresentation | null;
  /** 事件订阅断了；数据是断开前的 */
  streamIssue: string | null;
  fetchedAt: number;
}

export interface LiveConnection {
  origin: string;
  token: string;
}

/** 传输层来源。真实 HTTP 与确定性替身走完全相同的客户端代码，只是 fetch 不同。 */
export type TransportKind = 'http' | 'double';

function emptyState(): LiveTaskState {
  return {
    detail: null,
    transcript: emptyTranscript(),
    inputs: {},
    runs: {}, session: null,
    checks: null,
    invalidated: null,
    loading: false,
    error: null,
    streamIssue: null,
    fetchedAt: 0,
  };
}

/** 失效原因的原文 → 展示文案。事件里的 reason 是机器值。 */
const INVALID_REASON: Record<string, string> = {
  new_run: '之后产生了新的运行',
  workspace_changed: '工作区内容被改动',
  reaccepted: '被一次新的接受替代',
  snapshot_refreshed: '改动快照已更新',
  external_change: '工作区被外部修改',
};

export function invalidationText(reason: string): string {
  return INVALID_REASON[reason] ?? reason;
}

type Invalidated = LiveTaskState['invalidated'];

/**
 * 从单个事件推导「接受已失效」的事实。
 *
 * 后端没有接受列表端点，这个事实只在事件流里。
 * 因此**补读与增量必须走同一份推导** —— 否则重读一次就会把已经
 * 发生过的事实丢掉，界面退回含糊的「未接受」。
 */
function deriveInvalidated(current: Invalidated, event: ApiEvent): Invalidated {
  if (event.type === 'task.acceptance_invalidated' && typeof event.data.reason === 'string') {
    const snapshotId = typeof event.data.snapshotId === 'string' ? event.data.snapshotId : '';
    return { reason: event.data.reason, snapshotId };
  }
  /* 新的接受成功，之前的失效历史不再代表当前状态 */
  if (event.type === 'task.accepted') return null;
  return current;
}

/**
 * 选中的任务也留在模块内存里：去「概览」看一眼再回来，应该回到原来那个任务，
 * 而不是变成一个没选中任何东西的空工作台。刷新页面仍然会重置。
 */
const selectedTasks = new Map<string, string | null>();
const unresolvedRequests = new Map<string, PendingRequest>();

export function useLiveSession(input: {
  connection: LiveConnection;
  projectId?: string;
  projectName?: string;
  lane?: string;
  allowCreate?: boolean;
  fetch?: typeof globalThis.fetch;
  transport: TransportKind;
  /**
   * 关掉时完全不发请求。
   * 用于「已选中替身但替身模块还没加载完」这类中间态 —— 那时 origin/token
   * 还是占位值，贸然请求只会得到一串无意义的连接错误。
   * 默认为 true，真实模式不需要传。
   */
  enabled?: boolean;
  /** 替身模式下的外部修改注入；真实模式没有这个能力 */
  simulateExternalChange?: (taskId: string) => void;
}) {
  const { connection, transport, enabled = true } = input;
  const injectedFetch = input.fetch;
  const projectId = input.projectId;
  const allowCreate = input.allowCreate ?? true;
  const scope = `${connection.origin}:${transport}:${projectId ?? "legacy"}`;

  const client = useMemo(
    () =>
      new ApiClient({
        baseUrl: connection.origin,
        getToken: () => connection.token.trim(),
        ...(injectedFetch ? { fetch: injectedFetch } : {}),
      }),
    [connection.origin, connection.token, injectedFetch],
  );

  const instances = useAgentInstances(client);
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [bootError, setBootError] = useState<ErrorPresentation | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskId, setTaskIdState] = useState<string | null>(selectedTasks.get(scope+":"+(input.lane??"primary")) ?? null);
  const setTaskId = useCallback((next: string | null) => {
    selectedTasks.set(scope+":"+(input.lane??"primary"),next);
    setTaskIdState(next);
  }, [scope,input.lane]);
  const [statusFilter, setStatusFilter] = useState<TaskStatus | ''>('');
  const [nextCursor,setNextCursor] = useState<number | null>(null);
  const listRead = useRef<AbortController | null>(null);
  const [listBusy, setListBusy] = useState(false);
  const [listError, setListError] = useState<ErrorPresentation | null>(null);

  const [state, setState] = useState<LiveTaskState>(emptyState);
  const [epoch, setEpoch] = useState(0);
  /** 订阅里要读外部的最新值，又不希望因此重建订阅 */
  const stateRef = useRef<LiveTaskState>(emptyState());
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const refreshListRef = useRef<() => Promise<void>>(async () => {});

  const [pending, setPendingState] = useState<PendingRequest | null>(() => unresolvedRequests.get(scope) ?? null);
  const setPending = useCallback((request: PendingRequest | null) => {
    if (request) unresolvedRequests.set(scope,request); else unresolvedRequests.delete(scope);
    setPendingState(request);
  },[scope]);
  const sending = useRef(false);
  const [writing, setWriting] = useState(false);
  const [writeError, setWriteError] = useState<ErrorPresentation | null>(()=>unresolvedRequests.has(scope) ? {title:'上次请求结果尚未核对',detail:'原请求和幂等键仍保留。可以核对后重试原请求。',recovers:'reread'} : null);
  const [notice, setNotice] = useState<string | null>(null);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** 上次读取的任务；用来区分「换了任务」和「同一个任务重读」 */
  const lastTaskId = useRef<string | null>(null);
  /** seq 缺口自动重读的次数；换任务时归零，避免无限循环 */
  const gapRetries = useRef(0);

  /** 重启整段读取与订阅。这是唯一的生命周期入口。 */
  const restart = useCallback(() => setEpoch((n) => n + 1), []);

  /* ── 读取：bootstrap + 任务列表 ─────────────────────────── */

  const refreshList = useCallback(async () => {
    listRead.current?.abort();
    setListBusy(true);
    const controller = listRead.current = new AbortController();
    try {
      const [b, page] = await Promise.all([
        client.bootstrap(controller.signal),
        client.tasks(0, 50, controller.signal, {...(statusFilter ? {status:statusFilter} : {}),...(projectId ? {projectId} : {})}),
      ]);
      if (controller.signal.aborted || !mounted.current) return;
      setBoot(b);
      setBootError(null);
      setTasks(page.items.filter(t => taskBelongsToProject(t,projectId)));
      setNextCursor(page.nextCursor);
      setListError(null);
    } catch (e) {
      if (controller.signal.aborted || !mounted.current) return;
      const described = describe(e);
      /* bootstrap 失败说明连不上；列表失败只说明列表读不到，两者分开 */
      setBoot((b) => {
        if (!b) setBootError(described);
        return b;
      });
      setListError(described);
    } finally {
      if (mounted.current && !controller.signal.aborted) setListBusy(false);
    }
  }, [client, statusFilter, projectId]);

  /* 连接后立刻读一次；改筛选条件时重读列表 */
  useEffect(() => {
    refreshListRef.current = refreshList;
    /* 未就绪时不发请求：那时 origin/token 可能还是占位值 */
    if (enabled) void refreshList();
    return () => listRead.current?.abort();
  }, [refreshList, enabled]);

  /* ── 按任务隔离的读取 + 增量订阅 ────────────────────────── */

  useEffect(() => {
    if (!enabled || !taskId) {
      setState(emptyState());
      if (!taskId) lastTaskId.current = null;
      return;
    }

    const controller = new AbortController();
    const signal = controller.signal;
    let live = true;

    /* 换任务必须清空上一个任务的一切；同一任务重读则保留内容避免闪屏 */
    const switched = lastTaskId.current !== taskId;
    lastTaskId.current = taskId;
    if (switched) {
      gapRetries.current = 0;
      setState({ ...emptyState(), loading: true });
    } else {
      setState((s) => ({ ...s, loading: true, error: null }));
    }

    let transcript = switched ? emptyTranscript() : stateRef.current.transcript;
    let invalidated: Invalidated = switched ? null : stateRef.current.invalidated;

    const readDetail = async () => {
      const value = await client.task(taskId, signal);
      if (!live) return null;
      if (!taskBelongsToProject(value.task,projectId)) throw new Error("project_identity_mismatch");
      setState((s) => ({ ...s, detail: value, fetchedAt: Date.now() }));
      return value;
    };
    const readChecks = async () => {
      const value = await client.checks(taskId, signal);
      if (!live) return;
      setState((s) => ({ ...s, checks: value }));
      return value;
    };
    /* 逐轮读取用户输入。单轮失败降级为「暂不可用」，不阻塞整体 */
    const readInputs = async (t: Transcript) => {
      for (const round of t.rounds) {
        try {
          const value = await client.run(round.id, signal);
          if (!live) return;
          setState((s) => ({ ...s, inputs: { ...s.inputs, [round.id]: value.input ?? null }, runs: {...s.runs,[round.id]:value} }));
        } catch {
          if (!live) return;
          setState((s) => ({ ...s, inputs: { ...s.inputs, [round.id]: null } }));
        }
      }
    };

    void (async () => {
      try {
        await readDetail();
        try { const value=await client.taskSession(taskId,signal); if(live&&value.session&&value.session.taskId!==taskId)throw Error('session_identity_mismatch');if(live)setState(s=>({...s,session:value.session})); }catch(e){if(signal.aborted)return;if(e instanceof Error&&e.message==='session_identity_mismatch')throw e;}
        await readChecks();

        /* 先补读历史事件。只有成功应用的事件才推进游标 ——
           游标与已还原的状态必须匹配，否则订阅会从错误的位置开始。 */
        for (;;) {
          const page = await client.events(taskId, transcript.after, 200, signal);
          if (!live) return;
          if (!page.items.length) break;
          for (const event of page.items) {
            transcript = appendEvent(transcript, event);
            invalidated = deriveInvalidated(invalidated, event);
          }
          if (page.items.length < 200) break;
        }
        if (!live) return;
        // Completion events can be newer than the first detail read.
        // Re-read facts before subscribing from the advanced history cursor.
        await readDetail();
        await readChecks();
        if (!live) return;
        setState((s) => ({ ...s, transcript, invalidated, loading: false }));
        void readInputs(transcript);

        /* 增量订阅。EOF 与异常都只记录问题，不自动无限重连。 */
        for await (const event of client.streamEvents(taskId, { after: transcript.after, signal })) {
          if (!live) return;
          try {
            transcript = appendEvent(transcript, event);
          } catch {
            /* seq 缺口：整段重读，避免静默丢事件。限一次，防死循环。 */
            if (gapRetries.current < 1) {
              gapRetries.current += 1;
              setState((s) => ({ ...s, streamIssue: '事件序号出现缺口，已改为整段重读。' }));
              restart();
            } else {
              setState((s) => ({
                ...s,
                streamIssue: '事件序号反复出现缺口，已停止自动重读。请手动重新连接。',
              }));
            }
            return;
          }
          setState((s) => ({ ...s, transcript }));
          /* 失效事实只能从事件里取：后端没有接受列表端点。
             保留它才能显示「已失效 + 原因」，而不是含糊的「未接受」。 */
          invalidated = deriveInvalidated(invalidated, event);
          if (invalidated !== stateRef.current.invalidated) {
            const value = invalidated;
            setState((s) => ({ ...s, invalidated: value }));
          }
          /* 任务级状态变化也要刷新左侧列表，否则列表停在旧状态 */
          if (
            event.type === 'run.created' ||
            event.type === 'run.status_changed' ||
            event.type === 'task.created' ||
            event.type === 'task.updated' ||
            event.type === 'task.accepted' ||
            event.type === 'task.acceptance_invalidated' ||
            event.type === 'workspace.ready' ||
            event.type === 'workspace.failed' ||
            event.type === 'workspace.needs_recovery'
          ) {
            void refreshListRef.current();
          }
          if (event.type === 'run.created' || event.type === 'run.status_changed' || event.type === 'message.completed') {void readInputs(transcript);void client.taskSession(taskId,signal).then(v=>{if(live&&(!v.session||v.session.taskId===taskId))setState(s=>({...s,session:v.session}));}).catch(()=>{});}
          if (
            event.type === 'run.created' ||
            event.type === 'run.status_changed' ||
            event.type === 'task.updated' ||
            event.type === 'task.accepted' ||
            event.type === 'task.acceptance_invalidated' ||
            event.type === 'changes.snapshot_created' ||
            event.type === 'check.created' ||
            event.type === 'check.ended' ||
            event.type === 'check.recovered' ||
            event.type === 'workspace.preparing' ||
            event.type === 'workspace.ready' ||
            event.type === 'workspace.failed' ||
            event.type === 'workspace.needs_recovery'
          ) {
            await readDetail();
            await readChecks();
          }
        }
      } catch (e) {
        if (signal.aborted || !live) return;
        /* 事件流断了不等于数据错了：保留已有内容，只标出「这是旧的」 */
        if (e instanceof EventStreamError) {
          setState((s) => ({
            ...s,
            loading: false,
            streamIssue:
              e.code === 'frame_too_large'
                ? '事件帧超出客户端缓冲上限，已停止订阅。'
                : '事件订阅已断开。当前显示的是断开前的数据。',
          }));
          return;
        }
        setState((s) => ({ ...s, loading: false, error: describe(e) }));
      }
    })();

    return () => {
      live = false;
      controller.abort();
    };
    // stateRef 由 effect 同步，不参与依赖；重启由 epoch 驱动
  }, [client, taskId, epoch, restart]);

  /* ── 写入 ───────────────────────────────────────────────── */
  /** 该意图需要哪个版本号作为 expectedVersion */
  const versionFor = useCallback(
    (intent: LiveIntent): number | null => {
      const detail = stateRef.current.detail;
      switch (intent.kind) {
        case 'create':
          /* 创建不需要版本；用 0 占位，createTask 不读这个字段 */
          return 0;
        case 'interrupt':
          return detail?.run?.version ?? null;
        case 'recoverCheck':
          return detail?.recovery?.items.find(i=>i.id===intent.checkId && i.kind==='check' && i.recoverable)?.version ?? null;
        case 'cancelCheck':
          return stateRef.current.checks?.items.find((c) => c.id === intent.checkId)?.version ?? null;
        default:
          return detail?.task.version ?? null;
      }
    },
    [],
  );

  /** 真正执行一个已固定键与版本的写意图 */
  const send = useCallback(
    async (request: PendingRequest) => {
      if (sending.current) return;
      sending.current = true;
      setWriting(true);
      setWriteError(null);
      const { intent, key, expectedVersion } = request;
      try {
        switch (intent.kind) {
          case 'create': {
            /* 创建后立刻选中新任务，否则主区会停在「没有选中任务」 */
            const created = await client.createTask(intent.body, key);
            if (mounted.current && created?.id) setTaskId(created.id);
            break;
          }
          case 'prepare':
            await client.prepareWorkspace(intent.taskId, { expectedVersion }, key);
            break;
          case 'start':
            await client.startRun(
              intent.taskId,
              { expectedVersion, ...(intent.input ? { input: intent.input } : {}) },
              key,
            );
            break;
          case 'interrupt':
            await client.interrupt(intent.runId, { expectedVersion }, key);
            break;
          case 'snapshot':
            await client.snapshot(intent.taskId, { expectedVersion }, key);
            break;
          case 'check':
            await client.startCheck(
              intent.taskId,
              { expectedVersion, presetId: intent.presetId, snapshotId: intent.snapshotId },
              key,
            );
            break;
          case 'cancelCheck':
            await client.cancelCheck(intent.checkId, { expectedVersion }, key);
            break;
          case 'recoverCheck':
            await client.recoverCheck(intent.checkId, {expectedVersion},key);
            break;
          case 'accept':
            await client.accept(intent.taskId, { expectedVersion, snapshotId: intent.snapshotId }, key);
            break;
        }
        if (!mounted.current) return;
        /* 202/201 都只是「意图已记录」；结果靠重读获得 */
        setPending(null);
        await refreshList();
        restart();
      } catch (e) {
        if (!mounted.current) return;
        const described = describe(e);
        setWriteError(described);
        if (e instanceof ApiClientError && e.code === 'version_conflict') {
          /*
            版本冲突**不是**网络重试：带着旧的 expectedVersion 原样重发必然再次冲突，
            等于把用户卡死。所以这里清空待重试，重新读取最新状态，由用户重新发起 ——
            那时会取到新鲜版本与新的幂等键。用户的草稿由界面保留。
          */
          await refreshList();
          restart();
          setPending(null);
        } else if (e instanceof ApiClientError && e.code === 'idempotency_conflict') {
          /* 同一个键被用于不同内容，只能换键重来 */
          setPending(null);
        } else if (e instanceof ApiClientError && e.code === 'workspace_already_prepared') {
          restart();
          setPending(null);
        } else if (e instanceof ApiClientError && e.status < 500 && e.code !== 'invalid_response') {
          /* 其他明确的业务错误：请求本身不合法，重发同样的请求没有意义 */
          setPending(null);
        } else {
          /* 网络结果不明：保留原键与原载荷，等用户点「重试原请求」 */
          setPending(request);
        }
      } finally {
        sending.current = false;
        if (mounted.current) setWriting(false);
      }
    },
    [client, refreshList, restart],
  );

  /** 发起一个新意图：在这里固定键与版本，之后不再改变 */
  const run = useCallback(
    (intent: LiveIntent) => {
      if(intent.kind!=='create'){
        const current=stateRef.current;const action=intent.kind==='start'?(intent.input?'feedback':'start'):({prepare:'prepare_workspace',interrupt:'interrupt',snapshot:'snapshot',check:'check',cancelCheck:'cancel_check',recoverCheck:'recover_check',accept:'accept'} as const)[intent.kind];
        if(current.loading||current.error||current.streamIssue||current.detail?.task.id!==intent.taskId||!authorizedActions(current.detail,instances.items.find(i=>i.id===current.detail?.task.agentInstanceId)).includes(action)){setWriteError({title:'当前操作未获授权',detail:'请刷新任务与实例事实；不会绕过能力、固定配置或流程门禁。',recovers:'reread'});return;}
      }
      if(intent.kind==='create' && !allowCreate){setWriteError(presentError(422,'binding_refresh_required'));return;}
      if (sending.current || unresolvedRequests.has(scope)) {
        setWriteError({title:'已有未决请求',detail:'请先核对并重试原请求；不会默默替换幂等键。',recovers:'reread'});
        return;
      }
      const version = versionFor(intent);
      if (version === null) {
        setWriteError({
          title: '缺少版本信息',
          detail: '还没有读到这个对象的当前版本，不能安全提交。请先重新读取。',
          recovers: 'reread',
        });
        return;
      }
      const request: PendingRequest = { intent, key: crypto.randomUUID(), expectedVersion: version };
      setPending(request);
      void send(request);
    },
    [send, versionFor, scope, allowCreate, instances.items],
  );

  /** 原键 + 原载荷重发。可返回资源的最新状态，不会启动第二次执行。 */
  const retryPending = useCallback(() => {
    if (pending) void send(pending);
  }, [pending, send]);

  const abandonPending = useCallback(() => {
    setPending(null);
    setWriteError(null);
  }, []);

  /** 显式重新连接事件流 */
  const reconnect = useCallback(() => {
    setState((s) => ({ ...s, streamIssue: null }));
    restart();
  }, [restart]);

  const externalChange = useCallback(() => {
    if (!taskId || !input.simulateExternalChange) return;
    input.simulateExternalChange(taskId);
    setNotice('已模拟一次外部修改：内容摘要变化，旧检查应随之过时。');
    restart();
  }, [input, restart, taskId]);

  const loadMore = useCallback(async () => {
    if (nextCursor === null || listBusy) return;
    listRead.current?.abort();
    const controller = listRead.current = new AbortController(); setListBusy(true);
    try {
      const page = await client.tasks(nextCursor,50,controller.signal,{...(projectId ? {projectId} : {}),...(statusFilter ? {status:statusFilter} : {})});
      if (!controller.signal.aborted && mounted.current) {
        setTasks(previous=>[...previous,...page.items.filter(t=>taskBelongsToProject(t,projectId) && !previous.some(p=>p.id===t.id))]);
        setNextCursor(page.nextCursor);setListError(null);
      }
    } catch(e) {if(!controller.signal.aborted && mounted.current)setListError(describe(e));}
    finally {if(!controller.signal.aborted && mounted.current)setListBusy(false);}
  },[client,nextCursor,listBusy,projectId,statusFilter]);
  const visibleState = state.detail && state.detail.task.id !== taskId ? emptyState() : state;
  const presets = boot?.checkPresets ?? [];
  const actions = visibleActions(authorizedActions(visibleState.loading||visibleState.error||visibleState.streamIssue?null:visibleState.detail,instances.items.find(i=>i.id===visibleState.detail?.task.agentInstanceId)));
  const workspace: Workspace | undefined = visibleState.detail?.workspace;

  return {
    transport,
    instances,
    projectId,
    projectName: input.projectName ?? boot?.project.name,
    allowCreate,
    scope,
    loadMore,
    nextCursor,
    client,
    boot,
    bootError,
    mode: boot?.mode ?? null,
    tasks,
    taskId,
    setTaskId,
    statusFilter,
    setStatusFilter,
    listBusy,
    listError,
    refreshList,
    state: visibleState,
    actions,
    workspace,
    presets,
    restart,
    reconnect,
    run,
    writing,
    pending,
    writeError,
    notice,
    setNotice,
    retryPending,
    abandonPending,
    externalChange,
    canSimulateExternalChange: Boolean(input.simulateExternalChange),
  };
}

export type Live = ReturnType<typeof useLiveSession>;

/** ApiClientError / EventStreamError → 可展示的中文提示 */
function describe(error: unknown): ErrorPresentation {
  if (error instanceof ApiClientError) return presentError(error.status, error.code);
  if (error instanceof EventStreamError) {
    return {
      title: '事件流不可用',
      detail:
        error.code === 'disconnected'
          ? '事件连接已断开。已收到的内容仍然有效，可以用「重新连接」显式恢复。'
          : '事件流返回了无法解析的帧。数据可能不完整，请重新读取。',
      recovers: 'reread',
    };
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return { title: '请求已取消', detail: '这次请求被取消了。', recovers: null };
  }
  return {
    title: '连接不上服务',
    detail: `请确认后端已启动，并且地址、端口与令牌与它打印的一致。${error instanceof Error ? ` 原始信息：${error.message}` : ''}`,
    recovers: 'reconnect',
  };
}

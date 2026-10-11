import { useCallback, useEffect, useRef, useState } from 'react';
import { I, Spinner } from './icons.tsx';
import { normalizeOrigin, type Conn, type LiveError } from './api/connection.ts';
/* 只导入类型：替身模块必须留在动态分块里，不能被静态运行时导入拖回主包 */
import type { DoubleBackend } from './live/double.ts';
import { useLiveSession, type TransportKind } from './live/session.ts';
import { ProjectPortal } from './projects/ProjectPortal.tsx';
import { LiveWorkbench } from './live/LiveWorkbench.tsx';

/* ─────────────────────────────────────────────────────────────
   连接入口 + 真实模式工作台

   两种传输层，产品代码完全相同：
     • 真实 HTTP —— 连本机 AgentDesk 服务（Bearer 令牌，只留在内存）
     • 确定性替身 —— 在没有可用服务时，用同一份 ApiClient 跑通全部流程。
       替身不会调用模型，也不冒充真实后端；界面上明确标出是替身。

   只读快照读取（原连接页）保留在 loadLive 中，用于连接失败时的错误分类。
   ───────────────────────────────────────────────────────────── */

/** 令牌只活在这个模块变量里：刷新页面即失效，不落盘。 */
let memory: { origin: string; token: string } = { origin: 'http://127.0.0.1:4317', token: '' };

/**
 * 替身模块与它创建的实例都放在模块级：既避免每次渲染重建后端状态，
 * 也让 origin/token 只在模块真正加载后才取用（保持动态分块）。
 */
type DoubleModule = typeof import('./live/double.ts');
let doubleModule: DoubleModule | null = null;
let sharedDouble: DoubleBackend | null = null;
let doubleLoading: Promise<DoubleBackend> | null = null;

/**
 * 连接意图也放在模块级。
 * 否则去「概览」看一眼再回来就掉回连接表单 —— 而令牌本来就没丢，
 * 那是纯粹的重复劳动。刷新页面仍然会重置（符合「令牌不落盘」）。
 */
let connectionMemory: { transport: TransportKind; connected: boolean } = {
  transport: 'http',
  connected: false,
};

function ensureDouble(): Promise<DoubleBackend> {
  /* 动态导入：替身是离线兜底能力，不该拖累真实联调路径的主包体积 */
  doubleLoading ??= import('./live/double.ts').then((m) => {
    doubleModule = m;
    return (sharedDouble ??= m.createDoubleBackend());
  });
  return doubleLoading;
}

export function ConnectionPage() {
  const [transport, setTransport] = useState<TransportKind>(connectionMemory.transport);
  const [origin, setOrigin] = useState(memory.origin);
  const [token, setToken] = useState(memory.token);
  const [showToken, setShowToken] = useState(false);
  const [connected, setConnected] = useState(connectionMemory.connected);
  const [error, setError] = useState<LiveError | null>(null);
  const [double, setDouble] = useState<DoubleBackend | null>(sharedDouble);
  const [doubleError, setDoubleError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  /* 切到替身模式时才加载 */
  useEffect(() => {
    if (transport !== 'double' || double) return;
    let live = true;
    void ensureDouble().then(
      (value) => {
        if (live) setDouble(value);
      },
      () => {
        if (live) setDoubleError('替身模块加载失败。真实模式不受影响。');
      },
    );
    return () => {
      live = false;
    };
  }, [transport, double]);

  const useDouble = transport === 'double' && double !== null;
  /** 替身已选中但模块还没加载完 —— 这时不发任何请求 */

  const connection: Conn =
    useDouble && doubleModule
      ? { origin: doubleModule.DOUBLE_ORIGIN, token: doubleModule.DOUBLE_TOKEN }
      : { origin: normalizeOrigin(origin), token: token.trim() };

  /* 会话层只在「已连接」后才挂载，避免空令牌反复打后端 */

  useEffect(() => () => abort.current?.abort(), []);

  const connect = useCallback(() => {
    abort.current?.abort();
    abort.current = new AbortController();
    memory = { origin: normalizeOrigin(origin), token: token.trim() };
    connectionMemory = { transport, connected: true };
    setError(null);
    setConnected(true);
  }, [origin, token, transport]);

  /** 显式断开：清掉连接意图，回到设置表单 */
  const disconnect = useCallback(() => {
    connectionMemory = { transport, connected: false };
    setConnected(false);
    setError(null);
  }, [transport]);

  const pickTransport = useCallback((next: TransportKind) => {
    connectionMemory = { ...connectionMemory, transport: next };
    setTransport(next);
  }, []);

  const canSubmit = transport === 'double' || (origin.trim().length > 0 && token.trim().length > 0);

  /* 已连接：直接进入工作台，不再显示连接表单，避免重复信息 */
  if (connected && transport === "http") return <ProjectPortal connection={connection} onDisconnect={disconnect}/>;

  if (connected) {
    return (
      <div className="live-root">
        {double && <DoubleWorkbench connection={connection} double={double}/>}
        <button
          className="live-exit"
          onClick={disconnect}
          title="回到连接设置"
        >
          <I n="plug" s={13} />
          {transport === 'double' ? '退出替身模式' : '断开并重新设置'}
        </button>
      </div>
    );
  }

  return (
    <div className="scroll">
      <header className="project-topbar"><button className="icon-btn" disabled aria-label="返回项目首页"><I n="back" s={24}/></button><strong>AgentDesk</strong><span className="ctx__grow"/><a className="btn" href="#/demo/">查看独立示例</a></header>
      <div className="page page--wide">
        <div className="row gap-3">
          <h1 className="h1" style={{ flex: 1 }}>
            项目管理
          </h1>
          <span className="tag">真实数据</span>
        </div>
        <p className="lead">
          连接本机服务后读取你的项目列表。创建项目仅保存组织空间，不会启动 Agent。开发期连接配置如下。
          启动执行会调用模型并消耗额度。
        </p>

        {/* ── 传输层选择 ── */}
        <div className="seg" role="tablist" aria-label="数据来源" style={{ marginBottom: 16 }}>
          <button role="tab" aria-selected={transport === 'http'} onClick={() => pickTransport('http')}>
            本机服务（真实）
          </button>
          <button role="tab" aria-selected={transport === 'double'} onClick={() => pickTransport('double')}>
            确定性替身（不调用模型）
          </button>
        </div>

        {transport === 'double' ? (
          <div className="banner banner--warn" role="status">
            <span className="banner__ico">
              <I n="warn" s={15} />
            </span>
            <div className="banner__body">
              <div className="banner__title">替身模式：不是真实后端</div>
              <div className="sec">
                这里用一份遵循同一接口契约的进程内替身，走的是和真实服务完全相同的客户端代码。
                它不会调用模型、不写数据库、不建 Git 工作区，也不能用作真实执行或浏览器联调的验收。
                检查结果是脚本化的固定输出。
              </div>
            </div>
          </div>
        ) : (
          <div className="connect">
            <div className="connect__fields">
              <label className="connfield">
                <span className="connfield__label">服务地址</span>
                <input
                  className="input input--mono"
                  value={origin}
                  onChange={(e) => setOrigin(e.target.value)}
                  placeholder="http://127.0.0.1:4317"
                  spellCheck={false}
                  autoComplete="off"
                  onKeyDown={(e) => e.key === 'Enter' && canSubmit && connect()}
                />
              </label>
              <label className="connfield">
                <span className="connfield__label">访问令牌</span>
                <span className="connfield__row">
                  <input
                    className="input input--mono"
                    type={showToken ? 'text' : 'password'}
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="从 .agentdesk/backend/access-token 复制"
                    spellCheck={false}
                    autoComplete="off"
                    onKeyDown={(e) => e.key === 'Enter' && canSubmit && connect()}
                  />
                  <button
                    type="button"
                    className="icon-btn"
                    aria-pressed={showToken}
                    onClick={() => setShowToken((v) => !v)}
                    title={showToken ? '隐藏令牌' : '显示令牌'}
                    aria-label={showToken ? '隐藏令牌' : '显示令牌'}
                  >
                    <I n={showToken ? 'read' : 'lock'} s={15} />
                  </button>
                </span>
              </label>
            </div>
            <div className="connect__actions">
              <button className="btn btn--primary" disabled={!canSubmit} onClick={connect}>
                <I n="plug" s={15} />
                连接
              </button>
              <span className="meta">令牌只保存在本页内存，刷新页面即清除；不写入 localStorage 或网址。</span>
            </div>
          </div>
        )}

        {transport === 'double' ? (
          <div className="connect__actions" style={{ marginTop: 16 }}>
            <button className="btn btn--primary" disabled={!double || !!doubleError} onClick={connect}>
              {double ? <I n="play" s={14} /> : <Spinner s={14} />}
              {double ? '进入替身工作台' : '正在加载替身…'}
            </button>
            <span className="meta">替身初始没有任何任务，可以在左侧新建。</span>
          </div>
        ) : null}

        {doubleError ? (
          <div className="banner banner--bad mt-6" role="alert">
            <span className="banner__ico">
              <I n="warn" s={15} />
            </span>
            <div className="banner__body">
              <div className="banner__title">替身模块不可用</div>
              <div className="sec">{doubleError}请改用「本机服务（真实）」。</div>
            </div>
          </div>
        ) : null}

        {error ? (
          <div className={`banner banner--${error.kind === 'auth' ? 'warn' : 'bad'} mt-6`} role="alert">
            <span className="banner__ico">
              <I n={error.kind === 'auth' ? 'lock' : 'warn'} s={15} />
            </span>
            <div className="banner__body">
              <div className="banner__title">{error.title}</div>
              <div className="sec">{error.detail}</div>
            </div>
          </div>
        ) : null}

        <p className="meta" style={{ marginTop: 24 }}>
          <I n="info" s={13} /> 两种模式共用同一份公共客户端与服务端契约；界面层不分叉。真实模式下的
          工作区准备、检查执行都需要服务端已配置好项目模式与检查预设。
        </p>
      </div>

    </div>
  );
}

function DoubleWorkbench({connection,double}:{connection:Conn;double:DoubleBackend}) {
 const live=useLiveSession({connection,transport:"double",fetch:double.fetch,simulateExternalChange:(id:string)=>double.simulateExternalChange(id)});
 return <LiveWorkbench live={live}/>;
}

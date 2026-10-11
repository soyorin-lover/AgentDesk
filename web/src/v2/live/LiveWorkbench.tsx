import { modelLabels, engineName, engineMark } from './evidence.ts';
import { InstanceFacts } from './instances.tsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { acceptanceView } from "./scope.ts";
import { I, Spinner, EngineMark } from '../icons.tsx';
import { Prose } from '../bits.tsx';
import { Dialog } from '../backend/Dialog.tsx';
import { ReviewDiff, ReviewFileList, type DiffPrefs } from '../backend/Review.tsx';
import type { CheckRun, ReviewFile, Task } from '../api/backend/types.ts';
import type { TaskInput } from '../api/client/api.ts';
import type { Live, LiveIntent } from './session.ts';
import { invalidationText } from './session.ts';
import {
  checkHasEvidence,
  presentCheck,
  presentCheckRun,
  progressSentence,
  workspaceText,
} from './presentation.ts';
import { PHASE_TEXT, RUN_STATUS_TEXT, TASK_STATUS_TEXT } from '../api/connection.ts';

/* ─────────────────────────────────────────────────────────────
   真实模式工作台

   一个主区 + 一个按需辅助面板。主区随宽度自适应；面板关闭后
   空间还给内容，不保留固定占位。

   三条规则在界面上的落点：
   • 操作只由 availableActions 决定 —— 不看标题、不看时间、
     不看模型回复去「推断」现在能做什么。
   • 202 只代表已记录。中止与取消检查之后都显示「请求已记录，
     等真实终态」，不立刻显示成已中止。
   • 只有 passed + current 才说「当前版本检查通过」。
   ───────────────────────────────────────────────────────────── */

const feedbackDrafts = new Map<string,string>();
const readingPositions = new Map<string,number>();
type Tab = 'task' | 'workspace' | 'checks' | 'changes';

const ACTIONS = {
  prepare: 'prepare_workspace',
  start: 'start',
  feedback: 'feedback',
  interrupt: 'interrupt',
  snapshot: 'snapshot',
  check: 'check',
  cancelCheck: 'cancel_check',
  accept: 'accept',
  edit: 'edit',
} as const;

/** 后端会列出、但本批前端还没有对应表单的动作。保留位置并写明原因。 */
const NOT_IMPLEMENTED_ACTIONS: Record<string, string> = {
  edit: '任务编辑（标题 / 目标 / 验收条件）',
};

export function LiveWorkbench({ live }: { live: Live }) {
  const [tab, setTab] = useState<Tab>('task');
  const [auxOpen, setAuxOpen] = useState(false);
  const [acceptOpen, setAcceptOpen] = useState(false);
  const [fileId, setFileId] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<DiffPrefs>({ mode: 'split', wrap: false });

  const detail = live.state.detail;
  const task = detail?.task ?? null;
  const files: ReviewFile[] = detail?.snapshot?.files ?? [];
  const file = files.find((f) => f.id === fileId) ?? files[0] ?? null;

  /* 换任务时回到第一个文件，并收起与上一个任务相关的浮层 */
  useEffect(() => {
    setFileId(null);
    setAcceptOpen(false);
  }, [live.taskId]);

  if (!live.boot) {
    return (
      <Shell live={live}>
        <div className="empty">
          {live.bootError ? <I n="warn" s={22} /> : <Spinner s={22} />}
          <div className="empty__title">{live.bootError?.title ?? '正在读取服务状态…'}</div>
          <div className="empty__desc">{live.bootError?.detail ?? '正在取得 bootstrap 与实际模式。'}</div>
          {live.bootError ? (
            <button className="btn" onClick={() => void live.refreshList()}>
              <I n="refresh" s={14} />
              重新读取
            </button>
          ) : null}
        </div>
      </Shell>
    );
  }

  return (
    <Shell live={live}>
      {!task ? (
        <div className="empty">
          <I n="list" s={22} />
          <div className="empty__title">还没有任务</div>
          <div className="empty__desc">
            在左侧新建一个任务。创建只保存任务；需要先准备工作区，然后才能启动执行。
          </div>
        </div>
      ) : (
        <>
          {detail?.agentAuthorization?.eligible===false&&<div className="banner banner--warn" role="status">固定实例配置不能授权执行：{detail.agentAuthorization.reason}。不会自动替换实例或修订；历史任务保留可读，请返回流程建立新草案并重新批准。</div>}
          {live.instances.error&&<div className="banner banner--warn">{live.instances.error}<button className="btn" onClick={live.instances.refresh}>刷新实例</button></div>}
          {task.flow&&<details className="node-context"><summary>本任务的计划与执行依据</summary><p>节点 {task.flow.nodeId} · 计划 {task.flow.revision} · 批准 {task.flow.approvalId}。保留创建任务时的固定配置。</p></details>}{task.flow&&detail?.workflowAuthorization?.eligible===false&&<div className="banner banner--warn" role="status">后续执行授权已停止：这项任务的原计划或配置已失效。历史会话和代码仍可查看；请返回蓝图审阅新计划，批准后创建新任务。<details><summary>查看具体原因</summary><code>{detail.workflowAuthorization.reason}</code></details></div>}
          <TaskHeader
            task={task}
            live={live}
            tab={tab}
            onTab={setTab}
            auxOpen={auxOpen}
            onAux={() => setAuxOpen((v) => !v)}
          />
          <div className={`live-work ${auxOpen ? 'live-work--aux' : ''}`}>
            <div className="live-main">
              {tab === 'changes' ? (
                <ChangesView
                  live={live}
                  files={files}
                  file={file}
                  prefs={prefs}
                  onPrefs={(p) => setPrefs((old) => ({ ...old, ...p }))}
                  onPick={setFileId}
                />
              ) : (
                <Conversation live={live} />
              )}
            </div>
            {auxOpen ? (
              <aside className="surface aux live-aux" aria-label="辅助面板">
                <AuxPanel tab={tab} onTab={setTab} onClose={() => setAuxOpen(false)} live={live} />
              </aside>
            ) : null}
          </div>

          <ActionBar
            live={live}
            onAccept={() => setAcceptOpen(true)}
            onRequestChanges={() => setTab('task')}
            onOpenChanges={() => {
              setTab('changes');
              setAuxOpen(false);
            }}
          />
        </>
      )}

      {acceptOpen && task && detail?.snapshot ? (
        <AcceptDialog
          live={live}
          onClose={() => setAcceptOpen(false)}
          onDone={() => setAcceptOpen(false)}
        />
      ) : null}
    </Shell>
  );
}

/* ── 外壳：项目 / 模式 / 任务列表 / 写入提示 ────────────────── */

function Shell({ live, children }: { live: Live; children: React.ReactNode }) {
  const [creating, setCreating] = useState(false);
  return (
    <div className="live-shell">
      <div className="live-side">
        <div className="live-side__head">
          <span className="tag" title="来自本机后端">
            {live.transport === 'double' ? '前端 fetch 替身' : live.boot?.executionMode === 'deterministic' ? 'HTTP fixture · 不调用模型' : '本机 HTTP'}
          </span>
          <span className="meta">{live.mode === 'project' ? '项目模式' : live.mode === 'legacy' ? '旧模式' : '—'}</span>
          <button className="icon-btn icon-btn--sm" onClick={() => void live.refreshList()} title="重新读取任务列表" aria-label="刷新任务列表">
            {live.listBusy ? <Spinner s={13} /> : <I n="refresh" s={13} />}
          </button>
        </div>

        <div className="live-side__proj">
          <div className="live-side__projname" title={live.projectName ?? ''}>
            {live.projectName ?? live.boot?.project.name ?? '—'}
          </div>
          <div className="meta">
            检查预设 {live.presets.length} 项 · 可用 {live.presets.filter((p) => p.available).length} 项
          </div>
        </div>

        <label className="live-side__filter">
          <span className="meta">按状态筛选</span>
          <select
            className="input"
            value={live.statusFilter}
            onChange={(e) => live.setStatusFilter(e.target.value as typeof live.statusFilter)}
          >
            <option value="">全部</option>
            {(Object.keys(TASK_STATUS_TEXT) as Array<keyof typeof TASK_STATUS_TEXT>).map((k) => (
              <option key={k} value={k}>
                {TASK_STATUS_TEXT[k]}
              </option>
            ))}
          </select>
        </label>

        <div className="live-side__list">
          {live.listError ? (
            <div className="live-side__err" role="alert">
              {live.listError.title}
            </div>
          ) : null}
          {live.tasks.length === 0 && !live.listBusy ? (
            <p className="meta" style={{ padding: '10px 12px' }}>
              {live.statusFilter ? '没有符合筛选条件的任务。' : '后端上还没有任务。'}
            </p>
          ) : null}
          {live.tasks.map((t) => (
            <TaskListItem key={t.id} task={t} current={t.id === live.taskId} onPick={() => live.setTaskId(t.id)} />
          ))}
        </div>

        <div className="live-side__foot">{!live.allowCreate && <p className="meta">当前项目不能新建任务。已有任务仍按各自固定绑定核验操作；请返回项目设置处理当前绑定。</p>}{live.nextCursor !== null && <div><p className="meta">当前列表尚未取完，不代表全部任务数。</p><button className="btn btn--block" disabled={live.listBusy} onClick={()=>void live.loadMore()}>加载下一页任务</button></div>}
          <button className="btn btn--primary btn--block" disabled={!live.allowCreate || live.writing} onClick={() => setCreating(true)}>
            <I n="plus" s={14} />
            新建任务
          </button>
          {live.canSimulateExternalChange ? (
            <button className="btn btn--block btn--quiet" onClick={live.externalChange} title="仅在替身模式下可用：让工作区内容摘要变化，用于验证检查过时">
              <I n="edit" s={13} />
              模拟外部修改
            </button>
          ) : null}
        </div>
      </div>

      <div className="live-content">{live.writeError ? (
        <div className="banner banner--warn live-write-error" role="alert" style={{ marginBottom: 10 }}>
          <span className="banner__ico">
            <I n="warn" s={15} />
          </span>
          <div className="banner__body">
            <div className="banner__title">{live.writeError.title}</div>
            <div className="sec">{live.writeError.detail}</div><div className="meta">原请求：{live.pending?.intent.kind === "create" ? `创建任务 ${live.pending.intent.body.title}` : live.pending?.intent.taskId ?? "请核对当前操作"}</div>
          </div>
          <div className="live-dock__errbtns">
            {live.pending ? (
              <button className="btn btn--sm" disabled={live.writing} onClick={live.retryPending} title="用原来的幂等键与完全相同的内容重发；不会启动第二次执行">
                重试原请求
              </button>
            ) : null}
            <button className="btn btn--sm btn--quiet" onClick={live.abandonPending}>
              放弃
            </button>
          </div>
        </div>
      ) : null}
{children}</div>

      {creating ? <CreateDialog live={live} onClose={() => setCreating(false)} /> : null}

      {live.notice ? (
        <div className="toast" role="status">
          <I n="info" s={14} />
          <span style={{ flex: 1 }}>{live.notice}</span>
          <button className="icon-btn icon-btn--sm" onClick={() => live.setNotice(null)} aria-label="关闭提示">
            <I n="x" s={13} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

function TaskListItem({ task, current, onPick }: { task: Task; current: boolean; onPick: () => void }) {
  return (
    <button className="live-task" aria-current={current} onClick={onPick} title={task.title}>
      <span className="live-task__title">{task.title || '(无标题)'}</span>
      <span className="live-task__meta">
        <span className="st st--none">{TASK_STATUS_TEXT[task.status] ?? task.status}</span>
        {task.blockedReason ? (
          <span className="st st--wait" title={`后端 blockedReason = ${task.blockedReason}`}>
            结果未知
          </span>
        ) : null}
      </span>
    </button>
  );
}

/* ── 任务头：状态一句话 + 视图切换 + 面板开关 ───────────────── */

function TaskHeader({
  task,
  live,
  tab,
  onTab,
  auxOpen,
  onAux,
}: {
  task: Task;
  live: Live;
  tab: Tab;
  onTab: (t: Tab) => void;
  auxOpen: boolean;
  onAux: () => void;
}) {
  const detail = live.state.detail;
  const run = detail?.run;
  const check = presentCheck(detail?.checks);
  const runLine = run ? (RUN_STATUS_TEXT[run.status] ?? run.status) : '尚未运行';
  const phaseNote = run && run.phase !== 'ended' ? `（${PHASE_TEXT[run.phase] ?? run.phase}）` : '';

  return (
    <header className="live-head">
      <div className="live-head__title" title={task.title}><EngineMark mark={engineMark(live.instances.items.find(i=>i.id===task.agentInstanceId)?.engineId)}/>
        {task.title}
      </div>
      <div className="live-head__status">
        <span className="st st--none">{TASK_STATUS_TEXT[task.status] ?? task.status}</span>
        <span className={`st ${run?.status === 'running' ? 'st--run' : run?.status === 'succeeded' ? 'st--ok' : run?.status === 'failed' ? 'st--bad' : run?.status === 'needs_recovery' ? 'st--wait' : ''}`}>
          {runLine}
          {phaseNote}
        </span>
        <span className={`st ${check.tone === 'ok' ? 'st--ok' : check.tone === 'bad' ? 'st--bad' : check.tone === 'wait' ? 'st--wait' : check.tone === 'run' ? 'st--run' : 'st--none'}`} title={check.detail}>
          {check.label}
        </span>
      </div>
      <div className="live-head__grow" /><span className="meta" title={detail?.acceptance?.reason}>{acceptanceView(detail?.acceptance).text}</span>
      {/* 曾经接受过、但已失效：显示「已失效 + 原因」，不退回到含糊的「未接受」 */}
      {live.state.invalidated && (!detail?.acceptance || detail.acceptance.status === 'not_accepted') ? (
        <span
          className="accept-badge accept-badge--stale"
          title={`原接受针对快照 ${live.state.invalidated.snapshotId.slice(-8)}`}
        >
          <I n="warn" s={13} />
          上次接受已失效：{invalidationText(live.state.invalidated.reason)}
        </span>
      ) : null}
      <div className="seg" role="tablist" aria-label="视图">
        <button role="tab" aria-selected={tab !== 'changes'} onClick={() => onTab('task')}>
          执行
        </button>
        <button role="tab" aria-selected={tab === 'changes'} onClick={() => onTab('changes')}>
          变更 <span className="n">{detail?.snapshot?.files.length ?? 0}</span>
        </button>
      </div>
      <button
        className="icon-btn"
        aria-pressed={auxOpen}
        onClick={onAux}
        title={auxOpen ? '关闭辅助面板' : '打开辅助面板'}
        aria-label="辅助面板"
      >
        <I n="panel" />
      </button>
    </header>
  );
}

/* ── 会话流：轮次 / 输入 / 回复 / 活动 ─────────────────────── */

function Conversation({ live }: { live: Live }) {
  const { transcript, inputs, runs, detail, streamIssue, error, loading } = live.state;
  const scroller = useRef<HTMLDivElement>(null);
  const run = detail?.run;

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = readingPositions.get(`${live.scope}:${live.taskId}`) ?? el.scrollHeight;
  }, [transcript.after, live.taskId]);

  return (
    <div className="scroll" ref={scroller} onScroll={e=>readingPositions.set(`${live.scope}:${live.taskId}`,e.currentTarget.scrollTop)}>
      <div className="convo">
        {detail&&<details className="node-context"><summary>目标与验收 · {detail.task.title}</summary><p>{detail.task.goal}</p><ul>{detail.task.acceptanceCriteria.map((c,i)=><li key={i}>{c}</li>)}</ul><p>成果通过“变更”查看快照；工作区路径与检查依据在辅助面板中按需展开。</p></details>}
        {loading ? (
          <p className="meta">
            <Spinner s={13} /> 正在读取任务、事件与历史输入…
          </p>
        ) : null}

        {error ? (
          <div className="banner banner--bad" role="alert">
            <span className="banner__ico">
              <I n="warn" s={15} />
            </span>
            <div className="banner__body">
              <div className="banner__title">{error.title}</div>
              <div className="sec">{error.detail}</div>
            </div>
          </div>
        ) : null}

        {streamIssue ? (
          <div className="banner banner--warn" role="status">
            <span className="banner__ico">
              <I n="info" s={15} />
            </span>
            <div className="banner__body">
              <div className="banner__title">事件订阅中断</div>
              <div className="sec">{streamIssue}</div>
              <button className="btn btn--sm" style={{ marginTop: 8 }} onClick={live.reconnect}>
                <I n="refresh" s={13} />
                重新连接
              </button>
            </div>
          </div>
        ) : null}

        {transcript.rounds.length === 0 && !loading ? (
          <p className="meta">
            {run ? '这一轮还没有产生可展示的事件。' : '还没有运行记录。准备工作区后可以启动第一次执行。'}
          </p>
        ) : null}

        {transcript.rounds.map((round, index) => {
          const messages = transcript.messages.filter((m) => m.runId === round.id);
          const input = inputs[round.id];
          const evidence=runs[round.id], instance=live.instances.items.find(i=>i.id===(evidence?.agentInstanceId??detail?.task.agentInstanceId));
          const engine=evidence?.engineId??instance?.engineId;
          return (
            <section key={round.id} className="live-round">
              <h3 className="live-round__h">
                第 {index + 1} 轮
                <span className="meta">{round.startedAt ? new Date(round.startedAt).toLocaleString('zh-CN') : ''}</span>
                <span
                  className={`st ${round.status === 'running' ? 'st--run' : round.status === 'succeeded' ? 'st--ok' : round.status === 'failed' ? 'st--bad' : round.status === 'needs_recovery' ? 'st--wait' : 'st--none'}`}
                >
                  {round.status ? RUN_STATUS_TEXT[round.status] ?? round.status : '等待状态'}
                </span>
              </h3>

              <div className="round-evidence"><EngineMark mark={engineMark(engine)}/> {engineName(engine)} · 实例 {evidence?.agentInstanceId??detail?.task.agentInstanceId??'未知'}{modelLabels(evidence).map(label=><span className="tag" key={label}>{label}</span>)}{evidence?.agentBinding&&<span className="meta">固定配置修订 {evidence.agentBinding.revision}</span>}</div>
              <div className="live-input">
                <div className="live-input__label">
                  <I n="read" s={13} /> 本轮输入
                </div>
                <p className="live-input__text">
                  {input === undefined
                    ? '正在读取输入…'
                    : input === null
                      ? '本轮输入暂不可用（后端没有返回）。'
                      : input}
                </p>
              </div>

              {messages.map((m) => (
                <div className="prose" key={m.id}>
                  <div className="live-agent__label">
                    <EngineMark mark={engineMark(engine)}/> {engineName(engine)}
                  </div>
                  <Prose text={m.text} />
                </div>
              ))}
              {messages.length === 0 ? (
                <p className="meta">{round.status === 'running' ? '正在等待回复…' : '本轮没有文本回复。'}</p>
              ) : null}
            </section>
          );
        })}

        {transcript.activity ? <p className="meta">最近活动：{transcript.activity}</p> : null}
        {transcript.diagnostics.map((d, i) => (
          <p className="meta" key={i}>
            <I n="warn" s={12} /> {d}
          </p>
        ))}

        <p className="meta" style={{ marginTop: 20 }}>
          <I n="info" s={13} /> 关闭页面或切换任务不会取消后端运行。再次进入会用事件游标补读历史。
        </p>
      </div>
    </div>
  );
}

/* ── 变更视图：真实快照 + diff ─────────────────────────────── */

function ChangesView({
  live,
  files,
  file,
  prefs,
  onPrefs,
  onPick,
}: {
  live: Live;
  files: ReviewFile[];
  file: ReviewFile | null;
  prefs: DiffPrefs;
  onPrefs: (p: Partial<DiffPrefs>) => void;
  onPick: (id: string) => void;
}) {
  const snapshot = live.state.detail?.snapshot;
  if (!snapshot) {
    return (
      <div className="diffcol">
        <div className="diffbar">
          <span className="meta">没有可审查的变更</span>
        </div>
        <div className="empty">
          <I n="diff" s={22} />
          <div className="empty__title">还没有快照</div>
          <div className="empty__desc">
            运行结束后生成一次快照，才能在这里逐行审查、执行检查并接受。
          </div>
        </div>
      </div>
    );
  }

  const index = files.findIndex((f) => f.id === file?.id);
  return (
    <div className="review" style={{ position: 'relative' }}>
      <div className="files" style={{ width: 248 }}>
        <ReviewFileList files={files} cur={file?.id ?? ''} onPick={onPick} onClose={() => undefined} />
      </div>
      {file ? (
        <ReviewDiff
          file={file}
          files={files}
          prefs={prefs}
          onPrefs={onPrefs}
          index={index}
          onStep={(d) => {
            if (!files.length) return;
            const i = files.findIndex((f) => f.id === file.id);
            onPick(files[(i + d + files.length) % files.length].id);
          }}
          filesOpen
          onOpenFiles={() => undefined}
          longLineWidth={640}
        />
      ) : null}
    </div>
  );
}

/* ── 操作条：全部动作的唯一入口 ───────────────────────────── */

function ActionBar({
  live,
  onAccept,
  onOpenChanges,
  onRequestChanges,
}: {
  live: Live;
  onAccept: () => void;
  onOpenChanges: () => void;
  onRequestChanges: () => void;
}) {
  const detail = live.state.detail;
  const actions = live.actions;
  const has = (name: string) => actions.includes(name);
  const feedbackRef = useRef<HTMLTextAreaElement>(null);
  const draftKey = `${live.scope}:${live.taskId}`;
  const [feedback, setFeedbackState] = useState(() => feedbackDrafts.get(draftKey) ?? '');
  const setFeedback = (text: string) => {feedbackDrafts.set(draftKey,text);setFeedbackState(text);};
  useEffect(() => {setFeedbackState(feedbackDrafts.get(draftKey) ?? '');},[draftKey]);

  const ws = workspaceText(live.workspace);
  const run = detail?.run;
  const check = presentCheck(detail?.checks);
  const runningCheck = live.state.checks?.items.find((c) => c.status === 'running' && c.taskId === live.taskId);

  /* 中止是请求，不是结果：只有拿到真实终态才算中止完成 */
  const interruptPending =
    live.pending?.intent.kind === 'interrupt' && run?.phase === 'stopping';
  /* 取消检查同理 */
  const cancelPending =
    live.pending?.intent.kind === 'cancelCheck' && runningCheck && runningCheck.reason === 'cancel_requested';

  const sendOr = (intent: LiveIntent, label: string) => (
    <button
      className="btn btn--primary"
      disabled={live.writing}
      onClick={() => {
        live.run(intent);
        live.setNotice(label);
      }}
    >
      {live.writing ? <Spinner s={13} /> : null}
      {label}
    </button>
  );

  return (
    <div className="live-dock">
      
      <div className="live-dock__row">
        {/* 工作区未就绪：可准备则准备，否则只说明原因 */}
        {!detail?.task.flow && has(ACTIONS.prepare) ? (
          <>
            {sendOr({ kind: 'prepare', taskId: detail!.task.id }, '准备工作区')}
            <span className="meta">准备会创建独立 Git 工作区与分支；完成后才能启动执行。</span>
          </>
        ) : null}

        {ws && !has(ACTIONS.prepare) && live.workspace?.status !== 'ready' ? (
          <span className={`st ${ws.tone === 'bad' ? 'st--bad' : ws.tone === 'wait' ? 'st--wait' : ws.tone === 'run' ? 'st--run' : 'st--none'}`} title={ws.detail}>
            工作区{ws.label}
          </span>
        ) : null}

        {/* 启动 / 反馈：都由 availableActions 决定 */}
        {!detail?.task.flow && has(ACTIONS.start) ? sendOr({ kind: 'start', taskId: detail!.task.id }, '启动执行') : null}
        {detail?.task.flow && (has(ACTIONS.start)||has(ACTIONS.prepare)) ? <p className='meta'>请返回项目蓝图，在任务详情中准备工作区并确认下发。</p> : null}

        {detail ? (
          <div className="live-dock__feedback"><button className="btn" onClick={()=>{onRequestChanges();feedbackRef.current?.focus();}}>要求修改</button>
            <textarea
              className="input"
              rows={2}
              maxLength={64000}
              ref={feedbackRef}
              aria-label='任务反馈或修改要求'
              value={feedback}
              placeholder="说明需要修改的地方，或先保留反馈草稿…"
              onChange={(e) => setFeedback(e.target.value)}
            />
            <button
              className="btn btn--primary"
              disabled={live.writing || !has(ACTIONS.feedback) || !feedback.trim()}
              onClick={() => {
                live.run({ kind: 'start', taskId: detail!.task.id, input: feedback.trim() });

                live.setNotice('正在提交反馈，请等待服务确认。');
              }}
            >
              {live.writing ? <Spinner s={13} /> : null}
              发送反馈并继续
            </button>
          </div>
        ) : null}

        {detail&&!has(ACTIONS.feedback)&&<p className="meta">{run?.status==="running"?"当前不能即时发送，先保留反馈，等本轮结束后再继续原会话。":"当前状态或会话授权未满足，反馈未发送。请刷新核查后再试。"}</p>}
        {has(ACTIONS.interrupt) && run ? (
          <>
            <button
              className="btn"
              disabled={live.writing}
              onClick={() => {
                live.run({ kind: 'interrupt', taskId: detail!.task.id, runId: run.id });
                live.setNotice('已请求中止。这是请求，不是结果；以真实终态为准。已写入的文件不会回滚。');
              }}
              title="请求中止当前这一轮。202 只表示请求已记录；收到真实终态前不显示为已中止。"
            >
              <I n="stop" s={12} /> 中止
            </button>
            {interruptPending ? <span className="meta">正在停止…（等待真实终态）</span> : null}
          </>
        ) : null}

        {has(ACTIONS.cancelCheck) && runningCheck ? (
          <>
            <button
              className="btn"
              disabled={live.writing}
              onClick={() => {
                live.run({ kind: 'cancelCheck', taskId: detail!.task.id, checkId: runningCheck.id });
                live.setNotice('已请求取消检查。以检查列表的真实终态为准。');
              }}
            >
              <I n="x" s={12} /> 取消检查
            </button>
            {cancelPending ? <span className="meta">正在取消…（等待真实终态）</span> : null}
          </>
        ) : null}

        {has('recover_check') && detail?.recovery?.items.filter(i=>i.kind==='check' && i.recoverable && i.version).map(i=><button className="btn" key={i.id} disabled={live.writing} onClick={()=>live.run({kind:'recoverCheck',taskId:detail.task.id,checkId:i.id})}>恢复有退出证据的检查（不重执行）</button>)}
        {has(ACTIONS.snapshot) ? sendOr({ kind: 'snapshot', taskId: detail!.task.id }, '生成快照') : null}

        {has(ACTIONS.check) && detail?.snapshot ? (
          <CheckStarter live={live} taskId={detail.task.id} snapshotId={detail.snapshot.id} />
        ) : null}

        {has(ACTIONS.accept) ? (
          <button className="btn" onClick={onAccept} disabled={live.writing}>
            <I n="check" s={13} /> 确认成果
          </button>
        ) : null}

        {detail?.snapshot ? (
          <button className="btn btn--quiet btn--sm" onClick={onOpenChanges}>
            <I n="diff" s={13} /> 审查成果
          </button>
        ) : null}

        <span style={{ flex: 1 }} />
        <span className="meta" title="当前版本检查结论">
          {check.key === 'passed_current' ? (
            <span className="st st--ok">{check.label}</span>
          ) : (
            <span className="meta">{check.label}</span>
          )}
          {' · '}
          {progressSentence({
            runSucceeded: run?.status === 'succeeded',
            accepted: acceptanceView(detail?.acceptance).valid,
            integrated: false,
            verified: false,
          })}
        </span>
      </div>

      {/* 后端列出、但本批前端没有表单的动作：保留位置并写明原因，不静默吞掉 */}
      {actions.filter((name) => NOT_IMPLEMENTED_ACTIONS[name]).map((name) => (
        <p className="meta" key={name} style={{ marginTop: 8 }}>
          <I n="lock" s={12} /> 服务当前允许「{NOT_IMPLEMENTED_ACTIONS[name]}」，但本批界面还没有这个表单；
          接口（<span className="mono">PATCH /tasks/:id</span>）已经可用。这一项会在下一批补上。
        </p>
      ))}

      {/* 没有可执行动作时说明原因，不留空位也不给假按钮 */}
      {actions.length === 0 ? (
        <p className="meta" style={{ marginTop: 8 }}>
          <I n="lock" s={12} /> 当前没有可执行的操作
          {detail?.task.blockedReason ? `（任务被标记为 ${detail.task.blockedReason}，禁止继续执行）` : null}
          {run?.status === 'running' ? '（可能已有执行在进行）' : null}
          {runningCheck ? '（检查正在执行，任务占用执行位）' : null}
          。
        </p>
      ) : null}
    </div>
  );
}

/** 选择检查预设并启动。预设只能来自服务的本机配置。 */
function CheckStarter({ live, taskId, snapshotId }: { live: Live; taskId: string; snapshotId: string }) {
  const available = live.presets.filter((p) => p.available);
  const [presetId, setPresetId] = useState(available[0]?.id ?? '');
  useEffect(() => {
    if (!available.some((p) => p.id === presetId)) setPresetId(available[0]?.id ?? '');
  }, [available, presetId]);

  if (!available.length) {
    return (
      <span className="action-unavailable" title="服务的本机配置里没有可用的检查预设">
        <I n="lock" s={13} /> 没有可用检查预设
      </span>
    );
  }

  return (
    <>
      <select className="input" style={{ width: 'auto' }} value={presetId} onChange={(e) => setPresetId(e.target.value)} aria-label="检查预设">
        {available.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <button
        className="btn"
        disabled={live.writing || !presetId}
        onClick={() => {
          live.run({ kind: 'check', taskId, presetId, snapshotId });
          live.setNotice('已请求执行检查。结果从检查列表的后续查询获得。');
        }}
      >
        {live.writing ? <Spinner s={13} /> : null}
        执行检查
      </button>
    </>
  );
}

/* ── 辅助面板：任务 / 工作区 / 检查 / 变更 ─────────────────── */

function AuxPanel({ tab, onTab, onClose, live }: { tab: Tab; onTab: (t: Tab) => void; onClose: () => void; live: Live }) {
  const LABEL: Record<Tab, string> = { task: '任务', workspace: '工作区', checks: '检查', changes: '变更' };
  const tabs: Tab[] = ['task', 'workspace', 'checks'];
  return (
    <>
      <div className="aux__head">
        <div className="tabs" role="tablist">
          {(tab === 'changes' ? (['changes'] as Tab[]) : tabs).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => onTab(t)}>
              {LABEL[t]}
            </button>
          ))}
        </div>
        <button className="icon-btn icon-btn--sm" onClick={onClose} aria-label="关闭面板" title="关闭面板">
          <I n="x" s={14} />
        </button>
      </div>
      <div className="aux__body">
        {tab === 'task' ? <TaskPane live={live} /> : null}
        {tab === 'workspace' ? <WorkspacePane live={live} /> : null}
        {tab === 'checks' ? <ChecksPane live={live} /> : null}
        {tab === 'changes' ? <ChangesPane live={live} /> : null}
      </div>
    </>
  );
}

function TaskPane({ live }: { live: Live }) {
  const task = live.state.detail?.task;
  if (!task) return null;
  return (
    <div className="pane-pad">
      <div className="pane-h">目标</div>
      <p style={{ margin: 0, lineHeight: 1.7, fontSize: 14 }}>{task.goal || '尚未填写目标。'}</p>

      <div className="pane-h">验收条件</div>
      <ul className="ac">
        {task.acceptanceCriteria.map((text) => (
          <li key={text}>
            <span className="mk">
              <I n="circle" s={13} />
            </span>
            <span>
              {text}
              <span className="meta"> · 后端不做逐条判定</span>
            </span>
          </li>
        ))}
      </ul>

      <InstanceFacts instance={live.instances.items.find(i=>i.id===task.agentInstanceId)}/>
      <p className="mono">任务固定配置：{task.agentBinding?task.agentBinding.instanceId+' · 修订 '+task.agentBinding.revision+' · '+task.agentBinding.configurationId:'历史记录缺少配置证明'}</p>
      <p>会话归属：{live.state.session?live.state.session.ownership+' · '+engineName(live.state.session.engineId)+' · 工作台引用 '+live.state.session.id:'未读取到可核验的会话归属；尚未建立或暂不可用'}。跨任务上下文不自动共享。</p>
      <div className="pane-h">标识</div>
      <dl className="dl">
        <dt>任务</dt>
        <dd className="mono" style={{ fontSize: 12 }}>{task.id}</dd>
        <dt>项目</dt>
        <dd className="mono" style={{ fontSize: 12 }}>{task.projectId}</dd>
        <dt>实例</dt>
        <dd className="mono" style={{ fontSize: 12 }}>{task.agentInstanceId}</dd>
        <dt>版本</dt>
        <dd className="mono">{task.version}</dd>
        <dt>创建于</dt>
        <dd>{new Date(task.createdAt).toLocaleString('zh-CN')}</dd>
      </dl>

      <div className="pane-h">可用动作</div>
      <p className="meta" style={{ lineHeight: 1.7 }}>
        {live.actions.length ? (
          <span className="mono">{live.actions.join('、')}</span>
        ) : (
          '当前没有可执行的动作。'
        )}
        <br />
        这份列表由服务按当前状态给出；界面只渲染这里出现的操作，不自行推断。
      </p>
    </div>
  );
}

function WorkspacePane({ live }: { live: Live }) {
  const ws = live.workspace;
  const text = workspaceText(ws);
  if (!ws || !text) return <p className="meta" style={{ padding: 14 }}>没有工作区信息。</p>;
  return (
    <div className="pane-pad">
      <div className="pane-h">准备状态</div>
      <p style={{ marginTop: 0 }}>
        <span className={`st ${text.tone === 'ok' ? 'st--ok' : text.tone === 'bad' ? 'st--bad' : text.tone === 'wait' ? 'st--wait' : text.tone === 'run' ? 'st--run' : 'st--none'}`}>
          {text.label}
        </span>
      </p>
      <p className="meta" style={{ lineHeight: 1.7 }}>{text.detail}</p>

      <dl className="dl">
        <dt>分支</dt>
        <dd className="mono" style={{ fontSize: 12 }}>{ws.branch ?? '—'}</dd>
        <dt>基准提交</dt>
        <dd className="mono" style={{ fontSize: 12 }}>{live.state.detail?.task.executionBinding?.baselineCommit ?? ws.baseHead ?? '—'}</dd>
        <dt>绑定 ID</dt><dd className="mono">{live.state.detail?.task.executionBinding?.id ?? "旧模式 / 未提供"}</dd><dt>授权 ID</dt><dd className="mono">{live.state.detail?.task.executionBinding?.grantId ?? "旧模式 / 未提供"}</dd>
        <dt>绑定修订</dt><dd className="mono">{live.state.detail?.task.executionBinding?.revision ?? "旧模式 / 未提供"}</dd>
        <dt>工作区</dt>
        <dd className="mono" style={{ fontSize: 12 }}>{ws.id}</dd>
        {ws.reason ? (
          <>
            <dt>原因</dt>
            <dd className="mono" style={{ fontSize: 12 }}>{ws.reason}</dd>
          </>
        ) : null}
      </dl>

      <p className="meta" style={{ lineHeight: 1.7 }}>
        服务不通过接口暴露工作区的真实路径。准备意图跨重启不会自动重放；即使 Git 已经建好，无法确认时也会保留待人工恢复，而不是假装成功。
      </p>
    </div>
  );
}

function ChecksPane({ live }: { live: Live }) {
  const summary = presentCheck(live.state.detail?.checks);
  const items = live.state.checks?.items ?? [];
  return (
    <div className="pane-pad">
      <div className="pane-h">当前结论</div>
      <p style={{ marginTop: 0 }}>
        <span className={`st ${summary.tone === 'ok' ? 'st--ok' : summary.tone === 'bad' ? 'st--bad' : summary.tone === 'wait' ? 'st--wait' : summary.tone === 'run' ? 'st--run' : 'st--none'}`}>
          {summary.label}
        </span>
      </p>
      <p className="meta" style={{ lineHeight: 1.7 }}>{summary.detail}</p>
      {!summary.canClaimPassed && summary.key === 'passed_stale' ? (
        <p className="meta" style={{ color: 'var(--warn)', lineHeight: 1.7 }}>
          旧版本通过不能当作当前版本通过。
        </p>
      ) : null}

      <div className="pane-h">预设（来自服务本机配置）</div>
      <ul className="ac">
        {live.presets.map((p) => (
          <li key={p.id}>
            <span className="mk">
              <I n={p.available ? 'check' : 'x'} s={13} />
            </span>
            <span style={{ flex: 1 }}>
              {p.name}
              <span className="meta mono" style={{ display: 'block', fontSize: 11 }}>
                {p.executable} {p.args.join(' ')}
              </span>
              {!p.available ? <span className="meta"> · 本机不可用（不经过 shell 执行）</span> : null}
            </span>
          </li>
        ))}
      </ul>

      <div className="pane-h">历史记录</div>
      {items.length === 0 ? (
        <p className="meta">还没有检查记录。</p>
      ) : (
        items
          .slice()
          .reverse()
          .map((c) => <CheckRow key={c.id} run={c} />)
      )}
    </div>
  );
}

function CheckRow({ run }: { run: CheckRun }) {
  const [open, setOpen] = useState(false);
  const p = presentCheckRun(run);
  const evidence = checkHasEvidence(run);
  return (
    <div className="check">
      <div className="check__top">
        <span style={{ color: p.tone === 'ok' ? 'var(--ok)' : p.tone === 'bad' ? 'var(--bad)' : 'var(--text-3)' }}>
          <I n={p.tone === 'ok' ? 'check' : p.tone === 'bad' ? 'x' : p.tone === 'run' ? 'clock' : 'circle'} s={14} />
        </span>
        <span className="check__name">{run.preset.name}</span>
        <span className={`st ${p.tone === 'ok' ? 'st--ok' : p.tone === 'bad' ? 'st--bad' : p.tone === 'wait' ? 'st--wait' : p.tone === 'run' ? 'st--run' : 'st--none'}`}>
          {p.label}
        </span>
        {run.exitCode !== undefined && run.exitCode !== null ? <span className="meta">exit {run.exitCode}</span> : null}
      </div>
      <div className="check__cmd">
        {run.preset.executable} {run.preset.args.join(' ')}
      </div>
      {p.staleNote ? <div className="check__note">{p.staleNote}</div> : null}
      {run.reason ? <div className="check__note">原因：{run.reason}</div> : null}
      {run.truncated ? <div className="check__note">输出超出上限，已截断。</div> : null}
      {evidence ? (
        <div style={{ margin: '6px 0 0 0' }}>
          <button className="step-btn" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? '收起输出' : '查看输出'}
          </button>
          {open ? (
            <>
              {run.stdout ? <pre className="out" style={{ marginTop: 6 }}>{run.stdout}</pre> : null}
              {run.stderr ? (
                <>
                  <div className="meta" style={{ marginTop: 6 }}>stderr</div>
                  <pre className="out">{run.stderr}</pre>
                </>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
      <div className="meta" style={{ marginTop: 6 }}>
        {new Date(run.startedAt).toLocaleString('zh-CN')}
        {run.endedAt ? ` → ${new Date(run.endedAt).toLocaleTimeString('zh-CN')}` : ''}
        {run.validity === 'stale' ? ' · 已过时' : ''}
      </div>
    </div>
  );
}

function ChangesPane({ live }: { live: Live }) {
  const snapshot = live.state.detail?.snapshot;
  if (!snapshot) return <p className="meta" style={{ padding: 14 }}>还没有快照。</p>;
  return (
    <div className="pane-pad">
      <div className="pane-h">当前快照</div>
      <dl className="dl">
        <dt>文件</dt>
        <dd>{snapshot.files.length} 个</dd>
        <dt>完整性</dt>
        <dd className="mono">{snapshot.completeness}</dd>
        <dt>内容摘要</dt>
        <dd className="mono" style={{ fontSize: 12 }}>{snapshot.contentDigest.slice(0, 12)}</dd>
        <dt>基准</dt>
        <dd className="mono" style={{ fontSize: 12 }}>{snapshot.baseHead?.slice(0, 12) ?? '—'}</dd>
        <dt>创建于</dt>
        <dd>{new Date(snapshot.createdAt).toLocaleString('zh-CN')}</dd>
      </dl>
      <p className="meta" style={{ lineHeight: 1.7 }}>
        快照自身记录的 <span className="mono">checks</span> 是创建当时的
        <span className="mono"> {snapshot.checks}</span>，属于历史值。
        当前的检查结论请看检查面板，不能拿这个字段推断通过。
      </p>
      <ul className="flist">
        {snapshot.files.map((f) => (
          <li key={f.id}>
            <span className="p" title={f.path}>{f.path}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── 对话框：创建任务 / 接受 ───────────────────────────────── */

function CreateDialog({ live, onClose }: { live: Live; onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [goal, setGoal] = useState('');
  const [criteria, setCriteria] = useState('');
  const [instanceId,setInstanceId]=useState(live.instances.items.find(i=>i.available)?.id??'');
  const projectId = live.projectId ?? live.boot?.project.id;

  const body: TaskInput | null = useMemo(() => {
    const list = criteria
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!title.trim() || !goal.trim() || !list.length || !live.instances.items.some(i=>i.id===instanceId&&i.available&&i.capabilities.some(c=>c.name==='start'&&c.businessSupport==='implemented'))) return null;
    return {
      title: title.trim(),
      goal: goal.trim(),
      acceptanceCriteria: list,
      agentInstanceId: instanceId,
      ...(projectId ? { projectId } : {}),
    };
  }, [title, goal, criteria, projectId, instanceId, live.instances.items]);

  return (
    <Dialog
      title="新建任务"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button
            className="btn btn--primary"
            disabled={!body || live.writing || !live.allowCreate}
            onClick={() => {
              if (!body) return;
              live.run({ kind: 'create', body });
              live.setNotice('任务创建请求已提交，正在核对保存结果。创建不会调用模型。');
              onClose();
            }}
          >
            {live.writing ? <Spinner s={13} /> : null}
            创建任务
          </button>
        </>
      }
    >
      <p className="meta">创建只保存任务，不会调用模型，也不消耗额度。</p><label>执行实例<select className="input" value={instanceId} onChange={e=>setInstanceId(e.target.value)}><option value="">选择服务登记实例</option>{live.instances.items.map(i=><option key={i.id} value={i.id} disabled={!i.available}>{i.name} · {engineName(i.engineId)}{!i.available?' · 未支持':''}</option>)}</select></label><InstanceFacts instance={live.instances.items.find(i=>i.id===instanceId)}/>
      <div className="connect__fields">
        <label className="connfield">
          <span className="connfield__label">标题</span>
          <input className="input" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：修复游标在分页边界的重复写入" />
        </label>
        <label className="connfield">
          <span className="connfield__label">目标</span>
          <textarea className="input" rows={4} maxLength={64000} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="模型第一轮会拿到这段目标与下面的验收条件。" />
        </label>
        <label className="connfield">
          <span className="connfield__label">验收条件（每行一条，至少一条）</span>
          <textarea className="input" rows={3} maxLength={64000} value={criteria} onChange={(e) => setCriteria(e.target.value)} placeholder={'连续两轮同步不产生重复结果\n补充游标精度不一致的回归测试'} />
        </label>
      </div>
      <p className="meta">
        提示：标题里包含 <span className="mono">#conflict</span> / <span className="mono">#recover</span>，目标里包含
        <span className="mono"> #fail</span> / <span className="mono">#recover</span> / <span className="mono">#slow</span>，
        在替身模式下会走到对应的失败与未知分支。真实后端没有这些开关，纯属替身演示用。
      </p>
      <p className="meta">
        <I n="lock" s={12} /> 提交按钮只在标题、目标与至少一条验收条件都填好时可用 —— 少于一条会让任务停在草稿状态。
      </p>
    </Dialog>
  );
}

function AcceptDialog({ live, onClose, onDone }: { live: Live; onClose: () => void; onDone: () => void }) {
  const detail = live.state.detail;
  const snapshot = detail?.snapshot;
  const check = presentCheck(detail?.checks);
  if (!detail || !snapshot) return null;

  return (
    <Dialog
      title="确认这一版成果？"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            再看看
          </button>
          <button
            className="btn btn--primary"
            disabled={live.writing}
            onClick={() => {
              live.run({ kind: 'accept', taskId: detail.task.id, snapshotId: snapshot.id });
              live.setNotice('正在提交成果确认，请等待服务确认。此操作不集成代码，也不代表最终验收。');
              onDone();
            }}
          >
            {live.writing ? <Spinner s={13} /> : null}
            确认成果
          </button>
        </>
      }
    >
      <p>接受表示你认可当前这一版改动。它不会提交、不会合并到 main，集成与验收在后续批次单独进行。</p>
      <ul>
        <li>
          <I n="diff" s={15} className="meta" />
          <span>
            {snapshot.files.length} 个文件 ·<span className="mono" style={{ marginLeft: 6 }}>快照 {snapshot.id.slice(-8)}</span>
            <span className="meta" style={{ marginLeft: 6 }}>摘要 {snapshot.contentDigest.slice(0, 8)}</span>
          </span>
        </li>
        <li>
          <I n="circle" s={15} className="meta" />
          <span>
            检查结论：<b>{check.label}</b>
            <span className="meta"> · {check.detail}</span>
          </span>
        </li>
        {!check.canClaimPassed ? (
          <li style={{ color: 'var(--warn)' }}>
            <I n="warn" s={15} />
            <span>
              {check.key === 'not_run'
                ? '这个版本没有执行过检查 —— 接受不要求检查通过，所以不要把它当成已验证。'
                : check.key === 'passed_stale'
                  ? '检查通过针对的是更早的版本，不能代表当前版本。'
                  : '当前检查不是「通过」状态。接受不要求检查通过。'}
            </span>
          </li>
        ) : null}
        <li>
          <I n="circle" s={15} className="meta" />
          <span>接受记录绑定这个快照；之后产生新运行或工作区被改动，接受会自动失效</span>
        </li>
      </ul>
      <p className="meta">确认只针对刚刚审查的快照。如果代码已经变化，请重新审查后再确认。</p>
    </Dialog>
  );
}




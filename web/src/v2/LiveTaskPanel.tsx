import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiClient, ApiClientError, type TaskDetail, type TaskInput } from './api/client/api.ts';
import { appendEvent, emptyTranscript, runInput } from './api/client/execution.ts';
import { RUN_STATUS_TEXT, TASK_STATUS_TEXT, PHASE_TEXT, type Conn } from './api/connection.ts';

type Pending = { key: string } & ({ kind: 'create'; body: TaskInput } | { kind: 'start'; taskId: string; body: { expectedVersion: number; input?: string } });
function errorText(error: unknown) {
  if (error instanceof ApiClientError) return `请求失败（${error.status}）：${error.code}。可重新读取状态；网络结果不明时请重试原请求。`;
  return '连接中断或事件流不可用。请重新连接读取；不会自动重复执行任务。';
}

/** Real backend only; deliberately separate from the prototype's simulated task store. */
export function LiveTaskPanel({ connection, initialTaskId }: { connection: Conn; initialTaskId?: string }) {
  const client = useMemo(() => new ApiClient({ baseUrl: connection.origin, getToken: () => connection.token.trim() }), [connection.origin, connection.token]);
  const [taskId, setTaskId] = useState(initialTaskId);
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [transcript, setTranscript] = useState(emptyTranscript);
  const [inputs, setInputs] = useState<Record<string, string | null>>({});
  const [epoch, setEpoch] = useState(0);
  const [title, setTitle] = useState('我的第一个真实任务');
  const [goal, setGoal] = useState('请只回复一句“AgentDesk 已成功运行”，不要调用工具或修改文件。');
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const pending = useRef<Pending | null>(null);
  const mounted = useRef(true);
  const [error, setError] = useState('');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    if (!taskId) return;
    const controller = new AbortController();
    const signal = controller.signal;
    let state = emptyTranscript();
    setTranscript(state); setInputs({}); setError('');
    const loaded = new Set<string>();
    const loadInputs = async () => {
      for (const round of state.rounds) {
        if (loaded.has(round.id)) continue;
        loaded.add(round.id);
        try {
          const run = await client.run(round.id, signal);
          if (!signal.aborted) setInputs(previous => ({ ...previous, [round.id]: run.input ?? null }));
        } catch (error) {
          if (signal.aborted) throw error;
          setInputs(previous => ({ ...previous, [round.id]: null }));
        }
      }
    };
    const refresh = async () => {
      const value = await client.task(taskId, signal);
      if (!signal.aborted) setDetail(value);
      return value;
    };
    void (async () => {
      await refresh();
      while (true) {
        const page = await client.events(taskId, state.after, 200, signal);
        if (signal.aborted) return;
        for (const event of page.items) state = appendEvent(state, event);
        setTranscript(state);
        if (page.items.length < 200) break;
      }
      await loadInputs();
      const current = await refresh();
      if (current.run && current.run.status !== 'running' && state.after >= current.lastEventSeq) return;
      for await (const event of client.streamEvents(taskId, { after: state.after, signal })) {
        if (signal.aborted) return;
        state = appendEvent(state, event); setTranscript(state);
        if (event.type === 'run.created') await loadInputs();
        if (event.type === 'run.status_changed' || event.type === 'task.updated' || event.type === 'task.accepted') {
          const value = await refresh();
          if (value.run && value.run.status !== 'running' && state.after >= value.lastEventSeq) return;
        }
      }
    })().catch(e => { if (!signal.aborted) setError(errorText(e)); });
    return () => controller.abort();
  }, [client, taskId, epoch]);

  const send = async (intent: Pending) => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(''); pending.current = intent;
    try {
      if (intent.kind === 'create') {
        const task = await client.createTask(intent.body, intent.key);
        if (!mounted.current) return;
        setTaskId(task.id);
      } else {
        await client.startRun(intent.taskId, intent.body, intent.key);
      }
      if (!mounted.current) return;
      pending.current = null;
      if (intent.kind === 'start') { setFeedback(''); setDetail(null); }
      setEpoch(n => n + 1);
    } catch (e) { if (mounted.current) setError(errorText(e)); }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  };

  const startAllowed = detail?.availableActions.includes('start') && detail.task.status === 'ready';
  const feedbackAllowed = detail?.availableActions.includes('feedback') && !detail.task.blockedReason;
  return (
    <section className="connect-info" style={{ marginTop: 24 }}>
      <h2 className="h2">真实任务执行</h2>
      {!taskId ? (
        <div className="connect__fields">
          <label className="connfield"><span>任务标题</span><input className="input" value={title} maxLength={200} disabled={busy} onChange={e => setTitle(e.target.value)} /></label>
          <label className="connfield"><span>任务目标</span><textarea className="input" rows={4} value={goal} maxLength={60000} disabled={busy} onChange={e => setGoal(e.target.value)} /></label>
          <p className="meta">创建只保存任务；点击“启动执行”才会调用真实模型并消耗额度。当前服务绑定一个专用测试仓库。</p>
          <button className="btn btn--primary" disabled={busy || !!pending.current || !title.trim() || !goal.trim()} onClick={() => void send({ kind: 'create', key: crypto.randomUUID(), body: { title: title.trim(), goal: goal.trim(), acceptanceCriteria: ['完成上述目标，并说明实际执行结果'], agentInstanceId: 'codex-local' } })}>{busy ? '正在保存…' : '创建任务'}</button>
        </div>
      ) : (
        <>
          <h3>{detail?.task.title ?? '正在读取任务…'}</h3>
          <p>{detail ? TASK_STATUS_TEXT[detail.task.status] ?? detail.task.status : '加载中'} · {detail?.run ? `${RUN_STATUS_TEXT[detail.run.status] ?? detail.run.status}（${PHASE_TEXT[detail.run.phase] ?? detail.run.phase}）` : '尚未运行'}</p>
          {detail?.run?.model ? <p className="meta">模型：{detail.run.model}</p> : null}
          {detail?.run?.outcomeReason ? <p role="status">结果说明：{detail.run.outcomeReason}</p> : null}
          {startAllowed ? <button className="btn btn--primary" disabled={busy || !!pending.current} onClick={() => void send({ kind: 'start', taskId, key: crypto.randomUUID(), body: runInput(detail!) })}>{busy ? '正在提交…' : '启动执行（消耗额度）'}</button> : null}
          <button className="btn" disabled={busy} style={{ marginLeft: 8 }} onClick={() => { pending.current = null; setEpoch(n => n + 1); }}>重新读取状态与回复</button>
          {detail?.run?.status === 'needs_recovery' ? <p role="alert">本次结果未知，需要人工核查；不会自动重跑。</p> : null}
          {feedbackAllowed ? (
            <div className="connect__fields" style={{ marginTop: 20 }}>
              <label className="connfield"><span>继续这个任务：输入你的目标或修改要求</span><textarea className="input" rows={4} maxLength={60000} value={feedback} disabled={busy} placeholder="例如：请在专用测试仓库里创建 hello.txt，内容为你好，并说明修改结果。" onChange={e => setFeedback(e.target.value)} /></label>
              <p className="meta">沿用当前会话和测试仓库，保留历史；发送后调用模型并消耗额度。</p>
              <button className="btn btn--primary" disabled={busy || !!pending.current || !feedback.trim()} onClick={() => void send({ kind: 'start', taskId, key: crypto.randomUUID(), body: runInput(detail!, feedback) })}>{busy ? '正在提交…' : '发送并执行（消耗额度）'}</button>
            </div>
          ) : null}
          <div aria-live="polite" aria-atomic="false" style={{ marginTop: 20 }}>
            {transcript.rounds.map((round, index) => (
              <section key={round.id} style={{ borderTop: '1px solid var(--line)', paddingTop: 16, marginTop: 16 }}>
                <h3 style={{ fontSize: 14 }}>第 {index + 1} 轮 · {round.status ? RUN_STATUS_TEXT[round.status] ?? round.status : '等待状态'} <span className="meta">{new Date(round.startedAt).toLocaleString('zh-CN')}</span></h3>
                <div style={{ background: 'var(--fill-2)', borderRadius: 8, padding: 12, marginBottom: 12 }}>
                  <strong style={{ fontSize: 13 }}>你 · 本轮输入</strong>
                  <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', marginBottom: 0 }}>{inputs[round.id] === undefined ? '正在读取输入…' : inputs[round.id] === null ? '本轮输入暂不可用，请重新读取状态与回复。' : inputs[round.id]}</p>
                </div>
                {transcript.messages.filter(message => message.runId === round.id).map(message => (
                  <div key={message.id}><strong style={{ fontSize: 13 }}>智能体</strong><pre className="out" style={{ whiteSpace: 'pre-wrap', marginTop: 6, marginBottom: 12, maxHeight: 'none' }}>{message.text}</pre></div>
                ))}
                {!transcript.messages.some(message => message.runId === round.id) ? <p className="meta">{round.status === 'running' ? '正在等待回复…' : '本轮没有文本回复'}</p> : null}
              </section>
            ))}
            {!transcript.messages.length ? <p className="meta">{detail?.run?.status === 'running' ? '正在等待智能体回复…' : '暂无回复'}</p> : null}
          </div>
          {transcript.activity ? <p className="meta">最近活动：{transcript.activity}</p> : null}
          {transcript.diagnostics.map((text, i) => <p className="meta" key={i}>{text}</p>)}
        </>
      )}
      {error ? <div className="banner banner--warn mt-6" role="alert"><div>{error}</div>{pending.current ? <button className="btn" disabled={busy} onClick={() => pending.current && void send(pending.current)}>重试原请求</button> : null}</div> : null}
      <p className="meta" style={{ marginTop: 16 }}>执行完成后进入待审查，不等于已接受或已集成。离开页面不会中止执行；再次连接可读取历史回复。</p>
    </section>
  );
}

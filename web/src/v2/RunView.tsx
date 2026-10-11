import { useEffect, useRef, useState } from 'react';
import { TIMELINES, type Item, type Step } from './data.ts';
import { I, Spinner } from './icons.tsx';
import { Prose } from './bits.tsx';
import { useDraft } from './layout.tsx';
import type { DemoTask } from './backend/demo.ts';
import { DEMO_CAPS } from './backend/capability.tsx';

/* ─────────────────────────────────────────────────────────────
   执行视图
   能力边界（本批后端没有这些业务 API，界面不得展示为可执行）：
     - 运行中补充指令（steer）
     - 审批 / 提问
     - 恢复会话
     - 更换实例
   这些操作保留位置并说明原因，或者不出现；不给出可点的按钮。
   ───────────────────────────────────────────────────────────── */

const STEP_ICON = { read: 'read', search: 'search', cmd: 'terminal', edit: 'edit' } as const;

function summarize(steps: Step[]): string {
  const reads = steps.filter((s) => s.kind === 'read').length;
  const search = steps.filter((s) => s.kind === 'search').length;
  const cmds = steps.filter((s) => s.kind === 'cmd').length;
  const edits = steps.filter((s) => s.kind === 'edit').length;
  const parts: string[] = [];
  if (reads) parts.push(`读取了 ${reads} 个文件`);
  if (search) parts.push(`搜索 ${search} 次`);
  if (edits) parts.push(`修改了 ${edits} 处`);
  if (cmds) parts.push(`运行了 ${cmds} 条命令`);
  return parts.join('，');
}

function StepRow({ s }: { s: Step }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className={`step ${s.status === 'fail' ? 'step--fail' : ''}`}>
        <span style={{ color: s.status === 'fail' ? 'var(--bad)' : 'var(--text-3)' }}>
          {s.status === 'running' ? (
            <span style={{ color: 'var(--accent)' }}>
              <Spinner s={14} />
            </span>
          ) : (
            <I n={s.status === 'fail' ? 'x' : STEP_ICON[s.kind]} s={14} />
          )}
        </span>
        <span
          className={`step__label ${s.kind === 'cmd' || s.kind === 'read' || s.kind === 'edit' ? 'mono' : ''}`}
          title={s.label}
        >
          {s.label}
        </span>
        {s.meta ? <span className="step__meta">{s.meta}</span> : null}
        {s.output ? (
          <button className="step-btn" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? '收起输出' : '查看输出'}
          </button>
        ) : null}
      </div>
      {open && s.output ? (
        <div className="step-out">
          <pre className="out">{s.output}</pre>
        </div>
      ) : null}
    </>
  );
}

function Activity({ steps, defaultOpen }: { steps: Step[]; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const pinned = steps.filter((s) => s.status !== 'ok');
  const failed = steps.some((s) => s.status === 'fail');
  return (
    <div className="act">
      <button className="act__sum" aria-expanded={open} onClick={() => setOpen(!open)}>
        <I n="chevR" s={12} className="chev" />
        {summarize(steps)}
        {failed ? <span style={{ color: 'var(--bad)' }}>· 1 项失败</span> : null}
      </button>
      {open ? (
        <div className="act__list">
          {steps.map((s, i) => (
            <StepRow key={i} s={s} />
          ))}
        </div>
      ) : pinned.length ? (
        <div className="act__list act__pinned">
          {pinned.map((s, i) => (
            <StepRow key={i} s={s} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * 审批请求：本批后端没有审批 API（BACKEND-API-DRAFT 明确「本批不发布占位回答端点」）。
 * 演示数据里保留这个场景，但按钮不可执行，并说明原因。
 */
function ApprovalCard({
  item,
  resolved,
}: {
  item: Extract<Item, { k: 'approval' }>;
  resolved: 'accepted' | 'declined' | null;
}) {
  return (
    <div className="inline-card" id="pending-request">
      <div className="inline-card__head" style={{ alignItems: 'flex-start' }}>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span className="ask__label" style={{ color: 'var(--text-3)' }}>
            <I n="lock" s={14} />
            审批请求 · 本批不可执行
          </span>
          <span className="inline-card__title" style={{ display: 'block', marginTop: 4 }}>
            {item.title}
          </span>
          <p className="ask__reason">{item.reason}</p>
          <div className="ask__scope">
            <I n="info" s={14} className="meta" />
            <span>
              影响范围：{item.scope}
              本批后端没有审批 API，界面不能替模型做出决定；真实执行时默认拒绝未知请求。
            </span>
          </div>
        </span>
      </div>
      <ul className="flist" style={{ borderTop: '1px solid var(--line)' }}>
        {item.files.map((f) => (
          <li key={f.path}>
            <I n="file" s={13} className="meta" />
            <span className="p" title={f.path}>
              {f.path}
            </span>
            <span className="plus">+{f.add}</span>
            <span className="minus">−{f.del}</span>
          </li>
        ))}
      </ul>
      <div className="inline-card__foot">
        <span className="action-unavailable">
          <I n="lock" s={13} />
          允许 / 拒绝在本批不可用
        </span>
        {resolved ? (
          <span className="meta">（演示中曾选择：{resolved === 'accepted' ? '允许' : '拒绝'}）</span>
        ) : null}
      </div>
    </div>
  );
}

function ItemView({
  it,
  resolved,
  onOpenChanges,
}: {
  it: Item;
  resolved: 'accepted' | 'declined' | null;
  onOpenChanges: () => void;
}) {
  switch (it.k) {
    case 'turn':
      return <div className="turn-mark">{it.text}</div>;
    case 'user':
      return <div className="msg-user">{it.text}</div>;
    case 'agent':
      return (
        <div className="prose">
          {it.final ? (
            <div className="final-mark">
              <I n="check" s={13} />
              本轮结论
            </div>
          ) : null}
          <Prose text={it.text} />
        </div>
      );
    case 'activity':
      return <Activity steps={it.steps} />;
    case 'changes':
      return (
        <div className="inline-card">
          <div className="inline-card__head">
            <I n="diff" s={15} className="meta" />
            <span className="inline-card__title">修改了 {it.files.length} 个文件</span>
            <span className="plus">+{it.files.reduce((n, f) => n + f.add, 0)}</span>
            <span className="minus">−{it.files.reduce((n, f) => n + f.del, 0)}</span>
            <button className="btn btn--quiet btn--sm" onClick={onOpenChanges}>
              查看变更
            </button>
          </div>
          <ul className="flist" style={{ borderTop: '1px solid var(--line)' }}>
            {it.files.map((f) => (
              <li key={f.path}>
                <span className="p" title={f.path}>
                  {f.path}
                </span>
                <span className="plus">+{f.add}</span>
                <span className="minus">−{f.del}</span>
              </li>
            ))}
          </ul>
        </div>
      );
    case 'approval':
      return <ApprovalCard item={it} resolved={resolved} />;
    case 'failure':
      return (
        <div className="inline-card fail">
          <div className="inline-card__head">
            <I n="warn" s={15} />
            <span className="inline-card__title">{it.title}</span>
          </div>
          <div className="inline-card__body">
            <p className="fail__body">{it.body}</p>
            <div className="fail__kept">
              <I n="info" s={14} className="meta" />
              {it.preserved}
            </div>
          </div>
          <div className="inline-card__foot">
            <span className="action-unavailable" title="needs_recovery 状态禁止后续启动与接受；本批没有解除接口">
              <I n="lock" s={13} />
              需要人工恢复，本批没有恢复接口
            </span>
            <span className="action-unavailable" title="本批禁止在执行后更换实例">
              <I n="lock" s={13} />
              更换实例不可用
            </span>
            <button className="btn btn--quiet btn--sm" onClick={onOpenChanges}>
              查看已保留的改动
            </button>
          </div>
        </div>
      );
    case 'note':
      return <p className="meta">{it.text}</p>;
  }
}

/** 后端 RunStatus → 界面用的执行阶段 */
function phaseOf(task: DemoTask): 'running' | 'waiting' | 'failed' | 'aborted' | 'done' | 'draft' {
  const r = task.runs.at(-1);
  if (!r) return task.status === 'draft' ? 'draft' : 'done';
  if (r.status === 'running') return 'running';
  if (r.status === 'failed') return 'failed';
  if (r.status === 'aborted') return 'aborted';
  if (r.status === 'needs_recovery') return 'failed';
  return 'done';
}

export function RunView({
  task,
  resolved,
  onOpenChanges,
}: {
  task: DemoTask;
  resolved: 'accepted' | 'declined' | null;
  onResolve: (d: 'accepted' | 'declined') => void;
  onOpenChanges: () => void;
}) {
  const items = TIMELINES[task.id] ?? [];
  const [draft, setDraft] = useDraft(task.id);
  const [sent, setSent] = useState<string[]>([]);
  const scroller = useRef<HTMLDivElement>(null);
  const [away, setAway] = useState(false);

  const phase = phaseOf(task);
  const running = phase === 'running';
  const failed = phase === 'failed';
  const done = phase === 'done';

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
    setSent([]);
  }, [task.id]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const on = () => setAway(el.scrollHeight - el.scrollTop - el.clientHeight > 240);
    el.addEventListener('scroll', on);
    return () => el.removeEventListener('scroll', on);
  }, []);

  const send = () => {
    if (!draft.trim() || running) return;
    setSent((s) => [...s, draft.trim()]);
    setDraft('');
    requestAnimationFrame(() => {
      const el = scroller.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  };

  /* 运行中：后端没有 steer 能力，且活动运行期间不接受新指令 */
  const steerOff = !DEMO_CAPS.steer;
  const canSend = !running && draft.trim().length > 0;
  const verb = running ? '发送' : failed ? '反馈并重试' : done ? '要求修改' : '发送';

  const placeholder = running
    ? '本轮正在执行。本批后端没有运行中补充指令能力，需要等这一轮结束后再提交'
    : failed
      ? '说明下一步，例如：跳过回滚测试，先补齐 down 实现'
      : done
        ? '对结果有意见？在这里说明需要修改的地方；提交后会产生新运行，旧的接受记录随之失效'
        : '描述你希望智能体做什么';

  return (
    <>
      <div className="scroll" ref={scroller}>
        <div className="convo">
          {items.map((it, i) => (
            <ItemView key={i} it={it} resolved={resolved} onOpenChanges={onOpenChanges} />
          ))}
          {sent.map((s, i) => (
            <div key={i}>
              <div className="msg-user">{s}</div>
              <div className="sent-state">
                演示：未发送到真实引擎。真实模式下会以 Idempotency-Key 提交到
                <span className="mono"> POST /tasks/{task.id}/runs</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {away ? (
        <button
          className="newmsg"
          onClick={() => {
            const el = scroller.current;
            if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
          }}
        >
          <I n="arrowUp" s={13} />
          回到最新
        </button>
      ) : null}

      <div className="dock">
        <div className="dock__inner">
          {running ? (
            <div className="live">
              <span style={{ color: 'var(--accent)' }}>
                <Spinner s={14} />
              </span>
              <span className="live__text">
                {task.liveNow ? (
                  <>
                    正在运行 <span className="mono">npm test -- --run</span>
                    {task.liveElapsed ? <> · 已运行 {task.liveElapsed}</> : null}
                  </>
                ) : (
                  '执行中'
                )}
              </span>
              <span className="meta" title="关闭页面不会取消这次执行">
                离开页面不影响执行
              </span>
              <button
                className="btn btn--sm"
                title="请求中止当前这一轮。202 只表示请求已记录，收到真实终态前不显示为已中止；已写入的文件不会回滚。"
              >
                <I n="stop" s={12} />
                中止
              </button>
            </div>
          ) : steerOff && failed ? (
            <div className="live" style={{ color: 'var(--warn)' }}>
              <I n="lock" s={14} />
              <span className="live__text">
                本轮已结束，可以提交反馈产生新运行；恢复原会话不在本批范围
              </span>
            </div>
          ) : null}

          <div className="composer">
            <textarea
              rows={1}
              value={draft}
              placeholder={placeholder}
              disabled={running}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send();
                }
              }}
              aria-label={verb}
            />
            <div className="composer__bar">
              <button className="icon-btn icon-btn--sm" aria-label="附加文件或上下文" title="附加文件或上下文">
                <I n="plus" s={15} />
              </button>
              <span className="composer__hint">
                {running
                  ? '执行中不能提交新指令（本批无运行中补充能力）'
                  : 'Enter 发送 · Shift+Enter 换行 · 草稿自动保存'}
              </span>
              <span style={{ flex: 1 }} />
              <button className="send" disabled={!canSend} onClick={send}>
                {verb}
                <I n="arrowUp" s={14} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

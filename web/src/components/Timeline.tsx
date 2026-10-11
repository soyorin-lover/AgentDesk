import { useState } from 'react';
import type { ApprovalEvent, QuestionEvent, TimelineEvent } from '../domain/types.ts';
import { AgentMessage, UserMessage } from './Message.tsx';
import { Icon, type IconName } from './Icons.tsx';
import { Btn, Fold, TimeText } from './primitives.tsx';
import { CommandBlock } from './CommandBlock.tsx';
import { FileChangeBlock } from './FileChangeBlock.tsx';
import { duration } from '../lib/format.ts';
import { APPROVAL_LABEL } from '../domain/status.ts';
import type { Dispatch } from 'react';
import type { Action } from '../state/store.ts';

/* ─────────────────────────────────────────────────────────────
   时间线
   目标：消息、命令、文件变更、提问、审批在视觉上互不混淆。
   做法：不同类型用不同的左侧图标 + 不同的内容容器；
   技术细节（原始输出、cwd、退出码）一律折叠。
   ───────────────────────────────────────────────────────────── */

interface EvProps {
  event: TimelineEvent;
  now: number;
  dispatch: Dispatch<Action>;
  taskId: string;
  /** 该事件是否已不再等待用户 */
  interactive: boolean;
}

const GUTTER: Record<TimelineEvent['kind'], { icon: IconName; cls: string }> = {
  userMessage: { icon: 'user', cls: 'ev__gutter--user' },
  agentMessage: { icon: 'sparkle', cls: 'ev__gutter--active' },
  reasoning: { icon: 'cpu', cls: '' },
  command: { icon: 'terminal', cls: '' },
  fileChange: { icon: 'diff', cls: 'ev__gutter--ok' },
  plan: { icon: 'layers', cls: '' },
  question: { icon: 'question', cls: 'ev__gutter--wait' },
  approval: { icon: 'shield', cls: 'ev__gutter--wait' },
  error: { icon: 'x', cls: 'ev__gutter--bad' },
  warning: { icon: 'warn', cls: 'ev__gutter--wait' },
  interrupted: { icon: 'stop', cls: 'ev__gutter--bad' },
  info: { icon: 'info', cls: '' },
};

const LABEL: Record<TimelineEvent['kind'], string> = {
  userMessage: '你的指令',
  agentMessage: 'Codex',
  reasoning: '思考摘要',
  command: '执行命令',
  fileChange: '文件变更',
  plan: '执行计划',
  question: '向你提问',
  approval: '请求审批',
  error: '本轮错误',
  warning: '提示',
  interrupted: '已中止',
  info: '状态',
};

export function Timeline({
  events,
  now,
  dispatch,
  taskId,
  canInteract,
}: {
  events: TimelineEvent[];
  now: number;
  dispatch: Dispatch<Action>;
  taskId: string;
  canInteract: boolean;
}) {
  return (
    <div className="timeline">
      {events.map((e) => (
        <EventRow
          key={e.id}
          event={e}
          now={now}
          dispatch={dispatch}
          taskId={taskId}
          interactive={canInteract}
        />
      ))}
    </div>
  );
}

function EventRow({ event, now, dispatch, taskId, interactive }: EvProps) {
  const g = GUTTER[event.kind];
  return (
    <article className="ev" data-kind={event.kind}>
      <span className={`ev__gutter ${g.cls}`} aria-hidden>
        <Icon name={g.icon} size={11} />
      </span>
      <div className="ev__body">
        <div className="ev__meta">
          <span className="ev__label">{LABEL[event.kind]}</span>
          <TimeText ms={event.atMs} now={now} />
          {event.pending ? (
            <span className="row gap-2" style={{ color: 'var(--st-active)' }}>
              <span className="pulse" />
              进行中
            </span>
          ) : null}
        </div>
        <EventBody
          event={event}
          dispatch={dispatch}
          taskId={taskId}
          interactive={interactive}
        />
      </div>
    </article>
  );
}

function EventBody({
  event,
  dispatch,
  taskId,
  interactive,
}: {
  event: TimelineEvent;
  dispatch: Dispatch<Action>;
  taskId: string;
  interactive: boolean;
}) {
  switch (event.kind) {
    case 'userMessage':
      return <UserMessage text={event.text} isSteer={event.isSteer} />;

    case 'agentMessage':
      return <AgentMessage text={event.text} phase={event.phase} pending={event.pending} />;

    case 'reasoning':
      return (
        <Fold
          icon="cpu"
          title="查看思考摘要"
          meta={`${event.summary.length} 条`}
        >
          <div className="col gap-5">
            <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-secondary)', lineHeight: 'var(--lh-body)' }}>
              {event.summary.map((s, i) => (
                <li key={i} style={{ marginBottom: 4 }}>
                  {s}
                </li>
              ))}
            </ul>
            {event.text ? (
              <div>
                <div className="fs-xs dim mb-3">补充说明</div>
                <div className="sec" style={{ whiteSpace: 'pre-wrap', lineHeight: 'var(--lh-body)' }}>
                  {event.text}
                </div>
              </div>
            ) : null}
          </div>
        </Fold>
      );

    case 'command':
      return <CommandBlock event={event} />;

    case 'fileChange':
      return <FileChangeBlock event={event} />;

    case 'plan':
      return (
        <div
          className="card card--raised"
          style={{ padding: 'var(--sp-5) var(--sp-6)' }}
        >
          <div className="fs-xs dim mb-3">本轮计划</div>
          <div className="sec" style={{ whiteSpace: 'pre-wrap', lineHeight: 'var(--lh-body)' }}>
            {event.text}
          </div>
        </div>
      );

    case 'question':
      return (
        <QuestionCard
          event={event}
          taskId={taskId}
          dispatch={dispatch}
          interactive={interactive}
        />
      );

    case 'approval':
      return (
        <ApprovalCard
          event={event}
          taskId={taskId}
          dispatch={dispatch}
          interactive={interactive}
        />
      );

    case 'error':
      return (
        <div className="col gap-4">
          <div className="banner banner--bad">
            <span className="banner__ico">
              <Icon name="x" size={14} />
            </span>
            <div className="banner__body">
              <div className="banner__title">
                {event.willRetry ? '本轮出错，服务端将重试' : '本轮以错误结束'}
              </div>
              <div className="sec">{event.message}</div>
            </div>
          </div>
          {event.detail ? (
            <Fold icon="file" title="错误详情">
              <pre className="term">{event.detail}</pre>
            </Fold>
          ) : null}
        </div>
      );

    case 'warning':
      return (
        <div className="banner banner--warn" style={{ padding: 'var(--sp-4) var(--sp-5)' }}>
          <span className="banner__ico">
            <Icon name="warn" size={13} />
          </span>
          <div className="banner__body">{event.message}</div>
        </div>
      );

    case 'interrupted':
      return (
        <div className="col gap-4">
          <div className="banner banner--warn">
            <span className="banner__ico">
              <Icon name="stop" size={13} />
            </span>
            <div className="banner__body">
              <div className="banner__title">本轮已中止</div>
              <div className="sec">{event.reason}</div>
            </div>
          </div>
          {event.changesPreserved ? (
            <div className="banner">
              <span className="banner__ico">
                <Icon name="info" size={13} />
              </span>
              <div className="banner__body">
                中止不会回滚已经写入工作区的改动。这些改动仍然在变更视图里，
                可以继续查看、接受或要求修改。
              </div>
            </div>
          ) : null}
        </div>
      );

    case 'info':
      return (
        <div className="row gap-3 fs-sm sec">
          <Icon name="info" size={12} />
          <span>{event.text}</span>
        </div>
      );

    default:
      return null;
  }
}

/* ── 提问卡片 ─────────────────────────────────────────────── */

function QuestionCard({
  event,
  taskId,
  dispatch,
  interactive,
}: {
  event: QuestionEvent;
  taskId: string;
  dispatch: Dispatch<Action>;
  interactive: boolean;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const resolved = event.resolution !== null;
  const pending = !resolved && interactive;

  const submit = () => {
    const answers: Record<string, string[]> = {};
    for (const q of event.questions) {
      const v = (draft[q.id] ?? '').trim();
      answers[q.id] = v ? [v] : [];
    }
    dispatch({ type: 'answerQuestion', taskId, eventId: event.id, answers });
  };

  const canSubmit = event.questions.every((q) => (draft[q.id] ?? '').trim().length > 0);

  return (
    <div className={`attention attention--input`}>
      <div className="attention__head">
        <div className="attention__kind" style={{ color: 'var(--st-wait)' }}>
          需要回答 · {event.header}
        </div>

        {event.questions.map((q) => (
          <div key={q.id} className="col gap-4 mt-3">
            <div className="attention__q">{q.question}</div>

            {resolved ? (
              <div className="row gap-3">
                <ChipResolved>
                  {event.resolution?.answers[q.id]?.join('、') || '（未作答）'}
                </ChipResolved>
              </div>
            ) : pending ? (
              <div className="col gap-3">
                {q.options.map((o) => (
                  <button
                    key={o.label}
                    type="button"
                    className="option"
                    aria-pressed={draft[q.id] === o.label}
                    onClick={() => setDraft((d) => ({ ...d, [q.id]: o.label }))}
                  >
                    <span
                      aria-hidden
                      style={{
                        width: 13,
                        height: 13,
                        borderRadius: 999,
                        border: '1.5px solid var(--border-strong)',
                        marginTop: 3,
                        flex: 'none',
                        background:
                          draft[q.id] === o.label ? 'var(--accent)' : 'transparent',
                        borderColor:
                          draft[q.id] === o.label ? 'var(--accent)' : 'var(--border-strong)',
                      }}
                    />
                    <span style={{ minWidth: 0 }}>
                      <div className="option__label">{o.label}</div>
                      <div className="option__desc">{o.description}</div>
                    </span>
                  </button>
                ))}

                {q.allowOther ? (
                  <input
                    className="input"
                    placeholder="或直接输入你的答案…"
                    value={
                      q.options.some((o) => o.label === draft[q.id])
                        ? ''
                        : (draft[q.id] ?? '')
                    }
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, [q.id]: e.target.value }))
                    }
                    aria-label={`${q.header} 的自由输入`}
                  />
                ) : null}
              </div>
            ) : (
              <div className="fs-sm dim">本轮已不在等待回答。</div>
            )}
          </div>
        ))}
      </div>

      <div className="attention__foot">
        {resolved ? (
          <span className="fs-sm sec">
            <Icon name="check" size={12} /> 已回答（{event.resolution!.via === 'user' ? '由你回答' : '超时自动'}）
          </span>
        ) : pending ? (
          <>
            <Btn onClick={submit} variant="primary" disabled={!canSubmit} icon="arrowRight">
              提交回答并继续
            </Btn>
            <span className="fs-xs dim">
              回答后本轮继续执行。执行成功仍不代表验收通过。
            </span>
          </>
        ) : (
          <span className="fs-sm dim">
            这是一条历史提问，当前任务已不在等待回答。
          </span>
        )}
      </div>
    </div>
  );
}

/* ── 审批卡片 ─────────────────────────────────────────────── */

function ApprovalCard({
  event,
  taskId,
  dispatch,
  interactive,
}: {
  event: ApprovalEvent;
  taskId: string;
  dispatch: Dispatch<Action>;
  interactive: boolean;
}) {
  const [scopeHint] = useState(false);
  const pending = event.state.kind === 'pending' && interactive;
  const terse = event.sessionScopeHint !== null;

  return (
    <div className="attention attention--approval">
      <div className="attention__head">
        <div className="attention__kind" style={{ color: 'var(--st-active)' }}>
          需要审批 · {kindLabel(event.category)}
        </div>
        <div className="attention__q">{event.title}</div>

        {/* 待批准的具体内容：命令原文或文件列表，这是决定的依据 */}
        {event.detail.command ? (
          <div className="card" style={{ padding: 'var(--sp-4) var(--sp-5)' }}>
            <div className="cmdline">
              <span className="cmdline__prompt">$</span>
              <span className="grow">{event.detail.command}</span>
            </div>
            {event.detail.cwd ? (
              <div className="fs-xs dim mt-3 mono" title={event.detail.cwd}>
                cwd: {event.detail.cwd}
              </div>
            ) : null}
          </div>
        ) : null}

        {event.detail.files && event.detail.files.length > 0 ? (
          <div className="card" style={{ padding: 'var(--sp-4) var(--sp-5)' }}>
            <div className="col gap-2">
              {event.detail.files.map((f) => (
                <div key={f.path} className="row gap-3 fs-sm">
                  <Icon name="file" size={11} />
                  <span className="mono truncate grow" title={f.path}>
                    {f.path}
                  </span>
                  <span className="stat stat--add">+{f.additions}</span>
                  <span className="stat stat--del">−{f.deletions}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {event.reason ? (
          <div className="fs-sm sec" style={{ lineHeight: 'var(--lh-body)' }}>
            <span className="dim">模型给出的理由：</span>
            {event.reason}
          </div>
        ) : null}
      </div>

      <div className="attention__foot">
        {pending ? (
          <>
            <Btn
              variant="ok"
              icon="check"
              onClick={() =>
                dispatch({
                  type: 'resolveApproval',
                  taskId,
                  eventId: event.id,
                  decision: 'accept',
                })
              }
            >
              仅批准本次
            </Btn>

            <Btn
              variant={scopeHint ? 'danger' : 'default'}
              icon="shield"
              title={
                terse
                  ? event.sessionScopeHint ?? ''
                  : '本会话内同类操作不再询问'
              }
              onClick={() =>
                dispatch({
                  type: 'resolveApproval',
                  taskId,
                  eventId: event.id,
                  decision: 'acceptForSession',
                })
              }
            >
              批准，本次会话内不再询问
              {terse ? <Icon name="warn" size={11} /> : null}
            </Btn>

            <Btn
              icon="x"
              onClick={() =>
                dispatch({
                  type: 'resolveApproval',
                  taskId,
                  eventId: event.id,
                  decision: 'decline',
                })
              }
            >
              拒绝，本轮继续
            </Btn>

            <Btn
              variant="danger"
              icon="stop"
              onClick={() =>
                dispatch({
                  type: 'resolveApproval',
                  taskId,
                  eventId: event.id,
                  decision: 'cancel',
                })
              }
            >
              拒绝并中止本轮
            </Btn>
          </>
        ) : (
          <span className="fs-sm sec">
            <Icon
              name={
                event.state.kind === 'declined' || event.state.kind === 'cancelled'
                  ? 'x'
                  : 'check'
              }
              size={12}
            />{' '}
            {APPROVAL_LABEL[event.state.kind]}
          </span>
        )}
      </div>

      {/* 会话级授权的代价必须写在界面上，不能只放在 tooltip */}
      {pending && terse ? (
        <div
          className="fs-xs"
          style={{
            padding: 'var(--sp-4) var(--sp-6)',
            borderTop: '1px solid var(--border-subtle)',
            background: 'var(--bg-inset)',
            color: 'var(--text-secondary)',
            lineHeight: 'var(--lh-body)',
          }}
        >
          <Icon name="warn" size={11} /> 会话级授权的范围比「仅本次」更大：
          {event.sessionScopeHint}
        </div>
      ) : null}
    </div>
  );
}

function ChipResolved({ children }: { children: React.ReactNode }) {
  return (
    <span className="chip chip--ok chip--dot" style={{ height: 22 }}>
      {children}
    </span>
  );
}

function kindLabel(c: ApprovalEvent['category']): string {
  switch (c) {
    case 'commandExecution':
      return '执行命令';
    case 'fileChange':
      return '写入文件';
    case 'permissions':
      return '授予额外权限';
  }
}

/* ── 轮次分隔 ─────────────────────────────────────────────── */

export function TurnDivider({
  index,
  model,
  baseCommit,
  atMs,
  now,
  extra,
}: {
  index: number;
  model: string;
  baseCommit: string;
  atMs: number;
  now: number;
  extra?: React.ReactNode;
}) {
  return (
    <div className="turn-divider">
      <span className="turn-divider__label">
        第 {index} 次运行
        <span className="dim">·</span>
        {model}
        <span className="dim">·</span>
        <span title="本轮起点提交">base {baseCommit}</span>
        <span className="dim">·</span>
        <TimeText ms={atMs} now={now} />
        {extra}
      </span>
    </div>
  );
}

export { Fold, duration };

import { Icon } from './Icons.tsx';

/* ─────────────────────────────────────────────────────────────
   消息渲染
   不做 Markdown 富文本（首版不引入解析器）；保留段落与换行，
   数字列表与代码片段用等宽样式区分，够读且不会误渲染。
   ───────────────────────────────────────────────────────────── */

function isCodeLine(line: string): boolean {
  return /^\s{4,}|^\s*(npm|git|node|pnpm|yarn|cd|curl)\s/.test(line);
}

export function UserMessage({ text, isSteer }: { text: string; isSteer: boolean }) {
  return (
    <div className="col gap-3">
      <div className="msg-user">{text}</div>
      {isSteer ? (
        <div className="fs-xs" style={{ color: 'var(--st-wait)' }}>
          <Icon name="arrowRight" size={11} /> 这属于同一次运行的补充指令，不是新的运行
        </div>
      ) : null}
    </div>
  );
}

export function AgentMessage({
  text,
  phase,
  pending,
}: {
  text: string;
  phase: 'commentary' | 'final_answer';
  pending?: boolean;
}) {
  const paragraphs = text.split(/\n{2,}/);

  return (
    <div className="col gap-5">
      {phase === 'final_answer' ? (
        <div className="fs-xs" style={{ color: 'var(--st-ok)' }}>
          <Icon name="check" size={11} /> 本轮结论
        </div>
      ) : null}

      <div className="msg-agent">
        {paragraphs.map((p, i) => {
          const lines = p.split('\n');
          const allCode = lines.every((l) => isCodeLine(l) || l.trim() === '');
          if (allCode && p.trim()) {
            return (
              <pre key={i} className="term" style={{ marginBottom: 12 }}>
                {p}
              </pre>
            );
          }
          return (
            <p key={i} style={{ margin: '0 0 10px' }}>
              {lines.map((l, j) => (
                <span key={j}>
                  {l}
                  {j < lines.length - 1 ? <br /> : null}
                </span>
              ))}
            </p>
          );
        })}
        {pending ? <span className="msg-agent__caret" aria-label="正在输出" /> : null}
      </div>
    </div>
  );
}

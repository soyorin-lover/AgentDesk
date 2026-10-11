import { useEffect, useMemo, useRef, useState, type Dispatch } from 'react';
import type { Action } from '../state/store.ts';
import { Btn, Field } from './primitives.tsx';
import { Icon } from './Icons.tsx';

/* ─────────────────────────────────────────────────────────────
   创建任务对话框
   只收三样东西：标题、目标、验收条件。
   验收条件是一条一条加的 —— 因为「一条可判定的标准」和
   「一段描述」在实现上会走向完全不同的地方。
   ───────────────────────────────────────────────────────────── */

const REPO_DEFAULT = 'E:\\Projects\\fin-sync';

export function CreateTaskDialog({
  open,
  dispatch,
  onClose,
}: {
  open: boolean;
  dispatch: Dispatch<Action>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const [goal, setGoal] = useState('');
  const [criteria, setCriteria] = useState<string[]>(['']);
  const [repoPath, setRepoPath] = useState(REPO_DEFAULT);
  const [baseBranch, setBaseBranch] = useState('main');
  const [touched, setTouched] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      // 打开时聚焦标题，键盘用户可直接开始输入
      const t = window.setTimeout(() => titleRef.current?.focus(), 0);
      return () => window.clearTimeout(t);
    }
    // 关闭时重置，避免下次带入上次内容
    setTitle('');
    setGoal('');
    setCriteria(['']);
    setTouched(false);
    return undefined;
  }, [open]);

  /* Esc 关闭 + 焦点不逃出对话框 */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const el = dialogRef.current;
      if (!el) return;
      const focusables = el.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select, [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const cleanCriteria = useMemo(
    () => criteria.map((c) => c.trim()).filter(Boolean),
    [criteria],
  );

  const missing = useMemo(() => {
    const m: string[] = [];
    if (!title.trim()) m.push('标题');
    if (!goal.trim()) m.push('目标');
    if (cleanCriteria.length === 0) m.push('至少一条验收条件');
    return m;
  }, [title, goal, cleanCriteria]);

  const willBeDraft = missing.length > 0;

  if (!open) return null;

  const submit = (startImmediately: boolean) => {
    setTouched(true);
    if (willBeDraft && startImmediately) return;
    dispatch({
      type: 'createTask',
      title,
      goal,
      acceptance: cleanCriteria,
      startImmediately,
      repoPath: repoPath.trim() || REPO_DEFAULT,
      baseBranch: baseBranch.trim() || 'main',
    });
  };

  return (
    <div
      className="overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-task-title"
        ref={dialogRef}
      >
        <header className="modal__head">
          <h2 className="modal__title" id="create-task-title">
            创建任务
          </h2>
          <span className="chip chip--demo">演示模式</span>
          <Btn size="sm" variant="ghost" icon="x" onClick={onClose} ariaLabel="关闭" />
        </header>

        <div className="modal__body">
          <Field
            label="标题"
            htmlFor="ct-title"
            required
            hint="一句话说清这次要做什么。以后在列表里靠它辨认。"
            error={touched && !title.trim() ? '标题不能为空' : null}
          >
            <input
              id="ct-title"
              ref={titleRef}
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如：增量同步的边界处理"
            />
          </Field>

          <Field
            label="目标"
            htmlFor="ct-goal"
            required
            hint="说明为什么要做这件事、期望达到什么效果。不是实现步骤。"
            error={touched && !goal.trim() ? '目标不能为空' : null}
          >
            <textarea
              id="ct-goal"
              className="textarea"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="例如：让 syncLoop 在服务端返回顺序异常时不会漏数据，且不再随账单总量线性变慢。"
              rows={3}
            />
          </Field>

          <Field
            label="验收条件"
            required
            hint="每条都应是可判定的。写「代码更清晰」没法验收；写「第二次同步只拉取变更条目」可以。"
            error={touched && cleanCriteria.length === 0 ? '至少需要一条验收条件' : null}
          >
            <div className="col gap-3">
              {criteria.map((c, i) => (
                <div key={i} className="row gap-3">
                  <span
                    className="mono dim fs-xs nowrap"
                    style={{ width: 18, textAlign: 'right', lineHeight: '30px' }}
                  >
                    {i + 1}.
                  </span>
                  <input
                    className="input"
                    value={c}
                    onChange={(e) =>
                      setCriteria((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))
                    }
                    placeholder={
                      i === 0
                        ? '例如：第二次同步的拉取条目数只与新增/变更相关'
                        : '再加一条可判定的标准…'
                    }
                    onKeyDown={(e) => {
                      // Enter 在最后一行时新增一行，方便连续录入
                      if (e.key === 'Enter' && i === criteria.length - 1) {
                        e.preventDefault();
                        setCriteria((prev) => [...prev, '']);
                      }
                    }}
                    aria-label={`验收条件 ${i + 1}`}
                  />
                  <Btn
                    size="sm"
                    variant="ghost"
                    icon="x"
                    disabled={criteria.length === 1}
                    onClick={() => setCriteria((prev) => prev.filter((_, j) => j !== i))}
                    ariaLabel={`删除验收条件 ${i + 1}`}
                    title={criteria.length === 1 ? '至少保留一行' : '删除这条'}
                  />
                </div>
              ))}
              <div>
                <Btn
                  size="sm"
                  icon="plus"
                  onClick={() => setCriteria((prev) => [...prev, ''])}
                >
                  添加一条
                </Btn>
              </div>
            </div>
          </Field>

          {/* 仓库与基准分支：本批只支持已有仓库 */}
          <div className="row gap-5 row--wrap" style={{ alignItems: 'flex-start' }}>
            <div className="grow" style={{ minWidth: 240 }}>
              <Field
                label="Git 仓库"
                htmlFor="ct-repo"
                hint="必须是本机已有的仓库路径。本批不提供新建仓库与克隆。"
              >
                <input
                  id="ct-repo"
                  className="input input--mono"
                  value={repoPath}
                  onChange={(e) => setRepoPath(e.target.value)}
                />
              </Field>
            </div>
            <div style={{ width: 160 }}>
              <Field label="基准分支" htmlFor="ct-branch" hint="改动与集成都基于它。">
                <input
                  id="ct-branch"
                  className="input input--mono"
                  value={baseBranch}
                  onChange={(e) => setBaseBranch(e.target.value)}
                />
              </Field>
            </div>
          </div>

          {/* 草稿提示：不阻止保存，但要说明后果 */}
          {willBeDraft ? (
            <div className="banner banner--warn">
              <span className="banner__ico">
                <Icon name="warn" size={13} />
              </span>
              <div className="banner__body">
                <div className="banner__title">还缺：{missing.join('、')}</div>
                <div className="sec">
                  可以存为草稿，但草稿无法启动运行 —— 没有目标和验收条件时，
                  「做完了」没有判据。补齐后会自动变为「就绪」。
                </div>
              </div>
            </div>
          ) : (
            <div className="banner">
              <span className="banner__ico">
                <Icon name="info" size={13} />
              </span>
              <div className="banner__body">
                创建后会为这次任务建立一个独立的 Git worktree 与分支，
                在隔离工作区里执行 —— 不会直接改你的当前工作区。
              </div>
            </div>
          )}
        </div>

        <footer className="modal__foot">
          {willBeDraft ? (
            <Btn icon="file" onClick={() => submit(false)}>
              存为草稿
            </Btn>
          ) : (
            <>
              <Btn icon="file" onClick={() => submit(false)}>
                创建任务
              </Btn>
              <Btn variant="primary" icon="play" onClick={() => submit(true)}>
                创建并启动运行
              </Btn>
            </>
          )}
          <span className="modal__foot-spacer" />
          <span className="fs-xs dim">Esc 关闭</span>
        </footer>
      </div>
    </div>
  );
}

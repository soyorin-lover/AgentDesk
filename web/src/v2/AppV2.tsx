import { useEffect, useMemo, useState } from 'react';
import { AGENTS, engineById } from './data.ts';
import { I, EngineMark } from './icons.tsx';
import { Sidebar } from './Sidebar.tsx';
import { Agents, Inbox, Overview, TaskList } from './pages.tsx';
import { InteractionPreview } from './InteractionPreview.tsx';
import { ConnectionPage } from './ConnectionPage.tsx';
import { RunView } from './RunView.tsx';
import { AuxPanel, Checks } from './Panels.tsx';
import { Resizer, href, useLayout, useRoute, useWindowWidth, type AuxTab, type Mode } from './layout.tsx';
import { Status } from './bits.tsx';
import { useAppState } from './backend/store.ts';
import { Dialog } from './backend/Dialog.tsx';
import { ReviewDiff, ReviewFileList, type DiffPrefs } from './backend/Review.tsx';
import type { InvalidationReason } from './backend/types.ts';
import { INVALID_REASON_TEXT } from './backend/capability.tsx';
import { statusInputOf, type DemoTask } from './backend/demo.ts';

/* ─────────────────────────────────────────────────────────────
   空间分配：从可用宽度往下推，绝不写回用户偏好
   主区最小宽度 → 辅助面板 → 文件列表 → 侧栏
   任何一步放不下就降级最后一项，窗口变宽后自动恢复。
   ───────────────────────────────────────────────────────────── */

const MAIN_MIN: Record<Mode, number> = { page: 520, run: 560, review: 620 };
const RAIL_W = 56;
const GUTTER = 8;
/** 低于此宽度：并排 diff 不再够用，渲染时降级为统一视图 */
const SPLIT_MIN_CODE_W = 620;
/** 低于此宽度：文件列表改为浮层 */
const FILES_OVERLAY_BELOW = 1180;

export function AppV2() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => { const on = () => setHash(window.location.hash); window.addEventListener("hashchange",on); return () => window.removeEventListener("hashchange",on); },[]);
  if (hash.startsWith("#/preview")) return <InteractionPreview/>;
  if (hash.startsWith("#/demo")) return <><div className="demo-mode-bar"><a href="#/">← 返回真实项目首页</a><span>独立示例 · 内存数据 · 不连接模型</span></div><DemoAppV2/></>;
  return <ConnectionPage/>;
}

function DemoAppV2() {
  const route = useRoute();
  const [layout, update] = useLayout();
  const win = useWindowWidth();
  const app = useAppState();

  const [resolved, setResolved] = useState<Map<string, 'accepted' | 'declined'>>(new Map());
  const [dialog, setDialog] = useState<null | 'accept'>(null);
  const [reviewFileId, setReviewFileId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const mode: Mode = route.page === 'task' ? route.view : 'page';
  const task = route.page === 'task' ? app.tasks.find((t) => t.id === route.id) ?? app.tasks[0] : null;

  /* ── 布局推导 ── */
  const wantRail = layout.nav[mode] === 'rail';
  const auxKey = mode === 'review' ? 'review' : 'run';
  const aux = layout.aux[auxKey];
  const auxOpen = mode !== 'page' && aux.open;

  const availWith = (navW: number, filesW: number) => win - navW - filesW - GUTTER;

  /* 文件列表：宽度不足自动转浮层（渲染降级，不改 layout.files.open） */
  const filesWantOpen = mode === 'review' && layout.files.open;
  const filesOverlay = filesWantOpen && win < FILES_OVERLAY_BELOW;
  const filesInlineW = filesWantOpen && !filesOverlay ? layout.files.w + 1 : 0;

  let navRail = wantRail;
  if (!navRail && availWith(layout.navW, filesInlineW) < MAIN_MIN[mode]) navRail = true;
  const navW = navRail ? RAIL_W : layout.navW;

  const auxOverlay =
    auxOpen && availWith(navW, filesInlineW) < MAIN_MIN[mode] + aux.w + GUTTER;
  const autoRail = navRail && !wantRail;

  /* diff：代码宽度不够时渲染降级为统一视图，用户偏好保持 'split' */
  const codeW = availWith(navW, filesInlineW) - (auxOpen && !auxOverlay ? aux.w + GUTTER : 0);
  const diffAutoUnified = layout.diff === 'split' && codeW < SPLIT_MIN_CODE_W;
  const diffPrefs: DiffPrefs = {
    mode: diffAutoUnified ? 'unified' : layout.diff,
    wrap: layout.diffWrap,
  };
  const setDiffPrefs = (p: Partial<DiffPrefs>) =>
    update((l) => {
      if (p.mode) l.diff = p.mode;
      if (p.wrap !== undefined) l.diffWrap = p.wrap;
    });

  /* 文件列表：切换任务时回到第一个文件 */
  const files = task?.snapshot?.files ?? [];
  const reviewFile = files.find((f) => f.id === reviewFileId) ?? files[0] ?? null;
  useEffect(() => {
    setReviewFileId(null);
  }, [task?.id]);

  const step = (d: 1 | -1) => {
    if (!files.length || !reviewFile) return;
    const i = files.findIndex((f) => f.id === reviewFile.id);
    setReviewFileId(files[(i + d + files.length) % files.length].id);
  };

  /* ── 快捷键 ── */
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const el = e.target instanceof Element ? e.target : document.activeElement;
      const typing = Boolean(el?.closest('input, textarea, [contenteditable="true"]'));
      if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
        e.preventDefault();
        update((l) => {
          l.nav[mode] = navRail ? 'full' : 'rail';
        });
      } else if ((e.ctrlKey || e.metaKey) && e.key === '.') {
        if (mode === 'page') return;
        e.preventDefault();
        update((l) => {
          l.aux[auxKey].open = !l.aux[auxKey].open;
        });
      } else if (
        e.key === 'Escape' &&
        !document.querySelector('.dialog') &&
        auxOverlay &&
        auxOpen
      ) {
        update((l) => {
          l.aux[auxKey].open = false;
        });
      } else if (!typing && mode === 'review' && (e.key === 'j' || e.key === 'k')) {
        step(e.key === 'j' ? 1 : -1);
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  });

  const openAux = (tab: AuxTab) =>
    update((l) => {
      const a = l.aux[auxKey];
      a.open = !(a.open && a.tab === tab);
      a.tab = tab;
    });

  /* ── 接受状态（唯一来源） ── */
  const accepted = task ? app.validAcceptanceOf(task.id) : undefined;
  const stale = task ? app.invalidatedOf(task.id) : undefined;
  const actions = task ? app.actionsOf(task) : null;

  const resolvedSet = new Set(resolved.keys());

  /* ── 主区 ── */
  let main: React.ReactNode;
  if (route.page === 'overview') main = <Overview resolved={resolvedSet} app={app} />;
  else if (route.page === 'tasks') main = <TaskList app={app} />;
  else if (route.page === 'inbox') main = <Inbox resolved={resolvedSet} app={app} />;
  else if (route.page === 'agents') main = <Agents app={app} />;
  /* connect 是 workbench 的别名：同一个入口，避免两个导航项指向同一页面 */
  else if (route.page === 'connect' || route.page === 'workbench') main = <ConnectionPage />;
  else if (task && route.view === 'run')
    main = (
      <RunView
        key={task.id}
        task={task}
        resolved={resolved.get(task.id) ?? null}
        onResolve={(d) => setResolved((m) => new Map(m).set(task.id, d))}
        onOpenChanges={() =>
          task.snapshot
            ? (window.location.hash = href({ page: 'task', id: task.id, view: 'review' }))
            : openAux('changes')
        }
      />
    );
  else if (task)
    main = (
      <div className="review" style={{ position: 'relative' }}>
        {filesWantOpen && !filesOverlay ? (
          <>
            <div className="files" style={{ width: layout.files.w }}>
              <ReviewFileList
                files={files}
                cur={reviewFile?.id ?? ''}
                onPick={setReviewFileId}
                onClose={() => update((l) => void (l.files.open = false))}
              />
            </div>
            <Resizer
              inner
              value={layout.files.w}
              min={200}
              max={420}
              side="left"
              label="调整文件列表宽度"
              onChange={(v) => update((l) => void (l.files.w = v))}
            />
          </>
        ) : null}

        {filesWantOpen && filesOverlay ? (
          <div className="files files--overlay" style={{ width: Math.min(layout.files.w, win - 120) }}>
            <ReviewFileList
              files={files}
              cur={reviewFile?.id ?? ''}
              onPick={(id) => {
                setReviewFileId(id);
                update((l) => void (l.files.open = false));
              }}
              onClose={() => update((l) => void (l.files.open = false))}
            />
          </div>
        ) : null}

        {reviewFile ? (
          <ReviewDiff
            file={reviewFile}
            files={files}
            prefs={diffPrefs}
            onPrefs={setDiffPrefs}
            index={files.findIndex((f) => f.id === reviewFile.id)}
            onStep={step}
            filesOpen={filesWantOpen}
            onOpenFiles={() => update((l) => void (l.files.open = true))}
            longLineWidth={codeW}
          />
        ) : (
          <div className="diffcol">
            <div className="diffbar">
              <span className="meta">没有可审查的变更</span>
            </div>
            <div className="empty">
              <I n="diff" s={22} />
              <div className="empty__title">还没有快照</div>
              <div className="empty__desc">
                执行结束后需要生成一次改动快照，才能在这里审查并接受。
              </div>
            </div>
          </div>
        )}
      </div>
    );

  const tabs: AuxTab[] =
    mode === 'review' ? ['checks', 'details', 'files'] : ['details', 'files', 'changes'];

  return (
    <div className="shell">
      <Sidebar
        route={route}
        rail={navRail}
        width={navW}
        resolved={resolvedSet}
        tasks={app.tasks}
        onToggle={() =>
          update((l) => {
            l.nav[mode] = navRail ? 'full' : 'rail';
          })
        }
      />

      <div className="work">
        <section className="surface main">
          {task ? (
            <TaskBar
              task={task}
              view={mode === 'review' ? 'review' : 'run'}
              auxOpen={auxOpen}
              onAux={openAux}
              accepted={accepted}
              stale={stale}
              actions={actions}
              autoRail={autoRail}
            />
          ) : null}
          {main}

          {mode === 'review' && task ? (
            <div className="decide">
              <button className="decide__checks" onClick={() => openAux('checks')} title="查看检查证据">
                <span className="st st--none">检查未运行</span>
                <span className="meta">
                  后端本批不执行检查；这里展示不了通过或失败
                </span>
              </button>

              {accepted ? (
                <>
                  <span className="accept-badge accept-badge--valid">
                    <I n="check" s={14} />
                    已接受这一版
                    <span className="meta" title={`快照 ${accepted.snapshotId}`}>
                      快照 {accepted.snapshotId.slice(-8)}
                    </span>
                  </span>
                  {/* 后端允许对已接受任务反馈修改：产生新运行并使旧接受失效 */}
                  <button
                    className="btn"
                    title="提交反馈会产生新运行，并使这次接受失效"
                    onClick={() => {
                      app.requestChanges(task.id);
                      setNotice('已提交修改意见，产生新运行；上一次的接受记录已失效。');
                      window.location.hash = href({ page: 'task', id: task.id, view: 'run' });
                    }}
                  >
                    要求修改
                  </button>
                </>
              ) : (
                <>
                  {stale ? (
                    <span className="accept-badge accept-badge--stale" title={`${INVALID_REASON_TEXT[stale.reason]}`}>
                      <I n="warn" s={14} />
                      上次接受已失效：{INVALID_REASON_TEXT[stale.reason]}
                    </span>
                  ) : null}
                  <button
                    className="btn"
                    disabled={!actions?.requestChanges.allowed}
                    title={
                      actions?.requestChanges.allowed
                        ? '回到执行视图，在同一会话中说明需要修改的地方'
                        : '当前不可用'
                    }
                    onClick={() => {
                      app.requestChanges(task.id);
                      setNotice('已提交修改意见，产生新运行；上一次的接受记录已失效。');
                      window.location.hash = href({ page: 'task', id: task.id, view: 'run' });
                    }}
                  >
                    要求修改
                  </button>
                  <button
                    className="btn btn--primary"
                    disabled={!actions?.accept.allowed}
                    title={actions?.accept.allowed ? undefined : '没有可接受的最新快照'}
                    onClick={() => setDialog('accept')}
                  >
                    接受结果
                  </button>
                </>
              )}
            </div>
          ) : null}
        </section>

        {auxOpen && task ? (
          <>
            {!auxOverlay ? (
              <Resizer
                value={aux.w}
                min={320}
                max={Math.max(320, Math.min(640, win - navW - MAIN_MIN[mode] - filesInlineW - GUTTER * 2))}
                side="right"
                label="调整辅助面板宽度"
                onChange={(v) => update((l) => void (l.aux[auxKey].w = v))}
              />
            ) : null}
            <section
              className={`surface aux ${auxOverlay ? 'aux--overlay' : ''}`}
              style={{ width: auxOverlay ? Math.min(aux.w, win - 80) : aux.w }}
            >
              <AuxPanel
                task={task}
                tab={tabs.includes(aux.tab) ? aux.tab : tabs[0]}
                tabs={tabs}
                onTab={(t) => update((l) => void (l.aux[auxKey].tab = t))}
                onClose={() => update((l) => void (l.aux[auxKey].open = false))}
                onOpenReview={() =>
                  (window.location.hash = href({ page: 'task', id: task.id, view: 'review' }))
                }
              />
            </section>
          </>
        ) : null}
      </div>

      {/* 接受确认：绑定具体快照，说明接受范围 */}
      {dialog === 'accept' && task ? (
        <Dialog
          title="接受这一版改动？"
          onClose={() => setDialog(null)}
          footer={
            <>
              <button className="btn" onClick={() => setDialog(null)}>
                再看看
              </button>
              <button
                className="btn btn--primary"
                onClick={() => {
                  app.accept(task.id);
                  setDialog(null);
                  setNotice('已接受这一版快照。接受不提交、不集成，也不代表检查通过。');
                }}
              >
                接受这一版
              </button>
            </>
          }
        >
          <p>接受表示你认可当前这一版改动。它不会提交、不会合并到 main，集成在后续批次单独进行。</p>
          <ul>
            <li>
              <I n="diff" s={15} className="meta" />
              <span>
                {task.snapshot?.files.length ?? 0} 个文件 ·
                <span className="mono" style={{ marginLeft: 6 }}>
                  快照 {task.snapshot?.id.slice(-8)}
                </span>
                <span className="meta" style={{ marginLeft: 6 }}>
                  摘要 {task.snapshot?.contentDigest.slice(0, 8)}
                </span>
              </span>
            </li>
            <li style={{ color: 'var(--warn)' }}>
              <I n="circle" s={15} />
              <span>检查为「未运行」：后端本批不执行检查，不能据此认为测试通过</span>
            </li>
            <li>
              <I n="circle" s={15} className="meta" />
              <span>接受记录绑定这个快照；之后产生新运行或工作区被改动，接受自动失效</span>
            </li>
          </ul>
          <div className="dialog__hint">
            <I n="info" s={14} />
            <span>
              这是演示数据。真实模式下接受会携带 expectedVersion 与 snapshotId，
              后端会重算摘要并核对最新成功运行，不匹配时返回 snapshot_stale。
            </span>
          </div>
        </Dialog>
      ) : null}

      {/* 操作结果提示：一条，可关闭 */}
      {notice ? (
        <div className="toast" role="status">
          <I n="info" s={14} />
          <span style={{ flex: 1 }}>{notice}</span>
          <button className="icon-btn icon-btn--sm" onClick={() => setNotice(null)} aria-label="关闭提示">
            <I n="x" s={13} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

function TaskBar({
  task,
  view,
  auxOpen,
  onAux,
  accepted,
  stale,
  actions,
  autoRail,
}: {
  task: DemoTask;
  view: 'run' | 'review';
  auxOpen: boolean;
  onAux: (t: AuxTab) => void;
  accepted?: { id: string; snapshotId: string };
  stale?: { reason: InvalidationReason };
  actions: ReturnType<ReturnType<typeof useAppState>['actionsOf']> | null;
  autoRail: boolean;
}) {
  const a = AGENTS.find((x) => x.id === task.agentInstanceId);
  const e = a ? engineById(a.engine) : null;
  const reviewable = task.snapshot !== null || task.status === 'in_review' || task.status === 'accepted';
  const statusT = accepted ? { status: 'accepted' as const, run: null } : statusInputOf(task);

  return (
    <header className="ctx">
      <nav className="crumbs" aria-label="位置">
        <a href={href({ page: 'tasks' })} title="返回任务列表">
          任务
        </a>
        <I n="chevR" s={12} />
      </nav>
      <span className="ctx__title" title={task.title}>
        {task.title}
      </span>
      <span className="ctx__grow" />
      <span className="ctx__meta">
        <Status t={statusT} />
        {stale && !accepted ? (
          <span className="accept-badge accept-badge--stale" title={INVALID_REASON_TEXT[stale.reason]}>
            <I n="warn" s={13} />
            接受已失效
          </span>
        ) : null}
        {e && a ? (
          <span className="agent-chip" title={`${e.name} · ${a.name}${task.model ? ` · ${task.model}` : ''}`}>
            <EngineMark mark={e.mark} />
            <span className="hide-sm">{a.name}</span>
          </span>
        ) : null}
      </span>

      {reviewable ? (
        <div className="seg" role="tablist" aria-label="任务视图">
          <a role="tab" aria-selected={view === 'run'} href={href({ page: 'task', id: task.id, view: 'run' })} className="seg-a">
            执行
          </a>
          <a role="tab" aria-selected={view === 'review'} href={href({ page: 'task', id: task.id, view: 'review' })} className="seg-a">
            审查 <span className="n">{task.snapshot?.files.length ?? 0}</span>
          </a>
        </div>
      ) : null}

      <button
        className="icon-btn"
        aria-pressed={auxOpen}
        onClick={() => onAux(view === 'review' ? 'checks' : 'details')}
        title={auxOpen ? '关闭辅助面板 (Ctrl+.)' : '打开辅助面板 (Ctrl+.)'}
        aria-label="辅助面板"
      >
        <I n="panel" />
      </button>
      {autoRail ? <span className="sr-only">窗口较窄，导航已自动收起</span> : null}
      {actions && !actions.accept.allowed && view === 'review' && !accepted ? (
        <span className="action-unavailable">
          <I n="lock" s={13} />
          不可接受
        </span>
      ) : null}
    </header>
  );
}

export { Checks, useMemo };


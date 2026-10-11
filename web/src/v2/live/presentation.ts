import { bindingReason } from '../projects/binding.ts';
import type { Workspace, CheckRun, CheckSummary } from '../api/backend/types.ts';

/* ─────────────────────────────────────────────────────────────
   状态与证据的呈现规则（纯函数，无 React、无网络）

   这一层是本批的语义核心。产品不变式在这里被强制，而不是靠组件自觉：

   1. 执行完成 ≠ 接受 ≠ 集成 ≠ 验收 —— 四段措辞必须能区分。
   2. 检查只有 passed + current 才能说「当前版本检查通过」。
      passed + stale、failed、not_run、needs_recovery 各自措辞不同，
      且 passed+stale 不得显示为绿色通过。
   3. 工作区未 ready 时不能启动 —— 由 availableActions 把关，
      这里只负责把状态说明白。
   ───────────────────────────────────────────────────────────── */

/* ── 工作区准备状态 ───────────────────────────────────────── */

export interface WorkspaceText {
  label: string;
  /** 一句话解释「现在能做什么、不能做什么」 */
  detail: string;
  tone: 'none' | 'run' | 'ok' | 'bad' | 'wait';
  /** 是否允许启动模型（真正的把关仍是 availableActions，这里是同源的第二道） */
  blocksStart: boolean;
}

const WORKSPACE_TEXT: Record<Workspace['status'], WorkspaceText> = {
  unprepared: {
    label: '未准备',
    detail: '还没有为这个任务建立独立工作区。准备完成后才能启动执行。',
    tone: 'none',
    blocksStart: true,
  },
  preparing: {
    label: '准备中',
    detail: '正在创建独立的 Git 工作区与分支。完成前不能启动执行。',
    tone: 'run',
    blocksStart: true,
  },
  ready: {
    label: '已就绪',
    detail: '工作区已建立并绑定固定基准提交。',
    tone: 'ok',
    blocksStart: false,
  },
  failed: {
    label: '准备失败',
    detail: '准备过程中发生冲突，没有复用陌生目录。需要人工处理后再继续。',
    tone: 'bad',
    blocksStart: true,
  },
  needs_recovery: {
    label: '待人工恢复',
    detail: '准备是否真正完成无法确认。为避免误用，服务会阻止继续执行；不提供自动重放。',
    tone: 'wait',
    blocksStart: true,
  },
};

export function workspaceText(workspace: Workspace | undefined): WorkspaceText | null {
  if (!workspace) return null;
  return WORKSPACE_TEXT[workspace.status] ?? null;
}

/* ── 检查状态 ─────────────────────────────────────────────── */

/**
 * 界面上的检查结论。注意这不是后端枚举的直接转发：
 * 后端把「过程状态」和「对当前版本是否还有效」拆成 status / validity 两个字段，
 * 结论必须由两者共同决定。
 */
export type CheckTone = 'none' | 'run' | 'ok' | 'bad' | 'wait';

export interface CheckPresentation {
  /** 稳定的机器可判别标识，供测试与样式使用 */
  key:
    | 'not_run'
    | 'running'
    | 'passed_current'
    | 'passed_stale'
    | 'failed_current'
    | 'failed_stale'
    | 'cancelled'
    | 'timed_out'
    | 'needs_recovery';
  label: string;
  detail: string;
  tone: CheckTone;
  /**
   * 是否可以在界面上声称「当前版本的检查通过」。
   * 只有 passed + current 为 true —— 这是本批最容易出错的地方，
   * 所以做成显式布尔值而不是让每个组件各自判断。
   */
  canClaimPassed: boolean;
}

/**
 * 由任务详情 checks 摘要或检查列表 summary 推导结论。
 *
 * 注意：**不要**用快照上的旧字段 `checks` 推断通过 —— 那是创建快照当时的历史值，
 * 现在可能早已失效。当前证据只来自详情 checks / 检查列表 summary。
 */
export function presentCheck(summary: CheckSummary | undefined): CheckPresentation {
  if (!summary || summary.status === 'not_run') {
    return {
      key: 'not_run',
      label: '未运行',
      detail: '这个版本还没有执行过检查。未运行不等于通过。',
      tone: 'none',
      canClaimPassed: false,
    };
  }

  const stale = summary.validity === 'stale';

  switch (summary.status) {
    case 'running':
      return {
        key: 'running',
        label: '检查中',
        detail: '检查正在执行。同一时间服务只允许一个模型或检查占用执行位。',
        tone: 'run',
        canClaimPassed: false,
      };
    case 'passed':
      return stale
        ? {
            key: 'passed_stale',
            label: '旧版本通过',
            detail: '这次通过针对的是更早的版本；工作区内容、提交或快照已经变化，需要重新检查。',
            tone: 'wait',
            canClaimPassed: false,
          }
        : {
            key: 'passed_current',
            label: '当前版本检查通过',
            detail: '检查在当前版本上通过：内容摘要、最新运行与快照都一致。',
            tone: 'ok',
            canClaimPassed: true,
          };
    case 'failed':
      return {
        key: stale ? 'failed_stale' : 'failed_current',
        label: '检查失败',
        detail: stale
          ? '这次失败发生在更早的版本上，不能代表当前版本；但它确实失败过，也不会因为过时而变成通过。'
          : '检查在当前版本上失败，退出码非零。',
        tone: 'bad',
        canClaimPassed: false,
      };
    case 'cancelled':
      return {
        key: 'cancelled',
        label: '已取消',
        detail: '检查被请求取消并已结束。取消不代表通过，也不代表失败。',
        tone: 'none',
        canClaimPassed: false,
      };
    case 'timed_out':
      return {
        key: 'timed_out',
        label: '超时',
        detail: '检查超过预设时限后被终止。这不等于测试失败，也不能视为通过。',
        tone: 'bad',
        canClaimPassed: false,
      };
    case 'needs_recovery':
      return {
        key: 'needs_recovery',
        label: '结果未知 · 待恢复',
        detail: '检查进程是否真正退出无法确认。服务已隔离该工作区并阻止继续执行，需要人工核查。',
        tone: 'wait',
        canClaimPassed: false,
      };
  }
}

/* ── 检查记录（列表里的单条） ─────────────────────────────── */

export interface CheckRowPresentation extends CheckPresentation {
  /** 与当前版本一致时为空 */
  staleNote?: string;
}

export function presentCheckRun(run: CheckRun): CheckRowPresentation {
  const base = presentCheck({ status: run.status, validity: run.validity, checkId: run.id });
  return run.validity === 'stale' && run.status !== 'running'
    ? { ...base, staleNote: '这一条针对的是更早的版本' }
    : base;
}

/** 检查是否有真实可展示的输出与退出信息 */
export function checkHasEvidence(run: CheckRun): boolean {
  return run.status !== 'running' && (Boolean(run.stdout) || Boolean(run.stderr) || run.exitCode !== undefined);
}

/* ── 阶段措辞：四个阶段必须彼此不同 ───────────────────────── */

export const PHASE_TERMS = {
  execution: '执行完成',
  acceptance: '已接受',
  integration: '已集成',
  verification: '已验收',
} as const;

/**
 * 一句贯穿始终的说明：我们到哪一步了。
 * 后三个阶段在本批后端都没有实现，所以文案里必须写明界限，
 * 不能让「已接受」看起来像「已经合并」。
 */
export function progressSentence(input: {
  runSucceeded: boolean;
  accepted: boolean;
  integrated: false;
  verified: false;
}): string {
  if (input.verified) return PHASE_TERMS.verification;
  if (input.integrated) return PHASE_TERMS.integration;
  if (input.accepted) return `${PHASE_TERMS.acceptance}（未提交、未集成、未验收）`;
  if (input.runSucceeded) return `${PHASE_TERMS.execution}（未接受、未集成、未验收）`;
  return '尚未完成一次执行';
}

/* ── 错误码 → 可操作的中文提示 ────────────────────────────── */

export interface ErrorPresentation {
  title: string;
  detail: string;
  /** 用户接下来该做什么；没有可操作项时为 null */
  recovers: 'reread' | 'reprepare' | 'recheck' | 'reconnect' | null;
}

/**
 * 机器错误码 → 提示。文案必须说明「怎么恢复」，
 * 因为本批的写操作全部要求最新 expectedVersion 与原幂等键重试。
 */
const ERROR_MAP: Record<string, ErrorPresentation> = {
  ...Object.fromEntries(['agent_configuration_changed','agent_configuration_unproven','agent_instance_unavailable'].map(code=>[code,{title:'固定实例配置无法授权',detail:'原实例配置已变化、不可用或历史记录缺少配置证明。不会自动换实例或修订；保留历史任务，从流程建立新草案、审阅批准并显式创建新任务。',recovers:null}])),
  ...Object.fromEntries(['native_session_unproven','native_session_mismatch','native_session_already_owned'].map(code=>[code,{title:'会话归属未通过核验',detail:'不能确认会话属于这个任务与固定配置。反馈已拒绝，不会自动建立新线程或迁移上下文；请保留记录并核对服务配置。',recovers:null}])),
  ...Object.fromEntries(['binding_refresh_required','binding_unavailable','execution_binding_unavailable','execution_binding_required','grant_not_authorized','grant_repository_mismatch','association_stale','repository_changed','binding_change_forbidden','grant_configuration_changed','grant_repository_unavailable'].map(code=>[code,{title:'执行绑定需要处理',detail:bindingReason(code)+'',recovers:null}])),
  version_conflict: {
    title: '内容已被更新',
    detail: '在你操作期间这个任务已经变化。保留你的草稿，重新读取最新状态后再提交。',
    recovers: 'reread',
  },
  idempotency_conflict: {
    title: '请求键被用于不同内容',
    detail: '同一个幂等键提交了不一样的内容。请重新发起一次操作，不要改动后复用原键。',
    recovers: 'reread',
  },
  active_run: {
    title: '已有执行或检查在进行',
    detail: '服务同一时间只允许一个模型执行或一次检查。等它结束后再提交。',
    recovers: null,
  },
  workspace_not_ready: {
    title: '工作区尚未就绪',
    detail: '这个任务的工作区还没准备好。先完成准备工作区，再启动执行。',
    recovers: 'reprepare',
  },
  workspace_already_prepared: {
    title: '工作区已准备好',
    detail: '这个任务已经有过准备工作区的意图，不能重复发起。请刷新查看当前状态。',
    recovers: 'reread',
  },
  workspace_conflict: {
    title: '准备时遇到冲突',
    detail: '目录或分支已被占用，服务没有复用陌生目录。需要人工处理后重新开始。',
    recovers: 'reprepare',
  },
  snapshot_stale: {
    title: '这一版改动已经变化',
    detail: '快照与当前内容不一致。重新生成快照后再审查或接受。',
    recovers: 'recheck',
  },
  run_not_successful: {
    title: '最近一次运行不是成功状态',
    detail: '只有成功的运行才能接受其快照。先确认运行结果。',
    recovers: 'reread',
  },
  run_not_interruptible: {
    title: '当前不能中止',
    detail: '只有在执行中、且执行器确认可中止的运行才能被请求中止。',
    recovers: 'reread',
  },
  check_not_running: {
    title: '检查已经不在运行',
    detail: '这项检查已经结束。重新读取检查列表查看真实终态。',
    recovers: 'recheck',
  },
  task_started: {
    title: '任务已经启动过',
    detail: '启动之后不能再修改任务的目标与验收条件。',
    recovers: null,
  },
  task_not_ready: {
    title: '任务当前不能启动',
    detail: '任务状态不允许启动执行。',
    recovers: 'reread',
  },
  preset_not_found: {
    title: '检查预设不存在',
    detail: '这个预设不在服务的本机可信配置里。预设只能来自本机配置，不能来自模型回复或页面输入。',
    recovers: 'recheck',
  },
  check_unavailable: {
    title: '这项检查在本机不可用',
    detail: '例如 .cmd / .bat 脚本不会被调用（服务不经过 shell 执行）。',
    recovers: null,
  },
  project_not_found: {
    title: '项目不存在',
    detail: '服务上没有登记这个项目。确认服务与本机配置是否匹配。',
    recovers: 'reread',
  },
  engine_not_integrated: {
    title: '该引擎尚未接入',
    detail: '本批只有 Codex 有真实接入证据，其他引擎不能执行。',
    recovers: null,
  },
  unauthorized: {
    title: '认证失败（401）',
    detail: '令牌不正确。服务每次启动会重新生成 access-token，请确认用的是当前这次启动的值。',
    recovers: 'reconnect',
  },
  origin_forbidden: {
    title: '来源不被允许（403）',
    detail: '这个页面的来源不在后端 allowedOrigins 里。换用被允许的端口，或请维护者添加。',
    recovers: 'reconnect',
  },
  host_forbidden: {
    title: '请求主机不被允许（403）',
    detail: '后端只接受 127.0.0.1 或 localhost 的 Host 头。检查服务地址写法。',
    recovers: 'reconnect',
  },
  not_found: {
    title: '对象不存在（404）',
    detail: '服务上找不到这个对象。它可能属于另一套数据库，或已被更换。',
    recovers: 'reread',
  },
  storage_unavailable: {
    title: '本机存储不可用',
    detail: '服务进入故障状态，或数据库无法写入。需要人工检查服务日志。',
    recovers: null,
  },
  legacy_workspace_bound: {
    title: '当前是旧模式服务',
    detail: '旧 workspace 模式的工作区是绑定的，不能显式准备。新项目模式需要独立的配置、数据库与端口。',
    recovers: null,
  },
  workspace_bound: {
    title: '绑定工作区只能有一个任务',
    detail: '旧模式的服务只支持一项任务，不能创建第二项。',
    recovers: null,
  },
  invalid_input: {
    title: '请求内容不合法',
    detail: '检查必填项与长度限制后重试。',
    recovers: null,
  },
  invalid_configuration: {
    title: '服务配置不合法',
    detail: '后端配置有问题（例如项目与工作区模式混用）。需要维护者处理。',
    recovers: null,
  },
};

export function presentError(status: number, code: string): ErrorPresentation {
  const known = ERROR_MAP[code];
  if (known) return known;
  if (status === 401) return ERROR_MAP.unauthorized;
  if (status === 403) return ERROR_MAP.origin_forbidden;
  return {
    title: `请求失败（${status}）`,
    detail: `服务返回了未收录的错误码 ${code}。请重新读取状态；不确定网络结果时，用原幂等键与原内容重试。`,
    recovers: 'reread',
  };
}

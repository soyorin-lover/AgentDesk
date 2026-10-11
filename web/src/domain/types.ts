/**
 * 任务级状态。
 *
 * ⚠️ 与 RunStatus（运行级）是两个独立维度，禁止混用。
 * 来源：docs/PRODUCT.md「状态」章节 + 第 1 批提示词「必须遵守的状态语义」。
 *
 * 关键不变式（UI 不得违反）：
 *  - 执行成功 ≠ 验收通过
 *  - 接受结果 ≠ 已集成代码
 *  - 集成完成 ≠ 检查全部通过
 */
export type TaskStatus =
  | 'draft' // 草稿：只有标题，未定义验收条件
  | 'ready' // 就绪：目标与验收条件齐备，可启动运行
  | 'inProgress' // 处理中：至少一个运行处于活动或等待
  | 'inReview' // 待审查：运行已产出结果，等待人工查看 diff / 检查
  | 'accepted' // 已接受：人工确认结果，尚未集成
  | 'integrated' // 已集成：变更已进入集成分支
  | 'verified' // 已验收：最终验证通过，任务关闭
  | 'cancelled'; // 已取消

/**
 * 单次运行（turn）的状态。同一任务可有多次运行。
 */
export type RunStatus =
  | 'queued' // 排队：已请求，服务端尚未开始
  | 'running' // 运行中
  | 'waitingUser' // 等待用户：需要回答问题或处理审批
  | 'succeeded' // 成功：本轮正常结束
  | 'failed' // 失败
  | 'interrupted' // 已中止：用户主动中止
  | 'resumable'; // 待恢复：会话可恢复，但进程未在运行

/**
 * 阻塞原因单独记录，不折进状态里。
 * 一个「处理中」的任务可能同时被阻塞，两者都要显示。
 */
export type BlockReasonKind =
  | 'question' // 等待用户回答问题
  | 'approval' // 等待用户审批某个操作
  | 'processExited' // 承载进程已退出
  | 'connection' // 与服务端断连
  | 'mergeConflict' // 集成时出现合并冲突
  | 'checkFailed'; // 集成检查失败

export interface BlockReason {
  kind: BlockReasonKind;
  /** 一句话说明，直接展示给用户 */
  summary: string;
  /** 产生该阻塞的运行；断连类阻塞可能没有 */
  runId?: string;
}

export type CheckStatus =
  | 'notRun' // 未运行 —— 必须显式显示，不能留空
  | 'running'
  | 'passed'
  | 'failed'
  | 'error'; // 无法执行（命令缺失、环境问题）

export interface Check {
  id: string;
  /** 检查名称，如「单元测试」 */
  name: string;
  /** 真实执行的命令；未运行时为 null，界面据此显示「尚未执行」 */
  command: string | null;
  status: CheckStatus;
  /** 退出码；未运行或无法执行时为 null —— 0 是有效值，不能用 falsy 判断 */
  exitCode: number | null;
  durationMs: number | null;
  /** 原始输出，可能与 stdout 分开展示 */
  output: string | null;
  stderr?: string | null;
  /** 由哪次运行产生 */
  runId: string | null;
  startedAtMs: number | null;
}

export type FileChangeKind = 'add' | 'modify' | 'delete' | 'rename';

export interface DiffLine {
  kind: 'ctx' | 'add' | 'del';
  /** 旧文件行号，新增行为 null */
  oldNo: number | null;
  /** 新文件行号，删除行为 null */
  newNo: number | null;
  text: string;
}

export interface DiffHunk {
  /** 形如 `@@ -12,7 +12,9 @@` */
  header: string;
  lines: DiffLine[];
}

export interface DiffFile {
  path: string;
  /** 重命名时的原路径 */
  oldPath?: string;
  kind: FileChangeKind;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
  /** 二进制或过大文件不展示逐行 diff */
  binary?: boolean;
}

/** 任务的计划与实际改动，用于「变更」视图 */
export interface ChangeSet {
  /** 变更基于哪个基准 */
  baseRef: string;
  /** 执行用的隔离工作区 */
  worktreePath: string;
  /** 工作分支 */
  branch: string;
  files: DiffFile[];
  /** 尚未提交的改动数 */
  uncommitted: number;
}

/** 集成操作的结果 —— 独立于「接受」，见状态语义 */
export interface Integration {
  targetBranch: string;
  status: 'idle' | 'running' | 'succeeded' | 'conflict' | 'checkFailed';
  /** 已集成到目标分支的提交，成功后才有 */
  mergedCommit: string | null;
  /** 冲突文件，冲突时才有 */
  conflictFiles: string[];
  /** 集成后运行的检查 */
  checks: Check[];
  startedAtMs: number | null;
  finishedAtMs: number | null;
  /** 失败原因摘要 */
  message: string | null;
}

/* ─────────────────────────────────────────────────────────────
   时间线事件
   形状对齐本机 Codex App Server 0.162.0-alpha.2 的 ServerNotification：
   turn/started, turn/completed, item/started, item/completed,
   item/agentMessage/delta, item/commandExecution/outputDelta, error, warning
   （见 .agentdesk/protocol/ServerNotification.json）
   ───────────────────────────────────────────────────────────── */

export type EventKind =
  | 'userMessage'
  | 'agentMessage'
  | 'reasoning'
  | 'command'
  | 'fileChange'
  | 'plan'
  | 'question'
  | 'approval'
  | 'error'
  | 'warning'
  | 'interrupted'
  | 'info';

interface EventBase {
  id: string;
  kind: EventKind;
  atMs: number;
  runId: string;
  /** 所属轮次，用于时间线分组 */
  turnId: string | null;
  /** 该项是否仍在进行中（流式文本、运行中命令） */
  pending?: boolean;
}

export interface UserMessageEvent extends EventBase {
  kind: 'userMessage';
  text: string;
  /** 本轮是补充指令（steer）还是常规消息 */
  isSteer: boolean;
}

export interface AgentMessageEvent extends EventBase {
  kind: 'agentMessage';
  text: string;
  phase: 'commentary' | 'final_answer';
}

/** 模型的思考摘要，默认折叠 */
export interface ReasoningEvent extends EventBase {
  kind: 'reasoning';
  summary: string[];
  text?: string;
}

export interface CommandEvent extends EventBase {
  kind: 'command';
  command: string;
  cwd: string;
  /** 未被 sandbox 或审批拒绝 */
  exitCode: number | null;
  durationMs: number | null;
  output: string;
  /** 命令请求的审批结果 */
  approval: ApprovalState | null;
}

export interface FileChangeEvent extends EventBase {
  kind: 'fileChange';
  status: 'inProgress' | 'completed' | 'failed';
  changes: Array<{
    path: string;
    kind: FileChangeKind;
    additions: number;
    deletions: number;
    /** 展开时展示的逐行 diff */
    hunks: DiffHunk[];
  }>;
}

export interface PlanEvent extends EventBase {
  kind: 'plan';
  text: string;
}

/** 模型向用户提问（对应 item/tool/requestUserInput 服务端请求） */
export interface QuestionEvent extends EventBase {
  kind: 'question';
  requestId: string;
  header: string;
  questions: QuestionItem[];
  /** 是否阻塞本轮继续执行 */
  isBlocking: boolean;
  resolution: QuestionResolution | null;
}

export interface QuestionItem {
  id: string;
  header: string;
  question: string;
  options: Array<{ label: string; description: string }>;
  /** 允许自由输入 */
  allowOther: boolean;
  /** 敏感输入，界面需遮蔽 */
  isSecret: boolean;
}

export interface QuestionResolution {
  atMs: number;
  /** questionId → 答案 */
  answers: Record<string, string[]>;
  via: 'user' | 'timeout';
}

/** 审批请求（对应 item/commandExecution/requestApproval 等服务端请求） */
export interface ApprovalEvent extends EventBase {
  kind: 'approval';
  requestId: string;
  /** 审批对象的类别，决定展示细节 */
  category: 'commandExecution' | 'fileChange' | 'permissions';
  /** 一句话说明这次操作要做什么 */
  title: string;
  /** 待批准的具体内容：命令、或文件变更摘要 */
  detail: {
    command?: string;
    cwd?: string;
    files?: Array<{ path: string; additions: number; deletions: number }>;
    reason?: string | null;
  };
  /** 模型给出的理由（FileChangeRequestApprovalParams.reason） */
  reason: string | null;
  /** 可选的「本次会话内不再询问」含义说明 */
  sessionScopeHint: string | null;
  state: ApprovalState;
}

/**
 * 审批状态。值域取自 CommandExecutionApprovalDecision /
 * FileChangeApprovalDecision（本机协议 schema）：
 * accept | acceptForSession | decline | cancel
 */
export type ApprovalState =
  | { kind: 'pending' }
  | { kind: 'accepted'; atMs: number; scope: 'once' } // accept
  | { kind: 'acceptedForSession'; atMs: number; scope: 'session' } // acceptForSession
  | { kind: 'declined'; atMs: number } // decline：拒绝，本轮继续
  | { kind: 'cancelled'; atMs: number }; // cancel：拒绝并中止本轮

export interface ErrorEvent extends EventBase {
  kind: 'error';
  message: string;
  /** 服务端是否会重试 */
  willRetry: boolean;
  /** 技术细节，折叠展示 */
  detail?: string;
}

export interface WarningEvent extends EventBase {
  kind: 'warning';
  message: string;
}

export interface InterruptedEvent extends EventBase {
  kind: 'interrupted';
  reason: string;
  /** 中止保留了已有改动 —— 界面必须说明 */
  changesPreserved: boolean;
}

export interface InfoEvent extends EventBase {
  kind: 'info';
  text: string;
}

export type TimelineEvent =
  | UserMessageEvent
  | AgentMessageEvent
  | ReasoningEvent
  | CommandEvent
  | FileChangeEvent
  | PlanEvent
  | QuestionEvent
  | ApprovalEvent
  | ErrorEvent
  | WarningEvent
  | InterruptedEvent
  | InfoEvent;

/** 一次运行（turn） */
export interface Run {
  id: string;
  /** 服务端 thread/turn 标识 */
  threadId: string;
  turnId: string;
  index: number; // 第几次运行，从 1 开始
  status: RunStatus;
  startedAtMs: number;
  finishedAtMs: number | null;
  /** 本轮使用的模型，展示原文 */
  model: string;
  /** 本轮起点提交 */
  baseCommit: string;
  events: TimelineEvent[];
  /** 结束摘要；成功与失败时展示 */
  outcome: RunOutcome | null;
}

export interface RunOutcome {
  /** 保留下来供查看的结果 —— 失败或中止时尤其重要 */
  summary: string;
  changedFiles: number;
  additions: number;
  deletions: number;
  checks: Check[];
  /** 失败原因 */
  error?: string;
  /** 下一步可选操作 */
  nextSteps: NextStep[];
}

export interface NextStep {
  id: string;
  label: string;
  kind: 'resume' | 'rerun' | 'continueInstruction' | 'review' | 'integrate';
  /** 说明该操作与其它操作的区别，避免误认 */
  hint?: string;
  disabled?: boolean;
  disabledReason?: string;
}

/** 任务运行所在的环境 */
export interface Workspace {
  /** 仓库根路径 */
  repoPath: string;
  /** 隔离工作区路径 */
  worktreePath: string;
  branch: string;
  baseBranch: string;
  /** 环境探测结果 */
  env: {
    os: 'Windows' | 'Linux';
    node: string | null;
    git: string | null;
    codexVersion: string | null;
    /** 与 Codex App Server 的连接状态 */
    connection: 'connected' | 'connecting' | 'disconnected';
  };
  /** 未提交改动数 */
  uncommitted: number;
}

export interface Task {
  id: string;
  /** 简短编号，展示用 */
  ref: string;
  title: string;
  /** 目标：为什么做这件事 */
  goal: string;
  /** 验收条件：逐条可判定的完成标准 */
  acceptance: Array<{ id: string; text: string; met: boolean | null }>;
  status: TaskStatus;
  /** 运行状态是独立维度：取最近一次运行的状态 */
  latestRunStatus: RunStatus | null;
  block: BlockReason | null;
  runs: Run[];
  changes: ChangeSet | null;
  integration: Integration;
  workspace: Workspace;
  createdAtMs: number;
  updatedAtMs: number;
  /** 是否为演示数据 */
  demo: boolean;
}

export interface Project {
  id: string;
  name: string;
  repoPath: string;
  branch: string;
  env: Workspace['env'];
}

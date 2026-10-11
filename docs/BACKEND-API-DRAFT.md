# 通用任务 / 运行 / 事件接口草案

版本 v0.1，2026-10-08，保留第 2 批接口设计依据。A 已实施，实际端点和响应差异见 [BACKEND-USAGE.md](BACKEND-USAGE.md)，证据见 [CODEX-BATCH-02-RESULTS.md](CODEX-BATCH-02-RESULTS.md)。草案不作为跨版本兼容性承诺。

## 对象与身份

所有 ID 为后端生成的不透明字符串；时间使用 UTC ISO 8601。客户端不以路径或 Codex 原生 ID 作为主键。对象含 `schemaVersion: 1`，任务和运行含单调递增的 `version`。

| 对象 | 主要字段 | 含义 |
| --- | --- | --- |
| Project | id, name | 本批为绑定测试项目，不提供项目管理 |
| Workspace | id, projectId, kind, baseHead, availability | kind 为 dedicated_repository / external_worktree；本批只登记启动配置指定的一处，不接受请求传路径 |
| Engine | id, integrationStatus | codex 为 verified_probe；claude_code / deepseek_harness 为 not_integrated，不能发起执行 |
| AgentInstance | id, engineId, name, configurationRevision, capabilities, availability | 引擎的一份本机配置；握手、模型发现、执行可用性分别记录，availability 不是历史能力证明 |
| Task | id, projectId, workspaceId, title, goal, acceptanceCriteria, agentInstanceId, status, latestRunId, acceptedSnapshotId, blockedReason, version | 业务任务；不把原生会话作为任务 |
| Run | id, taskId, agentInstanceId, engineId, model, status, phase, outcomeReason, startedAt, endedAt, lastEventSeq, version | 一次用户启动的一轮执行；model 执行前可为空，配置修订和引擎版本留在本机运行记录 |
| ChangeSnapshot | id, taskId, runId, baseHead, contentDigest, files, completeness, checks, createdAt | 覆盖 HEAD/索引/工作树和未跟踪文件的审查版本；checks 本批为 not_run |
| Acceptance | id, taskId, runId, snapshotId, acceptedAt, valid | 人工接受记录；valid 随新执行或外部变化失效，不修改历史原文 |

原生 `threadId`、`turnId`、请求 ID 和直属 PID 只属于适配器私有记录。一个任务可有多个 Run，在同引擎会话内顺序续接；重跑与恢复语义不同。更换引擎不迁移会话，本批禁止在执行后切换实例。

## 状态规则

通用 TaskStatus：`draft | ready | in_progress | in_review | accepted | integrated | verified | cancelled`。保留产品完整语义，本批不提供 integrated / verified / cancelled 的操作。

通用 RunStatus：`queued | running | waiting_user | succeeded | failed | aborted | needs_recovery`。本批不排队，queued 和 waiting_user 不产生；启动中的持久化 Run 使用 running + phase=starting。phase 另有 executing / stopping，避免将“请求中止”当终态。

| 输入或事件 | Run 变化 | Task 变化 |
| --- | --- | --- |
| 保存有效目标与非空验收条件 | 无 | draft → ready |
| 启动已持久化 | running / starting | ready → in_progress；in_review / accepted 仅通过反馈进入 |
| 原生开始确认 | running / executing | 保持 in_progress |
| 原生 completed 且归一化记录提交成功 | succeeded | in_review，checks 仍未运行 |
| 明确拒绝启动或原生 failed | failed | in_review，保留残留变更与失败原因 |
| 用户请求中止 | running / stopping | 保持 in_progress |
| 原生 interrupted | aborted | in_review，保留变更 |
| 请求接受结果不明、连接丢失或运行中服务崩溃 | needs_recovery | 保持 in_progress，blockedReason=result_unknown；禁止后续启动和接受 |
| 人工接受当前成功运行的完整快照 | 无 | in_review → accepted |
| 对待审查/已接受任务反馈修改 | 新建 running | → in_progress，旧接受失效 |
| accepted 后读到外部改动 | 无 | → in_review，旧接受失效 |

本批失败/中止的残留可以查看，但不能直接接受；需显式反馈产生一个成功运行，再审查。无代码变化的成功文本任务也可待审查，但必须明确 diff 为空。终态迟到时按原生标识关联到原 Run；needs_recovery 不允许通过用户点击“重试”自行解除。只有可验证的匹配终态可消除同进程的未知状态；服务重启后的人工恢复流程另批设计。

## 能力表示

每项能力分别记录 `adapterSupport`（implemented / not_implemented）、`verification`（verified / unverified / unsupported）、`evidenceRef`（非敏感证据引用与平台/版本/传输条件）。实例和运行的 `availableActions` 另给当前可用动作及不可用原因，不从一个布尔值推导所有行为。

例如 Codex 的 interrupt 有第一批 Windows 条件下的历史证据；第 2 批中止 API 在实现并取得新证据前仍是 not_implemented。Claude Code 与 DeepSeek Harness 是 not_integrated，不能复制 Codex 能力。model/list 仅表示 advertised，不等于 executable；模型失败不自动换模。

## HTTP 草案

前缀 `/api/v1`，JSON，UTF-8。启动信息提供当前绑定项目/工作区、实例及能力。服务端只返回允许字段，不暴露执行程序参数和认证配置。

| 方法与路径 | 输入 | 结果 |
| --- | --- | --- |
| GET /bootstrap | 无 | 绑定项目/工作区、实例、能力、服务版本 |
| POST /tasks | title, goal, acceptanceCriteria, agentInstanceId | 201 Task；绑定工作区已有任务则 409 |
| GET /tasks | cursor, limit | 有界任务列表和 nextCursor |
| GET /tasks/:id | 无 | Task、最新 Run、availableActions、快照摘要与事件游标 |
| PATCH /tasks/:id | expectedVersion, title/goal/acceptanceCriteria | 200 Task；仅未执行草稿/就绪任务可修改 |
| POST /tasks/:id/runs | expectedVersion, input（反馈时必填） | 202 Run；新任务用 goal+验收条件生成输入，反馈追加用户内容 |
| GET /runs/:id | 无 | Run 与已提交状态 |
| POST /runs/:id/interrupt | expectedVersion | 202 最新 Run；表示请求已记录，尚不表示 aborted |
| GET /tasks/:id/events | after, limit | 已提交有序事件和 nextCursor，分页补读 |
| GET /tasks/:id/events/stream | after 或 Last-Event-ID | SSE；只消费，不控制执行 |
| GET /tasks/:id/changes | 无 | 最近持久化快照及 lastCheckedAt，不宣称代表当前磁盘 |
| POST /tasks/:id/snapshots | expectedVersion | 201 刷新快照，必要时使旧接受失效；仅无活动运行且结果已知时允许 |
| GET /snapshots/:id/files/:fileId | 无 | 本机保存的有界文本 diff；不提供任意路径读文件能力 |
| POST /tasks/:id/accept | expectedVersion, snapshotId | 200 Task 和 Acceptance；重算摘要并核对最新成功运行 |

所有写请求携带 `Idempotency-Key`，同端点/对象/键/载荷重放返回原对象与当前状态，不重复副作用；同键不同载荷返回 409。幂等查询优先于版本校验，否则网络重试会被自身成功写入误拒绝。记录与初始对象事务提交；本批不自动清理键。使用新键但 expectedVersion 过时返回 409，单活跃运行约束在数据库事务中检查。

POST /runs 的 202 表示后端已记录意图，不代表 App Server 接受或模型执行成功。服务重启不能仅凭该记录重新发请求。反馈输入必须被记录为用户新指令，与模型历史输出区分。

服务重启后，如果上一运行已有持久化的明确终态，可以在用户下一次反馈时恢复已知 Codex 会话，然后创建新轮次；这是上下文续接，不是恢复原运行。resume 明确失败时记录本次启动失败，不偷偷新建会话；resume 结果不明时仍进入 needs_recovery。本批不提供独立 resume 操作或对未知运行的恢复操作。

读取接口不扫描磁盘并修改接受状态；显式刷新快照、接受前校验及启动下一运行负责检查磁盘变化并发出失效事件。客户端展示 lastCheckedAt；没有文件监听器，不能承诺外部修改立即更新 UI。接受记录的 valid 表示截至最近核对有效，使用它做后续决策前仍需重新核对。

通用错误：`{ error: { code, message, retryable }, currentVersion? }`。code 至少覆盖 invalid_input（400）、unauthorized（401）、not_found（404）、version_conflict / active_run / snapshot_stale / idempotency_conflict（409）、engine_not_integrated / capability_unavailable（422）、storage_unavailable（503）。message 使用可公开的归一化说明；原始上游错误不能直接返回。retryable 表示可重新查询/人工再试，不授权自动重复执行。

## 事件草案

```ts
type EventEnvelope<T> = {
  schemaVersion: 1;
  id: string;         // 持久化事件 ID，客户端去重
  seq: number;        // 每个任务从 1 递增，事件分页/SSE 共用
  taskId: string;
  runId?: string;
  occurredAt: string; // 后端接收并记录时间，不伪称引擎原始时间
  type: string;      // v1 的已知联合类型，以下表为准
  data: T;
};
```

| type | data 的必要内容 |
| --- | --- |
| task.created / task.updated | version, status |
| run.created | runId, version, status, phase |
| run.status_changed | version, previousStatus, status, phase, reason? |
| message.delta | messageId, chunkIndex, text |
| message.completed | messageId, text；为该消息权威完整正文，替换拼接结果 |
| activity.started / activity.completed | activityId, category, status；仅允许的摘要字段 |
| diagnostic.recorded | category, code?；无原始帧与任意错误正文 |
| changes.snapshot_created | snapshotId, completeness, checks |
| task.accepted / task.acceptance_invalidated | acceptanceId, snapshotId, version, reason? |

事件必须先落库再对外发送；文本可合并小片段后形成规范事件，不承诺保存每个原生 token。HTTP 快照的 `lastEventSeq` 与快照在同一读取事务获取；客户端从此游标补读，不能在初始化缝隙漏事件。每个 Run 的原生关联和终态事件去重由适配器/服务负责，不能按正文哈希删除合法重复消息。

SSE 使用 seq 作为 id；同任务重复收到事件可去重，断线从最后 ID 继续。服务端先从持久化表补读再按 seq 继续，避免从回放切换实时流时漏事件；心跳不推进游标。慢客户端断开后补读，不能阻塞执行或无限堆积内存。本批不截断历史；未知/越界游标返回 400。前端可忽略未知非状态事件，但不能通过猜测事件名改变任务状态。

未来审批需要独立 PendingRequest 对象（运行/会话关联、动作范围、允许决定、过期状态）和确认协议；本批不发布占位回答端点，也不存活的 promise 等待浏览器决定。

## 本机访问与容量

回环监听仍需 Host / Origin 校验；本批建议使用启动时生成、只在本机交给客户端的访问令牌，所有 API（含读取和 SSE）验证它。跨域仅显式允许本机开发前端来源，不使用 `*`。SSE 客户端用支持鉴权头的流式请求，不把令牌放 URL。具体登录界面不在本批。

请求大小、任务字段长度、事件分页、文本/差异读取设有明确上限；超限返回 413 或 completeness=limited，不默默丢内容。建议初值：JSON 请求 256 KiB、列表每页默认 50/最多 200、单文件 diff 1 MiB、单快照 10 MiB、单运行可见正文 10 MiB；达到运行正文上限进入受控停止，未确认终态按未知结果处理。原始工具流也需流控，不能在 session 的文本数组中无限增长。具体上限可在实施计划调整并测试。

接口只允许配置绑定目录内的 Git 读取与受控执行；拒绝 cwd、shell 字符串和额外命令参数注入。路径用跨平台 API 与真实路径检查，符号链接不按普通文件放行。访问令牌、SQLite、任务正文和 diff 均不提交；本批不提供日志打包上传。

# B07 API（2026-10-09 已发布）

所有路径 /api/v1，沿用 Bearer/Host/Origin/JSON/幂等校验。新写命令必须 Idempotency-Key，读不启动执行。项目版本与流程版本分离，空流程 version=0/revision=0。

- GET /projects/:id/workflow → WorkflowView（完整当前草案、审批历史、节点派生状态与原因）。
- PUT 不新增；POST /projects/:id/workflow：{expectedVersion,roles,members,ownerMemberId,nodes} 完整替换草案；节点/角色/成员稳定 ID，项目作用域。每次成功 revision+1/version+1，保存不可变修订。nodes 包含 id/name/goal/acceptanceCriteria/roleId/memberId/agentInstanceId/parentId?/dependencyIds/executionBinding。绑定为 B06 TaskExecutionBinding，必须属于该项目已登记的绑定。可配置未接入实例，但不能批准执行。
- GET /projects/:id/workflow-revisions → {items:WorkflowDraft[]}，历史只读。
- POST /projects/:id/workflow-approvals：{expectedVersion,revision,nodeIds}；非空去重子集，整批使用全部节点。选中节点的每个依赖须在选中子集或同修订已批准，否则 409 approval_dependencies_missing。批准不自动建任务/准备/启动。返回不可变 WorkflowApproval，流程 version+1，revision 不变。
- POST /projects/:id/workflow-tasks：{expectedVersion,revision,nodeId,taskId?}；当前精确修订必须已批准，绑定有效；无 taskId 从批准配置建立 Task，有 taskId 显式关联已有同项目且目标/验收/实例/固定绑定完全一致的任务。拒绝活动/未知/已受其他节点管理任务。保存永久受管关联及 task.flow 引用，不伪造历史批准；一个修订节点最多关联一个任务，重复用新键拒绝。返回 Task，流程 version+1，不启动。
- POST /projects/:id/workflow-confirmations：{expectedVersion,revision,nodeId,acceptanceId}；依赖须已完成且接受有效，当前任务有批准后成功轮次、当前有效 acceptance 匹配 ID，保存不可变人工确认。返回 WorkflowConfirmation，流程 version+1；run succeeded 只能是 awaiting_confirmation。

角色 {id,name,responsibility,defaultAgentInstanceId}；成员 {id,name,roleId,agentInstanceId}；ownerMemberId 必须是成员或 null。所有引用显式，节点 roleId/memberId 必须匹配。实例枚举 codex-local/claude-local/deepseek-local；后两种仅配置目标，engine_not_integrated。角色默认不自动改变已有成员/节点实例；编辑要提交明确实例。批准快照包含完整节点/角色/成员/绑定/依赖。

成员/角色仅项目内复用，不是全局目录；无外部实例登记能力。ownerMemberId 表示成员负责人，不产生独立助手或自动规划操作。节点 projectId 由所在流程提供，额外提交 projectId 字段拒绝。草案保存也验证固定绑定属于本项目且当前本机授权有效，配置未接入工具目标不等于获得执行权限。

树与依赖分别验证循环、悬空、跨项目引用。上限每类 100 项，单节点依赖 100，目标 64000，验收 50 条×2000，名称 200。ID 1–80 字母数字下划线连字符。全量编辑生成新草案，旧批准保留历史但全部停止授权；affectedNodeIds 展示变化节点和依赖后继，authorizationInvalidatedNodeIds 列出旧修订批准节点。活动输入与 worktree 不被改写。旧任务关联永久受管，不因节点删除恢复为兼容模式。

受管任务 prepare/start/feedback/check/snapshot/accept 验证当前修订批准、明确任务关联、目标实例与固定绑定、依赖当前人工确认及有效接受。updateTask 拒绝 workflow_managed_task，需编辑新草案并显式关联/新建；interrupt/cancel/recovery/读取保持安全出口。批准后的源项目当前指针更新不改变任务已批准固定绑定，授权撤销/身份变化仍由 B06 实时校验。新草案可选择新绑定。旧非流程 Task 无 flow 字段，保留原契约，无迁移批准。

WorkflowView 节点状态独立于旧枚举：draft / approved / blocked / ready / in_progress / needs_recovery / awaiting_confirmation / completed；含 reason、taskId、approvalId、confirmationId、acceptance 摘要。成功运行未确认为 awaiting_confirmation；确认依赖最新有效 acceptance，外部修改/新反馈使确认不可用并阻塞后继；历史确认不删除。检查通过不自动完成；人工确认不等于集成/最终验收。图查询实时核验接受，执行命令再次核验依赖，无自动调度。

错误：400 invalid_input；404 not_found；409 version_conflict(currentVersion)、workflow_revision_stale、workflow_not_approved、workflow_already_approved、approval_dependencies_missing、workflow_dependencies_blocked、workflow_task_mismatch、workflow_task_already_linked、workflow_managed_task、workflow_confirmation_stale、active_run、execution_binding_unavailable；422 workflow_invalid_reference、workflow_cycle、engine_not_integrated（legacy 不支持流程执行绑定时 execution_binding_unavailable 为 422）。已有执行错误保持 B06。

流程元数据没有项目 SSE；成功写后刷新 workflow，运行视图消费原 task SSE 后刷新 workflow。建议活动期间定时 GET 检测外部磁盘变化；不把图事件/对话文本当授权依据。受管关联追加 task.workflow_linked（包含 projectId/nodeId/revision/approvalId）；其余任务事件维持原格式。公共文件仅正式发布后同步。

## 版本、历史与兼容的精确规则

节点状态映射优先保留正在执行/未知结果的事实，组织阻塞通过 reason 表达。未建立关联为 approved/task_not_linked；已关联且未准备为 ready/workspace_unprepared；工作区 preparing 为 in_progress/workspace_preparing；failed 为 blocked/实际 workspace.reason；needs_recovery 为 needs_recovery/实际 workspace.reason。Run running 为 in_progress，needs_recovery 为 needs_recovery/result_unknown，failed 或 aborted 且组织可执行时为 ready/run_failed 或 ready/run_aborted；成功后按 Acceptance 与确认推导 awaiting_confirmation/completed。工作区失败不会自动重试，图显示原因不表示已有恢复能力。

字段上限受 HTTP 总正文 256 KiB 共同约束。responsibility 非空最长 64000；ownerMemberId 可 null。未知额外节点 projectId、trusted、执行命令等字段拒绝。流程 version 可为 0，客户端 version_conflict.currentVersion 支持 0；负值或非整数不作为有效冲突版本。

所有新增 POST 成功 HTTP 200。saveWorkflow 返回创建时的不可变 WorkflowDraft，workflow-revisions 返回相同历史对象；approval/link/confirmation 会递增当前 workflow.version，但不修改历史 draft.version。approveWorkflow / confirmWorkflowNode 返回各自不可变记录，没有当前 version 字段；linkWorkflowTask 返回 Task。每次写后 GET workflow 获取下一条命令应使用的 version。幂等同键同正文重放不重复写入，改正文返回 idempotency_conflict；save/approval/confirmation 重放原不可变记录，Task 重放读取该任务当前事实。

首次整批批准提交全部节点；已有部分批准后，提交全部尚未批准的节点作为剩余批次。同修订已批准节点用新键再次提交返回 workflow_already_approved，应重读图并去除已批准节点；原幂等键可重放原批准记录。

每次编辑（包括成员/角色/负责人/层级/显示名）都生成新 revision，旧批准全部停止授权；affectedNodeIds 包含直接变更及旧/新依赖后继，角色/成员变更也传播，authorizationInvalidatedNodeIds 单列全部撤销的旧批准节点。owner 的替换不隐式修改节点执行者。空图可保存；空批准子集拒绝。

Task.flow={projectId,nodeId,revision,approvalId} 为可选增量字段，workflow-link 永久记录受管身份，节点删除不会让旧任务回到普通模式。每修订每节点最多一项关联；已有受管任务不能再次关联（包括同节点新修订），新批准后显式创建新任务，旧任务/会话/代码继续保留。已有普通任务只在字段、项目和固定绑定完全匹配时可显式关联，且全局无执行/未知结果/工作区准备；历史 run/acceptance 不获得事后授权。只有在受管 startRun 成功创建时保存 workflow-run 指向批准，确认必须匹配这一证据，关联前的成功轮次不能直接完成节点。

直接反馈仍是显式用户输入，保存在原 Run 输入记录；不会改写已批准 Task.goal/criteria/instance/baseline。TaskStatus/RunStatus 原枚举未改变：ready/in_review/accepted 仍表示执行/审查事实，Workflow completed 还需独立人工确认。Acceptance 有效不要求自动检查通过；检查作为独立证据继续展示。尚未确认的成功轮次是 awaiting_confirmation，接受失效仍保留历史人工确认但不算当前 completed。

当后继已在运行时依赖失效，节点保留 in_progress（或 needs_recovery）事实并带 workflow_dependencies_blocked 原因；不会自动取消、重放或调度，用户可中止，下一条受管写命令会被拒绝。新草案中的节点不伪装关联旧修订活动任务，历史 links 和 Task.flow 保留入口，任务详情/原 SSE 继续显示真实活动状态。

任务详情新增可选 workflowAuthorization={managed,eligible,reason?}；eligible 只表示流程组织授权及依赖核验，不保证资源空闲/工作区就绪/模型可用。普通任务 managed=false 保留原操作；受管任务不提供 edit，流程失效时过滤后续执行动作，保留已有 interrupt/cancel_check/recover_check 安全出口。HTTP 写命令始终再次执法，availableActions 不是权限来源。

F03 可使用：项目内角色与成员编辑/负责人选择、树与依赖图、全量草案编辑与影响列表、整批或闭包子集批准、显式任务关联/创建、人工节点确认及原因展示。本批无 AI 草案生成、角色全局目录、实例自动发现、多工具执行、队列、自动调度、交接或集成能力。

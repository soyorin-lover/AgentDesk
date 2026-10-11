# B08a API — 实例、配置与会话基础

2026-10-09。本批只接 Codex 业务适配，支持同工具多个受信实例，仍全服务串行。新增接口沿用 B05–B07 的 Bearer、Host、Origin、版本和幂等键规则。未启动 B08b/B08c，没有登录/额度/在线探针或真实模型调用。验证与公共三文件哈希见 [结果](CODEX-BATCH-08A-RESULTS.md)。

## 身份和实例查询

角色描述职责；成员属于项目组织；负责人引用成员。instance 是配置的执行目标，engine 是协议适配，model 是逐轮证据，native session 是所属工具的线程。它们不能互换。

| GET 路径（前缀 /api/v1） | 返回 |
| --- | --- |
| /agent-instances | {items: AgentInstance[]} |
| /agent-instances/:id | AgentInstance；未知 ID 404 agent_instance_not_found |
| /tasks/:id/session | {session: NativeSession 或 null} |

AgentBinding={instanceId,revision,configurationId}。configurationId 是不含路径/凭据的随机不透明 ID；服务端另存配置选择器摘要。修订不可变。AgentInstance 包含 id/name/engineId/binding?/available/reason?/identityEvidence/configuredModel?/health/capabilities。health.login/quota/online 均为 unknown，available 只表示启动注册有业务适配，不能证明账号可用。

固定兼容映射：codex-local → 顶层 Codex 配置；claude-local → claude_code 未接入；deepseek-local → deepseek_harness 未接入。占位实例可以出现在未批准草案中，批准/任务创建拒绝 engine_not_integrated；不能覆盖这三个保留 ID。旧 bootstrap.instances 保留兼容展示，发现全部实例与细分能力使用新接口。

能力 name 为 start/continue/interrupt/approval/recovery，分别含 businessSupport、protocolSupport、verification、evidenceRef。Codex 前三项业务 implemented，仅 fixture_verified；approval/recovery 业务 unsupported/unverified。协议支持不代表本产品提供该操作：引擎审批请求被拒绝，原生线程继续不等于重建未知进程。其他引擎协议 not_integrated。未实现的 approval/recover/steer 等业务 HTTP 路由继续 404，不暴露任意协议调用。

## 受信启动配置

HTTP 没有实例注册/更新接口，也不能提交二进制、命令、模型覆盖或会话 ID。BackendService.open 的 agentInstances 接收受信 {id,name,engineId,adapter?,configuredModel?}；只有 codex+adapter 可执行，其他引擎不接受 adapter。

serve 本地配置可添加 agentInstances 数组（最多 100）：Codex 条目 {id,name,engineId:'codex',codexBinary?,model?,transport?}；未接入条目只可 {id,name,engineId:'claude_code'|'deepseek_harness'}。顶层 codexBinary/model/transport 继续配置 codex-local。新增实例的 model/transport 各自配置，binary 缺省沿用顶层或 CODEX_BIN；无额外启动命令字段。既有配置文件未修改。

CodexAdapter.configurationIdentity 是拷贝并固定的 binary/args/model/transport/timeout/策略版本选择器摘要；它不证明宿主二进制内容、版本、外部配置或默认模型永不变化。公开实例不返回命令参数和路径。自定义适配器必须提供可信配置身份才可跨新对象证明；缺省只用当前适配器对象生命周期身份，换对象/进程后旧任务拒绝，不猜测配置相同。

## 固定任务与批准

Task 新增 agentBinding 和可选 nativeSessionRef；createTask 仍只接 agentInstanceId，服务端捕获配置。Run 固定相同 agentBinding 和实际 adapter 路由 engineId。配置变化创建新 revision；旧绑定不改写，运行前不相符则 409 agent_configuration_changed。实例移除为 unavailable，旧任务保留。可信原配置恢复后，服务端验证旧修订与当前配置摘要相同，才可继续旧绑定，不迁移会话。

WorkflowNode 新增可选 agentBinding。新草案省略时，服务端补齐当前可执行实例绑定并返回；用户批准该精确修订。显式旧绑定必须仍可验证。实例配置进入 nodeContract/影响传播/任务匹配，link、执行及依赖门禁重复校验。新实例 ID 可用于角色/成员/节点，未知 ID 拒绝。角色默认实例与成员实例仍是分开的组织字段。

历史 B07 草案/批准/Task 不自动补配置授权；缺少证明时 agent_configuration_unproven，需新草案、重新批准和新任务。旧 Task、输入、事件、审查、接受和批准仍可读取。普通历史任务的读/审查记录保留；执行/反馈拒绝不明目标。TaskDetail 新增 agentAuthorization:{eligible,reason?}，不可执行时隐藏 start/feedback；既有 workflowAuthorization 保持独立。

## 会话与逐轮证据

NativeSession={id,taskId,workspaceId,engineId,agentBinding?,nativeSessionId,ownership,createdAt}。id 为工作台引用，nativeSessionId 为所属 Codex thread.id，不能使用 session tree 的 sessionId 替代。归属固定到 task/workspace/instance/config/engine；继续前全部核对。重复会话不能认领到同实例的另一任务。返回错误 native ID/cwd/策略时拒绝；没有新建会话回退。

旧私有 session 保留并添加 ownership:legacy_unproven 引用，不绑定当前实例配置；新记录为 verified（指归属记录，非真实模型验收）。native_session_unproven、native_session_mismatch 等拒绝不明归属。未知运行继续 needs_recovery，全局阻塞；不自动重发、恢复或绕过隔离。检查恢复沿用 B04 的独立退出证据规则。

任务已产生轮次但缺少 native session 证明时，后续反馈直接拒绝 native_session_unproven，不能静默开新线程；仅第一轮启动自己的新意图可建立会话。

Run 新增 sessionRef/nativeTurnId/modelEvidence。modelEvidence 为 {status:'reported'|'unknown',actualModel?,configuredModel?,routingModel?,source}：

- Codex thread 返回 model：source=thread_configuration，configuredModel 有值，actualModel 无值，status unknown。
- 精确 thread/turn 的 model/rerouted：source=model_rerouted，routingModel 保存报告目标，仍 unknown；保留配置值。
- 缺少回报：unknown，不拿 model/list advertised 选择或上一轮模型填实际值。
- 可信适配器显式实际报告：source=adapter_reported/reported；确定性测试中的值仅证明夹具，不是实际模型验证。
- 旧 Run.model 保留，读取时 modelEvidence 标 legacy_unspecified/unknown。

Run.model 保留兼容值，Codex 下可能是配置/路由报告，界面不得据此标为“实际模型”。每轮初始化独立证据；结束轮次的迟到回调不改下一轮。

规范事件保留 message.delta/completed、activity.started/completed、diagnostic.recorded 字段，data.origin 由服务端覆盖注入 {instanceId,engineId,agentBinding,sessionRef?,nativeTurnId?}；事件仍有原 taskId/runId/seq。消息、活动和 reroute 必须精确且非缺失的原生 thread/turn；接受前事件缓冲后相关联。拒绝其他原始事件类型，Codex 不转发工具原文或敏感协议日志。

## 协议依据与前端冻结

本机 PATH 核验 codex-cli 0.154.0，其 generate-ts 本地模式生成 bindings（忽略目录 .agentdesk/b08a-protocol/ts）；未初始化运行服务或发起轮次。实际版本与历史 B01 记录不同，以本次生成协议为准。[官方 App Server 文档](https://learn.chatgpt.com/docs/app-server) 和 [官方集成说明](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server) 为辅助依据。thread 配置模型、轮次返回无物理模型字段、model/rerouted 不能互相冒充。

B07 源码及无模型 fixture 已在修改公共文件前复制到忽略目录 .agentdesk/b07-frozen/20261009-before-b08a，PUBLIC-SHA256.json 与正式 B07 哈希相符。F03 当前继续消费冻结 B07；需要时在独立端口、新临时库启动快照 fixture。既有服务未升级，开发中的新 API 不能视为旧端口现状。后续前端升级 B08a 必须同时同步公共三文件并核验哈希；本批没有浏览器验收。

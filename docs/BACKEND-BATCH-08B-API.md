# B08b API — Claude Code CLI 适配

2026-10-09。B08a/B07 HTTP、批准、固定绑定、会话与事件契约继续有效，全局串行。没有新增任意命令/会话/模型覆盖路由。源码接入不表示旧服务已升级，也不表示账号或真实模型可用。

## 协议与能力

本机 `claude --version` 与 npm 包均为 **2.1.284**；仅运行 version/help。采用官方 CLI `--print --verbose --output-format stream-json --input-format text`，不解析 TUI、不调用模型 API、不安装 Agent SDK。首轮生成 UUID 并传 `--session-id`，后续仅传服务端归属证明的 `--resume UUID`，不使用最近会话、fork 或新会话回退。

| 能力 | 业务 | 选定协议适配 | 证据 |
| --- | --- | --- | --- |
| start | implemented | implemented | 官方文档 + 本机帮助 + fake transport |
| continue | implemented | implemented，精确 resume | 同上；无真实续接 |
| interrupt | unsupported | not_integrated | 未采用 SDK control 或 Unix 信号冒充跨平台中止 |
| approval | unsupported | not_integrated | dontAsk/none 自动拒绝需交互操作；没有批准回调 |
| recovery | unsupported | not_integrated | resume 已知会话不等于恢复未知执行 |

查询沿用 GET `/agent-instances`、`/agent-instances/:id`、`/tasks/:id/session`。verification 只有 start/continue 为 fixture_verified；其余 unverified。protocolSupport 的 not_integrated 表示本批所选契约未适配，不表示 Claude 产品或 SDK 永远不支持该能力。health.login/quota/online 保持 unknown；available 只表示受信适配已注册，版本/账号/启动仍可能失败。bootstrap 的 Claude integrationStatus 在注册可执行实例时为 fixture_verified；完整实例仍查新接口。

服务端 detail 隐藏 Claude interrupt；POST `/runs/:id/interrupt` 直接调用返回 409 engine_capability_unsupported，不改变运行 phase。approval/recover/steer 仍无 HTTP 路由。Codex 中止与已有协议保持原样。

## 受信本地配置

serve 的 agentInstances 新增 Claude 条目：

```json
{"id":"claude-dev","name":"Claude 开发","engineId":"claude_code","claudeBinary":"本机原生可执行文件绝对路径","claudeVersion":"2.1.284","model":"可选的固定模型选择器"}
```

Windows 使用 npm 启动器实际指向的 bin/claude.exe；Linux 使用实际原生二进制绝对路径。拒绝 cmd/bat/ps1 包装器、任意 args、混用 Codex transport/binary 及未核验版本。不硬编码开发机路径到源码；既有配置未改。未提供 binary 的 Claude 条目只可作无模型选择器占位。

默认 claude-local 保留占位，三个保留 ID 不能覆盖；可执行 Claude 使用新的独立 ID。历史草案、批准、Task 和会话不自动换实例或配置，需按 B08a 新修订/批准/新任务。BackendService.open 仅受信代码可登记 ClaudeAdapter；注册引擎必须匹配适配器身份与能力，不能把 CodexAdapter 标作 Claude。

固定启动策略：safe-mode、restricted、strict-mcp-config 空配置、禁止 mcp__*、dontAsk、permission-prompts none、禁用 skills；内置工具仅 Read/Glob/Grep/Edit/Write，并预批准这五种工具。没有 shell、子代理、Web、MCP、后台命令或交互批准能力。CLI restricted 的文件目录限制不能替代 OS 沙箱，管理员管理策略仍可能影响执行；本批没有真实工具/权限或 Linux 验收。

configurationIdentity 固定 binary/version/model/超时/策略选择器。每轮先运行同一 binary 的只读 --version，精确不符或不可用时不发起模型请求，返回确定启动失败；退出无法确认仍隔离。依赖注入仅供可信测试，使用对象生命周期身份，不伪造跨进程配置证明。摘要不证明二进制内容、宿主策略或账号不变。

## 事件、模型与退出

- init 必须匹配选定 session_id、cwd 和 dontAsk 后才保存会话；assistant/user/result 必须匹配该 session；子代理 parent_tool_use_id 非 null 不转发。服务端仍固定 task/workspace/instance/config/engine，拒绝跨任务会话与迟到回调。
- 每次 CLI 调用只输入一轮文本，独立进程即本轮路由边界；不伪造 Claude nativeTurnId。输出为结构化完整文本块（message.completed，非逐 token）；同消息多文本块累计，uuid 去重。工具只转规范 activity 和状态，不保存工具参数/结果、思考、stderr 或协议原文。
- init.model 保存 thread_configuration/unknown；assistant.message.model 保存新增 source=assistant_message、routingModel、unknown，保留配置字段；actualModel 不填。result.modelUsage 不当作当前轮物理模型，因为 resume 可能含累计用量。旧 Run.model 仍是兼容显示值。
- success 必须匹配 result subtype=success、is_error=false 且进程 close code=0/无信号；permission_denials 非空为失败。结构化 error_* 或 is_error=true 为失败，但仍等退出。异常退出、会话/格式不符、无 init/终态、超时、截断或关闭未确认均不能宣称成功。
- close 负责退出本产品持有的 CLI，kill() 返回不是退出证据；等待 close，强制终止后仍无确认则抛出 process_exit_unconfirmed，沿用 quarantine/needs_recovery。close 不提供原生回合中止承诺，不回滚文件，也不重放未知请求。运行完成仍需人工审查/确认。

## 冻结、迁移与依据

F04 继续消费正式 B08a 快照 `.agentdesk/b08a-frozen/20261009-before-b08b`，其中 PUBLIC-SHA256.json 与 B08a 发布值一致，MANIFEST-SHA256.json 可核对快照。开发期不读半成品公共源。升级 B08b 时同时同步三个公共文件，按 [结果](CODEX-BATCH-08B-RESULTS.md) 核验哈希；execution.ts/api.ts 未增 HTTP 协议，types.ts 增模型来源与受信适配元数据。

不用迁移或改写旧运行库；新实例由新的受信服务配置显式注册，旧未授权任务继续拒绝。原端口、服务、令牌、配置和库没有重启或升级。

依据：[官方 headless](https://code.claude.com/docs/en/headless)、[CLI](https://code.claude.com/docs/en/cli-reference)、[流式消息](https://code.claude.com/docs/en/agent-sdk/streaming-output)、[会话](https://code.claude.com/docs/en/agent-sdk/sessions)、[官方 SDK 解析器](https://github.com/anthropics/claude-agent-sdk-python/blob/main/src/claude_agent_sdk/_internal/message_parser.py)。文档中高于本机版本的新能力不采用；例如 bare 在 v2.1.286 前有边界差异，且会改变 OAuth 行为，本批不用。无真实 Claude 模型轮次、登录/额度探针或执行验收。

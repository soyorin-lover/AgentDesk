# B08b 实施计划

2026-10-09。用户已授权立即实施；单主代理执行，不再采访、安装依赖或启动下一批。

目标：在 B08a 固定配置、批准、任务会话和全局串行基础上接入 Claude Code CLI 结构化执行。使用 writing-plans / test-driven-development / verification-before-completion 的计划与证据部分；用户最新授权覆盖重复确认、过量测试和独立审查流程。

- [x] 修改前冻结 B08a：`.agentdesk/b08a-frozen/20261009-before-b08b`；PUBLIC-SHA256.json 匹配正式三文件；MANIFEST-SHA256.json 保存全部快照文件摘要。不含凭据、运行库或依赖。
- [x] 本机只读 `claude --version/--help`：2.1.284，npm 启动器指向原生 bin/claude.exe。官方 CLI/headless、Agent SDK 流和会话文档确认接口；不运行模型探针。
- [x] 新增 ClaudeAdapter：固定 CLI 参数与版本检查，print + stream-json，每轮独立进程，首轮 UUID、后续精确 resume。只暴露 Read/Glob/Grep/Edit/Write，restricted + safe-mode + dontAsk，不开放命令、代理、MCP、交互审批。策略不能替代 OS 沙箱；受信管理员策略仍可能影响 CLI。
- [x] 注册受信本地 Claude 实例；复用 B08a 绑定与归属。默认 claude-local 仍为占位，不偷换历史任务；新增实例需独立 ID。能力按引擎表达，HTTP 中止必须检查支持；本批 interrupt/approval/recovery 禁用。
- [x] 少量 fake transport 行为测试：start/continue、事件归属、错误/缺失终态/退出确认、固定版本/配置、不支持命令拒绝；复用真实 Git/SQLite/HTTP 夹具保护会话隔离与旧授权。
- [x] 受影响测试开发中执行；收尾唯一一次既有全套146/146，合并 strict（58文件）与浏览器编译均通过。保存忽略目录日志，仅输出计数/退出码/失败摘要。发布 API、结果、公共三文件哈希及交接入口。

限制：无 Claude 真实轮次；模型配置/usage 不证明物理模型，逐轮 unknown。CLI print 无产品采用的跨平台原生中止契约，不模拟 SDK 控制包；退出不等于用户任务验收。丢失终态或退出证据保留 needs_recovery/quarantine。正常成功需结构化 success 且进程关闭 code=0。既有服务、数据库、配置、前端、路线只读；不提交、推送、部署或清理。

依据：[CLI](https://code.claude.com/docs/en/cli-reference)、[headless](https://code.claude.com/docs/en/headless)、[streaming](https://code.claude.com/docs/en/agent-sdk/streaming-output)、[sessions](https://code.claude.com/docs/en/agent-sdk/sessions)、[官方解析器](https://github.com/anthropics/claude-agent-sdk-python/blob/main/src/claude_agent_sdk/_internal/message_parser.py)。在线文档可能比安装版本新；仅采用本机帮助同时提供的标志，拒绝未核验版本。

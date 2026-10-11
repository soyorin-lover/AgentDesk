# 第 3 批前后端联调环境

第 4 批增量已完成，最新接口与验证见 [BACKEND-BATCH-04-API.md](BACKEND-BATCH-04-API.md) 和 [CODEX-BATCH-04-RESULTS.md](CODEX-BATCH-04-RESULTS.md)。原 4318 环境保留，本批另用 4319 提供最终代码；Claude 需同步公共客户端后连接。本文件下方“未修改契约”和 80 项验证结果属于第 3 批历史。

下一步由 Codex 提供独立服务，Claude 连接该服务进行浏览器验收。原有数据库、配置、令牌与前端文件不变。

## 服务边界

`node scripts/integration-server.ts` 启动真实 `BackendService` 和 HTTP API，使用真实 SQLite、专用 Git 示例源码、各任务独立 worktree、真实 Node 检查进程。仅执行适配器是确定性样例：每次等待约 1.2 秒，只修改任务 worktree 的 `sample.txt`；反馈会产生新的内容。中止会等待样例执行退出。没有导入 CodexAdapter，没有模型调用或模型回退。

这不是前端 fetch 替身，也不是真实模型验收。不要用它验证自然语言理解、真实 Codex 会话恢复、审批或模型行为。bootstrap 中兼容沿用的 `codex-local` / Codex 元数据不是本服务真实调用 Codex 的证据；项目名、运行 `model=deterministic-fixture` 和连接说明标识了样例执行。前端连接时应继续明确展示这一边界。

默认端口 4318，只监听本机。环境变量 `AGENTDESK_INTEGRATION_PORT` 可以指定其他端口（0 为自动选择）；占用时报错，不结束任何既有进程。Origin 仅允许 `http://localhost:5311` 与 `http://127.0.0.1:5311`。

每次启动创建新的独立环境，**不恢复上一次服务的数据**。忽略目录 `.agentdesk/project-integration/session-*/connection.json` 记录 URL、数据库、源码、worktree 根、令牌文件与 PID；令牌本身单独保存在 `access-token`，不写入日志或文档。源码在系统临时目录中，服务不自动清理。启动日志包含本次 connection.json 位置。本机后台启动信息另见忽略目录中的 `launch.json`。

## 给 Claude 的交接

1. 保留已有前端替身作为独立入口；本次选择实际 HTTP 连接，关闭该连接上的 fetch 注入。
2. 从本机本次 `connection.json` 读取服务 URL，从其 `tokenFile` 指向的文件读取令牌，勿将令牌提交或打印到报告。
3. bootstrap 应为 project 模式；唯一项目是 `integration-fixture`，名称明确标注确定性执行。任务实例仍选 `codex-local`。
4. 浏览器验证创建两任务、显式准备、启动、消息和状态流、快照、检查、接受、反馈使旧接受失效、隔离、中止，以及刷新重读和 SSE 重连。
5. 检查预设：`sample-pass` 校验样例文件并通过；`sample-fail` 预期失败；`sample-timeout` 预期超时；`sample-cancel` 等待手动取消。均为真实 Node 直属进程。
6. 当前 `needs_recovery` 没有恢复入口，不制造无法确认退出的故障；不通过删除租约、数据库或隔离标记绕过。Acceptance 查询、恢复流程等接口问题仍单独跟进。

此次未修改公共客户端或后端契约，不需重新同步 vendored 客户端。未修改 Claude 前端。接口命令测试不能代替 Claude 的浏览器验收；Linux 与真实模型仍未验证。

## 验证

`node --test tests/integration-server.test.ts` 覆盖真实 HTTP / Git / SQLite 链路、Origin 预检、无令牌拒绝、样例运行标识、快照、真实检查、接受、原始源码隔离、令牌文件和 SSE 响应。其余回归使用 `npm test` 和 `npm run typecheck`。

2026-10-09 实测：独立联调测试 1/1 通过，TypeScript 5.9.3 strict/noEmit 43 文件通过；全套 80 项中 79 通过，已有并发写文件测试的 writer 在 Windows 报 `UNKNOWN open sample.txt`，随后单独复测该文件 7/7 通过。未修改或跳过该测试，不能将此次全套记为全绿。后台服务实际认证 GET bootstrap/projects 成功，模式为 project。浏览器验收待 Claude 完成。

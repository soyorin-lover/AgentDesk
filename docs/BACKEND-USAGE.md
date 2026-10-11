# 本机后端使用说明

最新受信 agentInstances 启动配置、细分能力、历史配置与会话迁移边界见 [B08a API](BACKEND-BATCH-08A-API.md) 与 [正式结果](CODEX-BATCH-08A-RESULTS.md)。旧顶层 Codex 配置映射 codex-local，额外实例只从本地受信启动配置登记，HTTP 无任意命令/二进制或实例自授权入口。既有配置和服务未自动升级；下方早期 workspace 示例不包含本批完整配置。

第 3 批已增加可信项目登记、独立任务 worktree、多任务串行执行和真实检查。新模式配置、接口、状态及 Claude 对接见 [BACKEND-BATCH-03-API.md](BACKEND-BATCH-03-API.md)。项目模式必须另配数据库；原本地配置、数据库和会话未迁移，旧模式仍为一项任务。以下保留旧 workspace 模式的调用说明。

后端提供 API；独立 Claude 前端已有最小真实连接页，正式页面并未全部联调。执行成功、接受、集成和最终验收分别表达，本批只到接受。

浏览器客户端封装见 [API-CLIENT-USAGE.md](API-CLIENT-USAGE.md)，支持现有端点与带认证的事件流；它不表示 Claude 前端已经完成联调。

## 启动配置

需要 Node.js >=24.17、Git 和已登录的 Codex。准备一个**主项目之外**的专用测试 Git 仓库，要求有初始提交且首次绑定时干净。服务不会创建、清理、提交或合并该仓库。可以绑定单独准备的 worktree，但没有自动 worktree 管理。

将配置放进忽略目录，例如 `.agentdesk/local-backend.json`：

```json
{
  "workspace": "<专用测试仓库的绝对路径>",
  "port": 4317,
  "transport": "default"
}
```

路径由本机用户填写，Windows JSON 路径的反斜杠需要转义，也可使用正斜杠。可选 `database` 必须位于本项目 `.agentdesk/` 内；默认 `.agentdesk/backend/state.sqlite`。可选 `codexBinary`（也可通过 CODEX_BIN）、`model`、`allowedOrigins`。不支持任意 CLI 参数、shell 字符串、其他配置字段或请求覆盖执行策略。

```powershell
npm run serve -- --config .agentdesk/local-backend.json
```

配置也可通过 `AGENTDESK_CONFIG` 指定。默认监听 `127.0.0.1:4317`，启动本身不调用模型。终端打印地址和本机令牌文件路径，不打印令牌内容。所有 API 使用 `Authorization: Bearer <令牌>`；包括读取和 SSE。令牌保存在数据库同目录 `access-token`，每次服务启动生成。不要提交或分享令牌。

默认不允许带 Origin 的跨域访问；前端开发时显式配置对应本机来源，例如 `http://localhost:5173`。Host 只接受实际服务端口的 localhost 或 127.0.0.1；不支持远程暴露。前端 SSE 使用可带 Authorization 头的 fetch 流，不能将令牌放 URL。

`transport: "http"` 是已经用于内置 OpenAI/ChatGPT 路径的显式上游 HTTP 对照配置，stdio 通信仍不变；不用于自定义网关、不修改全局 Codex 设置。默认传输的历史问题仍未完成根因诊断。model 从当前服务器列表发现；列表不代表账户可执行，不自动换模。

## 单任务调用顺序

前缀 `/api/v1`。写请求需 JSON Content-Type 和 `Idempotency-Key`（1–128 字符）。每个新的用户动作使用新键；网络重试使用原键和完全相同的载荷。

1. `GET /bootstrap`：读取绑定环境和实例。当前执行实例 ID 为 `codex-local`；其他引擎明确未接入。
2. `POST /tasks`：`{title,goal,acceptanceCriteria:[...],agentInstanceId:"codex-local"}`。目标或条件未填完整则为 draft，填完整为 ready。一处绑定目录只能建立一项任务，重新启动也不释放这一绑定。
3. `PATCH /tasks/:id`：仅第一次执行前允许编辑，携带 expectedVersion。
4. `POST /tasks/:id/runs`：第一次只提交 `{expectedVersion}`。202 表示后端已记录意图；读取 Run 了解实际结果。
5. `GET /tasks/:id`：返回 `{task,run,snapshot,lastEventSeq,availableActions}`。`GET /runs/:id` 返回运行对象和可选 `input`（本轮提交给智能体的用户输入，用于恢复对话；首次含目标与验收条件，不含原生系统指令）。该接口同样需认证，旧记录缺失时不能猜测输入。`GET /tasks` 提供分页列表。
6. `GET /tasks/:id/events?after=0&limit=50`：返回 `{items,nextCursor}`。从 nextCursor 继续补读。`GET /tasks/:id/events/stream?after=...` 为 SSE，seq 为 event id，支持 Last-Event-ID。关闭客户端不取消运行。
7. `POST /runs/:id/interrupt`：携带运行 expectedVersion；202 只表示请求已记录。真正 interrupted 才映射 aborted；已完成的运行保留真实结果，不伪造中止。
8. 无活动运行后 `POST /tasks/:id/snapshots`：携带任务 expectedVersion，生成真实差异快照。`GET /tasks/:id/changes` 只返回最近保存版本，不自动扫描磁盘。单文件读取为 `GET /snapshots/:id/files/:fileId`。
9. `POST /tasks/:id/accept`：`{expectedVersion,snapshotId}`，只允许当前成功运行的完整且仍匹配磁盘的快照。返回更新后的 Task，接受记录持久化。旧版本返回 snapshot_stale。检查状态明确为 not_run，不能解释为测试通过。
10. 要求修改时 `POST /tasks/:id/runs`：`{expectedVersion,input:"具体反馈"}`，产生新运行并使旧接受失效；同一引擎会话续接上下文，保留历史。

所有版本从最近一次查询取得；幂等查询优先于版本检查。409 表示版本、忙碌或快照冲突；422 表示实例/能力不可用。原生标识、执行参数和原始上游错误不作为 API 业务数据返回。HTTP 错误当前为稳定的机器错误码，中文展示由前端映射。

快照覆盖 staged、unstaged、untracked 和删除；忽略文件不进入 Git 差异审查。Git HEAD 改动、二进制、符号链接、子模块、不可读取或超限内容不能接受；仍保留明确的不完整标识。服务不回滚文件，接受也不提交或集成。

## 重启、失败与数据

任务正文、归一化可见答复、差异和事件保存在本机 SQLite；可能包含用户代码或敏感内容，不承诺可靠自动脱敏。原始协议帧、stderr、认证配置和完整工具输出不持久化。运行目录不得整体上传。

服务重启恢复记录；结果未知的活动运行变为 needs_recovery，禁止重发或接受，本批没有解除接口。上次明确终结的会话可以在用户再次反馈时恢复上下文，不保证恢复外部系统进程。

完成状态等到直属 App Server 退出确认后才对外发布；这不保证所有外部工具的系统进程退出。若直属进程退出无法确认，工作区 Git 元数据内保存隔离标记，后续启动拒绝使用该目录；保留现场供后续恢复设计处理，不自动清理。数据库和工作区均使用本机独占租约；PID 不确定、损坏租约或遗留 guard 均保守拒绝，不杀其他进程。

单文件差异上限 1 MiB、快照总量 10 MiB；请求上限 256 KiB；可见事件累积 10 MiB 或 100000 条后退役执行并报告结果未知。SSE 最多 8 客户端，等待 drain 且慢连接 5 秒后断开，客户端可按最后收到的 seq 补读。没有完整日志查看器或大文件审查器。

## 工程与真实验证

```powershell
npm test
npm run typecheck
npm run verify:backend
```

typecheck 仍需本机已有 TypeScript/Node 类型路径，通过 `TYPESCRIPT_PATH` 和 `NODE_TYPES_ROOT` 传入，不提交机器路径。没有新增第三方依赖或独立 linter。

`verify:backend` **会调用真实模型并消耗额度**，可通过 CODEX_MODEL/CODEX_TRANSPORT 显式选择已发现的模型和配置。它只创建 `.agentdesk/backend-verification/` 内唯一的新样例和数据库，不重用用户仓库；样例基线提交由验证工具创建。执行两轮精确样例改动、接受与反馈、事件补读和中止，保存脱敏 summary.json；不输出任务正文和模型回复，不清理样例。这个验证工具对忽略目录内的新样例采用单独的主目录排除边界，正常 serve 入口仍拒绝绑定主项目及其子目录。

最新结果见 [CODEX-BATCH-02-RESULTS.md](CODEX-BATCH-02-RESULTS.md)。Windows 证据不能代替 Linux 验证。

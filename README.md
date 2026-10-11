# AgentDesk

面向独立开发者的多引擎 Coding Agent 开发工作台，长期至少管理 Codex、Claude Code、DeepSeek Harness；当前只有 Codex 具有真实接入验证证据。

## 当前阶段

2026-10-09 B08a 已发布受信实例/能力查询、固定配置、任务会话归属与逐轮引擎/模型证据，最终 140/140、strict 56 文件、浏览器编译和 CLI 专项通过。见 [B08a API](docs/BACKEND-BATCH-08A-API.md)、[结果/哈希](docs/CODEX-BATCH-08A-RESULTS.md)、[最新交接](docs/BACKEND-HANDOFF.md)。只有 Codex 业务适配、仍全局串行；无证据的物理模型与账号状态 unknown。F03 继续使用冻结 B07；既有服务/配置/运行库未升级，无模型轮次或主仓库提交/推送。停在 B08a，不自动启动 B08b/B08c。下方早期状态保留为历史。

2026-10-09 第 7 批流程组织与授权基础已正式发布，最终全套 126/126、严格类型和浏览器编译通过；见 [B07 接口](docs/BACKEND-BATCH-07-API.md) 与 [结果](docs/CODEX-BATCH-07-RESULTS.md)。成员/角色/负责人、树与依赖 DAG、精确修订批准及人工节点确认分别存证；未批准受管任务的直接执行命令被拒绝。旧任务与 B06 兼容，既有服务未升级，无模型调用、提交或推送。B08 未启动。

2026-10-09 第 6 批已新增受信多项目执行绑定，任务固定绑定修订和 commit；重绑或源 HEAD 推进不替换历史任务代码，保留原脏源码及全服务串行保护。见 [B06 接口](docs/BACKEND-BATCH-06-API.md)、[结果](docs/CODEX-BATCH-06-RESULTS.md) 与 [最新交接](docs/BACKEND-HANDOFF.md)。既有在线服务未升级，无模型调用、提交或推送。下方早期阶段保留作历史。

2026-10-09 第 5 批已新增项目空间持久创建/详情/编辑、已有仓库只读检查与 commit 基线关联。新空间不扩大执行权限，未提交改动不自动进入 worktree。见 [第 5 批接口](docs/BACKEND-BATCH-05-API.md)、[结果](docs/CODEX-BATCH-05-RESULTS.md) 与 [最新剩余路线](docs/PROJECT-REMAINING.md)。首版目标和前端 Codex 分工以 [最新产品决定](docs/PRODUCT-DECISIONS-2026-10-09.md) 为准，下方早期说明为历史。

第 3 批后端已实现可信项目登记、独立任务 Git worktree、多任务串行执行、真实有界检查与过时判断，保留既有事件补读、diff、反馈和人工接受。旧 workspace 模式及数据库继续兼容，新项目模式需独立配置与数据库。使用 Node.js 24.17+ 内置 TypeScript、SQLite 和测试框架，无新增第三方依赖。独立前端连接页仍连接旧服务，正式页面未完成全部联调；代码集成、队列、其他引擎及自动恢复尚未实现。

在 Windows 开发，目标支持 Windows 和 Linux。Codex 负责执行接入、后端和集成；Claude 负责前端设计与实现；DeepSeek 负责范围明确的辅助工作。

## 文档入口

- [最新后端交接](docs/BACKEND-HANDOFF.md)
- [第 3 批后端范围](docs/CODEX-BATCH-03.md)
- [第 3 批实施计划](docs/superpowers/plans/2026-10-08-backend-batch-03.md)
- [第 3 批结果与边界](docs/CODEX-BATCH-03-RESULTS.md)
- [第 3 批公共接口与 Claude 对接](docs/BACKEND-BATCH-03-API.md)

- [产品范围](docs/PRODUCT.md)
- [第一批 Codex 接入计划](docs/CODEX-BATCH-01.md)
- [第二批后端范围建议](docs/CODEX-BATCH-02.md)
- [通用任务 / 运行 / 事件接口草案](docs/BACKEND-API-DRAFT.md)
- [本机后端使用说明](docs/BACKEND-USAGE.md)
- [前端联调 API 客户端](docs/API-CLIENT-USAGE.md)
- [第二批结果与限制](docs/CODEX-BATCH-02-RESULTS.md)
- [Claude 前端交接](docs/CLAUDE-HANDOFF.md)
- [并行协作规则](docs/COLLABORATION.md)
- [环境验证记录](docs/ENVIRONMENT.md)

## 运行

需要 Git、Node.js 24.17+ 和已登录的 Codex。可先执行 `codex login status`；验证器不读取或复制认证凭据。

```powershell
npm test
# 可使用已安装的 TypeScript；见下文 typecheck 说明
npm run typecheck
# 默认使用 Codex 配置的传输；仅验证单会话闭环
npm run verify:codex -- baseline
# 本机已验证的 HTTP/SSE 对照模式，仅作用于子进程，不改全局设置
$env:CODEX_TRANSPORT = 'http'
npm run verify:codex -- all
```

Linux shell 对应 `CODEX_TRANSPORT=http npm run verify:codex -- all`；该命令说明不代表 Linux 已实测。

可选 `CODEX_BIN` 指定可执行文件，`CODEX_MODEL` 从服务器 `model/list` 中选择模型。未指定模型时使用服务器列表标记的默认项，避免继承未列出的旧配置。模型在列表中不保证当前账户可以执行。

阶段参数：`baseline`、`interaction`、`approvals`、`parallel`、`all`（默认）。建议首次顺序执行 `all`。后续阶段重试需先有 baseline 成功证据。Node CLI 退出码 0 表示所选阶段全部通过，1 表示失败，2 表示有未触发或未执行项；npm 可能将非零状态统一报告为 1，应同时读取摘要。

类型检查使用已有 `typescript` 模块。也可设置 `TYPESCRIPT_PATH` 指向编辑器捆绑的 `typescript.js`，`NODE_TYPES_ROOT` 指向包含 `node` 类型的 `@types` 目录，然后执行 `npm run typecheck`。机器路径仅通过环境变量传入，不提交。未提供编译器时该命令明确退出 2；运行验证器和测试不需要编译器。

每次运行只创建 `.agentdesk/runs/<唯一标识>/` 下的新示例 Git 仓库，并保存脱敏 `summary.json` 与固定样例内容的 `.diff`。不会对主仓库发起测试改写，也不会清理已有样例。请求/事件日志只在内存处理；摘要不保存原始模型文本、命令输出、stderr 或认证数据。Codex 自身仍按正常机制在其用户目录保存会话，供 `thread/resume` 使用。

**真实调用会消耗账户额度。** HTTP 模式针对内置 OpenAI/ChatGPT 登录，用独立 provider ID 临时关闭上游 WebSocket；它不用于自定义网关，也不改变本地 stdio 通信。

## 本批证据

2026-10-08（Asia/Shanghai），Windows / Codex 0.154.0：HTTP 模式下文本、文件 diff、上下文、重启恢复、执行中补充与中止、文件审批接受/拒绝、两个工作区并行修改均已在分阶段运行中通过。Linux 尚未实测。默认上游路径出现错误/超时，默认模型的后续阶段曾返回 `usageLimitExceeded`；详见 [真实验证矩阵](docs/CODEX-BATCH-01-RESULTS.md)。

## 后续步骤

第 3 批后端链路已完成。下一批可由 Claude 按公共客户端接任务切换、准备工作区及检查状态；真实模型、浏览器和 Linux 验证需另行安排，不能把替身链路当作这些能力的验收。集成与工作区恢复/回收需独立规划，不自动启动下一批。

## 新聊天接手

先阅读 [项目交接说明](docs/HANDOFF.md)，再执行当前批次。

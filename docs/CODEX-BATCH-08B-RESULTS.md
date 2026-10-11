# B08b 结果

2026-10-09。Claude Code CLI 适配、受信实例配置与能力门禁已实施，交付限于源码与无模型 fixture。接口与能力矩阵见 [API](BACKEND-BATCH-08B-API.md)，决策见 [计划](BACKEND-BATCH-08B-PLAN.md)。全服务仍串行，B08c/并行/交接/宿主没有启动。

## 修改范围

- 新增 `src/backend/claude-adapter.ts`：只读版本预检、固定原生 executable/模型/策略、精确新建和续接会话、结构化可见消息与活动、结果加进程退出确认；受限文件工具，无任意 args 或交互审批。
- `src/backend/agent-instances.ts`、`src/serve.ts`：受信 Claude 实例登记，保留默认占位；不允许 Codex 冒充 Claude，不修改已有本地配置。
- `src/backend/types.ts`、`src/backend/service.ts`：Claude 自有能力矩阵、HTTP 中止硬拒绝、新模型来源 assistant_message/unknown。复用精确批准、固定配置/执行绑定、跨任务会话保护和未知结果隔离，Codex 行为保留。
- 新增一个 fake CLI fixture、5 项协议/集成测试；现有 CLI 文件增加1项配置拒绝测试。复用原 Git/SQLite/HTTP 夹具，没有新测试框架/依赖/独立审查代理。
- 三份本批文档和交接入口；公共 `api.ts`、`execution.ts` 保持字节不变。前端、DESIGN、HTML、总路线未修改。

## 验证证据

唯一一次收尾 `npm test`：**146/146 通过**，0失败/取消/跳过，exit=0，约281秒。包含新增6项及现有 Codex/B07/B08a 全部回归，没有因文档更新重复运行全套。

- 初次新增测试因模块尚不存在而失败（1 个测试文件、exit=1）；没有将其冒称5项独立行为 RED。
- 首轮 Claude + registry 8/8；最终受影响 Claude/CLI/B08a 16/16，exit=0（约95秒）。覆盖精确续接、归属不符不泄露、格式/终态/退出错误、未退出不成功、unsupported interrupt、版本/包装器/任意参数拒绝，以及旧授权/旧会话拒绝。
- 最终合并检查：TypeScript 5.9.3 strict/noEmit **58 TS 文件通过**、exit=0；公共客户端浏览器编译 exit=0。首次合并检查也通过，后续仅新增输入流错误处理后收尾合并复验。没有 build/lint 脚本，没有安装工具。
- B08a 冻结 MANIFEST 的32份文件重新核对：0 摘要不符；本批8个源码/测试文件尾随空白0项。没有依赖空 git diff 作为审查证据：仓库仍无首次提交、文件均未跟踪。

命令：`node --test tests/backend-claude.test.ts tests/backend-agent-instances.test.ts`；`node --test tests/backend-claude.test.ts tests/backend-cli.test.ts tests/backend-batch08a.test.ts`；收尾 `npm test`；合并 `npm run typecheck` 与已有 tsc 的 `--strict --noEmit --target es2023 --module nodenext --allowImportingTsExtensions --lib es2023,dom,dom.iterable src/client/api.ts src/client/execution.ts`。使用既有 TypeScript 5.9.3 和 Node 类型路径，无安装。日志仅保存在忽略的 `.agentdesk/b08b-evidence/`。

## 发布三文件 SHA-256

| 文件 | SHA-256 |
| --- | --- |
| src/client/api.ts | EAC5D2C41B707CFEC3CEF348C07DE0F96404D1E085D21BAD4912AAF2DE53D89D |
| src/client/execution.ts | 8A5207C059409FD1AE3A45C2588D2FEF380282D33420A0D016526969440373AF |
| src/backend/types.ts | F4A58760CE0E644C146B141A3CAF6CFD940C1C84ABE8B2729B269F18139417A9 |

## 协议证据和边界

只读发现 Claude Code 2.1.284，本机帮助确认使用的标志；npm 指向原生 bin/claude.exe，其本次 SHA-256 为 0416631E846F743110DA5282409776FA1313E65F33A588AAE066EAF8DB0FDA7D（只作本机发现证据，产品不保证内容恒定）。官方文档与解析器链接见 API；没有依赖猜测原生控制包。

start/continue：implemented、fixture_verified；interrupt/approval/recovery：unsupported、unverified。CLI 仅使用 Read/Glob/Grep/Edit/Write，无命令执行工具，不能用该适配宣称自动测试、完整工具链或跨平台进程树中止已验收。管理员策略仍可能影响宿主；进程 close 不是 OS 沙箱。模型配置与消息头保持 unknown，不报告物理模型。

无真实 Claude 模型轮次、额度/登录探针、账号配置变更、SDK 安装、真实文件工具/权限验收、Linux 或浏览器验收。没有改既有服务、端口、运行库、令牌或配置；已有在线端口仍是原版本。没有提交/推送/部署/删除工作区，也没有向其他聊天发消息。

F04 开发期间继续用 `.agentdesk/b08a-frozen/20261009-before-b08b`（含 src/scripts/package/API/RESULTS 和哈希，不含凭据/库/node_modules）。B08b 升级需要消费正式三文件并在独立受信本地配置登记新 Claude 实例；历史缺少授权/配置证明的 Task 仍不能执行，不自动迁移或恢复未知结果。本批完成后停止，后续真实验收和 B08c 需单独授权。

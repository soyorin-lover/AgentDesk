# FRONTEND F04 交付结果

2026-10-09。范围仅 F04：节点工作区、实例/能力事实、逐轮模型证据、临时双会话查看。基线为正式 B08a，未接 B08b，未启动 F05。写入只在前端工程，主项目后端、公共源、设计稿和交接均未修改。

## 实际实现

- 复用 F03 节点任务入口与 LiveWorkbench，在同一工作视图提供目标/验收摘要、会话、变更快照、检查和 worktree 辅助面板。左上统一返回，图位置保留；未增加重复返回入口、IDE 假入口或自动交接。
- 默认单会话；可从当前项目已加载任务中临时选择第二会话，并可继续载入更多任务。两边复用相同工作台，保留各任务草稿和阅读位置，独立事件订阅；关闭第二视图取消订阅，不中止后端任务。1100px 以下上下布局，也可显式返回单会话。比较视图不代表并行执行已实现，后端仍全服务串行。
- 通过 GET agent-instances 获取全部服务登记实例，普通任务创建、角色和成员选择均使用返回列表。展示工具品牌、实例 ID/名称、业务能力、协议支持和验证级别；available 仅表示服务适配事实，登录/额度/在线均明确为 unknown。没有实例注册/编辑保存按钮；Claude/DeepSeek 仅展示未支持事实。
- 节点草案保存和审阅保留服务返回的 agentBinding，普通改名不会丢失固定配置。显式换实例才移除旧绑定，由服务在保存时捕获当前配置；同一实例要重新捕获配置也需用户明确操作、保存新修订并重新批准。正式 B08a 的角色/成员只有实例 ID 字段，未虚构配置修订字段；任务/节点/运行按服务实际字段固定配置。
- 每轮从 GET runs/:id 读取 engineId、agentInstanceId、agentBinding 和 modelEvidence。只有 status=reported 且 actualModel 有值时显示“实际模型”；configuredModel/routingModel 分别标“配置模型”“路由模型”。缺失证据、unknown 与 legacy Run.model 均不冒充实际模型。
- 任务辅助信息只展示工作台会话引用、归属等级与工具，不展示 nativeSessionId 或原始协议日志。没有归属响应时明确未核验，不猜测建立了新线程。
- 执行动作同时受 availableActions、实例 businessSupport、agentAuthorization 和 workflowAuthorization 限制。实例事实缺失、详情正在读取/失败、事件断线时关闭不安全写入口；服务端门禁保持。引擎审批/原生恢复/steer 未提供入口，B04 检查恢复仍遵循其独立服务契约。
- 配置失效与旧修订任务显示原因和重新建立草案/批准/任务的安全出口；保留历史任务入口、未知结果原键重试、旧记录只读和接受失效展示。

## 契约冻结

主项目 .agentdesk/b08a-frozen 在本次检查时尚无文件；正式源三文件与发布哈希完全一致。对主项目 src 下全部 24 个文件执行复制前/复制后源文件及副本哈希核验，建立自有忽略快照 `.agentdesk/f04-b08a-backend`。未从进行中接口猜字段。fixture 只加载该快照，启动时核验全部文件哈希；收尾 24/24 再核验一致。

完整同步三文件，客户端清单见 [FRONTEND-CLIENT-SNAPSHOT.json](FRONTEND-CLIENT-SNAPSHOT.json)：

| 源文件 | SHA-256 |
| --- | --- |
| src/client/api.ts | EAC5D2C41B707CFEC3CEF348C07DE0F96404D1E085D21BAD4912AAF2DE53D89D |
| src/client/execution.ts | 8A5207C059409FD1AE3A45C2588D2FEF380282D33420A0D016526969440373AF |
| src/backend/types.ts | A2A87AF620D2547D167DDC509B6727AA0E453ECB241245DD90B239D54C055700 |

旧在线后端不会自动升级。验收使用自有动态端口，未修改既有端口、配置或运行库。

## 修改文件

- `src/v2/live/evidence.ts`、`evidence.test.ts`：模型证据标签、业务能力/授权过滤与显式实例变更的配置保持规则；新增 3 项关键行为测试。
- `src/v2/live/instances.tsx`：可取消实例查询与事实展示。
- `src/v2/live/session.ts`、`LiveWorkbench.tsx`、`presentation.ts`：独立查看选择、轮次元数据、会话归属、安全门禁、实例创建选择与错误解释。
- `src/v2/projects/ProjectPortal.tsx`：临时第二会话、独立订阅开关和载入更多任务。
- `src/v2/workflow/DraftEditor.tsx`、`WorkflowPage.tsx`、`WorkflowGraph.tsx`：多实例事实、固定配置审阅与明确重新捕获；继续使用 F03 流程状态控制器。
- `src/v2/live/double.ts`：为原显式 fetch 演示替身补只读实例/空会话响应，保持旧工作台展示兼容；未把替身当真实 HTTP 证据。
- vendored 三文件、`v2.css`、`package.json` 的现有测试入口，以及本结果和客户端哈希清单。
- `scripts/f03-fixture.ts` 增加可选 --f04：复用既有真实 HTTP/Git/SQLite/确定性执行器，默认 F03 路径不变；F04 使用冻结 B08a、多 Codex 实例与只读历史/失效配置样例。
- `scripts/f04-browser.mjs`：复用既有 Playwright、连接与证据约定的一轮集中验收，没有新增依赖或另建验收框架。

## 验证

遵循用户本批减量要求，没有默认审查代理、逐字段测试、样式测试或 F01–F03 全套 DOM 重跑。

- `node --experimental-strip-types --test src/v2/live/evidence.test.ts`：新增实现缺失时 RED（模块尚不存在），实现后 3/3 GREEN；不是旧功能测试失败。
- `npm test`：本批唯一一次现有全套回归，75/75，0 失败/取消/跳过，退出 0。比 F03 增加 3 项。
- `npm run build`：包含 tsc --noEmit 与 Vite，94 模块，退出 0；没有另跑 typecheck。实际修改双会话辅助行高度后只补跑受影响 build，没有重复回归。
- 两个验收脚本 `node --check`：退出 0。工程无 lint 脚本，静态检查由实际构建中的 TypeScript 完成。
- 精简真实 DOM：5 组通过，页面错误 0，覆盖节点进入/返回图位置；unknown、配置/路由与 reported 实际模型标签、两个实例和健康 unknown；同项目两会话草稿/滚动/输入与事件隔离；800px 上下布局和宽度；固定配置失效、缺配置历史任务只读、服务生成配置在编辑保存后保留、旧修订历史入口及反馈禁用。
- 一条第二任务反馈经真实 HTTP 确定性执行器结束；收尾额外只读核验最新轮次 input=SECOND_EVENT_UNIQUE、status=succeeded，主任务运行 ID 未被替换，两个任务原生会话引用独立。服务也实际拒绝历史/失效配置任务启动。
- 客户端 3/3 哈希与冻结后端 24/24 文件收尾一致。

证据索引 `.agentdesk/f04-verification.json`；完整构建/测试/浏览器日志均在自有忽略目录。浏览器结果、截图与独立数据库位于自有 fixture 临时根的 browser-f04-*。截图仅在连接后保存，不包含令牌。验收使用既有 Windows Node、Git、Edge 和已安装 Playwright；当前自有 fixture 保留，不清理用户工作区或旧运行库。

复跑先按哈希恢复前端自有 B08a 快照，再 `node scripts/f03-fixture.ts --f04` 创建新自有环境；使用已有前端开发入口及 PLAYWRIGHT_MODULE_PATH，运行 `node scripts/f04-browser.mjs <connection.json>`。浏览器脚本只用于新 fixture，会创建和编辑其中的测试节点/任务，不针对用户在线库运行。

## 边界与交接

所有执行证据来自确定性适配器，不证明真实 Codex 登录、额度、在线或物理模型。reported 的 fixture 模型标签只证明 UI 按正式证据字段呈现。Claude/DeepSeek 业务接入、并行执行、跨引擎交接、原生恢复、系统通知、IDE 宿主和 Linux 未验证/未实施。

草稿、阅读位置和未知请求保留在当前前端连接内存中；整页刷新/退出不承诺持久恢复。双会话按 projectId/taskId 隔离，第二视图仅限同项目；返回图再进入时默认单会话。

前端目录没有可用 Git 仓库，保留既有未提交源码，未自动初始化或提交。没有新增依赖、模型调用、额度探针、跨对话消息、提交、推送、部署或自动清理。完成后停在 F04，F05 与 B08b 需另行授权。

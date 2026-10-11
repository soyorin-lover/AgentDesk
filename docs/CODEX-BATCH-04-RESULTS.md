# 后端第 4 批结果

2026-10-09。本批继续主项目后端与公共客户端，不修改 Claude 前端、原数据库/配置/令牌；无模型调用、依赖安装、提交、推送、部署、Git 集成或工作区清理。

## 已实现

- 接受记录保存摘要和失效原因，新增权威摘要读取；外部修改被发现后持久失效，反馈原因和旧记录原因可重读，无法核验明确显示 unverifiable。
- 真实全量总览与可分页待处理事项读取，按项目过滤；当前轮次之外的旧检查失败不继续显示为待处理。
- 检查确定结束时先保存结果与绑定，再扫描 Git；后续扫描失败/记录中断可消费该证据恢复，严格版本/幂等、保留 stale、要求重查。
- 无退出证据的检查、模型未知、准备未知仍拒绝冒险恢复。诊断明确给出原因；不接受浏览器自己宣称退出，不删除 quarantine。
- bootstrap 明确 codex / deterministic 执行模式；版本冲突原有顶层 currentVersion 已填充，客户端安全保留该字段。

接口及前端接法见 [BACKEND-BATCH-04-API.md](BACKEND-BATCH-04-API.md)。离首版和长期完整产品的剩余步骤见 [PROJECT-REMAINING.md](PROJECT-REMAINING.md)。

## 修复与审查证据

独立只读审查确认并复现：接受扫描期间检查完成，旧任务对象会覆盖新增版本（8 被覆盖为 8，正确应为 9）。已补失败回归并在失效事务中重读任务；还补了旧轮次失败检查不进入当前待处理的回归。

上一轮已记录的 Windows 并发测试写入故障在本批完整回归再次出现：writer 重复截断 sample.txt，报 UNKNOWN open。只修改该测试 fixture，先设固定长度，再用 r+ 改写等长内容；不吞写入异常，断言扫描期间确有成功内容变化。修改后曾完成 86/86 全套；后续审查修复新增两项回归，最终验证以本文件的最终记录为准。

## 本机联调环境

原 4318 环境保留。另为本批提供独立 4319 样例服务，真实 HTTP/Git/SQLite、确定性执行器、无模型调用。连接信息在忽略目录的 `.agentdesk/project-integration/batch04-launch.json` 所指日志中，日志指向本次 connection.json；connection.json 给出 tokenFile 路径，不包含令牌正文。必须以本次最终启动信息为准。

不将旧后台进程当作热更新服务；公共客户端同步后让 Claude 连本批服务并验收浏览器行为。真实模型、浏览器、Linux、代码集成及最终验收不在本次完成证据内。

## 最终验证

- `npm test`：**88/88 通过**，约 92.4 秒，含 8 项本批测试；没有跳过 Windows 并发文件修改回归。
- `npm run typecheck`：TypeScript **5.9.3，45 文件 strict/noEmit 通过**。使用已安装编译器与 Node 类型的环境变量路径，未安装依赖。
- 浏览器安全客户端编译：`tsc --strict --noEmit --target es2023 --module nodenext --allowImportingTsExtensions --lib es2023,dom,dom.iterable src/client/api.ts src/client/execution.ts` 退出 0。
- 10 个本批源码/测试文件无尾随空白；独立只读审查发现的并发缺陷已复现并通过回归。
- 最新后台服务已加载最终代码：认证 GET bootstrap / overview / attention 成功，project + deterministic、空任务列表。只替换了本批自行创建且身份核对、确认零任务的临时实例，原 4318 服务未动。最终连接位置通过忽略的 batch04-launch.json 查找，PID 及路径不作为永久部署约定。

修改范围：`src/backend/{types,service,queries,store,http}.ts`、`src/client/api.ts`、`scripts/integration-server.ts`、本批测试及两个相关回归、接口/结果/交接/剩余路线文档。保留旧数据与前端；未提交。

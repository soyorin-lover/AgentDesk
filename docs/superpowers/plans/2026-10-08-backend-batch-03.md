# Backend Batch 03 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking. 用户已授权新对话执行，不需再次选择执行方式。

**Goal:** 独立任务 worktree、多任务串行执行，以及能辨认过时结果的真实检查。

**Architecture:** 保留 legacy workspace 配置，增加可信项目模式。任务独立绑定 worktree 和会话；模型与检查共享保守资源门禁。CheckRun 单独持久化，以快照及内容摘要判断有效性。

**Tech Stack:** Node.js 24.17+、TypeScript、node:sqlite、node:test、Git、现有 Codex adapter。

**Spec:** [第 3 批范围](../../CODEX-BATCH-03.md)，接手先读 [最新交接](../../BACKEND-HANDOFF.md)。

## Global Constraints

- 不修改 Claude 页面；不自动提交、推送、合并、部署或删除数据。
- 没有新增依赖的授权；优先内置模块和现有工具。
- 原生子代理仅 gpt-6.1-sol，优先 solo。主仓库没有 HEAD，不自动首次提交以创建代码 worktree。
- Windows/Linux 为目标，跨平台路径、子进程参数数组、shell:false；Linux 未运行须标明。
- 默认使用确定性引擎替身，不新增真实模型调用，不重跑既有真实验证脚本。
- 保留现有服务配置、数据库和令牌；新模式用独立 fixture/config/database。

## Review Focus

- Windows 大小写、junction、祖先路径逃逸：任务 2 覆盖根目录校验。
- Git 成功但落盘失败：任务 2 覆盖持久准备意图及重启辨认。
- 多任务共用会话/事件/快照：任务 3 验证隔离及旧库反馈。
- 检查超时进程未退出：任务 4 验证阻止资源复用。
- 页面读到旧绿色结论：任务 5 验证外部修改和新运行触发 stale。

## 文件与拟新增接口

新增 src/backend/projects.ts（可信项目、工作区准备）、checks.ts（检查进程与记录）。复用 store.ts 的持久化/幂等、repository.ts 的租约/摘要，service.ts 编排，http.ts/client/api.ts 对外，serve.ts 解析本地配置。不为新功能重构无关模块。

拟新增：ProjectRegistry.list(): Project[]；prepare(taskId, projectId): Promise<Workspace>；BackendService.prepareWorkspace(taskId, expectedVersion)、startCheck(taskId, presetId, snapshotId, expectedVersion)、listChecks(taskId)。核对现有命名后全批统一。Workspace 状态 preparing/ready/failed/needs_recovery，记录 projectId/taskId/baseHead，内部保存 cwd；CheckRun 字段及状态以范围文档为准。

### Task 1: 项目配置与旧数据兼容

**Files:** src/serve.ts、src/backend/types.ts、store.ts；新增 projects.ts、tests/backend-projects.test.ts；扩展 tests/backend-cli.test.ts。

**Interfaces:** ProjectRegistry.list()、legacy/project 模式；旧 workspace 配置及旧 Task/会话读取不变。

- [x] 写失败测试：旧配置仍可启动；新项目无 HEAD/首次脏仓库/重复 projectId 拒绝；旧库任务和会话 ID 保留。
- [x] 运行 `node --test tests/backend-projects.test.ts tests/backend-cli.test.ts`，确认新增断言因能力缺失失败。
- [x] 实现可信本地登记和存储兼容，新模式单独建测试库；需升级则先补旧库 fixture、失败回滚/备份策略。
- [x] 重跑本任务测试通过，确认不迁移当前正在使用的数据。

### Task 2: 幂等准备独立 worktree

**Files:** projects.ts、repository.ts、store.ts、service.ts；新增 tests/backend-workspaces.test.ts。

**Interfaces:** 已登记 projectId → prepareWorkspace → task.workspaceId；固定 baseHead，准备状态控制启动能力。

- [x] 写失败测试：两任务不同目录/分支、源码不变；重复只创建一次；预存路径/分支拒绝；根目录在源码/主项目内或为其祖先、大小写别名、可创建时的 junction 逃逸拒绝。
- [x] 运行 `node --test tests/backend-projects.test.ts tests/backend-workspaces.test.ts`，确认新增行为缺失。
- [x] 先持久化 preparing 意图，再用 Git 参数数组、禁用 hooks 创建 worktree，再保存结果；不在数据库事务内等 Git。
- [x] 注入 Git 成功后存储失败、准备中退出再重启；断言不重复创建、不删除未知路径、不虚报 ready。
- [x] 重跑本任务测试通过，确认未引入自动回收。

### Task 3: 多任务串行执行及会话隔离

**Files:** service.ts、adapter.ts、repository.ts、types.ts；tests/backend-service.test.ts、backend-crash.test.ts；新增 tests/backend-multitask.test.ts。

**Interfaces:** 按 task.workspaceId 选择 ExecutionContext.cwd/sessionId，兼容现有任务/事件/快照/接受。

- [x] 写失败测试：新模式两任务；未准备禁止运行；替身各改文件、保存不同 sessionId；交替反馈恢复各自会话；事件 seq/快照/接受不串数据。
- [x] 运行 `node --test tests/backend-multitask.test.ts tests/backend-service.test.ts tests/backend-crash.test.ts` 确认失败。
- [x] 改为按任务解析仓库；保留 legacy 语义、全局活动运行门禁、needs_recovery 阻塞，不增加队列。
- [x] 补旧数据库反馈与并发启动拒绝测试，断言仅启动一个实际执行器；重跑本任务通过。

### Task 4: 有界真实检查执行器

**Files:** 新增 checks.ts、tests/backend-checks.test.ts；types.ts、store.ts、service.ts、serve.ts。

**Interfaces:** 本地 CheckPreset → startCheck 持久意图 → CheckRun 终态/退出码/有界输出。

- [x] 写失败测试：Node fixture 退出 0/非零、超时、取消、多字节大量输出；非法预设/不支持的脚本拒绝；模型或检查运行中禁止抢占资源。
- [x] 运行 `node --test tests/backend-checks.test.ts` 确认缺失能力。
- [x] spawn 参数数组与 shell:false，输出按字节限量并标记截断；确认退出后释放资源，不能确认则 needs_recovery。
- [x] 补检查中后端退出/重启测试，不虚构通过或释放未知占用；重跑通过，确认没有自动装依赖和模型调用。

### Task 5: 版本有效性与公共接口

**Files:** checks.ts、repository.ts、service.ts、http.ts、types.ts、src/client/api.ts；tests/backend-checks.test.ts、backend-http.test.ts、api-client.test.ts。

**Interfaces:** GET /projects；POST /tasks/:id/workspace；POST /tasks/:id/checks（presetId/snapshotId）；GET /tasks/:id/checks。写入带 expectedVersion/Idempotency-Key；任务列表支持 projectId/status，详情附工作区/检查摘要和准确能力。

- [x] 写失败测试：检查自己改文件、外部修改、新运行后 stale；未运行为 not_run；失败不得绿色；跨任务 snapshot 拒绝。
- [x] 运行 `node --test tests/backend-checks.test.ts tests/backend-http.test.ts tests/api-client.test.ts` 确认失败。
- [x] 执行前后与读取摘要核对内容/HEAD/index，status 与 validity 分开，不靠 HEAD 单独判断、不承诺实时监听。
- [x] 接新接口、过滤/稳定分页、客户端类型；补 401、Origin/Host、幂等及版本冲突测试；旧客户端创建/反馈/接受兼容。
- [x] 重跑本任务通过；检查不自动接受、提交或集成。

### Task 6: 完整链路与交接

**Files:** 新增 tests/backend-project-flow.test.ts、docs/CODEX-BATCH-03-RESULTS.md；更新 BACKEND-USAGE.md、API-CLIENT-USAGE.md、BACKEND-HANDOFF.md、HANDOFF.md、README.md。

**Interfaces:** 真实 Git/SQLite/HTTP + 确定性模型替身串联前五项，公共客户端覆盖未来前端调用。

- [x] 链路测试：项目→两任务准备→串行执行→独立反馈/事件补读→快照→检查通过→内容改变过时→新检查→人工接受，断言源码和另一任务未变。
- [x] 运行 `node --test tests/backend-project-flow.test.ts`，修复缺口后通过。
- [x] 运行 `npm test` 与 `npm run typecheck`；用现有编译器环境变量，不加依赖。失败只修本批相关问题。
- [x] 自审 Review Focus 五项并用测试证明修复，避免重复审查循环。
- [x] 写结果、Claude 请求响应样例及状态映射，明确真实模型/浏览器/Linux 缺口，保留旧服务数据。

按序完成六项后报告；只有具体不可恢复阻塞才停止说明，不在每个任务结束重复索要许可。

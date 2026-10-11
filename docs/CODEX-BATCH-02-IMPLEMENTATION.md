# 第 2 批 A 实施计划与记录

用户于 2026-10-08 确认按 A 实施。规格：[批次说明](CODEX-BATCH-02.md)、[接口草案](BACKEND-API-DRAFT.md)。本轮单一代码写入者；子代理只读核验协议/参考与最终审查。不提交、不推送、不清理已有文件。

目标：专用 Git 仓库上的本机单任务执行、事件补读、反馈与人工接受。Node 24.17+、TypeScript、node:http、node:sqlite、node:test；无新增第三方依赖。关闭浏览器不中止，结果未知不重发，执行完成不等于验收。

## 文件与步骤

- [x] `src/backend/store.ts`、`types.ts`、`errors.ts`：SQLite 文档/事件/幂等事务与状态类型；`tests/backend-store.test.ts` 先验证重启、回滚、事件游标、独占锁。
- [x] `src/backend/repository.ts`：专用仓库验证和有界 Git 快照；`tests/backend-repository.test.ts` 先验证 staged/untracked/deleted、外部变化、二进制/链接/限额。
- [x] `src/backend/adapter.ts` 与必要的 `src/codex/session.ts` 小改动：受控配置、结构化事件、续接、默认拒绝审批、确认中止；协议对端测试先证明竞争与失败边界。
- [x] `src/backend/service.ts`：创建/修改任务、幂等运行、单运行锁、快照接受与崩溃恢复；`tests/backend-service.test.ts` 用真实 SQLite/Git 和受控执行对端覆盖闭环。
- [x] `src/backend/http.ts`、`src/serve.ts`：本机令牌、Host/Origin、输入限制、JSON 与 SSE；`tests/backend-http.test.ts` 验证鉴权、游标、刷新/补读和幂等。
- [x] 最终运行全套测试和 strict 类型检查；只读独立审查；在唯一专用样例进行最小真实 API 执行、反馈、审查与中止验证；保存脱敏结果，更新 README、批次结果及 HANDOFF。

每个模块先写失败测试并观察结果再实现；任务间共享类型以 types.ts 为准。基线本轮重新执行：25/25 测试通过；默认 typecheck 缺编译器路径，后续发现已有工具后重跑。SQLite 内存探针成功，未调用模型。

## 重点检查

1. 同键重复、不同载荷、过期版本不能触发二次模型调用。
2. 原生事件早于响应、断线或服务重启不得伪造终态或重放执行。
3. staged/untracked/二进制/符号链接/HEAD 变化必须进入快照证据或明确禁止接受。
4. 数据库写失败与慢 SSE 客户端不得让运行变成无记录的成功或无限占内存。
5. 已知完成会话可显式反馈续接，未知活动运行不能借反馈解除阻塞。

规格中的提交、worktree 隔离流程不适用于当前无初始提交且用户禁止自动提交的工作区。本轮保留可审查文件与证据，读写职责不并行交叉，不建立伪造基准提交。

## 完成记录

本轮全套 47/47 测试通过，strict 检查 28 TS 文件通过。真实专用 API 验收通过，随后审查的摘要编码、退出互斥和令牌写入失败三项重要发现均以失败回归→修复→全套通过验证。没有需要保留的重要未修复审查项。详细新旧证据边界见 CODEX-BATCH-02-RESULTS.md。

执行选择：单一主代理写入，无自动提交或工作树清理；用户追加子代理仅用 gpt-6.1-sol 后，最新独立审查按该模型执行。产品执行器验收使用其服务器实际提供的模型，证据与子代理配置分别记录。

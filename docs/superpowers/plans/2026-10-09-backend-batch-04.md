# Backend Batch 04 Implementation Plan

**Goal:** 补齐前端真实数据读取、接受有效性与有证据的检查恢复。

**Architecture:** 沿用模块化单体、文档表和现有版本/幂等/HTTP 安全门禁。查询返回后端事实；接受绑定不可变快照摘要。检查只有已持久化的确定结束结果可以恢复，未知进程不解隔离。

**Tech Stack:** Node.js 24.17+、TypeScript、内置 SQLite/Git/测试框架，无新依赖。

**Scope and rulings:** 用户已授权继续完成更多后端；自行决定本批范围并连续执行，不等待重复审批。不写 Claude 前端，不改正在运行的服务/旧数据，不调用模型、不提交/推送。源码仓库无 HEAD，直接工作；最终仅做只读独立审查。

### Task 1: 接受摘要与持久失效原因
- [x] 写失败测试：未接受、三字段绑定、外部修改、恢复内容不能复活接受、反馈、重启、旧记录。
- [x] 新增 acceptance 摘要查询与 TaskDetail 可选字段，保存 digest / 失效原因；外部变化使已接受状态失效，不可核验时返回 unverifiable。
- [x] 接 HTTP / ApiClient，验证旧客户端兼容；版本冲突填 currentVersion。

### Task 2: 真实总览与待处理数据
- [x] 写失败测试：完整计数、过滤、稳定分页、空列表、跨任务隔离、异常工作区及检查、存储健康。
- [x] GET /overview 和 GET /attention，统计持久状态并区分执行中与待处理；不将模拟能力伪装成真实引擎。
- [x] bootstrap 增加 executionMode，独立联调入口显式标记 deterministic，原服务默认 codex。

### Task 3: 有证据的检查恢复
- [x] 写失败测试：结束后扫描失败可恢复、重启保留证据、未知退出拒绝、版本/幂等/跨任务隔离。
- [x] 在扫描前保存确定结束结果；GET /tasks/:id/recovery 返回具体阻塞和恢复能力；POST /checks/:id/recover 只消费已确认结果，并使检查 stale、要求重查。
- [x] 不删 quarantine、不信任浏览器的“确认退出”、不重放命令；旧未知记录仍阻塞并返回原因。

### Task 4: 验证、交接和剩余路线
- [x] targeted tests、全套测试、strict typecheck、浏览器安全客户端编译、独立只读审查。
- [x] 更新接口/最新交接，列出首版完成与长期多引擎目标剩余步骤；明确未验证项。

**Rulings / evidence:** 最终 88/88、strict 45 文件、浏览器库编译通过。接受扫描与检查结束竞态在独立审查与失败回归中复现后修复；旧轮次检查提示已回归。Windows fixture 固定长度 r+ 写入替代反复截断，不改变产品扫描、不跳过断言。没有完整未知进程恢复或自动 Git 集成。

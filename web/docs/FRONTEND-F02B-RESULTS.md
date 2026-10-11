# F02b：B06 显式执行绑定与新项目闭环

日期：2026-10-09。写入仅本前端工程；后端、公共客户端源和设计稿只读。本批在 F01–F02 基础上补齐显式执行绑定，不进入 B07/F03。

## 实现

项目设置新增“执行绑定”区域：executionGrants 列出本机已登记受信授权；executionBinding 展示当前绑定 ID、修订、grant、完整 commit、实时可用性与具体失败原因。授权不会自动选中；未提交排除承认默认不勾选。没有授权或关联时显示准确下一步，网页不提供创建授权、任意路径 trusted 或伪管理员开关。

绑定使用当前读取的 project.expectedVersion、已确认关联的 inspectionId、完整 baselineCommit、acknowledgeUncommittedExcluded:true 与显式幂等键。成功返回的 ExecutionBinding 本体作为请求回执保存，随后重新读取项目、关联、授权和当前绑定；不把原请求回执冒充最新指针。绑定不创建任务，不准备 worktree，不自动运行。

已知拒绝不会自动重发；版本冲突重新读取并要求用户再次明确确认。仓库变化/关联过时封锁原 inspection，须重新检查和确认；切项目后迟到的拒绝也遵守此约束。未知响应保留原项目、版本、授权、inspection、commit、确认与幂等键，刷新事实或切项目不改写原正文；用户可核对后显式重试原请求。放弃只丢弃本地重试记录，不撤销可能已保存的服务操作。

所有 B06 拒绝提供具体解释与下一步：binding_refresh_required、binding_unavailable、execution_binding_unavailable、grant_not_authorized、grant_repository_mismatch、association_stale、repository_changed、binding_change_forbidden、active_run，以及 grant_configuration_changed/grant_repository_unavailable。任务操作错误也有绑定提示；不会把 ready、supported 或一次核验可用视为登录、额度或运行成功。

旧任务访问与新任务创建能力分开：当前关联要求刷新绑定时，仍可查看旧任务历史、恢复/取消入口；操作按钮继续遵守服务 availableActions，真正命令再由服务核验。新任务创建在当前项目不具备执行能力时禁用。任务工作依据始终取 task.executionBinding 的 ID、revision、grantId 和 commit，不能借用项目最新绑定。

沿用内存令牌、项目 ID 隔离、全局返回、字体、GPT 品牌图标、44px 弹窗关闭和通知行为；没有新增依赖或锁文件修改。

## 主要文件

- src/v2/projects/binding.ts：绑定读取/校验、取消与迟到保护、原请求重试、错误解释。
- src/v2/projects/binding.test.ts：新增 12 项行为回归。
- src/v2/projects/ExecutionBinding.tsx、ProjectPortal.tsx：明确选择与确认界面、绑定核验、旧任务入口。
- src/v2/live/session.ts、LiveWorkbench.tsx、presentation.ts：新建能力与历史访问分离、任务固定绑定、命令拒绝提示。
- src/v2/v2.css：沿用 tokens 的绑定布局；package.json 仅扩展 test 命令。
- scripts/f02b-fixture.ts、f02b-fixture-check.ts、f02b-browser.mjs、f02b-old-task-access.mjs：自有双仓库无模型验收。原 F01 浏览器脚本的复选框定位收窄为仓库确认控件，避免误选新增绑定确认。

## 契约冻结

未同步 B07 半成品。F02b 开始与验证阶段重新核对三个 vendored 文件，仍与正式 B06 [冻结记录](FRONTEND-CLIENT-SNAPSHOT.json) 一致：

| 文件 | SHA-256 |
| --- | --- |
| api/client/api.ts | 610c79842df00b5c663b75036937c31413f55662a0d584bce27e1cb0e330359b |
| api/client/execution.ts | 8a5207c059409fd1ae3a45c2588d2fef380282d33420a0d016526969440373af |
| api/backend/types.ts | e25644b58d1bf96b7ceda368416b9849b8bb3d7b12d71ca2f83360c330c0daf2 |

## 验收

环境：Windows + 现有 Edge/Playwright；前端端口 5331；本批独立 API 127.0.0.1:64431。自有系统临时目录 agentdesk-f02b-BVQ2Ue，主仓库 source 与额外脏仓库 dirty 是两个真实独立 Git 仓库；grant=f02b-extra，独立 extra-workspaces 和 SQLite。令牌仅私有文件，不写入本报告/日志/URL/截图。执行器 deterministic-f02b-fixture 只修改自有任务 worktree 中 sample.txt，没有调用模型。

| 命令/检查 | 实际结果 |
| --- | --- |
| npm test | 57/57，通过，无跳过；包含新增绑定测试 12 项 |
| npm run typecheck | 通过 |
| npm run build | 通过，Vite 6.4.4，87 modules |
| node scripts/f02b-fixture-check.ts CONNECTION | 真实 HTTP/Git/SQLite/SSE 全链路通过，源 HEAD/index/sample/untracked/status 不变 |
| node scripts/f02b-browser.mjs CONNECTION | 12 项真实浏览器检查通过，pageerror 0 |
| node scripts/f01-browser.mjs 独立F01连接文件 | 原 F01–F02 14 项回归通过，pageerror 0 |
| node scripts/f02b-old-task-access.mjs CONNECTION | 当前关联需刷新时旧任务可访问、新建禁用且显示旧固定绑定，通过 |

主 DOM 验收：创建组织项目 → 真实脏仓库检查（staged/unstaged/untracked 各1）→ 明确排除未提交 → 确认完整 HEAD → 选择匹配授权 → 显式绑定 → 创建任务 → 准备 → 无模型运行/SSE → 快照 → 真实 Node 检查 → 接受。绑定阶段先断言没有任务或准备，闭环后比较源仓库脏文件、index 和 HEAD 字节不变。

其他覆盖：主仓库授权用于第二仓库时真实拒绝；不存在授权 ID 的真实 HTTP 拒绝；重确认后项目要求刷新绑定；新修订保存后旧任务 ID/revision/commit 不变且实际 DOM 展示旧引用；旧版本冲突只读取一次，不自动重发；成功写入响应被人为中断后切项目返回，以原键原正文重放同一绑定；确认后真实修改 fixture 未跟踪文件导致 repository_changed，同关联不能反复提交，新查确认后可绑定。

布局实测 1440×900、1280×800、800×900，无页面横向溢出，绑定 commit 至少14px。证据在临时目录 browser-f02b/results.json、fixed-task-reference.json、binding-1440/1280/800.png、accepted-1440.png、old-task-fixed-revision.png；截图不含令牌。可复跑时先启动 node scripts/f02b-fixture.ts，用 connection.json 作为参数；PLAYWRIGHT_MODULE_PATH 指向已安装 Playwright，F01_BROWSER_CHANNEL 可选择已安装浏览器，不安装依赖。共享同一 fixture 的写入型验收必须串行。

## 审查与边界

仅 gpt-6.1-sol default 子代理负责独立 fixture 和一次只读审查，无 Astra、无递归委派。审查两项 P2 均先失败复现后修复：当前绑定门禁误封旧任务（真实 DOM）；A→B→A 后迟到仓库拒绝未锁住旧检查（状态测试）。回归通过。验收脚本另修正工作区页签定位、未知请求在途状态的等待时序，未为通过测试削弱产品门禁。

本批没有真实模型、Linux、桌面宿主、生产部署、并行执行、角色/流程批准或 B07 接口验收。未在本批模拟所有授权撤销/根目录替换与未知进程情况；相关服务拒绝按事实呈现，后台权限与恢复保护未绕过。没有自建管理员授权接口、修改数据库、推送、自动提交、清理工作区或终止别人服务。

前端目录无 Git 元数据，按授权同目录非重叠实施，未制造初始提交。服务与测试成果保留，供审阅；本机临时路径不进入正式产品配置。后续 F03 需等 B07 正式发布并另行授权，届时重新核对运行服务与完整客户端发布。

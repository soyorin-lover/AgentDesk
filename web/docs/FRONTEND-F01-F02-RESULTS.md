# F01–F02 前端交付与验收

日期：2026-10-09。写入范围：本前端工程；主项目后端、设计稿和共享源客户端只读。完成当前 F01–F02，未扩展 F03 及后续批次。

## 契约与模式

用户明确授权改为 B06。三个公共客户端文件整体同步，已按正式发布的 CODEX-BATCH-06-RESULTS.md 核对 SHA-256，详见 [冻结记录](FRONTEND-CLIENT-SNAPSHOT.json)。没有混用 B03/B05 文件，也没有实现 B06 执行授权管理界面。

| 文件 | SHA-256 |
| --- | --- |
| api/client/api.ts | 610c79842df00b5c663b75036937c31413f55662a0d584bce27e1cb0e330359b |
| api/client/execution.ts | 8a5207c059409fd1ae3a45c2588d2fef380282d33420a0d016526969440373af |
| api/backend/types.ts | e25644b58d1bf96b7ceda368416b9849b8bb3d7b12d71ca2f83360c330c0daf2 |

正式入口使用真实 HTTP。示例入口独立且标明内存示例。单元测试中的 fetch 替身仅证明状态和呈现行为；HTTP fixture 使用真实后端、Git、SQLite、SSE、工作区和 Node 检查，执行器仅确定性修改自有样例文件，没有调用任何模型。

## 实现范围

- 项目首页、真实空态、创建、名称/说明编辑、按 ID 选择与路由、全局左上角返回；列表详情按需读取，不编造项目描述或任务统计。
- 版本冲突重读服务事实并保留草稿；请求未知时保留原载荷与幂等键，改正文使用新键。项目切换取消旧读取并核验归属，同项目迟到读取也不得回退已保存版本。
- 文本路径提交后只读检查仓库，显示完整 HEAD、分支状态、变化计数与 worktree；无 commit 不允许确认。确认必须明确勾选未提交改动排除，固定该次检查/项目/版本/HEAD，过期或仓库变化要求重新扫描。
- 保存后重读项目和历史关联。已保存关联明确是确认当时事实；项目卡片不展示完整磁盘路径。执行入口由 execution.supported/reason 控制，普通新项目不因关联仓库而获得执行权限。
- 复用旧任务工作台：按项目过滤、任务分页、动作白名单、检查恢复门禁、接受摘要与失效原因、按轮实际模型/未知模型。任务反馈草稿与阅读位置隔离；SSE 续接去重；离开工作台后未知写请求仍保留原键。
- 沿用现有 CSS tokens、Dialog 与客户端。会话正文 15px、发送者/代码 14px、辅助字号至少 13px；Codex 使用 GPT/OpenAI 图标，并保留品牌文字及 Lobe Icons MIT 许可。关闭控件 44×44px，Escape 与焦点恢复保留。通知不抢焦点且不遮挡底部操作。
- Bearer 仅在内存连接中使用，不写入 URL、localStorage、截图或结果日志。

主要变更：src/v2/projects/{state.ts,state.test.ts,ProjectPortal.tsx}、live/{session.ts,LiveWorkbench.tsx,scope.ts,scope.test.ts}、AppV2.tsx、ConnectionPage.tsx、layout.tsx、icons.tsx、brand-icons.ts、v2.css、既有 Dialog、三个 vendored 文件、index.html、package.json 的 test 命令，以及本批文档和验收脚本。没有新增依赖或修改锁文件。

## 验证与证据

| 验证 | 结果 |
| --- | --- |
| npm test | 45/45：既有 double 15、presentation 15、新 scope 4、project state 11；无跳过 |
| npm run typecheck | 通过 |
| npm run build | 通过，Vite 6.4.4，85 modules |
| scripts/f01-fixture-check.ts | 真实 HTTP 准备/执行/SSE/快照/真实 Node 检查/接受/反馈失效通过 |
| scripts/f01-browser.mjs | 14 项真实 DOM 验收通过，pageerror 0 |
| scripts/f01-extra-browser.mjs | 7 项补充验收通过，pageerror 0 |
| scripts/f01-request-retention.mjs | 未知任务创建请求跨工作台卸载/重进仍使用原键，通过 |

项目状态测试先出现失败再完成实现；审查补充的同项目版本倒退与旧关联覆盖均有回归测试。未知任务请求卸载丢失先由 DOM 重现，再修复通过。最终复测另发现固定通知遮挡接受按钮，调整位置与点击穿透后，真实接受/反馈链路再次通过。

浏览器覆盖：两个项目独立创建/编辑、刷新重读、版本冲突、离线恢复、写成功但响应丢失后原键重试、返回；非仓库/unborn/dirty、显式排除勾选、检查后真实修改文件导致确认拒绝、新扫描保存、服务重启读回关联、检查/确认不改源码与 Git index 字节；执行门禁与后端直接拒绝；旧任务准备/执行/SSE/快照/检查/接受/反馈后 new_run 失效；两个任务草稿隔离、实际 fixture 模型标签、SSE 离线后重挂载续接去重。

布局实际验证 1440×900、1280×800、800×900：项目首页、弹窗关闭尺寸、Escape/焦点恢复、任务辅助面板、字号与页面横向溢出。过期检查通过仅推进浏览器 Date.now 验证 UI 门禁，没有把它声称为服务端过期实测。

本机证据位置（测试数据，不是产品配置）：

- 当前正式 B06 fixture：系统临时目录 agentdesk-f01-hnftai，API 127.0.0.1:64447；browser-f01/results.json 与项目/任务截图。
- 持久化 fixture：系统临时目录 agentdesk-f01-67zdFm，API 127.0.0.1:64450；browser-f01/extra-results.json、restarted-association-1280.png、task-aux-1440/1280/800.png。
- 前端开发验收端口 5331。上述服务均为本批自建，不改动原有服务或数据库。令牌位于各 fixture 私有文件，未写入报告。

可复跑：先 node scripts/f01-fixture.ts 启动新自有环境，用其 connection.json 运行 node scripts/f01-fixture-check.ts 和 node scripts/f01-browser.mjs；Playwright 使用已有运行库，PLAYWRIGHT_MODULE_PATH 指向现有 playwright/index.mjs，无需安装依赖。补充脚本第一个参数是已有主套件结果且重启过的 fixture，第二参数可指定独立任务 fixture。浏览器默认使用本机 Edge，可通过 F01_BROWSER_CHANNEL 指定已有浏览器。脚本仅用于开发验收，不是产品启动配置。

## 限制与下一批

- 旧持久化 fixture 在 B06 草案期间创建，绑定记录缺正式版 workspaceRootIdentity，重启后执行被 binding_unavailable 正确阻断；关联仍可读回。未迁移该旧测试库、未绕过门禁或修改后端。任务链路改用正式 B06 新建环境验证，不把这次草案兼容问题掩饰为正常执行恢复。
- 本轮未验收真实 Codex/Claude/DeepSeek 模型、登录/额度、Linux、桌面宿主或生产部署；后台检查恢复能力以服务返回为准。没有声称后端全量测试由前端独立重跑。
- 普通新项目仍需受支持的执行绑定；F01–F02 不提供管理员授权/撤销/重绑操作。流程、角色、批准、跨任务交接和多引擎依赖后续正式契约，未生成假数据或假启动入口。
- 原前端目录无 Git 元数据，本批未制造初始提交；交付按文件与验证证据审阅。未推送、部署、清理用户工作区或终止既有服务。
- 下一批 F03 须待 B07 正式发布并另行授权；先检查后端及运行服务实际版本，不能把当前端口视为自动升级。

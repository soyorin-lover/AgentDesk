# P3/P4：本地交付整理与验证

日期：2026-10-12。工作对象为 P0 建立的统一交付仓库，原后端与独立前端未修改。此次合并执行剩余主线核对、联调修复与发布准备，不再逐个测试等待用户确认。

## 发现、判断和修改

1. 前端 F04 fixture 依赖忽略目录中的 B08a 私有后端快照。交付副本没有它，实际启动报 snapshot-evidence.json 的 ENOENT。先加入 tests/delivery.test.ts 并观察失败，再改用当前仓库相对路径；启动前比较三个公共文件 SHA-256，避免后端和浏览器客户端错配。来源明确为 current-checkout，不冒充历史冻结快照。
2. 前端公共 types.ts 落后后端两项类型定义。同步 B08b 类型并更新来源清单；api.ts 与 execution.ts 原已字节一致，保持原样。此改动不构成 Claude 真实验收。
3. 当前浏览器脚本固定了开发者机器上的 Playwright 路径和前端地址。改为外部测试工具环境变量与本轮持有的前端地址；新增 npm run verify:web 统一启动和关闭确定性测试环境，不触碰既有服务。
4. npm test 漏收已有的两项 node-edit 测试，补入默认命令。没有为凑修改创建新功能或故意制造产品 Bug。
5. 只读审查发现异常启动时的子进程清理可能无限等待，以及浏览器初始化失败的关闭缺口。补入独立启动/关闭时限和 finally；超时仅终止本轮自己创建的 fixture 子进程。
6. 更新根/前端 README 和示例配置，明确真正的源码、数据库、工作区、令牌与工具依赖。示例需要填写占位符，不伪装成开箱可用配置。

## 本轮新运行证据

| 验证 | 结果 | 证明范围 |
| --- | --- | --- |
| node --test tests/backend-checks.test.ts tests/backend-project-flow.test.ts | 7/7 通过 | 真实 Git/SQLite/HTTP/Node 检查；过时、超时、取消、未知结果、隔离与人工接受 |
| npm test（根） | 147/147 通过，约 335 秒 | 原 146 项加交付 fixture 回归；协议与执行器替身不等于真实模型 |
| node --test tests/delivery.test.ts | 先失败，修复后通过；清理修改后再次通过 | 当前源码启动、认证 bootstrap、确定性标记、IPC 关闭 |
| npm run typecheck（根） | TypeScript 5.9.3，strict/noEmit，59 文件通过 | 使用本地已有编译器与 Node 类型；机器路径未写入公开文件 |
| npm --prefix web test | 77/77 通过 | 原 75 项及此前遗漏的 2 项；前端替身和状态逻辑 |
| npm --prefix web run build | 类型检查及 Vite 构建通过，99 模块 | 前端编译与产物生成 |
| npm run verify:web | 4 组通过，0 页面错误，0 模型调用 | 真浏览器、HTTP、Git、SQLite；Agent 为确定性 fixture |

浏览器核对：示例预览与窄屏；单任务计划保存、独立批准、创建执行记录、准备 worktree；确认下发留在蓝图；进入工作台、原会话反馈；生成并查看 sample.txt Diff；执行真实 Node 样例检查，等待 passed + current 后接受；修改计划撤销旧授权、保留历史任务并禁止旧反馈。

测试环境中的样例检查只验证 fixture 文件，不表示任意目标项目测试通过。人工接受仍不强制检查通过，也不自动合并到源仓库。缺会话、错误归属、未知结果和外部修改的定向证据见前面的 P3-A/B/C 与本次后端回归。

本机截图与浏览器结果在 web/.agentdesk/interaction-evidence/，没有纳入公开提交。旧脚本保留供追溯；当前受维护的浏览器入口是根目录 verify:web。依赖安装遵循已有前端锁文件，没有新增第三方依赖。

## 仍未完成的发布条件

- 本交付副本上的真实 Codex 首次执行与反馈续接：本轮没有调用模型，不能用替身通过替代。
- 干净源码副本复核已通过：从代码提交 6ed9b5d 用 git archive 导出到全新临时目录，确认不含 .agentdesk 和 web/node_modules；随后按现有锁文件离线安装 69 个包（--ignore-scripts）、前端类型/99 模块构建通过、交付 fixture 回归 1/1 通过。使用本机已有 npm 缓存，未证明无缓存网络安装，也不是完整 Git clone 或真实生产配置验收。
- 真实 serve 配置接入用户仓库的手工验收：当前源码说明和 CLI 回归不等同于完成该验收。
- 许可证选择、素材来源最后确认、GitHub 公开前文件复核、演示与求职案例。没有设置远端、推送、发布或部署。

用户参与记录：用户确认首版要保留反馈迭代，并要求合并大批执行。技术定位、代码修改和运行由 AI 完成；尚未记录用户独立读懂这些代码、完成方案取舍或亲自验收。后续用实际界面与证据解释一个完整案例，避免把“ok”算作掌握工程能力。

最终收尾：资源清理修改后的定向回归和 strict 类型检查再次通过；最终浏览器 4 组、0 页面错误，命令以 0 退出。忽略规则确认排除结果截图、令牌/本地配置、node_modules 和 dist；未设置远端。主线代码提交为 6ed9b5d，后续仅补充本段验证记录。

## P4 下一步：真实 Codex 演示已准备，尚未执行

2026-10-12 新预检：本机 Codex CLI 0.154.0 可定位。新建无敏感信息的临时 Git 示例仓库，生成标题整理函数及 2 项现有测试，测试通过且源码干净；基线 commit 为 0f7269241dacb4b29c16f595d1c4e05005e15293。这是本轮生成的验收样例，不是项目历史成果，也没有故意修改 AgentDesk 制造 Bug。

使用正式 src/serve.ts --config 入口启动项目模式，认证 bootstrap 成功，title-tests 检查预设可用，任务列表为 0，原示例源码仍干净。预检后终止了本轮自己启动的空闲 CLI；Windows 下这不能作为优雅退出证明。没有真实模型调用，也未验证账号登录或额度。

本地配置、路径、令牌及预检报告保存在忽略的 .agentdesk/release-demo/；当前定位文件为 .agentdesk/release-demo-current.json。无需把私人路径或令牌写进公开文件。

拟执行的具体任务：

- 第一次：只修改 normalize-title.mjs 与 normalize-title.test.mjs。保留现有非空标题的首尾去空白行为；空字符串或只有空白的标题返回“未命名任务”。增加对应测试，不安装依赖、不提交、不改其他文件。
- 同任务反馈：追加一个新要求，将标题内部连续空白（包括空格、Tab、换行）合并为单个普通空格；保留第一轮行为，补充英文及中文标题测试。此要求预先规划用于验证续接，不假装第一轮模型做错了。
- 示例：`  Hello  ` → `Hello`；空白标题 → `未命名任务`；反馈后 `Hello \t\n world` → `Hello world`，`整理  项目` → `整理 项目`。

验收流程：用户审阅明确任务 → 保存并批准计划 → 独立 worktree → 首次真实执行 → 同任务原生会话反馈 → 查看 Diff → 执行 Node 测试 → 展示结果供用户判断，再决定是否人工接受。禁止把成功回复直接当作测试通过；必须比较任务和会话归属、检查退出结果及当前快照，确认原示例源码和基线未改变。

调用边界待用户明确授权：最多两轮真实 Codex 执行（首次 + 一次反馈），不自动重试、不新增任务或扩展修改范围。会消耗 Codex 账号额度，不声称已有金额硬上限。若失败、超时或结果未知，保留事实并停下核查；不为了凑成功继续调用。推送、公开、真实私人仓库操作不包含在此授权内。

## P4 真实验收首次尝试：在模型任务开始前被权限校验阻塞

用户明确授权最多首次执行和反馈两轮、不自动重试。2026-10-12 已通过真实 HTTP 保存计划、独立批准、关联任务并准备固定基线 worktree；提交了 1 次应用运行请求。该 Run 结束为 needs_recovery / result_unknown，没有保存原生会话或 nativeTurnId，没有进入反馈轮次，也没有接受成果。不能记录为真实模型主线通过。

直接阻塞点与对照证据：

- 本机 Codex CLI 0.154.0 的元数据探测只发送 initialize、model/list、thread/start，**不发送 turn/start**。普通命令环境下重复返回 approvalPolicy=never、cwd 匹配，但 sandbox.type=readOnly；适配器在 onSession/startTurn 前严格要求 workspaceWrite，因此拒绝继续。
- 对相同元数据探测申请平台 require_escalated 审批后，返回 sandbox.type=workspaceWrite；未修改 Codex 全局配置，也未放宽产品的权限校验。这将直接阻塞定位到启动权限环境差异，真实任务仍未在该环境重验。
- model/list 的默认配置为 gpt-6-astra，仅是服务通告/线程配置，不是物理模型运行证据。没有把这次启动请求或元数据探测计作成功模型轮次。
- 用后端实际 Git helper 复核：源仓库和独立 worktree 状态均干净，HEAD 均仍为 0f7269241dacb4b29c16f595d1c4e05005e15293。早先使用协议样例 helper（强制 core.autocrlf=false）看到的四文件变化全部是换行差异；该 helper 与后端的 Git 配置不同，不应据此声称模型修改了其他文件。
- 未清除或改写旧 Run 的未知状态。旧任务缺少可证明会话，既定门禁禁止反馈；继续应重新明确授权，在全新的隔离样例中开始一次验收，保留旧证据。

本轮新增的公开代码仅是回归覆盖：peer 支持返回 readOnly，并在首次及续接两条测试路径确认适配器在暴露会话/模型/轮次回调前拒绝。实际后端运行逻辑未修改。验证：node --test tests/backend-adapter.test.ts，5/5 通过；strict 类型检查 59 文件通过；git diff --check 通过。没有重复全套测试。

私有详细报告位于 .agentdesk/release-demo/ 的 real-report.json、git-followup.json 与 metadata-probe.json，原任务与数据库保留。下一步的新验收仍限同一标题整理需求、最多两轮真实调用、无自动重试；启动时需要平台审核通过的执行环境。公开发布、许可证和人工接受依然没有完成。

## P4 第二次隔离验收：权限通过，默认上游断流导致未知

用户再次授权了新隔离样例的最多首次与反馈两轮。此次在经平台审核的执行环境中新建独立源仓库、数据库与 worktree，完整通过保存计划、批准、关联、准备；源基线为 24d21ceebb4a5df9e7df672f48c5010b5eaa12bf，上次未知记录未改写或复用。

结果与边界：

- 提交 1 次应用运行请求，Codex 保存原生会话及 nativeTurnId，Run 实际进入 executing。线程配置返回 gpt-6-astra，仍没有物理实际模型证据。
- 当前使用 transport=default。持久事件出现 4 条 responseStreamDisconnected 和 1 条其他网络/上游诊断；它们属于同一 turn。应用没有重发执行请求，但 Codex CLI 在内部进行了连接重试，因此此前“不自动重试”的口径不能扩展为“CLI/provider 从不重连”。
- 可见回复仅表示将检查并修改文件，未声称完成。没有文件改动、没有模型运行测试的证据；约 120 秒后执行超时，Run 为 needs_recovery / result_unknown。停止，未发反馈、未接受、未集成。
- 使用后端实际 Git 配置复核，源仓库与 worktree 均干净，HEAD 均等于原基线。
- 重开保存的数据库并通过真实浏览器读取任务及历史可见回复；界面显示未知/待恢复、禁止继续执行，页面错误为 0。此浏览器核对未点击执行或接受按钮、未调用模型，自己启动的浏览器和服务均关闭。截图留在本地忽略目录 unknown-workbench.png。

定位进展与准备不足：历史 CODEX-BATCH-01/02-RESULTS 已记录显式 HTTP 上游成功，本次沿用示例的 default，漏核了这一环境条件。该失败说明默认路径在本次环境中断流，尚不能断言 WebSocket、代理或 TLS 的具体根因。当前 HTTP 元数据预检通过 initialize/model-list/thread-start，cwd 与 never/workspaceWrite 均匹配；没有发送 turn/start，故不是新的成功模型验收。

下一次的具体方案已准备：同一标题整理需求，全新隔离样例，使用既有 transport=http。该选项临时选择 OpenAI Responses HTTP provider、关闭 WebSocket 支持，并设置 request_max_retries=0、stream_max_retries=0、stream_idle_timeout_ms=15000；不改全局 Codex 配置。此处 HTTP 指 Codex 的上游连接，本机界面/API 此前也一直是 HTTP。其模型侧效果仍需真实验收，不能将元数据预检当作成功证据。

本轮没有修改产品运行代码，未重复全套测试；记录与私有验收辅助脚本已更新。保留两个未知任务的数据库和证据。当前样例定位见忽略目录 .agentdesk/release-demo-current.json；新的 HTTP 样例准备脚本为 .agentdesk/prepare-http-release-demo.mjs，尚未执行。下一次真实调用仍需用户明确重试授权，不利用剩余轮次数量偷偷换任务或重试。


## P4 第三次隔离验收：HTTP 两轮真实执行通过，等待人工审阅

2026-10-12 用户明确允许全新隔离样例的 HTTP 验收，最多首次执行和一次同会话反馈。使用既有 transport=http，临时 provider 配置关闭 WebSocket 并设置请求/流重试为 0；没有改全局 Codex 配置。独立示例基线为 fef560182460687ddc61b7496cb4d3e978ee7f2f。

启动辅助脚本第一次在提交模型任务前退出，submittedTurns=0、无任务；原始失败报告保留。后续单独检查 Git、服务启动、认证读取及执行绑定均通过，未确定最初的具体错误。继续使用同一尚无任务的样例执行已授权验收，没有重发模型请求，也未覆盖该失败报告。

| 核对 | 实际结果 |
| --- | --- |
| 首次执行 | succeeded；只改标题函数及测试，空标题返回“未命名任务”；独立输入断言通过，配置的 Node 测试 5/5、exitCode=0 |
| 追加需求 | succeeded；把标题内部连续空白合为普通空格，保留首尾整理及空标题规则；独立英文/中文/Tab/换行断言通过，Node 测试 7/7、exitCode=0 |
| 会话归属 | 同一任务、同一原生会话、两个不同 nativeTurnId，未另开线程冒充续接 |
| 成果与检查 | 两次 Diff 快照均 complete，仅两个指定文件；对应检查 passed/current，输出未截断 |
| 隔离与接受 | 源示例仓库干净、HEAD 保持基线；worktree 未提交；acceptance=not_accepted |

这一结果证明本机 Windows 上，正式 HTTP API 的保存/批准/任务关联/worktree/真实 Codex 首次执行/同会话反馈/Diff/检查链路通过。配置模型为 gpt-6-astra，但 ModelEvidence 仍为 unknown/thread_configuration；不将其写成实际物理模型证明。此前两个未知任务及数据库保持原样。

本轮没有修改产品运行代码或重复全套测试。私有完整证据在当前 .agentdesk/release-demo/ 样例目录的 real-report-http.json、phase-1.json、phase-2.json、final.diff；最初启动失败另存 real-report.json，不能混淆。人工接受、集成、许可证与 GitHub 发布尚未完成。用户只授权执行，尚未据此记录其已经理解代码或亲自通过验收。

持久化界面复核：关闭执行服务后，重新打开同一数据库与真实前端，读到了两轮输入/回复、2 个变更、执行完成、当前版本检查通过和尚未接受；页面错误 0，没有点击执行或接受、没有新增模型调用。首次浏览器脚本等待了错误的状态文案而超时，改用实际最终回复定位后通过；未修改产品。截图 review-workbench.png 保存在本地忽略目录。

## P4 人工接受完成

2026-10-12 向用户展示标题输入/输出、两轮同会话证据和最终 7/7 检查后，用户回复“可以”，授权接受该示例成果。接受前重新读取实际 worktree：快照 complete、内容摘要与已审阅最终快照一致，仅两个指定文件，检查仍 passed/current；源仓库干净且 HEAD 未变。通过正式 HTTP accept API 记录接受，随后关闭并重新打开服务/数据库，复核任务 accepted、acceptance=valid 且绑定同一最终快照。新增模型调用 0，未提交或合并示例代码、未推送或公开。私有记录为 human-acceptance.json。

至此本机 Windows 的隔离示例主线已完成：接入已有 Git 仓库 → 保存/批准任务 → worktree → 真实 Codex 执行 → 同会话反馈 → Diff → 当前检查 → 用户判断并接受。该判断基于展示的行为和验证证据，不代表用户已独立理解实现代码。正式开源仍需许可证/素材来源、公开文件最后复核与发布处理；不将样例通过推广为所有用户仓库或 Linux 均已验收。

## P4 开源材料收尾（未发布）

2026-10-12 用户选择 MIT，已加入项目 LICENSE（2026 AgentDesk contributors）与 THIRD_PARTY_NOTICES.md，保留 LobeHub 图标原许可。核对本机 69 个已安装依赖版本与锁文件一致，许可字段无缺失；另有 50 个其他平台可选包未安装。图标原下载 commit 和早期生成线性图标的原创性仍无法追溯，不把本轮核对说成完整法律审计。

README 已改为真实 Windows 示例闭环验收状态；示例配置采用已验证的 transport=http，文档说明其禁用请求/流重试和不修改全局配置。定向 CLI 回归 3/3；示例 JSON、README/来源说明本地链接及许可署名检查通过。只改文档和示例配置，未再次调用模型或重复全套测试。

公开边界复核覆盖当前 273 个跟踪文件以及此前全部 13 个提交：常见 provider token、私钥、凭据 URL 与长凭据赋值模式仅命中 tests/api-client.test.ts 的明确虚构 URL 拒绝测试；未跟踪数据库、日志、私钥、node_modules 或 .agentdesk 文件。历史模式候选同样只剩该测试地址。模式检查不保证排除所有秘密。27 行历史开发路径保留作追溯，旧辅助脚本不属于 README 的受维护入口。

另发现提交作者/提交者元数据带个人 Gmail 地址。用户选择“暂不发布，稍后决定”；未修改作者信息、未重写历史、未设置远端或推送。该邮箱仍是发布前待处理项。许可证选择与本地准备不等于 GitHub 公开授权。

## GitHub 发布授权与隐私处理

2026-10-12 用户明确要求“发布吧”，并选择改用 GitHub 隐私邮箱。已确认目标账号 soyorin-lover，AgentDesk 同名仓库不存在。发布前以 Git bundle 保存并验证原始 14 个提交的本地备份，再重建这些提交的作者/提交者邮箱；逐提交验证 tree、说明、作者姓名、时间和父子关系保留。提交哈希因此变化，本文前面的旧哈希是当时证据标识，映射和原始 bundle 只存忽略目录 .agentdesk/publish/，不上传。只推送 main，不推送本地原始历史备份。

此步骤未修改产品运行代码或调用模型。发布准备再次核对 273 个跟踪文件，常见凭据模式仍仅命中明确虚构的 URL 拒绝测试。公开操作的实际结果将另行记录。

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

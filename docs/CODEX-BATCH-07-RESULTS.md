# B07 结果与交接（2026-10-09 已发布）

范围：项目内成员、可复用角色和成员负责人；手动流程草案、独立父子树与依赖 DAG、不可变修订与精确部分批准；固定 B06 绑定的受管任务；人工节点确认。接口详见 [B07 API](BACKEND-BATCH-07-API.md)，实施记录见 [计划](BACKEND-BATCH-07-PLAN.md)。B08 以后未执行。

## 行为与决策

- 项目工作流独立于 TaskStatus/RunStatus。角色/成员/负责人只表达组织配置，只有 codex-local 可批准执行；其他工具为配置目标，不伪装可用，不调用模型生成计划。
- 全量编辑产生新修订；批准精确绑定节点目标/验收/角色/成员/实例/commit/依赖。部分批准缺少尚未批准依赖时拒绝整条命令，不扩大批准子集。批准不自动创建任务、准备 worktree 或启动。
- 每次编辑撤销旧修订全部后续执行授权，保留历史与影响列表。旧受管任务不能通过删节点回到兼容模式，不能静默改输入或替换基线；新修订批准后显式新建任务，历史代码和会话保留。代价是保留历史任务，归档/回收留到后续。
- prepare/start/feedback/check/snapshot/accept 的直接端点验证流程授权、绑定和依赖；updateTask 拒绝受管任务改写。原 interrupt/cancel/recovery 和读取保留安全出口，全局串行/未知结果/quarantine 未放松。
- 节点完成需批准后成功轮次的当前有效 Acceptance 加独立人工确认。run succeeded、检查通过和 accepted 均不自动标 completed；外部修改或反馈使证据失效后阻止依赖，确认历史仍可追踪。普通任务关联不能把历史轮次伪装成批准后的执行。
- 当前绑定指针更新不替换已批准任务固定绑定，授权撤销与源码身份变化仍实时拒绝。旧非流程任务保持原契约，不倒推自动批准。

## 修改文件

| 文件 | 内容 |
| --- | --- |
| `src/backend/workflow.ts`（新增） | 严格配置/引用/上限、独立树/DAG 验证、节点契约与影响传播 |
| `src/backend/workflow-service.ts`（新增） | 持久修订、批准、永久关联、确认、节点派生状态与直接门禁 |
| `src/backend/types.ts` | 全部浏览器安全工作流类型、可选 Task.flow |
| `src/backend/service.ts` | 复用队列/事务/接受摘要、绑定核验、任务动作执法与详情原因 |
| `src/backend/http.ts` | 新增流程读写端点，沿用认证/Host/Origin/JSON |
| `src/client/api.ts` | 六个公共工作流方法、详情授权类型；原方法兼容 |
| `tests/backend-batch07.test.ts`（新增） | 真实临时 Git/SQLite/HTTP 和无模型执行器集成 |
| `tests/workflow-validation.test.ts`（新增） | 图与角色引用、循环、限额及影响传播 |
| B07 PLAN/API/RESULTS、交接/剩余路线/README | 本批发布记录 |

`src/client/execution.ts` 无改动，纳入三文件同步哈希。未改前端目录、DESIGN.md、HTML 预览、路线任务书、根配置/锁文件或运行数据，无新增依赖。

## 验证与审查

Windows 临时真实 Git/SQLite/HTTP；引擎为可控制、无模型替身。

| 命令 | 结果 |
| --- | --- |
| `node --test tests/backend-batch07.test.ts tests/workflow-validation.test.ts` | 13/13，退出 0，约 210 秒 |
| 最终修复定向测试（graph displays / interrupted preparation / HTTP workflow versions） | 3/3，退出 0；两项新增回归纳入最终全套 |
| `npm test` | 最终 126/126，失败/跳过 0，退出 0，约 259 秒；包含 B07 的 10 个集成和 5 个图验证测试 |
| `npm run typecheck`（使用已安装 TypeScript 5.9.3 与 Node 类型路径） | strict 53 文件，退出 0 |
| 已安装 tsc：strict/noEmit/target es2023/module nodenext/allowImportingTsExtensions/lib es2023,dom,dom.iterable，输入 api.ts / execution.ts | 退出 0 |

无 build/lint 脚本，不声称执行不存在的检查。原普通沙箱进程初始化失败，按平台审批使用受控命令执行；没有修改应用配置绕过权限。

先失败再实现/修复的测试包括：缺失 workflow 能力、部分批准缺依赖、跨项目绑定草案、过期任务直接门禁与详情动作、角色影响传播、授权失效图状态、依赖失效仍显示运行事实。覆盖真实重启重读、并发编辑/批准、幂等冲突、完整 HTTP 批准→任务→执行→接受→确认→反馈失效、旧普通任务与全局未知状态保护。全套原回归也验证 B05/B06 兼容。

一次 gpt-6.1-sol 默认角色只读审查发现一项 Important：准备中/失败/需恢复被图误显 ready；已完成失败复现和修复，保留真实工作区原因，无新增恢复能力。另修复客户端 currentVersion=0 遗漏，HTTP 先失败再通过。最后定向 3/3；最终全套 126/126。没有 deferred minor。审查未判断 F03 实际浏览器刷新体验，因为前端属于独立批次；代价是本批不能声称图界面已完成浏览器验收。图验证由同模型独立限定文件实现，无递归委派或 Astra。

## 公共三文件 SHA-256（正式发布）

| 文件 | SHA-256 |
| --- | --- |
| `src/client/api.ts` | `CBCA773A74759D4E6C6BF3412B2F71CFFED0831DA1E653E2AACD6E5CF13CB6A3` |
| `src/client/execution.ts` | `8A5207C059409FD1AE3A45C2588D2FEF380282D33420A0D016526969440373AF` |
| `src/backend/types.ts` | `94545955082DCB7018C6253B49DD61A9F8B1B907FFCCBFB8DC34024B4506D665` |

## F03 接手与服务边界

前端发布后同步三文件，可消费项目内角色/成员/负责人、流程树/DAG、草案编辑与影响列表、精确整批/部分批准、显式任务关联/创建及人工节点确认。流程元数据没有新项目 SSE；每次写后刷新 workflow 取得当前 version，原任务 SSE 到来时刷新相关图，活动期间定时重读以发现外部变化。详情 workflowAuthorization 不取代服务端检查。示例字段与兼容规则见正式 API。

没有启动 B07 常驻服务、重启旧服务或修改运行库/本机配置；旧在线端口不会自动提供本批接口。临时服务均属于测试 fixture。现有 integration-server 可供独立启动验证 API，默认每次新库，不能当持久恢复环境；重启证据来自同一临时 SQLite/同一配置关闭重开服务。

未验证真实模型、正式浏览器 DOM、Linux、长期大图性能。未实现全局角色库/实例注册、多引擎适配、AI 规划、自动调度/并行、交接、未知恢复、归档回收、集成或最终验收。本批是流程授权基础，人工成果确认不代表代码已集成。

仓库无首次提交，保持未跟踪文件和原工作区；无提交/推送/部署/清理。B07 验证交付后停止，B08 单独授权。

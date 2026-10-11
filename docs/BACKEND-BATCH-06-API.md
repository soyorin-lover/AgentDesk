# B06 API（2026-10-09 已发布）

新增受信启动配置 executionGrants: `{id,name,path,workspaceRoot,checkPresetIds?}[]`。原配置 projects 的唯一登记项作为兼容默认授权，其 id 保留。HTTP 不接受 path/trusted/executable 来创建授权。

- GET /execution-grants → `{items:[{id,name,available,reason?}]}`，无路径。
- GET /projects/:id/execution-binding → `{binding:ExecutionBinding|null,available:boolean,reason?:string}`。
- POST /projects/:id/execution-binding：`{expectedVersion,grantId,inspectionId,baselineCommit,acknowledgeUncommittedExcluded:true}` + 幂等键。关联必须是当前已确认事实，检查必须重新核验；不自动创建 worktree/模型。
- ExecutionBinding：id/projectId/revision/grantId/baselineCommit/associationInspectionId?/createdAt/uncommittedChangesIncluded=false。绑定不可变，项目详情版本递增。新任务 executionBinding 保存固定引用，旧任务只按可证明历史补足。
- ProjectDetail.execution additive reason：trusted_configuration / execution_binding_required / binding_unavailable / binding_refresh_required；repositoryAssociationUsed 允许 true（显式绑定）或 false（兼容默认）。不承诺模型登录/额度。
- 额外 409/422 错误：execution_binding_unavailable、binding_refresh_required、grant_not_authorized、grant_repository_mismatch、association_stale、repository_changed、binding_change_forbidden、active_run。版本/幂等/认证保持 B05。

源 HEAD 推进不自动改变固定基线；显式重查/确认/绑定后才影响新任务。旧任务始终固定旧修订，关联改变不换其代码。未提交改动排除并保留；需要纳入请用户在 IDE/终端显式提交后重新检查确认。本批不自动 stash/reset/commit。

## 精确契约与兼容规则

所有新增 HTTP 路径位于 `/api/v1`。与 B05 一样要求 Bearer、正确 Host 和允许的 Origin；POST 要求 JSON、显式 Idempotency-Key，未知字段拒绝。公共客户端增加 `executionGrants(signal?)`、`executionBinding(projectId,signal?)`、`bindProjectExecution(projectId,body,key,signal?)`；不自动重试、不中止服务器已接受操作，网络响应未知时可用原键和原正文查询/回放结果。

GET execution-grants 的 available 是启动配置加载结果；GET execution-binding 还实时验证根目录、源码身份及 commit 存在性。普通项目详情 execution 是配置与已保存事实的能力判断，外部实时变化仍以专用查询及真实写命令核验为准。未绑定时 GET 返回 binding=null、available=false。所有新增响应不返回绝对路径、命令、PID、凭据或源码。

POST 成功返回 **ExecutionBinding 本体**，HTTP 200；不返回任务或工作区。expectedVersion 是项目当前版本（B05 确认关联后已递增一次）；成功再次递增项目版本，前端需重读项目。binding.id 不可变、revision 递增，当前指针单独保存；同键重放固定原修订，不会用最新修订代替。绑定没有新增任务动作名/任务 SSE 事件；项目刷新通过成功响应与详情查询。绑定自己不生成模型轮次或任务接受证据。

inspectionId 和 baselineCommit 必须匹配项目当前已确认关联；acknowledgeUncommittedExcluded 必须 true。绑定时再次核验原用户提交路径、B05 完整检查摘要和受信配置身份；确认之后文件/分支/HEAD/index/worktree 变化会返回 repository_changed，应新建检查、确认后重新绑定。已确认关联本身没有 10 分钟有效期，B05 未确认检查仍遵守原过期规则；绑定以实时重新核验为准。

显式绑定后重新确认仓库会使项目的新任务能力为 binding_refresh_required，旧任务仍使用原绑定。源 HEAD 单独合法推进不会使旧绑定自动换 commit，新任务在显式更新前仍使用旧基线。不同授权项换绑在项目已有任何任务时拒绝 binding_change_forbidden；同授权项更新基线可在全局没有运行/未知运行/未知检查/准备中操作时进行。旧任务不依赖“当前项目绑定指针”。

Task 新增可选 `executionBinding:{id,revision,grantId,baselineCommit}`；新 project 模式任务必有固定引用。legacy 模式保持原单工作区契约。任务显示基线应取任务自身引用，不能取 ProjectDetail.repository 或 bootstrap 的基线。检查/快照/接受/恢复/反馈均对任务固定工作区及源仓库身份核验。任务已有接受不因项目关联更新自动换成果，仍按自己的快照摘要判断有效性。

## 本机受信配置

生产 `serve` 接受 executionGrants（仅原 project 模式），仍保留旧 projects 中唯一主配置和 workspaceRoot。不要求改写旧配置，旧 bootstrap 继续指向主项目；B06 多项目通过额外授权项和显式组织绑定实现，不把所有启动授权自动创建为组织项目。

```json
{
  "executionGrants": [
    {
      "id": "repo-b",
      "name": "仓库 B 的受信授权",
      "path": "本机配置中的已有绝对仓库根路径",
      "workspaceRoot": "本机配置中的独立绝对 worktree 根路径",
      "checkPresetIds": ["tests"]
    }
  ]
}
```

以上是字段示意，不是可直接运行的机器路径模板。只有本机配置能登记路径/检查预设；HTTP 没有登记授权接口。授权 ID 为 1–80 位字母数字下划线连字符，名称非空最长 200，条目未知字段拒绝。ID 重复、同 Git commonDir、源码/worktreeRoot 互相包含或重叠、与主项目重叠会启动失败。不同 linked worktree 仍属于同一 commonDir，不能冒充两仓库授权。首次额外授权允许源目录脏，要求已有 commit；不会 stash/reset/checkout/commit 源代码。

checkPresetIds 省略表示启动时所有受信预设，空数组表示不允许检查。绑定固定该 ID 范围，真实执行仍使用服务预设；客户端不能提交 executable/shell/cwd。预设范围变更或撤销授权使旧绑定不可用，不能静默认领新范围。bootstrap 的检查表是服务配置全集；真实 startCheck 按任务固定范围执法，越界为 preset_not_found。CheckRun 保存实际执行预设与退出证据。

源码 identity 固定真实 cwd/gitDir/commonDir 及目录 dev/ino；worktreeRoot 固定真实路径和 dev/ino。源码 HEAD 推进与身份替换分开；同一路径重建目录也不能绕过。额外授权在同一 ID 下改变仓库、root 身份或预设范围会报告 grant_configuration_changed，缺失/不可访问报告 grant_not_authorized / grant_repository_unavailable。恢复原配置和身份可恢复权限；要登记不同仓库使用新的授权 ID，再显式绑定，已有任务不能被换绑。主配置源码/root 身份改变仍按旧严格契约拒绝启动。

## 持久化、历史与保护

复用 SQLite documents：不可变 execution-binding 内部保存 identity/root/预设范围，execution-binding-current 保存当前指针；private 保存授权首次身份。项目版本、绑定及幂等记录同事务写入。普通 Task 只暴露固定引用，不暴露内部路径。已有 project 模式任务仅从原 private.project.repository.baseHead 或已保存 workspace.baseHead 补引用，ID、版本和历史事件不变；不从当前 HEAD 推测。旧 private.project 首次升级补目录身份，之后严格校验；无法验证的旧任务不执行，不冒充恢复。

撤销授权使直接命令拒绝，已准备工作区记录可保留 ready；ready 不代表仍有执行权限。重新授予原配置后先重新核验归属/marker/commit 再使用。准备中断、marker 篡改、未知进程的 needs_recovery/quarantine 不因此解除；没有新增“确认进程已退出”捷径。全局模型/检查仍串行，needs_recovery 在跨项目也阻止新执行/换绑。隔离写入失败保留租约，不清理未知资源。

新增状态错误：422 grant_not_authorized / grant_repository_mismatch；409 association_stale / execution_binding_unavailable / binding_change_forbidden / active_run / repository_changed；新任务在未绑定/过期能力时为 422 execution_binding_required / execution_binding_unavailable / binding_refresh_required。version_conflict 继续提供 currentVersion，idempotency_conflict、认证/输入/存储错误保持原规则。

## 无模型联调与验收边界

`scripts/integration-server.ts` 保持默认单项目、每次新库行为。可选 `startIntegration({mainProject,port,additionalProject:true})` 或环境变量 `AGENTDESK_INTEGRATION_MULTIPROJECT=1` 登记第二个独立 fixture 授权，不自动创建第二空间/绑定/任务。connection.json 的 additionalProject 给出本地 grantId/source/workspaceRoot，令牌仅在忽略的 tokenFile。Origin 仍仅 localhost/127.0.0.1:5311，未放开通配。

该入口不是持久恢复模式，本批没有新增 resume/restart 启动选项。重启重读证据来自同一配置/同一 SQLite 数据库的 BackendService 关闭重开测试，不能把每次生成新库称为持久化。本批测试服务均已按所属 fixture 关闭，旧在线服务未更新。生产不得回退 fixture；executionMode/model 字段明确 deterministic / deterministic-fixture。本批不包含真实模型、浏览器 DOM、Linux、并行、流程批准、多引擎或集成验收。

发布状态和 api.ts / execution.ts / types.ts SHA-256 见 CODEX-BATCH-06-RESULTS.md。前端只在发布后同步三文件，不依赖测试中的草案；B05 端点和方法保留。

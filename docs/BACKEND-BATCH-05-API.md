# 后端第 5 批：项目空间与已有仓库接入

2026-10-09。接口位于 `/api/v1`，沿用 Bearer、Host、Origin、JSON、Idempotency-Key 和版本冲突契约。公共客户端 `src/client/api.ts`；类型 `src/backend/types.ts`。旧任务/运行/检查/快照/接受/SSE 保持兼容。

## 项目空间

创建只保存内部组织对象；不调用模型、创建 Agent 原生项目、仓库或 worktree、启动执行。当前服务启动仍需要旧可信执行配置，本批没有增加无配置启动模式。

| HTTP | 公共客户端 | 正文 / 返回 |
| --- | --- | --- |
| GET /projects | projects() | `{items:[{id,name}]}`，保持简要契约 |
| POST /projects | createProject(body,key) | `{name,description?}` → ProjectDetail，201 |
| GET /projects/:id | project(id) | ProjectDetail，200 |
| PATCH /projects/:id | updateProject(id,body,key) | `{expectedVersion,name?,description?}` → ProjectDetail，200 |

ProjectDetail：id、name、description、schemaVersion=1、version、createdAt、updatedAt、可选 repository 摘要和 execution。名称去首尾空白，非空且最长 200 字符；说明可空、最长 8000 字符；编辑至少一项，未知字段拒绝。版本初始 1，编辑和确认关联均递增。普通详情的 repository 仅含 baselineCommit、confirmedAt、uncommittedChangesIncluded=false，不含路径。

execution 为 `{supported,reason,repositoryAssociationUsed:false}`。reason 为 trusted_configuration 或 execution_binding_required。只有配置项目受旧执行器支持；新增空间即使确认仓库也不能创建执行任务（422 execution_binding_required）。配置项目的关联也不修改其执行仓库/baseHead。supported 不代表模型已登录、额度充足或执行成功。bootstrap 始终指向旧可信配置项目。

## 只读检查与确认

| HTTP | 公共客户端 | 正文 / 返回 |
| --- | --- | --- |
| POST /projects/:id/repository-inspections | inspectProjectRepository(id,body,key) | `{path,expectedVersion}` → RepositoryInspection，201 |
| POST /projects/:id/repository | confirmProjectRepository(id,body,key) | 下方确认正文 → RepositoryAssociation，200 |
| GET /projects/:id/repository | projectRepository(id) | 已保存关联或 null，200 |

path 是已有仓库根目录绝对路径，最长 4096 字符、无 NUL；支持目录 symlink/junction，经 realpath 规范化。拒绝子目录、裸仓库和非仓库，不自动初始化。绝对路径仅在这些认证后的、用户显式请求的专用接口返回；普通列表/详情/bootstrap/总览/待处理及错误不含路径、文件内容或 Git stderr。

RepositoryInspection 含 id、projectId、projectVersion、checkedAt、expiresAt（10 分钟）、confirmable、可选 reason、uncommittedChangesIncluded=false，以及 repository：

- path / gitDir / commonDir：真实路径及 Git 身份，支持 linked worktree。
- branch / head：分支名或 null、完整 commit 或 null；headState 为 attached / detached / unborn。
- changes：staged / unstaged / untracked / conflicted 文件数，同一文件可同时 staged/unstaged，仅统计 Git 非忽略项。
- worktrees：path、head、branch、bare、detached、locked、prunable，不返回任意锁理由文本。
- fingerprint：后端生成的一致性摘要，不是用户可指定基线。

unborn 可查看，但 confirmable=false、reason=no_commit_baseline；detached 可确认具体 commit。确认正文：

```json
{
  "expectedVersion": 1,
  "inspectionId": "检查返回的 ID",
  "baselineCommit": "检查返回的完整 HEAD commit",
  "acknowledgeUncommittedExcluded": true
}
```

仅接受该次检查 HEAD。确认前重新解析原提交路径，重复扫描并核对目录身份、gitDir/commonDir、分支/HEAD、index、未提交字节、未跟踪文件和 worktree。单次检查也扫描两遍要求摘要一致；核对项目/版本/有效期，包括确认扫描后的有效期。变化要求重新检查，不自动 stash/reset/checkout/commit，不刷新 index、重建删除内容或收养执行工作区。

有界扫描：最多 2000 状态项、普通改动文件 1 MiB、总内容 10 MiB；Git 单命令超时 15 秒、输出上限 12 MiB。只保存摘要/身份，不保存源码字节。变化的父 symlink、特殊文件、脏子模块、assume-unchanged/skip-worktree 等无法完整核验时拒绝；大型/特殊仓库可能需要后续扩展，不能将拒绝显示为干净。继承 GIT_* 重定向被隔离，fsmonitor/untrackedCache 禁用，不触发外部 diff/文本转换。

RepositoryAssociation 含 projectId、baselineCommit、confirmedAt、inspectionId、repository、uncommittedChangesIncluded=false。关联与项目版本及幂等记录事务保存，可重启重读。GET 返回确认当时事实，不重新扫描当前仓库；要查看当前情况应新建检查。再次确认替换当前关联且递增版本。未提交改动不自动进入后续 worktree；本批没有实现关联驱动的 worktree 或执行绑定。代码存在/关联成功不等于功能已验证。

## 一致性与错误

所有写请求使用原串行队列和 SQLite 事务；同版本并发只有一个成功。幂等作用域按接口/项目区分，同键同正文复用持久记录，同键异正文 409 idempotency_conflict。沿用资源引用回放，可能返回资源最新状态，不是冻结响应；重读版本，不自动重试写入。检查的同键回放不会重新扫描，应使用新键获取新检查。

400：invalid_input、invalid_repository_path。404：not_found。409：version_conflict（顶层 currentVersion）、idempotency_conflict、inspection_stale、inspection_expired、repository_changed。422：repository_unavailable、repository_root_required、bare_repository_unsupported、repository_scan_unsupported、repository_scan_limited、invalid_baseline、execution_binding_required。认证、请求大小、关闭和存储错误沿用原契约。

扫描不是原子文件系统快照/安全沙箱；确认后外部仍可变。未来执行绑定和工作区准备必须再核验，不能直接授权任意接入路径。忽略文件不计入扫描，未提交内容没有保存方案，本批不宣称已实现安全备份/纳入基线。

## 历史数据库与前端

复用 documents 表增加 project-space、repository-inspection、project-repository 和 private 中原提交路径；无破坏性 SQL 或任务重编号。按可信配置原 ID（legacy 为 local-project）仅在缺失时补录空间，旧任务/事件/运行/接受/配置保留。用户编辑的名称重启不被配置覆盖；旧两种执行模式间换绑限制保留。未触及正在运行的数据库/配置/令牌，也未重启既有服务；在线旧端口没有自动更新。

前端用 projects + 按需 project 接首页，编辑成功刷新版本；显式路径提交、展示 HEAD/改动后确认，成功刷新详情与关联。确认界面必须显示未提交排除说明；新增空间执行入口按 execution 禁用，说明需要受支持绑定。客户端方法支持 AbortSignal，不自动重试。前端副本、HTML 预览未修改，尚无新版浏览器 DOM 验收。

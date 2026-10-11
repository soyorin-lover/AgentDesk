# 第 3 批公共接口与 Claude 对接

前缀 `/api/v1`。所有读取与写入继续校验 Bearer、Host、Origin。写入必须 JSON、`Idempotency-Key`；版本来自最新任务/检查查询。202 仅表示持久化意图。示例不含真实路径、凭据和用户数据。

## 项目模式配置

独立本地配置示例（占位路径替换为本机绝对路径）：

```json
{
  "projects": [{ "id": "app", "name": "My App", "path": "<已提交且首次干净的源码仓库绝对路径>" }],
  "workspaceRoot": "<独立工作区根目录绝对路径>",
  "database": ".agentdesk/project-backend/state.sqlite",
  "port": 4318,
  "checkPresets": [{
    "id": "whitespace", "name": "Git whitespace",
    "executable": "git", "args": ["diff", "--check"],
    "timeoutMs": 15000, "outputBytes": 65536
  }]
}
```

项目模式必须显式指定独立数据库；不复用 `.agentdesk/backend/state.sqlite`。当前支持一个登记项目、该项目多任务。`workspace` 与 `projects` 互斥；旧 workspace 配置及任务/会话保留，无数据库表结构升级。源码仓库与工作区根目录均不可与 AgentDesk 主目录重叠；工作区根也不可与源码目录互为祖先，真实路径包含 junction/symlink 检查。当前 AgentDesk 无 HEAD，不可直接用它演示项目登记，更不可自动提交全部源码。

检查预设是本机可信配置，不能来自模型回复或浏览器命令输入。参数数组、shell:false；`.cmd`/`.bat` 明确 unavailable，不调用 shell。超时 10–600000ms，输出总字节 1–1048576；stdout/stderr 共享限额，超限标记 truncated。不得在预设中填凭据；记录会保存本次实际预设、输出与退出结果，不保存环境变量。示例 git diff --check 仅检查 Git 空白问题，不能解释为完整测试通过。项目可显式配置已知 Node 测试命令；不扫描并执行未知脚本、不安装依赖。

## 端点

| 请求 | 载荷 / 返回 |
| --- | --- |
| `GET /projects` | `{items:[{id,name}]}`；不暴露源码路径 |
| `GET /bootstrap` | 新增 `mode: project/legacy` 与 `checkPresets`（命令、限制、available）；项目模式 workspace 为 per_task，需看任务详情 |
| `POST /tasks` | 原字段加 `projectId:"app"`；项目模式必须指定，旧模式可省略 |
| `POST /tasks/:id/workspace` | `{expectedVersion:1}` → 202 Workspace；先保存 preparing，再异步创建 Git worktree |
| `GET /tasks/:id` | 原字段加 `workspace`、`checks`；checks 在读取时重新扫描内容、HEAD、index |
| `GET /tasks?projectId=app&status=ready&cursor=0&limit=50` | 原列表形状；cursor 为过滤前的插入位置，保持既有任务顺序，不按会变化的状态重新编号 |
| `POST /tasks/:id/checks` | `{expectedVersion:5,presetId:"whitespace",snapshotId:"snapshot-id"}` → 202 CheckRun |
| `GET /tasks/:id/checks` | `{items:[CheckRun],summary:{status,validity?,checkId?}}`，每次重查当前有效性 |
| `POST /checks/:id/cancel` | `{expectedVersion:1}` → 202；查询检查列表等待 cancelled/timed_out/其他真实终态 |

现有启动、反馈、事件、快照、接受端点不变。先创建任务，再显式准备工作区；准备后重新查询版本，再启动。Git worktree 和分支仅在准备动作建立，分支名 `codex/task-<taskId>`，固定 baseHead。任务/运行/快照/会话/事件均按任务隔离；全服务仅一个模型或检查执行，不排队。幂等重试必须原键与原载荷，可返回资源的最新状态；新键不能重试 failed/needs_recovery 准备。没有自动恢复或清理端点。

Workspace 示例：

```json
{"id":"workspace-id","taskId":"task-id","projectId":"app","status":"ready","baseHead":"<commit>","branch":"codex/task-task-id"}
```

准备状态 `unprepared`、`preparing`、`ready`、`failed`、`needs_recovery`；公开 DTO 不含 cwd/gitDir。preparing 意图跨重启不自动重放，即使 Git 已成功也保留 needs_recovery，需人工诊断；不删除目录或分支。外部修改 HEAD、分支、目录归属或隔离标记会阻止启动。

CheckRun 包含 id/taskId/runId/snapshotId/contentDigest/presetId/preset、status、validity、startedAt/endedAt、exitCode、stdout/stderr、truncated、version、reason。实际执行预设被固定保存在记录中，后续改配置不改写历史命令。

```json
{"status":"passed","validity":"current","checkId":"check-id"}
```

只有 **passed + current** 可显示“当前版本检查通过”。failed + current 仍失败；passed + stale 显示“旧版本通过，需重新检查”。未运行是 `{status:"not_run"}`，不能绿色。运行状态还包括 running/cancelled/timed_out/needs_recovery。新运行、新快照、外部内容/HEAD/index 改动使旧记录 stale；检查本身改变内容也 stale。查询触发扫描，无实时文件监听；查询后的外部修改仍可能发生。快照旧字段 `checks:"not_run"` 是创建快照时的历史值；页面以详情 `checks` 或检查列表 summary 为当前证据。

检查与模型共享门禁和租约。中止只处理应用直属进程并等待 close；无法确认退出则 needs_recovery 并隔离工作区，不承诺所有后代进程已经结束。未知记录重启不自动重发，阻止继续执行。人工接受不强制检查、不提交、不合并、不代表集成或最终验收。

## 客户端与状态映射

`ApiClient.projects()`、`prepareWorkspace(taskId,{expectedVersion},key)`、`startCheck(taskId,{expectedVersion,presetId,snapshotId},key)`、`checks(taskId)`、`cancelCheck(checkId,{expectedVersion},key)`。均可传 AbortSignal；取消 HTTP 不取消后端操作。原 `tasks(cursor,limit,signal)` 保持兼容，第四参数新增 `{projectId?,status?}`。

| 实际状态 | 前端呈现/操作 |
| --- | --- |
| 未准备 / 准备中 | 准备工作区 / 等待；不能启动模型 |
| failed / needs_recovery 工作区 | 准备失败 / 待人工恢复；不能以新键强行复用 |
| ready 任务且工作区 ready | 依据 availableActions 显示 start |
| running 模型 | 仅在 executing 且执行器可中止时显示 interrupt |
| running 检查 | availableActions 提供 cancel_check；按检查 version 调用 cancel，其余任务不可启动 |
| needs_recovery 模型/检查 | 明确未知并阻止执行，不伪造失败/成功 |
| in_review / accepted | 依据 availableActions 显示反馈、快照、检查、接受；accepted 绑定原快照 |

401 为未认证；403 为 Host/Origin 不允许；409 包括 version_conflict/idempotency_conflict/active_run/workspace_not_ready/workspace_already_prepared/snapshot_stale；422 包括 project_not_found/preset_not_found/check_unavailable。availableActions 是服务当前可操作提示，不是绕过版本/磁盘校验的承诺。

本批只验证 Windows 的真实 Git/SQLite/HTTP 与确定性引擎替身。未运行真实浏览器、真实模型或 Linux；Claude 页面不在本批修改范围，现有前端连接旧服务时仍是旧模式。

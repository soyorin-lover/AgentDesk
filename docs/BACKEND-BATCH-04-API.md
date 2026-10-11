# 后端第 4 批：读取事实与受控检查恢复

基于[第 3 批接口](BACKEND-BATCH-03-API.md)，保持已有端点、动作名、认证、幂等和版本规则。所有新端点同样要求 Bearer / Host / Origin 校验。公共客户端新增方法后需要 Claude 同步 vendored 的 api.ts、execution.ts、types.ts；Codex 不修改前端副本。

## 接受摘要

`GET /tasks/:id/acceptance` 和任务详情的 `acceptance` 返回：

```ts
type AcceptanceSummary = {
  status: 'not_accepted' | 'valid' | 'invalid' | 'unverifiable';
  acceptance?: Acceptance;
  reason?: string;
  checkedAt: string;
};
```

新接受记录保存 runId、snapshotId、contentDigest，另有 valid、acceptedAt 和失效后的 invalidatedAt / invalidatedReason。旧记录缺少 digest 时从其不可变快照派生；缺少失效原因时从同一 acceptanceId 的历史失效事件读取，没有证据则为 previously_invalidated。类型中的新增字段可选，用于兼容旧库；不需要数据库迁移。

摘要由后端重新核对绑定和工作区内容。`valid` 才能展示“当前接受有效”；`unverifiable` 表示扫描不完整、工作区不可访问或存储不可用，不能当作有效或永久失效。记录里的 valid 是持久状态，不应覆盖摘要的 status。检查通过与接受是独立事实。

读取发现确定的外部内容变化，会持久失效原因 workspace_changed，将任务改为 in_review，并增加任务版本、产生事件；恢复旧文件内容不会复活已失效的接受。反馈的原因是 new_run。因此 GET 详情/接受摘要可能发现并记录失效；后续写入使用重新读取的任务版本。总览只统计已存事实，不主动扫描每个 Git 工作区。

## 总览与待处理

| 端点 | 公共客户端 | 返回 |
| --- | --- | --- |
| `GET /overview?projectId=...` | `overview(signal?, filters?)` | totalTasks、taskCounts、runs、checks、workspaces、storageHealthy、executionMode |
| `GET /attention?cursor=0&limit=50&projectId=...` | `attention(cursor?, limit?, signal?, filters?)` | `{items,nextCursor}` |

总览统计全部任务，不受前端当前 50 项分页限制；未知项目返回零计数。运行/检查分别统计 running 与 needsRecovery。工作区按 unprepared / preparing / ready / failed / needs_recovery 统计。任务 accepted 计数表示持久任务状态，不能替代某项任务最新的接受摘要。

待处理项字段：id、taskId、projectId、title、kind、resourceId、可选 reason。kind 为 task_details、prepare_workspace、workspace_recovery、run_recovery、check_recovery、review、run_failed、check_failed。每项 id 由 kind 与资源 ID 组成；一项任务可有多个事项。失败检查只取当前运行轮次对应的最新检查，历史失败不会持续堆积。正在执行不等于等待用户，也不生成虚构审批。

游标为生成列表的偏移量，limit 为 1–200；projectId 过滤按底层位置扫描，与任务列表一致。状态改变时列表可能变化，这不是冻结快照；前端收到事件后从 0 刷新，勿持久化跨状态的分页游标。响应不返回源码/worktree/数据库路径、令牌或内部进程身份。

## 受控检查恢复

| 端点 | 公共客户端 | 行为 |
| --- | --- | --- |
| `GET /tasks/:id/recovery` | `recovery(taskId)` | `{items:[{kind,id,taskId,version?,reason,recoverable}]}` |
| `POST /checks/:id/recover` | `recoverCheck(checkId,{expectedVersion},key)` | 200，已恢复的 CheckRun |

任务详情另带 `recovery`。kind 为 check / run / workspace。仅检查在有可信持久退出结果且工作区状态允许时 recoverable=true，动作名增加 `recover_check`。其他九个动作名保持不变；客户端忽略不认识的新动作，不据字符串推断新能力已支持。

检查进程确定结束后，后端在 Git 扫描前持久保存本次结果及 task/run/snapshot/digest 绑定。若随后扫描失败，或服务在记录最终状态前重启，可显式恢复该检查记录。恢复重新核对工作区身份、无正在运行的执行、没有 quarantine、扫描完整；不执行原命令。使用检查版本与显式幂等键，同键同载荷不重复产生恢复事件，同键异载荷仍 409。

恢复保留已确认的 passed / failed / cancelled / timed_out 结果和实际输出，但 validity 固定 stale，reason 为 recovered_confirmed_exit，事件 check.recovered；任务版本增加。必须重新运行检查才能得到新的当前检查证据。不会自动接受、回滚、集成或恢复模型会话。

**没有持久退出证据的 needs_recovery 仍不能解除。** 返回 process_exit_unconfirmed；浏览器不能提交 confirmed=true、PID、路径或结果来替代证据。旧版未知记录同样拒绝。quarantine 不删除，工作区归属未知不收养，Git 准备失败/模型结果未知暂没有恢复命令。recoverable 是查询时的建议，真实 POST 仍可因版本或工作区变化被拒绝。

## 执行模式与版本冲突

bootstrap 新增 `executionMode: 'codex' | 'deterministic'`，联调入口显式 deterministic，实例名标为无模型样例；普通 serve 为 codex，仍需实际模型验证，不能把模式字段当作额度、登录或执行成功证据。codex-local 身份与原接口兼容。

版本冲突现在填写原有响应顶层 `currentVersion`：`{error:{code:'version_conflict',...},currentVersion:N}`，公共客户端在 `ApiClientError.currentVersion` 保留合法的正整数。仍需重新读取资源，不自动重发旧载荷。PATCH 任务编辑一直存在，仅允许首次运行前编辑目标等字段。

# API 说明

所有路由以 `/api/v1` 为前缀，地址由启动输出确定。本文提供主线索引，不重复完整 DTO；字段以 [类型](../src/backend/types.ts)、[ApiClient](../src/client/api.ts) 和 [HTTP 路由](../src/backend/http.ts) 为准。

## 访问规则

- 使用 `Authorization: Bearer <本地令牌>`，令牌不放 URL。
- 写操作使用 JSON、`Idempotency-Key`，更新类请求按客户端签名带 expectedVersion。
- 同键同载荷复用结果，同键异载荷拒绝。超时不表示后端未收到，客户端不自动重试。
- 409 后重新读取并处理版本或授权变化；202 只表示意图已记录。
- 仅允许本机 Host 和配置的精确 Origin，不使用 Cookie 登录。

## 主线路由

| 方法与路径 | 用途 |
| --- | --- |
| GET `/bootstrap`、`/projects`、`/projects/:id` | 环境与项目 |
| POST `/projects`、PATCH `/projects/:id` | 创建/编辑项目空间 |
| POST `/projects/:id/repository-inspections`、`/repository` | 检查仓库与确认基线 |
| GET `/execution-grants`、GET/POST `/projects/:id/execution-binding` | 来源授权与绑定 |
| GET/POST `/projects/:id/workflow` | 读取/保存计划 |
| GET `/projects/:id/workflow-revisions` | 历史修订 |
| POST `/projects/:id/workflow-approvals` | 批准修订的指定节点 |
| POST `/projects/:id/workflow-tasks` | 建立受管任务 |
| POST `/projects/:id/workflow-confirmations` | 根据有效接受确认节点 |
| GET `/tasks`、`/tasks/:id`、`/runs/:id` | 任务与轮次 |
| POST `/tasks/:id/workspace` | 准备固定基线 worktree |
| POST `/tasks/:id/runs` | 首次执行或带 input 的反馈 |
| GET `/tasks/:id/session`、`/agent-instances`、`/agent-instances/:id` | 会话、实例与能力 |
| POST `/tasks/:id/snapshots` | 创建快照 |
| GET `/tasks/:id/changes`、`/snapshots/:id/files/:fileId` | 快照与文件 Diff |
| POST/GET `/tasks/:id/checks` | 执行检查与查询有效性 |
| POST `/checks/:id/cancel`、`/checks/:id/recover` | 取消检查与可证明的恢复 |
| POST `/tasks/:id/accept`、GET `/tasks/:id/acceptance` | 接受与有效性 |
| GET `/tasks/:id/events`、`/tasks/:id/events/stream` | 分页事件与 SSE |
| GET `/overview`、`/attention`、`/tasks/:id/recovery` | 总览、待处理与恢复信息 |

同一行省略共同前缀的第二条路径沿用对应 project/task ID。另有普通任务创建/编辑和 Run 中止接口，是否可用由实例能力、授权与状态决定，不能因路由存在就认为所有引擎均支持。

## 客户端

```ts
import { ApiClient } from './src/client/api.ts';
const api = new ApiClient({
  baseUrl: connection.origin,
  getToken: () => connection.token,
});
const detail = await api.task(taskId);
const body = { expectedVersion: detail.task.version };
const key = crypto.randomUUID();
// 前提：任务已批准、工作区 ready，当前允许执行。
const run = await api.startRun(taskId, body, key);
// 继续查询 api.run(run.id) 或读取事件，不能当作成功。
```

明确重试未确认写请求时保留原方法、body、key，先查询事实；不要生成新 key 变成另一轮模型执行。实际产品不自动重试模型调用。

`api.events(taskId, after, limit)` 分页读取，`api.streamEvents(taskId, { after, signal })` 读取带认证的 fetch 流。成功应用后才推进游标，跨任务、序号缺口、无效帧或缓冲超限停止，客户端不静默重连。

ApiClientError 包含 status、code 和可选 currentVersion；EventStreamError 包含原因与最后交付序号。取消 fetch 或关页面不等于取消后台执行。Run.model 兼容值不独自证明实际物理模型。

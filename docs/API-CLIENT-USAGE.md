# 联调 API 客户端

最新字段与实例/会话查询见 [B08a API](BACKEND-BATCH-08A-API.md)、[结果及三文件哈希](CODEX-BATCH-08A-RESULTS.md)。ApiClient.agentInstances/agentInstance/taskSession 为新增读取；Run.model 兼容值不能独自证明实际模型。F03 当前冻结 B07，后续升级需同步三文件；下方为早期使用示例。

第 3 批已扩展项目列表、工作区准备、检查/取消和任务过滤，原调用兼容。新增 DTO、请求样例、状态映射见 [BACKEND-BATCH-03-API.md](BACKEND-BATCH-03-API.md)；下方保留旧模式示例。

`src/client/api.ts` 为第 2 批 A 的现有 HTTP 接口提供无第三方依赖的客户端。它不绑定 React，不改变后端，不负责页面状态管理或渲染。运行时只使用浏览器已有的 fetch、ReadableStream、TextDecoder、AbortController；类型引用的 `src/backend/types.ts` 无 Node 依赖。正式前端集成时保留两个文件的相对结构，或由共同接口的负责方统一迁移；不要只复制一个文件而遗漏类型。

## 连接与调用

```ts
import { ApiClient, ApiClientError } from './src/client/api.ts';

// 连接表单输入，仅保存在当前页面内存中；不要使用构建期环境变量嵌入令牌。
const client = new ApiClient({
  baseUrl: connection.origin,
  getToken: () => connection.accessToken,
});
const bootstrap = await client.bootstrap();
const task = await client.createTask({
  title: '修复同步游标',
  goal: '消除连续两轮同步时的重复结果',
  acceptanceCriteria: ['针对连续两轮同步的回归通过'],
  agentInstanceId: 'codex-local',
}, crypto.randomUUID());

// 将动作、body 与 key 一起保存在当前待定请求状态；网络重试复用全部三个值。
const body = { expectedVersion: task.version };
const key = crypto.randomUUID();
const run = await client.startRun(task.id, body, key);
// HTTP 202 只代表意图已记录，不能将 run 当作执行成功。
```

所有写动作都要求调用方显式传入幂等键，不自动生成或重试。网络中断或取消 fetch 不表示服务器没收到请求；先查询详情，必要时用原键和完全相同的 body 重试。409 时保留用户草稿，重新读取详情并呈现冲突，不能无提示改版本后重发。令牌变更后下一次请求调用 getToken 取得新值；已建立的事件连接需显式重新连接。

接口方法：`bootstrap`、`tasks`、`task`、`run`、`changes`、`file`、`events`、`createTask`、`updateTask`、`startRun`、`interrupt`、`snapshot`、`accept`。最后一个可选参数为 AbortSignal；streamEvents 使用 options.signal。取消客户端请求或订阅不等于中止执行；产品中止必须调用 interrupt，并等待真实运行终态。

客户端仅接受 localhost / 127.0.0.1 的 HTTP 来源，路径固定为 /api/v1；令牌放 Authorization 请求头，不放 URL。fetch 禁止重定向、Cookie 和缓存。浏览器开发来源需在后端配置精确允许，例如 `http://localhost:5273`。该客户端不改变服务的跨域策略。

## 事件流与补读

```ts
const controller = new AbortController();
let appliedSeq = 0; // 必须与已还原的任务/消息状态匹配；首次重放从 0 开始。
try {
  for await (const event of client.streamEvents(task.id, {
    after: appliedSeq,
    signal: controller.signal,
  })) {
    applyEvent(event); // 先成功应用事件，再更新游标。
    appliedSeq = event.seq;
  }
} catch (error) {
  if (!controller.signal.aborted) showConnectionIssue(error);
}
// 用户离开该任务或组件卸载时 controller.abort()。
// 恢复连接时显式新建订阅，after 使用成功应用的 appliedSeq。
```

使用带认证的 fetch 流，不使用原生 EventSource。支持后端的 LF / CRLF 帧、跨数据块 UTF-8、心跳忽略和已消费 seq 去重。发现 seq 缺口、错误任务或帧 id/type 与 JSON 不一致时停止，避免默默丢事件。单帧/未结束缓冲上限为 12 Mi 字符，避免无限缓冲；这不是通用 SSE 库，不支持仅 CR 的分隔格式。

EOF/传输异常产生 `EventStreamError`，包含 `code` 和最后交付的 `after`；无效事件为 invalid_event，超限为 frame_too_large。客户端不会静默重连。调用方应区分断线、认证错误、协议错误，避免无限重试；实际补读游标以成功应用的事件为准，不能用异常中的 after 覆盖尚未成功应用的状态。退出循环会取消请求、释放 reader；在等待下一条事件时需通过 AbortController 取消，单独调用异步生成器 return 不会立即打断正在等待的 read。

JSON API 错误产生 `ApiClientError`，包含 HTTP status 和机器 code，不显示原始错误正文。成功 JSON 响应类型对应现有服务契约，未对每个对象做完整运行时 schema 校验；页面 adapter 仍须处理可选字段和未来未知状态。客户端不把 needs_recovery 映射成可恢复执行，也不把 succeeded 映射成 accepted。

## 与样稿对接

- `TaskDetail` 分别返回 task、run、snapshot、lastEventSeq 和 availableActions；样稿的展示状态需由前端 adapter 映射。
- 原样保留 changes/snapshot 的 checks=not_run，不沿用演示检查结果。
- 接受传 expectedVersion + snapshotId，snapshot_stale 时重新审查；反馈创建新 Run，旧接受失效。
- 不提供审批、steer、恢复、换实例、集成或最终验收方法，因为第 2 批 A 没有这些业务端点。
- ReviewFile 返回原始 patch / stagedDiff，客户端不解析为样稿的 hunks，也不生成完整仓库文件树。

## 验证边界

测试文件 `tests/api-client.test.ts` 覆盖实际 SQLite/Git/HTTP 上的认证、幂等与版本冲突、执行/快照/接受/反馈，以及流分块与游标、错误事件和取消。执行器为测试替身；该切片没有再次调用模型。浏览器工程类型检查不加载 Node 类型。真实浏览器 CORS、页面渲染、Linux 和 Claude 前端联调仍待验证。

2026-10-08 修复后新执行：`node --test tests/api-client.test.ts` 10/10；`npm test` 57/57；`npm run typecheck` 使用现有 TypeScript 6.0.3，30 个文件 strict/noEmit 通过。另以 ES2023 + DOM + DOM.Iterable、Bundler resolution、types=[] 单独检查客户端通过，证明其编译不依赖 Node 类型，不等同于浏览器运行验证。没有独立 linter 或产品构建配置，未新增依赖。

gpt-6.1-sol 只读独立审查发现 JSON 正文取消误分类和取消后继续交付缓冲帧两项问题，均先添加失败回归，再修复为通过。
# 第 3 批扩展

项目、工作区准备、检查与取消、任务过滤已接入同一客户端，原方法签名保留。完整请求/响应及状态映射见 [BACKEND-BATCH-03-API.md](BACKEND-BATCH-03-API.md)。`task()` 返回 workspace/checks；当前检查证据使用详情 checks 或 `checks(taskId).summary`，不能使用快照旧字段推断通过。新增端点与客户端已用真实 Git/SQLite/HTTP 及确定性引擎验证；真实浏览器、真实模型和 Linux 不在本批验证范围。


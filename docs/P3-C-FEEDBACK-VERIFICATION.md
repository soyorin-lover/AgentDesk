# P3-C 首小批：反馈回到原任务

2026-10-12（Asia/Shanghai）。运行代码版本：`fa32a4f`。预期沿用 P1：反馈必须继续有归属证明的原会话；无法确认时拒绝，不能悄悄新开会话兜底。

## 证据与实际结果

复用 [backend-batch08a.test.ts](../tests/backend-batch08a.test.ts) 的两个现有测试。使用临时 Git/worktree、SQLite、应用服务，第一项还启动并关闭自有随机端口的本机 HTTP 服务。两个执行器均为确定性替身，没有 Codex/Claude 模型调用或浏览器操作。

- 正常反馈：两个不同实例的任务分别保留自己的会话归属。向第一个任务反馈时，替身收到该任务已保存的原生会话 ID；旧轮次迟到的消息/模型/turn 回调不能污染新轮次，换成其他会话 ID 被拒绝。
- 缺失会话：首轮替身结束但不提供会话证明，再发送反馈时返回 `native_session_unproven`；替身启动次数仍为 1，没有另开一轮执行兜底。
- 测试后另以只读方式检查生成的数据库：正常场景 2 个 Task、3 个 Run、2 份会话记录；反馈任务的两个 Run 引用同一份保存会话，另一任务只有 1 个 Run，迟到的 `late` 消息入库数为 0。缺会话场景只有 1 个 Task、1 个 Run、0 份会话记录。

会话记录身份与原生 ID 的归属需要结合引擎和实例判断；不假定不同实例的替身原生 ID 字符串必然不同。关键代码入口：[BackendService.#sessionFor/startRun/#execute](../src/backend/service.ts)。

## 命令与结论

```powershell
node --test --test-reporter=tap --test-name-pattern="^B08a (HTTP registry separates same-engine instances and fixes session ownership and per-round evidence|missing native session after a round never silently creates a new feedback thread)$" tests/backend-batch08a.test.ts
```

Windows、Node.js v24.17.0：exit=0，2 项通过、0 失败、0 跳过，约 24 秒。原始输出、命令记录和数据库观察保存在忽略目录 `.agentdesk/p3c/`，不提交运行库、令牌或原始日志。

本次目标行为符合证据，未发现需修复的问题，不改源码或测试。未验证真实 Codex 协议和模型续接、浏览器反馈提示与草稿、全部异常和配置变化分支；不据此宣称真实模型验收完成，也不把执行结束等同于人工接受。

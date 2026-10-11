# P3-B 首小批：保存、批准与执行

2026-10-12（Asia/Shanghai）。运行代码版本：`fd20b56`。只验证下述授权行为，不代表计划模块全部通过验收。

预期来自 P1：保存任务不能自动执行；批准具体要求后仍需显式下发；修改要求不能继续使用旧批准。旧记录应保留，而不是悄悄改成新内容。

## 本次证据

复用 [backend-batch07.test.ts](../tests/backend-batch07.test.ts) 的首个测试：保存计划、批准节点、建立任务后，断言工作区未准备、FixtureEngine 调用次数为 0；重开后端服务验证计划和批准记录不变；将要求从 `change file` 改为 `new goal` 后，旧计划准备工作区及再次批准均被 `workflow_revision_stale` 拒绝，绕过计划直接编辑受管任务也被拒绝。旧任务要求仍为 `change file`。

测试后另外以只读方式打开生成的 SQLite 库：当前计划 revision=2、要求为 `new goal`；两份节点批准记录均属于 revision=1；已建立的任务仍保存 `change file`；Run 记录 0、Workspace 记录 0、任务 worktree 目录 0。旧批准仍是历史记录，但不能授权当前修订的后续操作。

关键实现：[Workflows.prepareDraft/prepareApproval/prepareLink/assertTask](../src/backend/workflow-service.ts)。原始日志和只读观察保存在忽略目录 `.agentdesk/p3b/`，不提交运行数据库或本机临时路径。

## 命令与结果

```powershell
node --test --test-reporter=tap --test-name-pattern="^workflow revisions and exact partial approvals persist without executing; edits revoke managed task authority$" tests/backend-batch07.test.ts
```

Windows、Node.js v24.17.0：exit=0，1 项通过、0 失败、0 跳过，约 7 秒。测试使用临时 Git 仓库、真实 SQLite 与应用服务，执行器为 FixtureEngine；没有真实模型、HTTP 或浏览器调用。

结论：本次预期符合实际证据，未发现需要修改产品代码的问题，源码及测试保持原样。未验证页面是否清楚呈现保存/批准/下发、新修订重新批准后的完整执行，以及全部授权/依赖分支；不把一项测试记为整个模块或真实 Agent 验收。

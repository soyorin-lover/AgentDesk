# P3-A 首小批：原目录与任务基线

日期：2026-10-12（Asia/Shanghai）。运行代码版本：`03f3982`。只核对项目与工作区中的两个行为，不代表整个模块或首版通过验收。

## 预期与判断依据

沿用 P1：原目录未提交的修改不能被覆盖，也不自动进入任务；任务从明确的已提交 commit 创建独立 worktree。原仓库后来提交新版本，旧任务不能悄悄换成新版本。

本批复用已有测试，使用真实临时 Git 仓库、worktree、SQLite 和后端应用服务；执行器是确定性的 FixtureEngine，不调用 Codex 或其他模型，不启动 HTTP 或浏览器。样例文件变化是测试输入，不是为求职案例制造产品 Bug。

## 实际观察

| 观察对象 | 预期 | 测试后读取的实际内容 |
| --- | --- | --- |
| 有未提交修改的原目录 | 保留用户当前修改 | sample.txt 仍为 `unsaved source`；untracked.txt 仍为 `keep`（测试断言）；Git 状态仍为已修改文件和未跟踪文件 |
| 上述项目的任务 worktree | 使用已提交基线，排除原目录未提交内容 | sample.txt 为 `second baseline`；HEAD 与固定基线一致，工作区干净 |
| 原仓库提交新版本后的旧任务 | 仍使用旧基线 | sample.txt 为 `second baseline`，HEAD 与新版本不同 |
| 显式重新绑定后建立的新任务 | 使用新绑定的版本 | sample.txt 为 `new baseline`，HEAD 与新的来源 commit 一致 |

第一个测试同时比较原目录的 HEAD、index 字节和 Git status 与操作前一致，并断言第二个任务在首个执行未结束时被拒绝。第二个测试重开服务后检查新旧任务绑定和工作区内容仍分别正确。测试完成后另外只读核对生成样例的文件内容、HEAD 与状态，未只凭测试标题推断行为。

关键代码入口：[ProjectRegistry.create/verify](../src/backend/projects.ts)、[ExecutionBindings.storedFor/validate](../src/backend/execution-bindings.ts)、[BackendService.prepareWorkspace](../src/backend/service.ts)。任务创建使用保存的 baselineCommit，不直接拿执行时的来源 HEAD，也没有复制原目录未提交修改的步骤。

## 验证命令及结果

```powershell
node --test --test-reporter=tap --test-name-pattern="^(two authorized sources pin task baselines|source HEAD advance and explicit new binding)" tests/backend-batch06.test.ts
```

实际：exit=0，2 项通过、0 失败、0 跳过，约 49 秒。Node.js v24.17.0，Windows。测试定义见 [backend-batch06.test.ts](../tests/backend-batch06.test.ts)；确定性执行器见 [backend-fixtures.ts](../tests/backend-fixtures.ts)。

原始测试输出、命令记录和临时目录内文件观察留在被忽略的 `.agentdesk/p3a/tests.tap`、`run.json`、`observed-files.json`。不提交临时仓库、运行数据库、本机路径或原始日志。本公开摘要记录代码版本、命令、条件和结果；日志留在本机，不承诺随仓库提供。

## 本批结论与边界

两个目标行为符合预期，没有据此发现必须修复的问题，因此不改产品源码或测试。没有为留下代码提交增加无关改动。

这次没有验证：浏览器里是否清楚提示未提交修改、真实 Codex 实际工作位置和反馈、其他仓库权限/路径边界、完整批准链路、成果检查与接受，以及 Linux。项目与工作区模块仍需按剩余条件核对，不把这两项测试升级为整个模块“已验证”。

验收者应观察：既保留了原目录未提交修改，又让任务从明确的已提交版本开始。若希望把当前修改交给任务，需先明确保存为新的 Git commit，再显式选择新基线；本批没有实现自动带入修改。最终人工判断不由测试框架代替。

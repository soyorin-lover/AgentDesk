# AgentDesk

源码：[soyorin-lover/AgentDesk](https://github.com/soyorin-lover/AgentDesk)。当前公开版本为 Windows 本机原型，已验证范围与限制见下文。

本机 Coding Agent 工作台原型：把已有 Git 仓库中的任务拆成可批准的计划，在独立 worktree 中执行，查看事件和 Diff，运行检查后人工接受成果。

当前整理目标是 **Windows、本机、单用户、串行、Codex** 首个公开版本。项目由 AI 辅助原型开发而来；从工程化整理开始记录新的阅读、判断、修改与验证，不把历史 AI 报告等同于本轮验收。

## 当前能力与边界

- 已有源码：项目与任务、计划修订与批准、固定执行绑定、独立 Git worktree、执行反馈、事件补读、Diff 快照、有界检查与人工接受。
- 反馈必须续接原任务会话；执行成功、检查通过、接受和集成是不同状态。接受不自动合并代码，也不强制检查通过。
- 本交付副本已在 Windows 隔离示例上完成真实 Codex 首次执行、同会话反馈、Diff、当前检查和用户接受；两轮检查分别 5/5、7/7。Claude 有适配和模拟测试，尚无真实模型验收；DeepSeek 为规划。
- 首次发布不包含完整并行、自动交接、自动集成、桌面安装与真实 AI 策划。Linux 尚未验收。
- 示例预览、确定性 HTTP 测试环境和真实模型执行有明确区分。

## 本地准备

需要 Node.js >=24.17.0、Git。后端运行使用 Node 内置 TypeScript 与 SQLite；前端依赖通过现有锁文件安装。在仓库根目录运行：

```powershell
npm --prefix web ci
npm --prefix web test
npm --prefix web run build
```

预览前端：

```powershell
npm --prefix web run dev -- --host 127.0.0.1 --port 5331 --strictPort
```

打开 http://127.0.0.1:5331/#/preview 。预览使用示例，不执行模型。

## 无模型浏览器验收

安装上述前端依赖后，在仓库根运行 `npm run verify:web`。此命令启动自己持有的前端和确定性后端，创建临时 Git/SQLite 工作区，运行浏览器交互验证，再关闭自己启动的服务。不会修改用户源码或调用模型。

浏览器自动化需要环境中已有 Playwright 和可用浏览器。默认导入 `playwright` 并使用其 Chromium；外部工具可以设置 `PLAYWRIGHT_MODULE_PATH` 为 `playwright/index.mjs` 的绝对路径。Windows 已安装 Edge 时可设置 `PLAYWRIGHT_BROWSER_CHANNEL=msedge`。这些路径只放本地环境变量，不写入仓库。未提供这些测试工具时，该专项不能运行。

截图和结果位于忽略目录 `web/.agentdesk/interaction-evidence/`；临时测试数据库与令牌不提交。确定性执行器只验证工作流，不证明真实模型能力。

## 连接真实后端

1. 准备一个已有提交且干净的 Git 仓库，以及独立的任务工作区根目录。两者不能重叠，也不能与 AgentDesk 仓库重叠。
2. 在仓库根创建 `.agentdesk`，复制 `config.example.json` 为 `.agentdesk/local-backend.json`，填写全部占位符。JSON 路径使用正斜杠或双反斜杠；可用 `node -p "process.execPath"` 查询 Node 路径。
3. 在仓库根运行：

```powershell
npm run serve -- --config .agentdesk/local-backend.json
```

示例采用本轮验证通过的 `transport: "http"`：临时使用 Codex 上游 HTTP 连接，禁用请求/流重试，不修改全局 Codex 配置；这不意味着所有网络环境都已验收。

终端显示实际 API 地址和访问令牌文件的位置。将地址和令牌填入前端连接页。启动本身不执行模型；明确开始任务才会执行，因此真实执行还需可用且已登录的 Codex CLI。

数据库必须位于本仓库忽略的 `.agentdesk` 内；相对路径按当前工作目录解释，因此上述命令必须从根目录运行。端口冲突应修改配置。`allowedOrigins` 必须匹配实际前端来源，不带末尾斜杠。

示例的 Node 版本检查只证明命令可执行。请把检查预设换成目标项目实际的测试命令，使用可执行文件及参数数组；Windows 不支持 `.cmd`/`.bat` 检查预设，不依赖 shell 通配符展开。未提交源码不会自动进入任务 worktree；开发中脏仓库的额外授权见 [B06 接口](docs/BACKEND-BATCH-06-API.md)。

## 开发验证与项目记录

- 后端回归：根目录 `npm test`。包含真实临时 Git/SQLite/HTTP/子进程与协议替身，不调用真实模型。
- 后端严格类型：`npm run typecheck`。当前没有自动安装后端编译工具，需要已有 TypeScript 与 `@types/node`；设置 `TYPESCRIPT_PATH` 指向 `typescript.js`、`NODE_TYPES_ROOT` 指向包含 `node` 的 `@types` 目录。
- 前端测试/类型与构建：`npm --prefix web test`、`npm --prefix web run build`。
- [首次发布范围与验收](docs/release-scope.md)、[核心架构](docs/architecture.md)、[本轮交付验证](docs/delivery-verification.md)。
- [历史交接](docs/HANDOFF.md) 保留原型过程；其旧路径、测试数量和未来计划应结合当前记录阅读。

不提交令牌、私人配置、运行数据库、原始敏感日志或依赖目录。Git worktree 提供代码隔离，不是安全沙箱。项目代码采用 [MIT 许可证](LICENSE)；第三方图标及依赖保留各自许可，见 [来源与依赖说明](THIRD_PARTY_NOTICES.md)。真实 Codex 验收范围见 [交付记录](docs/delivery-verification.md)。提交作者信息使用 GitHub 隐私邮箱；原始历史备份仅保存在本地忽略目录。

# 开发与测试

## 目录与工具

```text
src/backend/     服务、SQLite、Git、Agent、检查与计划
src/codex/       结构化 App Server 协议
src/client/      浏览器 API 客户端与事件状态
web/            React 前端、测试和前端锁文件
tests/          后端与集成回归
scripts/        验证和设计预览
docs/           当前指南与静态设计资源
.agentdesk/     本地配置、运行记录与备份（忽略）
```

需要 Node.js >=24.17.0、Git；前端用 `npm --prefix web ci` 安装。后端直接用 Node 内置 TypeScript 与 SQLite，没有根目录依赖安装步骤。普通自动测试使用替身，真实执行另需已登录 Codex CLI。

## 验证命令

从根目录执行，按影响选择定向测试。

| 命令 | 范围 |
| --- | --- |
| `npm test` | 后端全套，Git/SQLite/HTTP/子进程及协议替身，零真实模型 |
| `node --test tests/delivery.test.ts` | 当前源码 fixture 启动、认证、契约与关闭 |
| `node --test tests/backend-checks.test.ts tests/backend-project-flow.test.ts` | 检查、有效性与接受 |
| `node --test tests/backend-adapter.test.ts` | Codex 协议替身与权限拒绝 |
| `npm --prefix web test` | 前端状态逻辑，含 node-edit |
| `npm --prefix web run build` | 前端类型与 Vite 构建 |
| `npm run typecheck` | 后端 strict/noEmit，需外部工具配置 |
| `npm run verify:web` | 自有浏览器/HTTP/Git/SQLite，确定性 Agent，零模型 |

后端类型检查需已有 TypeScript 与 @types/node：TYPESCRIPT_PATH 指向 typescript.js，NODE_TYPES_ROOT 指向包含 node 子目录的 @types 绝对路径。不写入机器路径。前端安装含 TypeScript，但不保证具备后端所需 Node 类型。

浏览器专项需已有 Playwright 和 Chromium；默认导入 playwright，外部安装可设 PLAYWRIGHT_MODULE_PATH 指向 index.mjs。Windows 已有 Edge 可设 PLAYWRIGHT_BROWSER_CHANNEL=msedge。工具未配置时该项不能运行。

verify:web 创建并关闭自己的服务与浏览器，结果在忽略目录 `web/.agentdesk/interaction-evidence/`。不能终止别人的服务。历史 F01/F02/F03/F04 编辑和浏览器脚本可能含旧路径/私有快照，不是受维护入口。

verify:codex 等真实协议验证入口先阅读源码并明确调用范围；不能把含 verify 的命令一律当成零模型测试。

## 公共契约

| 根文件 | 前端副本 |
| --- | --- |
| `src/client/api.ts` | `web/src/v2/api/client/api.ts` |
| `src/client/execution.ts` | `web/src/v2/api/client/execution.ts` |
| `src/backend/types.ts` | `web/src/v2/api/backend/types.ts` |

同步后更新 [哈希清单](../web/docs/FRONTEND-CLIENT-SNAPSHOT.json)。fixture 比较实际 SHA-256 后启动，不依赖私有冻结后端。公共接口和锁文件同一批指定一位修改者。

## 文档维护

README 放定位、入口和简短结果；操作放使用指南，模块关系放架构，接口放 API，证据放验证指南。设计资源由根 [DESIGN](../DESIGN.md) 说明，不再前插交接消息维护现状。

精简前文档仍在 Git 历史中，例如 `git show 7cf9878:docs/delivery-verification.md`。这是公开历史中的整理前基线，无需恢复旧开发目录或运行库。没有把敏感原始日志移入公开档案。

修改后记录实际命令、结果与未验证项；AI 的完成报告不是验收证据。详见 [AGENTS](../AGENTS.md)。

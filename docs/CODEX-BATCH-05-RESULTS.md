# 后端第 5 批结果

2026-10-09，Windows。本批完成项目组织空间和已有 Git 仓库接入基础；[接口及前端接法](BACKEND-BATCH-05-API.md)、[技术计划](BACKEND-BATCH-05-PLAN.md)。没有调用真实模型、安装依赖、改根配置/锁文件、提交/推送/部署、停止或重启既有服务。未改 Claude 前端或 workflow-preview.html、根 DESIGN.md、运行数据库/配置/令牌。

## 实现范围

- SQLite documents 新增项目空间，提供创建、简要列表、详情和名称/说明编辑；初始版本 1，编辑和仓库确认递增。全部写入沿用幂等键、串行队列和事务；HTTP 沿用 Bearer/Host/Origin。
- 规范化用户显式提交的已有根目录，真实读取 Git 身份、分支/HEAD（attached/detached/unborn）、staged/unstaged/untracked/conflicted 概要及 linked worktree 信息。隔离继承 GIT_*、禁用 fsmonitor 和可选 index 写锁；没有 Git 写操作或源码响应。
- 每次检查两遍稳定核对；检查关联项目版本并在 10 分钟失效。显式确认具体 HEAD commit、承认未提交排除；确认重新解析原路径、重扫字节/index/身份/worktree，变化拒绝。关联与具体基线持久保存，可重读。
- 组织空间不授予执行权限。新空间创建执行任务返回 execution_binding_required，详情提供能力原因。可信配置、bootstrap、旧 workspace/project 模式及旧 task/run/check/snapshot/accept/SSE 保留；关联不替换旧执行仓库或基线。
- 公共客户端新增项目详情/创建/编辑/检查/确认/读取关联方法和浏览器安全类型。普通列表、详情、bootstrap、总览、待处理和错误不泄露绝对路径。
- 历史数据库采用非破坏性补录：只在缺失时按旧 projectId 加项目空间，不重编号任务或重写事件。用户编辑后重启保留，不被旧配置名称覆盖。本批仅测试临时数据库，没有迁移运行中的旧数据库。

## 新执行验证

| 命令 | 最终结果 |
| --- | --- |
| `npm test` | 99/99，通过，0 skipped，约 77.8 秒；含 11 项第 5 批测试及全部旧链路 |
| `npm run typecheck` | TypeScript 5.9.3，47 文件 strict/noEmit 通过 |
| `tsc --strict --noEmit --target es2023 --module nodenext --allowImportingTsExtensions --lib es2023,dom,dom.iterable src/client/api.ts src/client/execution.ts` | 退出 0，仅浏览器库客户端编译通过 |
| 第 5 批针对性运行 | 首轮 7/8，路径别名重指向测试失败；修复后 10/10，补目录删除测试后最终全套 11/11 |

TypeScript 与 Node 类型复用本机已有安装，通过 TYPESCRIPT_PATH / NODE_TYPES_ROOT 指定；不提交机器路径、不安装依赖。仓库没有 build 或 lint 脚本；以严格编译、仅浏览器编译及真实运行测试验证，不声称运行了不存在的 build/lint。未运行会消耗额度的 verify:codex / verify:backend。

测试使用真实临时 Git 仓库、SQLite 和本机 HTTP 端口，执行器是明确不调用模型的 fixture。覆盖脏 index/工作区、未跟踪、HEAD commit 推进、detached、unborn、裸/非仓库/子目录、目录别名及重指向、linked worktree 变化、同状态但字节变化、隐藏 index 标记、大小限制、整目录删除、检查过期和跨项目/版本/基线拒绝；还有真实 HTTP 认证/Origin、校验、并发版本冲突、公共客户端、关联重启重读与历史任务 ID 保留。

只读证明：对原分支、HEAD、porcelain 状态、index 字节、已修改/未跟踪文件字节在检查及确认前后进行相等断言；重复确认和服务关闭/重开后再次核对。detached/unborn/目录删除场景也确认状态和内容未被恢复或覆盖。测试自己的显式 commit/checkout/worktree 操作仅用于制造临时仓库变化，产品检查/确认不会执行这些命令。

两项边界有失败复现后修复：确认仅用已解析路径会漏掉输入别名重指向，现保留私有提交路径并重解析；被删目录父级 lstat 会误拒绝有效删除，现允许 ENOENT 并记录缺失，仍拒绝父 symlink，不重建内容。首次类型检查 Node 类型位置未找到，定位已有包后最终通过。普通 shell/Node 工具沙箱启动失败，本批通过受审查执行通道运行，未修改沙箱配置。

## 修改文件与交接

代码：`src/backend/{service,http,types}.ts`、新增 `src/backend/repository-import.ts`、`src/client/api.ts`。验证：新增 `tests/backend-batch05.test.ts`。文档：本批 PLAN/API/RESULTS、HANDOFF.md、BACKEND-HANDOFF.md、PROJECT-REMAINING.md、README.md。没有修改根 package.json、锁文件或前端副本。仓库仍 main、无首次提交、文件未跟踪；没有自动提交全部文件或创建依赖 HEAD 的并行代码 worktree。

未实现/未验证：任意项目的受支持执行绑定、关联驱动 worktree、未提交内容保存/纳入基线、流程图/角色/草案批准、并行调度、其他引擎、集成/部署、桌面宿主、Linux、正式浏览器 DOM 和新模式真实模型验收。服务启动仍需旧可信配置；扫描不是原子文件系统快照，确认后外部仍可变，后续执行必须重新验证。有界扫描可能拒绝大型/特殊仓库，忽略文件不纳入摘要。检查记录没有自动清理策略。

前端独立对话可接项目首页，明确 commit、未提交排除与 execution_binding_required；原在线服务未热更新，不把源码完成当作旧端口已经提供新接口。下一批后端建议显式多项目执行绑定与未提交改动处理方案，按最新产品决策逐批推进；不自动扩大本批或消费模型额度。

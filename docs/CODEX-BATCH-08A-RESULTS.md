# B08a 正式结果

2026-10-09。受信实例注册/查询、固定配置修订、原生会话归属、逐轮引擎/模型证据与规范事件已实施；仍只有 Codex 业务适配、全局串行。正式字段见 [API](BACKEND-BATCH-08A-API.md)，过程见 [计划](BACKEND-BATCH-08A-PLAN.md)。B08b/B08c 未启动。

## 修改范围

- 新增 backend/agent-instances.ts：启动注册、兼容别名、不可变配置修订与摘要证明、缺失实例与能力查询；无 HTTP 自授权或账号探针。
- backend/types.ts/service.ts/workflow.ts/workflow-service.ts：Task/节点/批准固定实例配置；每任务会话归属、迁移拒绝不明目标、逐轮 Run 证据及事件来源；保留 B05–07 基线、依赖、检查、接受和未知结果隔离。
- backend/adapter.ts：固定启动选择器、必须验证线程 cwd/审批/沙箱、接受的 native turn、精确 thread/turn 消息/活动/路由；模型目录不当作实际结果。
- backend/http.ts、client/api.ts、serve.ts：只读实例/会话端点、浏览器客户端、受信多实例本地配置。client/execution.ts 保持原协议消费，不变。
- 新增实例注册/B08a 测试，扩展协议夹具/adapter 测试，保留 B07 未知结果测试身份，并隔离 RPC 冲突断言与 Windows 进程启动时限。
- 更新本批计划/API/结果和交接入口；前端、设计稿、路线任务书不改。

## 验证

最终 `npm test`：**140/140 通过**，0 失败/取消/跳过，约 325 秒；包含全部 B05–B07 回归与缺失原生会话的拒绝用例。所有自有测试进程/HTTP 监听已关闭。

- 新整合先 4/4 RED；补充覆盖后 B08a+RPC 20/20。使用实际临时 Git、SQLite、HTTP、确定性 EngineAdapter/fake stdio transport，未调用模型。
- registry 3/3；adapter/session/RPC 26/26。配置漂移/恢复、同工具多实例、精确事件、策略回显、未知模型、会话隔离/迁移、直接未支持路由和全局未知阻塞均有证据。
- TypeScript 5.9.3 strict/noEmit 56 文件通过；公共 api/execution 以 ES2023+DOM 单独浏览器编译通过。使用既有依赖路径，不新增依赖。package 没有 lint/build 脚本。
- 单次 gpt-6.1-sol 只读审查未发现可确认 P1/P2；主代理负责最终测试验收。
- 第一轮全套唯一失败为 RPC 测试把 Windows 子进程启动包含在 300ms 冲突等待中；独立 13/13，修正测试就绪边界后重新全套。真实超时/冲突处理没有更改。
- 修正后全套 139/139；收尾另发现缺失 native session 的反馈不应静默新建线程，追加 RED→GREEN 用例及门禁，含该修正的最终全套单独记录。
- 该门禁要求旧客户端无模型夹具提供明确 session，补齐 onSession 与继续 ID 断言后 10/10；最终 140/140 已包含修正，生产门禁未放宽。
- CLI 专项使用新临时配置登记 Codex/未接入占位实例，验证配置元数据保存、监听与租约释放、零 Task/零模型轮次；未触及既有运行配置。修改源文件和测试的尾随空白静态检查通过。

验证命令：`npm test`、`npm run typecheck`、`node --test tests/backend-batch08a.test.ts tests/rpc.test.ts`、`node --test tests/backend-adapter.test.ts tests/session.test.ts tests/rpc.test.ts`。浏览器独立编译使用既有 TypeScript 的 tsc.js，参数为 `--strict --noEmit --target es2023 --module nodenext --allowImportingTsExtensions --lib es2023,dom,dom.iterable src/client/api.ts src/client/execution.ts`。typecheck 从既有 TYPESCRIPT_PATH/NODE_TYPES_ROOT 读取运行时，无安装依赖。

## 公共文件 SHA-256

需同步三个文件并保留相对类型引用；F03 暂不升级，继续冻结 B07。

| 文件 | SHA-256 |
| --- | --- |
| src/client/api.ts | EAC5D2C41B707CFEC3CEF348C07DE0F96404D1E085D21BAD4912AAF2DE53D89D |
| src/client/execution.ts | 8A5207C059409FD1AE3A45C2588D2FEF380282D33420A0D016526969440373AF |
| src/backend/types.ts | A2A87AF620D2547D167DDC509B6727AA0E453ECB241245DD90B239D54C055700 |

## 冻结与未验证边界

改公共文件前保留的 B07 副本：`.agentdesk/b07-frozen/20261009-before-b08a`，含 src/scripts/package 与 B07 契约，PUBLIC-SHA256.json 核对正式 B07 哈希。快照被 Git 忽略，未复制运行库/令牌/凭据/node_modules。可在独立端口启动其中 scripts/integration-server.ts，每次新库，不保证恢复临时源码/任务 worktree。未启动该副本服务或改变已有端口。

仅执行本批源码/本地测试。没有登录/额度/模型探针、真实模型轮次、Claude/DeepSeek 接入、AI 规划、交接调度、并行执行、集成、桌面宿主、Linux 或浏览器验收。配置摘要证明选择器一致，不证明二进制内容/外部配置或物理模型；health 始终 unknown。历史缺少实例配置的 Task/批准和 legacy session 只保留可读证据，不能猜测授权。

既有在线服务、运行库与配置未升级；无提交/推送/部署/清理。无首次 Git 提交，全部文件仍未跟踪，不能用空 git diff 代替审查证据。后续前端同步 B08a 和其他引擎批次需另行协调，本批交付后停止。

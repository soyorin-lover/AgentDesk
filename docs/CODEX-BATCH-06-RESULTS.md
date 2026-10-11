# B06 结果与交接（2026-10-09）

已完成本批：显式受信多项目执行绑定、任务固定仓库基线和绑定修订。正式契约见 [B06 API](BACKEND-BATCH-06-API.md)，过程与边界见 [计划](BACKEND-BATCH-06-PLAN.md)。未实施 B07 及后续批次。

## 行为与兼容

- 本机启动配置 `executionGrants` 授予仓库执行权限，HTTP 只能引用登记授权和当前已确认仓库关联；任意路径或 trusted 字段不能授予权限。兼容原唯一主项目配置与 legacy 单工作区模式。
- 绑定不可变，项目保存当前指针，新任务固定绑定 ID/revision/grantId/commit。显式更新只影响后续任务，源 HEAD 推进也不替换历史基线。旧任务仅从已保存配置/工作区基线补引用，不猜当前 HEAD。
- 两个授权仓库分别路由准备、模型替身执行、反馈、快照、检查与接受；检查预设可按授权项缩小范围。模型与检查继续全局串行，未知结果继续阻止其他项目执行和重绑。
- 原始源码的 HEAD/index/已修改文件/未跟踪文件保留，未提交改动明确排除。源码与工作区根目录真实身份、Git commonDir、commit、归属标记和租约均校验；路径别名重指向或同路径目录替换不能收养新仓库。
- 授权暂时撤销会禁用执行；已经证明准备成功的工作区保留 ready 事实，恢复原授权后仍须实际身份验证。未知进程保护不因此解除。

## 修改范围

| 文件 | 修改 |
| --- | --- |
| `src/backend/execution-bindings.ts`（新增） | 受信授权加载、持久身份、不可变绑定与任务解析 |
| `src/backend/types.ts` | 绑定、授权配置、任务引用及项目能力类型 |
| `src/backend/projects.ts`、`repository.ts` | 源码/根目录身份、固定 commit 路由、隔离继承的 Git 环境覆盖 |
| `src/backend/service.ts`、`http.ts` | 授权与绑定端点、历史迁移、多项目任务路由、范围检查及租约保护 |
| `src/client/api.ts` | 授权列表、读取绑定、显式绑定方法及类型导出 |
| `src/serve.ts` | 接受受信启动 executionGrants 配置 |
| `scripts/integration-server.ts` | 可选双项目无模型 fixture，默认行为保留 |
| `tests/backend-batch06.test.ts`（新增）、`tests/integration-server.test.ts` | B06 回归与真实双项目 HTTP fixture |
| B06 PLAN/API/RESULTS、HANDOFF、BACKEND-HANDOFF、PROJECT-REMAINING、README | 发布契约、证据及后续交接 |

`src/client/execution.ts` 无改动，但作为公共同步文件一起公布哈希。前端工程、DESIGN.md、HTML 设计稿、路线任务书未修改；无新增依赖。

## 验证证据

Windows，真实临时 Git 仓库、SQLite、HTTP；执行器为不调用模型的确定性替身。

| 验证 | 结果 |
| --- | --- |
| `node --test tests/backend-batch06.test.ts` | 11/11，退出 0，约 254 秒 |
| `npm test` | 111/111，无跳过，退出 0，约 255 秒 |
| `npm run typecheck`（使用已安装 TypeScript 5.9.3 与 Node 类型） | strict 49 文件通过 |
| 已安装 tsc 对 `src/client/api.ts src/client/execution.ts` 编译：strict/noEmit/es2023/nodenext/allowImportingTsExtensions/lib es2023,dom,dom.iterable | 退出 0 |

测试覆盖双仓库不同内容、脏源码逐项不变、授权拒绝与撤销恢复、固定基线/修订/重启、旧任务迁移、全局未知状态门禁、检查/会话/接受隔离、Host/Origin/Bearer、请求字段、版本冲突、幂等与客户端取消。

按失败测试后修复的关键问题：暂时撤权被错误标记为准备未知；同 commonDir 多授权未拒绝；workspaceRoot 同路径目录替换未检测；未知模型进程且 quarantine 写失败时租约被释放。最后两项由一次 gpt-6.1-sol 默认角色只读审查发现，均完成失败复现、修复与最终回归。没有使用 Astra 或递归委派。

没有 build/lint 脚本，不声称运行了不存在的检查。最终测试后仅更新文档。额外重复类型检查命令因自动审批复核用量限制未执行；此前 strict 与浏览器编译已取得通过证据。

## 公共文件 SHA-256

前端自行同步副本，保持三个文件来自同一发布批次：

| 文件 | SHA-256 |
| --- | --- |
| `src/client/api.ts` | `610C79842DF00B5C663B75036937C31413F55662A0D584BCE27E1CB0E330359B` |
| `src/client/execution.ts` | `8A5207C059409FD1AE3A45C2588D2FEF380282D33420A0D016526969440373AF` |
| `src/backend/types.ts` | `E25644B58D1BF96B7CEDA368416B9849B8BB3D7B12D71CA2F83360C330C0DAF2` |

## 联调与未验证边界

独立 integration-server 支持可选 `additionalProject:true`；CLI 开关为 `AGENTDESK_INTEGRATION_MULTIPROJECT=1`。第二个仓库授权 ID、源码/工作区路径只写入忽略的本地连接信息，HTTP 授权列表不暴露路径。启动不自动创建第二个组织项目、绑定或执行；前端需走创建→检查→确认→绑定→任务流程。具体字段与限制见正式 API。

每次 fixture 启动仍创建新库，不能把该脚本重启当作持久恢复验收；持久重读由临时 SQLite 服务重启测试验证。未启动 B06 常驻联调服务，未重启既有服务、修改运行配置/运行库或占用原服务端口；旧在线服务不会自动提供 B06 接口。

未调用真实模型，未做正式浏览器端到端或 Linux 实测。没有并行调度、其他引擎、自动未知恢复、代码集成或最终验收。仓库无首次提交，按授权保留当前工作区和未跟踪文件；无提交、推送、部署、stash/reset 或清理。

前端后续消费已发布 B05/B06，展示固定 commit、未提交排除、授权失效与刷新绑定提示，并单独做浏览器验证。后端下一批按任务书依赖另行授权，本批不自动启动。

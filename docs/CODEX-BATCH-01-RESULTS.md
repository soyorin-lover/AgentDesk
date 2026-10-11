# 第 1 批接入验证结果

日期：2026-10-08（Asia/Shanghai）。本文件记录真实调用与自动测试，二者分别列示；本批不包含 Web、数据库、前端或代码集成验收。

## 环境与协议

Node.js 24.17.0、Git 2.53.0.windows.2、PATH Codex 0.154.0、Windows、ChatGPT 登录。交接中的 0.162.0-alpha.2 不再是当前 PATH 版本，本批不声称验证了该版本。

已用本机 `codex app-server generate-json-schema` / `generate-ts` 生成协议并核对官方文档。生成文件在忽略目录，不提交。官方参考：[App Server](https://learn.chatgpt.com/docs/app-server)、[临时配置](https://learn.chatgpt.com/docs/config-file/config-advanced)、[0.154.0 provider 源码](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/model-provider-info/src/lib.rs)。

## 已保存的真实证据

运行目录 `.agentdesk/runs/` 被 Git 忽略，下述标识用于本机找到摘要；摘要仅含会话/轮次 ID、终态、事件数量、固定样例 diff 的摘要和退出审计。不得把这些目录整体提交或上传。

| 运行标识 | 条件 | 结果 |
| --- | --- | --- |
| `2026-10-08T02-40-39-249Z-8910360a` | 默认配置模型 gpt-6.1-sol | 握手成功，模型不可用，后续依赖未运行 |
| `2026-10-08T02-42-31-558Z-d96e8f6b` | 服务器默认模型 gpt-6-astra、默认上游传输 | 握手成功，网络/上游错误，120 秒未完成；自有进程退出 |
| `2026-10-08T02-50-30-030Z-72cc9934` | gpt-6-astra、临时 HTTP provider | 单会话闭环通过；后续阶段 usageLimitExceeded；6 个示例仓库审计无额外改动、HEAD 不变，6 个 App Server 全部退出 |
| `2026-10-08T05-57-43-954Z-ac0c2780` | gpt-5.6-luna、HTTP、interaction | 文本流出现后 steer 接受，interrupt 以 interrupted 确认；样例无改动，自有进程退出 |
| `2026-10-08T05-59-31-007Z-800d7057` | gpt-5.6-luna、HTTP、approvals | 两次轮次 completed，但无审批请求、文件无改动；接受/拒绝均未验证 |
| `2026-10-08T06-00-54-221Z-34512a38` | gpt-5.6-luna、HTTP、parallel | 两个轮次 completed，事件重叠约 36 秒；各自精确修改 sample.txt，无额外修改，HEAD 不变，自有进程退出 |
| `2026-10-08T06-05-31-788Z-f076e7bf` | gpt-5.6-luna、HTTP、精确审批补丁 | 有效 readOnly / on-request / user 策略；两个真实文件审批请求分别 decline / accept，均有 serverRequest/resolved；拒绝无 diff、接受只有预期 diff，自有进程退出 |

HTTP 对照结果定位到两条上游路径的行为差异，不能据此断言 WebSocket、代理或 TLS 的具体根因。默认模型从 `model/list` 实际返回的 `isDefault` 选择，不猜模型权限，不修改全局配置。stdio 传输始终不变。

## 真实能力矩阵

| 能力 | 当前结果 | 成功判据 / 限制 |
| --- | --- | --- |
| initialize / initialized | 通过 | 真实子进程握手与后续 thread/start |
| 创建会话与工作目录 | 通过 | 专用示例仓库的真实会话 ID |
| 文本流与完成 | 通过（HTTP） | agentMessage/delta、completed、指定 READY 回复 |
| 指定文件修改 | 通过（HTTP） | sample.txt 精确内容、真实 Git diff、无其他改动 |
| 第二轮上下文 | 通过（HTTP） | 不重新提供随机标记，模型精确回忆 |
| 进程关闭后恢复 | 通过（HTTP） | 不同 PID，原 threadId，模型精确回忆标记，diff 保留 |
| 执行中 steer 与 interrupt | 通过（HTTP / luna） | 确认已有文本流、同一 turnId steer 接受、最终 interrupted；不承诺补充指令已完整执行 |
| 文件审批拒绝 / 接受 | 通过（HTTP / luna） | 精确补丁触发真实 requestApproval，正确回应 ID，serverRequest/resolved；拒绝无修改，接受只有指定修改。命令升级审批不在此次实测范围 |
| 两个工作区并行修改 | 通过（HTTP / luna） | 两个独立 Git 示例仓库，两个会话终态 completed、事件确实重叠、内容与各自 diff 精确匹配 |
| Linux | 未验证 | 需要独立 Linux 环境或 CI |

`usageLimitExceeded` 是服务器原始错误枚举；普通账户限额接口同时报告 `ordinaryUsageAllowed=true`。不能根据整体百分比推断模型已恢复，也不能把这个结果直接解释为账户所有额度已耗尽。未购买或重置额度。

本批 Windows 所要求的真实能力已在上述多次运行中全部取得成功证据；并非某一次 `all` 全绿，也不表示任意模型/传输配置都可用。单会话闭环使用 astra，交互、审批与并行使用服务器实际列出的 luna。首次审批没有回调；提供已知基线的精确 Update File 补丁并核对有效策略后成功，不能证明首次未触发的唯一根因。Linux 仍待独立验证。

## 自动测试与工程检查

`npm test`：25 项通过（协议真实 Node 对端 + 本地 Git 示例仓库）；覆盖 UTF-8/CRLF 分片、乱序、错误响应、超时及晚到响应、提前退出/启动失败、非法和截断 JSONL、重复及冲突服务端请求、EOF 后强制退出、事件先于响应、握手、失败终态、中止终态、模型发现、审批路径与重命名边界、轮次超时退役、失败工作区审计。模拟协议与测试通过不能替代真实审批或中止。

独立只读审查发现的三项已修复并有红→绿回归：审批 move_path 越界、轮次超时复用污染、失败退出遗漏工作区审计。另补充冲突请求和强制退出覆盖。复用 VS Code 捆绑 TypeScript 6.0.3 与已有 Node 类型，`npm run typecheck` strict / noEmit / erasableSyntaxOnly 检查 11 个 TS 文件通过；无新增项目依赖。未配置独立 linter，静态检查使用 TypeScript。

## 已知限制与交接

没有 HTTP 后端/API；会话层是本批探针，不是稳定公共 SDK。审批默认拒绝；仅对匹配 thread/turn/item 的 sample.txt 普通更新接受一次，拒绝重命名、目录授权、命令升级和未知请求。中止必须以 interrupted 终态确认，超时只表示结果未知，连接退役不冒充中止成功。只确认直属 App Server 退出，不承诺所有外部工具的系统进程恢复或终止。

示例仓库所有未提交修改保留，主项目未自动提交、推送、部署。下一批建议先与 Claude 对齐事件/任务字段，再规划最小单任务本机后端；默认传输诊断与 Linux 验证仍需保留。这里只记录交接，不自动启动下一批。Claude 的能力边界见 CLAUDE-HANDOFF.md。

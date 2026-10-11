# B06 实施计划与记录

范围：显式多项目执行绑定、按任务固定基线；执行仍全局串行。当前无 HEAD，按用户授权留在主工作区单人写后端；不创建依赖 HEAD 的 worktree、不提交、不修改前端/设计稿/运行库。

1. 保留原 projects/workspace 配置及 primary bootstrap；增加 executionGrants 受信配置（id/name/path/workspaceRoot/checkPresetIds）。配置 ID、真实源码、worktreeRoot 不可冲突或互相嵌套；HTTP 只能引用登记 ID。
2. 注册器保存源码真实身份（realpath/gitDir/commonDir/目录 inode）与 workspaceRoot，校验 commit 存在。源 HEAD 推进、源目录脏改动不换基线；身份/授权缺失时失效，不收养新仓库。
3. 绑定命令引用项目版本、当前确认关联 inspectionId、完整 commit 和 grantId，重新核验检查摘要；绑定不可变，保存递增 revision 和当前指针。不同授权项换绑有历史任务时拒绝；同授权项可显式更新基线，全局运行/未知状态/准备中时拒绝。
4. 新任务固定 binding ID/revision/commit；所有 prepare/create/verify/restart/repoFor（执行/快照/检查/接受/恢复）按任务绑定路由。旧任务仅从旧保存配置/工作区 baseHead 补引用，legacy 保持原契约，不从当前 HEAD 猜历史。
5. 检查预设为服务信任配置，授权项可缩小 preset ID 范围；任务使用固定范围，并对当前授权再校验。保留全局 busy、租约/quarantine 和未知结果保护。
6. 先真实失败测试，再实现授权/绑定/路由；测试两仓库不同内容、脏源码不变、重启/配置失效、固定基线/修订、HTTP/客户端/并发/未知保护。完整回归/strict/浏览器编译，最终一次 GPT-6.1 只读审查。
7. 独立无模型 fixture 可配置两个授权仓库，保持旧启动行为；不提供未验证的恢复环境。发布 API/结果和三个公共文件 SHA-256，更新交接。

正式契约见 BACKEND-BATCH-06-API.md；已完成验证，公共文件同步依据见 CODEX-BATCH-06-RESULTS.md。

Ruling: 不使用技能依赖提交/HEAD 的辅助脚本，记录保留于本文件 — 仓库无首次提交且用户禁止自动提交；不会产出提交范围审查，以本批文件清单审查。
Pre-flight: Task1 授权配置 → Task2 持久绑定 → Task3 固定任务路由 → Task4 客户端，同一 identity/binding 类型按顺序实现，不能用最新项目关联代替任务引用。

Task1–4: 已实现受信授权/绑定/路由/HTTP 与可选双项目 fixture。首条双仓库测试先因缺少 bindProjectExecution 失败，再实现；配置撤销、固定基线/修订、重启、版本/幂等、检查/接受/反馈隔离均有真实测试。
Ruling: 暂时撤销授权不把已准备工作区改为 preparation_unknown — 已有证据未消失，命令仍实时校验授权；错误判断的代价是需要再次授权/核验，不能跳过进程保护。
Final review: gpt-6.1-sol 默认角色、只读，发现 root 同路径替换和 quarantine 写失败租约释放；两项均失败复现后修复。另补同 commonDir 的重复授权失败回归。没有使用 Astra，无递归委派。
Task5: 已完成，B06 专项 11/11、全套 111/111；strict 49 文件通过，浏览器库编译退出 0。接口与哈希已发布，交接和剩余路线已更新。额外重复 strict 命令因自动审批复核用量限制未执行，不影响此前已取得的验证证据。保留执行记录，不执行清理/自动提交。

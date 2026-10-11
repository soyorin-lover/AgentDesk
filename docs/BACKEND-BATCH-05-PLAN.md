# 后端第 5 批技术计划

2026-10-09。项目空间是内部组织对象，不能通过用户路径扩大旧执行器授权。

1. 在既有 SQLite documents 表增加 project-space、repository-inspection 和私有关联记录；不迁移或重写任务/运行表。配置项目以原 ID 幂等补录，历史任务 projectId 保留。
2. 保留 GET projects 的 id/name 简要契约；详情和创建/编辑响应提供说明、版本、时间及执行能力原因。bootstrap 永远指向配置绑定项目。
3. 只读 Git 参数数组检查真实根目录、gitDir/commonDir、HEAD、symbolic HEAD、status、worktree。检查两次摘要一致才可确认。拒绝裸仓库和非仓库；unborn 可检查但无 commit 可确认。
4. 检查记录绑定项目版本、真实路径和仓库身份，10 分钟有效。确认仅接受检查对应的 HEAD commit，并显式确认未提交改动不纳入 worktree。确认前重扫身份、内容与 worktree；变化则 409，要求重新检查。
5. 元数据与确认复用串行命令队列、事务、幂等键和 expectedVersion。路径仅出现在认证后的专用仓库检查/关联接口，列表/bootstrap/普通详情不返回路径或代码内容。
6. 新空间不能创建执行任务，报告 execution_binding_required；旧可信绑定仍执行原流程。关联不创建 worktree，也不改变可信配置或旧基线。
7. 真实临时 SQLite/Git 测试、重启重读、认证/校验/并发/客户端、旧链路回归与 strict 编译。无模型调用、前端修改、提交或服务重启。

检查不是原子文件系统快照；有界扫描拒绝不能完整核验的内容，并在确认前重复核对。确认后外部仓库仍可变化，未来执行绑定必须再核验，不能直接信任本批关联记录。

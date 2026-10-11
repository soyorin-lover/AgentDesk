# 界面设计约定

AgentDesk 的主要界面是项目入口、计划蓝图和任务工作台。目标是让用户看清“批准了什么、正在执行什么、依据哪个版本接受成果”。当前产品范围见 [README](README.md)。

## 当前交互

- 项目入口区分项目空间、仓库关联和执行授权；创建项目不自动获得执行能力。
- 蓝图显示任务与依赖。保存、批准、建立执行记录和启动分别呈现，不合并成含糊的“完成”按钮。
- 工作台默认查看一个任务，可临时比较另一任务；这不表示两个任务在并行运行。
- 执行消息、Diff 和检查结果围绕具体任务及轮次组织。过时检查、未知执行和失效接受明确标识。
- 反馈草稿与执行状态分开；断连或归属不明确时不无提示重发。
- 示例预览持续标明示例；配置模型与实际模型证据分别显示，无证据时保持未知。

实现入口：[项目页](web/src/v2/projects/ProjectPortal.tsx)、[蓝图](web/src/v2/workflow/WorkflowPage.tsx)、[任务工作台](web/src/v2/live/LiveWorkbench.tsx)、[样式](web/src/v2/v2.css)。品牌图标与字体来源见 [第三方说明](THIRD_PARTY_NOTICES.md)。

## 保留的设计原型

```powershell
node scripts/preview-design.mjs
```

打开 <http://127.0.0.1:5320/>；`/?legacy=1` 查看早期版本。端口可用 `AGENTDESK_DESIGN_PORT` 修改。

静态原型包含尚未实现的安装、交接、集成等目标场景，**不是功能验收演示**。它们不连接后端或模型。可编辑源与生成页面位于 [docs/prototypes](docs/prototypes/)，修改后用 `node scripts/build-design-preview.mjs` 重建。产品能力以 README 和验证指南为准。

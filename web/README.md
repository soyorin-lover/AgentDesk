# AgentDesk Web

React + TypeScript + Vite 前端，随根目录后端一起维护。使用方式和范围见 [根 README](../README.md)，测试工具要求见 [开发指南](../docs/development.md)。

在本目录运行：

```powershell
npm ci
npm test
npm run build
npm run dev -- --host 127.0.0.1 --port 5331 --strictPort
```

入口 `/#/preview` 为无模型示例，默认入口可连接真实本机服务。当前界面从 `src/main.tsx` 进入 `src/v2/AppV2.tsx`。

公共客户端与类型复制自根 `src/`，哈希清单保存在 [FRONTEND-CLIENT-SNAPSHOT.json](docs/FRONTEND-CLIENT-SNAPSHOT.json)。修改公共接口必须同步副本与清单；fixture 会在启动时检查三个文件是否匹配。

受维护的浏览器验证由根目录 `npm run verify:web` 编排，内部使用 `scripts/f03-fixture.ts --f04` 和 `scripts/interaction-v1-smoke.mjs`。其他历史浏览器和 fixture 验证器仍有独立回归覆盖，保留作专项工具；运行前检查路径与环境要求，不作为安装入口。已删除完成使命的一次性源码编辑器、临时探针及无人引用的旧任务面板。

`/v1.html` 是仍参与构建的旧版原型，`/?gallery`、`/#/demo` 和 `/#/preview` 是可访问的示例或评审入口；它们不是废弃文件，也不代表真实模型执行能力。

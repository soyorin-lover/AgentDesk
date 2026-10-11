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

受维护的浏览器验证由根目录 `npm run verify:web` 编排，内部使用 `scripts/f03-fixture.ts --f04` 和 `scripts/interaction-v1-smoke.mjs`。其他历史浏览器/编辑脚本保留作追溯，可能依赖旧目录或私有快照，不作为安装、运行或修改当前项目的入口。

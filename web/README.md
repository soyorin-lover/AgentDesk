# AgentDesk Web

React + TypeScript + Vite 前端，当前随上级 AgentDesk 交付仓库维护。启动、无模型浏览器验收、真实连接和能力边界以 [根 README](../README.md) 为准。

在本目录运行 `npm ci`、`npm test`、`npm run build`；默认前端测试包括 node-edit 测试。公共客户端与后端类型来源见 [接口清单](docs/FRONTEND-CLIENT-SNAPSHOT.json)，当前三个文件与上级后端一致。

本轮维护入口是 `scripts/f03-fixture.ts --f04` 与 `scripts/interaction-v1-smoke.mjs`，由根目录 `npm run verify:web` 统一编排。更早的 F01/F02/F03/F04 浏览器脚本及历史结果仅用于追溯，可能依赖原开发目录或历史私有快照，不作为当前启动入口。

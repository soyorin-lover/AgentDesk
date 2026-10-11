# 第三方来源与依赖

项目代码采用根目录 MIT 许可。下列第三方材料仍遵循原许可，项目许可不替代第三方许可。

## 图标及界面素材

- Codex/OpenAI、Claude、DeepSeek 品牌 SVG：现有来源注释和设计记录指向 [Lobe Icons](https://github.com/lobehub/lobe-icons)。本轮对照了上游 [MIT 许可](https://github.com/lobehub/lobe-icons/blob/master/LICENSE)，Copyright (c) 2023 LobeHub；完整文本保留在 [前端许可](web/docs/licenses/lobe-icons-MIT.txt) 和 [设计原型许可](docs/prototypes/licenses/lobe-icons-MIT.txt)。使用位置包括 web/src/v2/brand-icons.ts 与 docs/prototypes/workflow-preview*.html。未找到原下载 commit，不能声称已逐路径核对到某个上游版本。
- 通用线性图标以项目代码中的 SVG 路径实现；现有文件没有标明另一外部图标库来源。本次未重新证明早期 AI 生成路径的原创性。
- 当前 Git 跟踪清单中没有独立图片、音视频或字体文件。字体使用 CSS 字体栈及用户设备已有字体；未发现前端远程字体/图片加载引用。
- 品牌名称与标识用于说明对应引擎，不表示获得品牌背书。

## 软件依赖

后端使用 Node.js 内置模块；真实执行另需用户安装和登录 Codex CLI。Node.js、Git、Codex CLI、外部浏览器测试工具未随此源码仓库分发。前端依赖按 web/package-lock.json 安装，依赖保留其包内许可和版权。

以下为 2026-10-12 本机已安装的 69 个包，其版本已与锁文件逐项比较；50 个其他平台可选包未安装，不属于本次已安装清单。许可证名称来自本机 package.json，不是完整的法律审计。当前交付为源码，未纳入 node_modules、dist 或第三方二进制；未来如分发编译包，需按实际包含的依赖保留相应许可声明。

| 包 | 版本 | 许可 |
| --- | --- | --- |
| @babel/code-frame | 7.29.7 | MIT |
| @babel/compat-data | 7.29.7 | MIT |
| @babel/core | 7.29.7 | MIT |
| @babel/generator | 7.29.8 | MIT |
| @babel/helper-compilation-targets | 7.29.7 | MIT |
| @babel/helper-globals | 7.29.7 | MIT |
| @babel/helper-module-imports | 7.29.7 | MIT |
| @babel/helper-module-transforms | 7.29.7 | MIT |
| @babel/helper-plugin-utils | 7.29.7 | MIT |
| @babel/helper-string-parser | 7.29.7 | MIT |
| @babel/helper-validator-identifier | 7.29.7 | MIT |
| @babel/helper-validator-option | 7.29.7 | MIT |
| @babel/helpers | 7.29.10 | MIT |
| @babel/parser | 7.29.9 | MIT |
| @babel/plugin-transform-react-jsx-self | 7.29.7 | MIT |
| @babel/plugin-transform-react-jsx-source | 7.29.7 | MIT |
| @babel/template | 7.29.7 | MIT |
| @babel/traverse | 7.29.10 | MIT |
| @babel/types | 7.29.8 | MIT |
| @esbuild/win32-x64 | 0.25.12 | MIT |
| @jridgewell/gen-mapping | 0.3.13 | MIT |
| @jridgewell/remapping | 2.3.5 | MIT |
| @jridgewell/resolve-uri | 3.1.2 | MIT |
| @jridgewell/sourcemap-codec | 1.6.0 | MIT |
| @jridgewell/trace-mapping | 0.3.31 | MIT |
| @rolldown/pluginutils | 1.0.0-beta.27 | MIT |
| @rollup/rollup-win32-x64-gnu | 4.64.2 | MIT |
| @rollup/rollup-win32-x64-msvc | 4.64.2 | MIT |
| @types/babel__core | 7.20.5 | MIT |
| @types/babel__generator | 7.27.0 | MIT |
| @types/babel__template | 7.4.4 | MIT |
| @types/babel__traverse | 7.28.0 | MIT |
| @types/estree | 1.0.9 | MIT |
| @types/react | 19.3.0 | MIT |
| @types/react-dom | 19.3.0 | MIT |
| @vitejs/plugin-react | 4.7.0 | MIT |
| baseline-browser-mapping | 2.11.27 | Apache-2.0 |
| browserslist | 4.29.3 | MIT |
| caniuse-lite | 1.0.30001815 | CC-BY-4.0 |
| convert-source-map | 2.0.0 | MIT |
| csstype | 3.2.3 | MIT |
| debug | 4.4.3 | MIT |
| electron-to-chromium | 1.5.451 | ISC |
| esbuild | 0.25.12 | MIT |
| escalade | 3.2.0 | MIT |
| fdir | 6.5.0 | MIT |
| gensync | 1.0.0-beta.2 | MIT |
| js-tokens | 4.0.0 | MIT |
| jsesc | 3.1.0 | MIT |
| json5 | 2.2.3 | MIT |
| lru-cache | 5.1.1 | ISC |
| ms | 2.1.3 | MIT |
| nanoid | 3.3.20 | MIT |
| node-releases | 2.0.57 | MIT |
| picocolors | 1.1.1 | ISC |
| picomatch | 4.0.7 | MIT |
| postcss | 8.5.29 | MIT |
| react | 19.3.0 | MIT |
| react-dom | 19.3.0 | MIT |
| react-refresh | 0.17.0 | MIT |
| rollup | 4.64.2 | MIT |
| scheduler | 0.28.0 | MIT |
| semver | 6.3.1 | ISC |
| source-map-js | 1.2.2 | BSD-3-Clause |
| tinyglobby | 0.2.17 | MIT |
| typescript | 5.9.3 | Apache-2.0 |
| update-browserslist-db | 1.3.4 | MIT |
| vite | 6.4.4 | MIT |
| yallist | 3.1.1 | ISC |

其中 caniuse-lite 浏览器兼容性数据采用 CC-BY-4.0，上游为 [browserslist/caniuse-lite](https://github.com/browserslist/caniuse-lite)。本仓库未复制或修改其数据；随构建工具安装的包保留自身许可。

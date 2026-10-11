// Assemble the dependency-free storyboard from its editable sources.
import { readFile, writeFile } from 'node:fs/promises';
const root = new URL('../docs/prototypes/', import.meta.url);
const original = await readFile(new URL('workflow-preview-v1.html', root), 'utf8');
const baseStyle = original.match(/<style>([\s\S]*?)<\/style>/)?.[1];
const icons = original.match(/const agentIcons=([\s\S]*?)const tasks =/)?.[0].replace(/const tasks =$/, '');
if (!baseStyle || !icons) throw Error('Original design style or icon source missing');
const css = await readFile(new URL('journey-preview.css', root), 'utf8');
const js = await readFile(new URL('journey-preview.js', root), 'utf8');
await writeFile(new URL('workflow-preview.html', root), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AgentDesk · 全流程设计稿</title><style>${baseStyle}\n${css}</style><body><div id="journey"></div><script>${icons}\n${js}</script></body></html>`);
console.log('Design storyboard assembled. No product files or runtime data changed.');

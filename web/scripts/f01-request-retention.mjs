import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href);
const c=JSON.parse(await fs.readFile(process.argv[2],'utf8'));const token=(await fs.readFile(c.tokenFile,'utf8')).trim();
const browser=await chromium.launch({headless:true,channel:'msedge'});const page=await browser.newPage({viewport:{width:1440,height:900}});
try{
 await page.goto('http://127.0.0.1:5331');await page.getByLabel('服务地址').fill(c.url);await page.getByLabel('访问令牌',{exact:true}).fill(token);await page.getByRole('button',{name:'连接',exact:true}).click();await page.getByRole('link',{name:'F01 独立测试配置 打开项目'}).click();await page.getByRole('button',{name:'进入任务工作台'}).click();
 const keys=[];let first=true;await page.route('**/api/v1/tasks',async route=>{if(route.request().method()!=='POST'){await route.continue();return;}keys.push(route.request().headers()['idempotency-key']);if(first){first=false;await route.fetch();await route.abort('failed');}else await route.continue();});
 const title='retained-write '+randomUUID();await page.getByRole('button',{name:'新建任务',exact:true}).click();const d=page.getByRole('dialog');await d.getByLabel('标题',{exact:true}).fill(title);await d.getByLabel('目标',{exact:true}).fill('no model');await d.getByLabel('验收条件（每行一条，至少一条）',{exact:true}).fill('no duplicate');await d.getByRole('button',{name:'创建任务',exact:true}).click();await page.getByRole('button',{name:'重试原请求',exact:true}).waitFor();
 await page.getByRole('button',{name:'返回项目工作区'}).click();await page.getByRole('button',{name:'进入任务工作台'}).click();
 assert.equal(await page.getByRole('button',{name:'重试原请求',exact:true}).count(),1,'Returning must retain unknown write intent and original key');
 await page.getByRole('button',{name:'重试原请求',exact:true}).click();await page.getByRole('button',{name:title,exact:false}).waitFor();assert.equal(keys.length,2);assert.equal(keys[0],keys[1]);
 console.log('PASS unknown task creation survives leaving/re-entering workbench; original key reused');
}finally{await browser.close();}

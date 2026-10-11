import fs from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL('C:/Users/scout/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
const c=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
const token=(await fs.readFile(c.tokenFile,'utf8')).trim();
const {ApiClient}=await import(pathToFileURL(join(c.backendSnapshot.path,'src/client/api.ts')).href);
const api=new ApiClient({baseUrl:c.url,getToken:()=>token});
const poll=async(fn,ok)=>{const until=Date.now()+20000;while(Date.now()<until){const value=await fn();if(ok(value))return value;await new Promise(r=>setTimeout(r,150));}throw Error('poll timeout');};
const browser=await chromium.launch({headless:true,channel:'msedge'});
const page=await browser.newPage({viewport:{width:1440,height:960}});page.setDefaultTimeout(18000);
const out=join(process.cwd(),'.agentdesk/interaction-evidence');await fs.mkdir(out,{recursive:true});
const errors=[],passed=[];page.on('pageerror',e=>errors.push(e.message));
const btn=name=>page.getByRole('button',{name,exact:true});
const panel=()=>page.getByRole('complementary',{name:'蓝图右侧面板'});
const step=async(name,fn)=>{await fn();passed.push(name);console.log('PASS '+name);};
try{
 await page.goto('http://127.0.0.1:5331/#/preview');
 await step('直接预览：首页空/有项目、蓝图、互斥策划与候选计划',async()=>{
  await page.getByRole('heading',{name:'我的项目',exact:true}).waitFor();await page.screenshot({path:join(out,'home.png')});
  await btn('查看首次使用状态').click();await page.getByRole('heading',{name:'还没有项目',exact:true}).waitFor();await btn('创建第一个项目').click();await page.getByRole('dialog',{name:'新建项目预览'}).waitFor();await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);await btn('查看有项目状态').click();await page.getByRole('link').filter({hasText:'LogLens'}).click();
  await btn('选择节点 实现日志解析器').click();await panel().getByRole('heading',{name:'实现日志解析器',exact:true}).waitFor();await page.screenshot({path:join(out,'blueprint.png')});
  await btn('✦ 与 AI 策划').click();await panel().getByRole('heading',{name:'项目策划助手',exact:true}).waitFor();await page.getByLabel('你的想法').fill('保留策划笔记');await btn('查看示例候选计划').click();await page.getByText('示例候选计划 · 尚未生效',{exact:true}).waitFor();await btn('收起蓝图面板').click();assert.equal(await panel().count(),0);await btn('✦ 与 AI 策划').click();assert.equal(await page.getByLabel('你的想法').inputValue(),'保留策划笔记');await panel().getByRole('button',{name:'返回正式蓝图',exact:true}).click();await btn('选择节点 实现日志解析器').dblclick();await page.getByRole('heading',{name:'实现日志解析器',exact:true}).waitFor();await btn('审查成果').click();await btn('要求修改').click();assert.equal(await page.locator('#preview-feedback').evaluate(e=>document.activeElement===e),true);await btn('返回上一级').click();await page.locator('.workflow-viewport').waitFor();
  await page.setViewportSize({width:800,height:900});await btn('选择节点 实现日志解析器').click();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.setViewportSize({width:1440,height:960});
 });
 await page.goto('http://127.0.0.1:5331/');await page.getByLabel('服务地址').fill(c.url);await page.getByLabel('访问令牌',{exact:true}).fill(token);await btn('连接').click();await btn('连接设置').waitFor();await page.evaluate(id=>location.hash='#/project/'+id,c.projectId);
 await step('真实HTTP fixture：从单任务表单保存、独立批准、创建执行记录',async()=>{
  await btn('＋ 新建任务').click();await page.getByLabel('任务名称',{exact:true}).fill('交互 V1 样例任务');await page.getByLabel('任务说明',{exact:true}).fill('只更新 fixture sample.txt，不调用模型');await page.getByLabel('交给谁？',{exact:true}).selectOption('codex-second');await page.getByLabel('怎样算完成？',{exact:true}).fill('保留可审查的改动快照');await btn('审阅并保存计划').click();await page.getByLabel('我理解旧批准将失效，历史记录保留。').check();await btn('确认保存计划').click();await poll(()=>api.workflow(c.projectId),v=>v.nodes.some(n=>n.name==='交互 V1 样例任务'));await page.locator('.blueprint-panel').waitFor({state:'hidden'});
  await page.getByRole('button',{name:/审阅待批准任务/}).click();let dlg=page.getByRole('dialog',{name:'批准这些任务？'});await dlg.getByRole('checkbox').check();await dlg.getByRole('button',{name:'确认批准',exact:true}).click();await dlg.waitFor({state:'hidden'});await btn('选择节点 交互 V1 样例任务').click();await btn('创建这项任务的执行记录').click();dlg=page.getByRole('dialog',{name:'创建执行记录？'});await dlg.getByRole('checkbox').check();await dlg.getByRole('button',{name:'确认创建',exact:true}).click();await dlg.waitFor({state:'hidden'});await btn('准备任务工作区').click();await poll(()=>btn('下发任务').isEnabled(),Boolean);
 });
 let v=await api.workflow(c.projectId),link=v.links.find(l=>l.revision===v.revision);
 await step('真实HTTP fixture：确认后下发留在蓝图，原会话反馈与成果审查',async()=>{
  await btn('下发任务').click();let dlg=page.getByRole('dialog',{name:'确认下发任务'});assert.ok((await dlg.innerText()).includes('codex-second')||(await dlg.innerText()).includes('Codex'));await dlg.getByRole('button',{name:'确认下发',exact:true}).click();assert.ok(page.url().endsWith('#/project/'+c.projectId));await poll(()=>api.task(link.taskId),d=>d.run?.status==='succeeded');await btn('进入任务工作台 →').click();await page.getByRole('textbox',{name:'任务反馈或修改要求'}).fill('增加边界处理');const old=(await api.task(link.taskId)).run.id;await poll(()=>btn('发送反馈并继续').isEnabled(),Boolean);await btn('发送反馈并继续').click();await poll(()=>api.task(link.taskId),d=>d.run?.id!==old&&d.run?.status==='succeeded');await btn('生成快照').click();await poll(()=>api.task(link.taskId),d=>!!d.snapshot);await btn('审查成果').click();await page.getByText('sample.txt',{exact:true}).first().waitFor();await page.screenshot({path:join(out,'workbench.png')});await btn('要求修改').click();assert.equal(await page.getByRole('textbox',{name:'任务反馈或修改要求'}).inputValue(),'增加边界处理');await btn('确认成果').click();dlg=page.getByRole('dialog',{name:'确认这一版成果？'});assert.ok((await dlg.innerText()).includes('没有执行过检查'));await dlg.getByRole('button',{name:'确认成果',exact:true}).click();await poll(()=>api.task(link.taskId),d=>d.acceptance?.status==='valid');
  await btn('返回项目工作区').click();await panel().getByRole('button',{name:'确认这个节点完成'}).waitFor();assert.ok((await api.workflow(c.projectId)).nodeStates.some(n=>n.status==='awaiting_confirmation'));
 });
 await step('编辑新计划撤销旧批准，保留固定实例与历史任务；预览不发送',async()=>{
  const before=await api.workflow(c.projectId),fixed=before.nodes[0].agentBinding;await btn('编辑任务').click();await page.getByLabel('任务名称',{exact:true}).fill('交互 V1 样例任务修改');await btn('审阅并保存计划').click();await page.getByLabel('我理解旧批准将失效，历史记录保留。').check();await btn('确认保存计划').click();const after=await poll(()=>api.workflow(c.projectId),x=>x.revision>before.revision);assert.deepEqual(after.nodes[0].agentBinding,fixed);assert.ok(after.links.some(l=>l.taskId===link.taskId));assert.equal(after.approvals.filter(a=>a.revision===after.revision).length,0);await page.getByText('计划批准、变更影响与历史记录',{exact:true}).click();await btn('查看记录').click();await page.getByText(/后续执行授权已停止/).waitFor();assert.equal(await btn('发送反馈并继续').isEnabled(),false);
 });
 assert.deepEqual(errors,[]);await fs.writeFile(join(out,'results.json'),JSON.stringify({passed,errors,modelCalls:0,contract:'B08a',fixture:c.root,taskId:link.taskId},null,2));console.log('RESULT '+passed.length+' groups, 0 page errors; '+out);
}catch(e){await page.screenshot({path:join(out,'failure.png')});await fs.writeFile(join(out,'failure.txt'),e.stack??String(e));console.error(e.stack);process.exitCode=1;}finally{await browser.close();}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProjectController, canConfirmRepository } from './state.ts';
import { ApiClient, ApiClientError } from '../api/client/api.ts';

function project(id: string, version = 1) { return { id, name: '同名项目', description: '', version, schemaVersion: 1, createdAt: '', updatedAt: '', execution: { supported: false, reason: 'execution_binding_required', repositoryAssociationUsed: false } }; }
function deferred() { let resolve!: (v: any) => void; const promise = new Promise<any>(r => resolve = r); return { promise, resolve }; }
const fake = (overrides: object) => ({ projects: async () => ({ items: [] }), project: async (id: string) => project(id), ...overrides } as unknown as ApiClient);

test('同名项目按ID选择；已取消但迟到的响应不覆盖新项目', async () => {
  const a = deferred();
  const c = new ProjectController(fake({ project: (id: string) => id === 'a' ? a.promise : Promise.resolve(project(id)) }));
  const old = c.select('a'); await c.select('b'); a.resolve(project('a')); await old;
  assert.equal(c.getSnapshot().detail?.id, 'b');
});
test('响应归属错误不能成为当前项目', async () => {
  const c = new ProjectController(fake({ project: async () => project('other') })); await c.select('a');
  assert.equal(c.getSnapshot().detail, null); assert.ok(c.getSnapshot().error);
});
test('结果未知时同操作同正文保持键，改变正文使用新键', async () => {
  const calls: any[] = [];
  const c = new ProjectController(fake({ createProject: async (body: unknown, key: string) => { calls.push({body,key}); throw new TypeError('network'); } }));
  await c.create({ name: 'A' }); await c.create({ name: 'A' }); await c.create({ name: 'B' });
  assert.equal(calls[0].key, calls[1].key); assert.notEqual(calls[1].key, calls[2].key);
});
test('编辑冲突重读版本但保留草稿，不自动重发', async () => {
  let count = 0;
  const c = new ProjectController(fake({ project: async () => project('a', count ? 2 : 1), updateProject: async () => { count++; throw new ApiClientError(409, 'version_conflict', 2); } }));
  await c.select('a'); c.setDraft('a', { name: '我的草稿', description: '保持输入' }); await c.save();
  assert.equal(count, 1); assert.equal(c.getSnapshot().detail?.version, 2); assert.equal(c.draft('a')?.name, '我的草稿'); assert.match(c.getSnapshot().error ?? '', /冲突/);
});
test('旧项目写入迟到不导航到旧项目，并保留另一个项目草稿', async () => {
  const pending = deferred(); const c = new ProjectController(fake({ updateProject: () => pending.promise }));
  await c.select('a'); c.setDraft('a', { name: 'A', description: '' }); const save = c.save();
  await c.select('b'); c.setDraft('b', { name: 'B', description: '' }); pending.resolve(project('a', 2)); await save;
  assert.equal(c.getSnapshot().detail?.id, 'b'); assert.equal(c.draft('b')?.name, 'B');
});
const inspection = { projectId: 'a', projectVersion: 1, confirmable: true, expiresAt: '2099-01-01', repository: { head: 'a'.repeat(40) } } as any;
test('确认必须显式承认未提交排除，且版本/项目/有效期/commit均符合', () => {
  assert.equal(canConfirmRepository(inspection, project('a') as any, false), false);
  assert.equal(canConfirmRepository(inspection, project('a') as any, true), true);
  assert.equal(canConfirmRepository(inspection, project('b') as any, true), false);
  assert.equal(canConfirmRepository(inspection, project('a', 2) as any, true), false);
  assert.equal(canConfirmRepository({...inspection, expiresAt:'2000-01-01'}, project('a') as any, true), false);
  assert.equal(canConfirmRepository({...inspection, confirmable:false}, project('a') as any, true), false);
});
test('仓库发生变化会废弃检查；再次扫描使用新键且保留路径', async () => {
  const keys: string[] = []; const c = new ProjectController(fake({
    inspectProjectRepository: async (_id: string, body: any, key: string) => { keys.push(key); return { ...inspection, id:'scan', repository:{...inspection.repository,path:body.path} }; },
    confirmProjectRepository: async () => { throw new ApiClientError(409,'repository_changed'); }
  }));
  await c.select('a'); await c.inspect('/repo'); await c.confirm(true);
  assert.equal(c.getSnapshot().inspection, null); assert.match(c.getSnapshot().error ?? '', /重新检查/);
  await c.inspect('/repo'); assert.notEqual(keys[0], keys[1]);
});

test('服务500或成功响应不可解析时保留原键，不能假定写入未发生', async () => {
  for (const failure of [new ApiClientError(500,'storage_unavailable'),new ApiClientError(201,'invalid_response')]) {
    const keys:string[]=[];const c=new ProjectController(fake({createProject:async (_b:unknown,key:string)=>{keys.push(key);throw failure;}}));
    await c.create({name:'A'});assert.equal(c.getSnapshot().uncertain,true);await c.create({name:'A'});assert.equal(keys[0],keys[1]);
  }
});
test('保存已完成但后续读取中断时不产生未处理拒绝，并保留用户草稿',async()=>{
  let saved=false;const c=new ProjectController(fake({project:async()=>{if(saved)throw new TypeError('network');return project('a');},updateProject:async()=>{saved=true;return project('a',2);}}));
  await c.select('a');c.setDraft('a',{name:'草稿',description:'保留'});await assert.doesNotReject(()=>c.save());assert.ok(c.getSnapshot().error);assert.equal(c.draft('a')?.name,'草稿');
});

test('同项目旧读取不得使保存后的版本倒退',async()=>{
  const delayed=deferred();let reads=0;const c=new ProjectController(fake({project:async()=>{reads++;return reads===2 ? delayed.promise : project('a',reads===1?1:2);},updateProject:async()=>project('a',2)}));
  await c.select('a');const old=c.reread();c.setDraft('a',{name:'新版',description:''});await c.save();assert.equal(c.getSnapshot().detail?.version,2);delayed.resolve(project('a',1));await old;assert.equal(c.getSnapshot().detail?.version,2);
});
test('旧关联读取不能覆盖刚刚确认的关联',async()=>{
  const delayed=deferred();const c=new ProjectController(fake({projectRepository:()=>delayed.promise,inspectProjectRepository:async()=>({...inspection,id:'new'}),confirmProjectRepository:async()=>({projectId:'a',inspectionId:'new'})}));
  await c.select('a');const old=c.repository();await c.inspect('/repo');await c.confirm(true);delayed.resolve({projectId:'a',inspectionId:'old'});await old;assert.equal(c.getSnapshot().association?.inspectionId,'new');
});

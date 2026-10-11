import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const c = JSON.parse(await readFile(process.argv[2], 'utf8'));
const token = await readFile(c.tokenFile, 'utf8');
async function api(path, body) { const r = await fetch(c.url + '/api/v1' + path, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + token, Origin: 'http://localhost:5331', 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() }, body: body ? JSON.stringify(body) : undefined }); assert.equal(r.headers.get('access-control-allow-origin'),'http://localhost:5331'); const data = await r.json(); assert.ok(r.ok, JSON.stringify(data)); return data; }
const { execFileSync } = await import('node:child_process');
const repo = c.additionalProject.source;
const git = (...args) => execFileSync('git', ['-C', repo, ...args]);
const before = { head: git('rev-parse','HEAD'), index: await readFile(repo+'/.git/index'), sample: await readFile(repo+'/sample.txt'), untracked: await readFile(repo+'/untracked.txt'), status: git('status','--porcelain=v1','-z') };
const project = await api('/projects', {name:'F02b HTTP bound project'});
async function associate() {
  const p = await api('/projects/'+project.id);
  const i = await api(`/projects/${p.id}/repository-inspections`, {expectedVersion:p.version,path:repo});
  assert.deepEqual(i.repository.changes,{staged:1,unstaged:1,untracked:1,conflicted:0});
  await api(`/projects/${p.id}/repository`, {expectedVersion:p.version,inspectionId:i.id,baselineCommit:i.repository.head,acknowledgeUncommittedExcluded:true});
  return {expectedVersion:(await api('/projects/'+p.id)).version,grantId:c.grantId,inspectionId:i.id,baselineCommit:i.repository.head,acknowledgeUncommittedExcluded:true};
}
const bindingBody=await associate();
async function rejectBinding(body,code) {
  const r=await fetch(c.url+`/api/v1/projects/${project.id}/execution-binding`,{method:'POST',headers:{Authorization:'Bearer '+token,Origin:'http://localhost:5331','Content-Type':'application/json','Idempotency-Key':randomUUID()},body:JSON.stringify(body)});
  assert.equal((await r.json()).error.code,code);
}
await rejectBinding({...bindingBody,grantId:'unknown'},'grant_not_authorized');
await rejectBinding({...bindingBody,grantId:'f02b-fixture'},'grant_repository_mismatch');
assert.equal((await fetch(c.url+'/api/v1/execution-grants')).status,401);
const binding=await api(`/projects/${project.id}/execution-binding`,bindingBody);
const t = await api('/tasks', {projectId:project.id, title:'F02b HTTP regression',goal:'fixture sample',acceptanceCriteria:['sample only'],agentInstanceId:'codex-local'});
assert.equal(t.executionBinding.id,binding.id);
const refreshed=await api('/projects/'+project.id+'/execution-binding',await associate());
assert.equal(refreshed.revision,binding.revision+1);
assert.equal((await api('/tasks/'+t.id)).task.executionBinding.id,binding.id);
const detail = () => api('/tasks/' + t.id);
async function until(fn) { const end = Date.now() + 15000; while (!(await fn())) { if (Date.now() > end) throw Error('timeout'); await new Promise(r=>setTimeout(r,100)); } }
await api(`/tasks/${t.id}/workspace`,{expectedVersion:t.version});
await until(async()=>(await detail()).workspace.status==='ready');
const abort = new AbortController(); const stream = await fetch(c.url+`/api/v1/tasks/${t.id}/events/stream?after=0`,{headers:{Authorization:'Bearer '+token},signal:abort.signal}); assert.equal(stream.status,200);
let text=''; const reader=stream.body.getReader(); const reading=(async()=>{try { while(true){const r=await reader.read();if(r.done)break;text+=new TextDecoder().decode(r.value);} }catch(e){if(!abort.signal.aborted)throw e;}})();
const run=await api(`/tasks/${t.id}/runs`,{expectedVersion:(await detail()).task.version});
await until(async()=>(await api('/runs/'+run.id)).status!=='running'); assert.equal((await api('/runs/'+run.id)).status,'succeeded');
await until(async()=>text.includes('message.completed'));abort.abort();await reading;assert.ok(text.includes('message.delta'));
const snap=await api(`/tasks/${t.id}/snapshots`,{expectedVersion:(await detail()).task.version});assert.equal(snap.completeness,'complete');assert.equal(snap.files.length,1);
await api(`/tasks/${t.id}/checks`,{expectedVersion:(await detail()).task.version,presetId:'sample-pass',snapshotId:snap.id});
await until(async()=>(await api(`/tasks/${t.id}/checks`)).items.every(c=>c.status!=='running'));assert.equal((await api(`/tasks/${t.id}/checks`)).items[0].status,'passed');
const accepted=await api(`/tasks/${t.id}/accept`,{expectedVersion:(await detail()).task.version,snapshotId:snap.id});assert.equal(accepted.status,'accepted');
const second=await api(`/tasks/${t.id}/runs`,{expectedVersion:accepted.version,input:'fixture feedback'});await until(async()=>(await api('/runs/'+second.id)).status!=='running');assert.notEqual((await detail()).task.status,'accepted');
for (const [key,value] of Object.entries(before)) { const after=key==='head'?git('rev-parse','HEAD'):key==='status'?git('status','--porcelain=v1','-z'):await readFile(repo+'/'+(key==='index'?'.git/index':key==='sample'?'sample.txt':'untracked.txt')); assert.deepEqual(after,value,key+' source changed'); }
console.log('PASS: two Git repositories, dirty exclusion, unauthorized/mismatched grant rejection, explicit binding refresh with old task pinned, unchanged source HEAD/index/sample/untracked/status, prepare, deterministic run, SSE delta/completed, one-file snapshot, real Node check, acceptance, feedback invalidation. Task: '+t.id);




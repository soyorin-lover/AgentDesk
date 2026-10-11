import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const c = JSON.parse(await readFile(process.argv[2], 'utf8'));
const token = await readFile(c.tokenFile, 'utf8');
async function api(path, body) { const r = await fetch(c.url + '/api/v1' + path, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + token, Origin: 'http://localhost:5331', 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() }, body: body ? JSON.stringify(body) : undefined }); const data = await r.json(); assert.ok(r.ok, JSON.stringify(data)); return data; }
const t = await api('/tasks', {projectId:'f01-fixture', title:'F02 HTTP regression',goal:'fixture sample',acceptanceCriteria:['sample only'],agentInstanceId:'codex-local'});
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
console.log('PASS: prepare, deterministic run, SSE delta/completed, one-file snapshot, real Node check, acceptance, feedback invalidation. Task: '+t.id);

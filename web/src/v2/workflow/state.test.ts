import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkflowController, validateDraft, remainingNodeIds, approvalMissingDependencies } from './state.ts';
const draft = { roles: [{ id:'r', name:'Role', responsibility:'Work', defaultAgentInstanceId:'codex-local' }], members:[{id:'m',name:'Member',roleId:'r',agentInstanceId:'codex-local'}], ownerMemberId:'m', nodes:[] };
const node = (id, dependencyIds = [], parentId = undefined) => ({ id,name:id,goal:'Goal',acceptanceCriteria:['Done'],roleId:'r',memberId:'m',agentInstanceId:'codex-local', dependencyIds,parentId,executionBinding:{id:'b',revision:1,grantId:'g',baselineCommit:'abc'} });
const view = (projectId='p',version=0) => ({ ...structuredClone(draft),projectId,version,revision:1,createdAt:'',affectedNodeIds:[],authorizationInvalidatedNodeIds:[],approvals:[],links:[],confirmations:[],nodeStates:[] });
test('validation separates tree and dependency cycles and missing references',()=>{
 assert.deepEqual(validateDraft(draft),[]);
 assert.match(validateDraft({...draft,nodes:[node('a',[],'b'),node('b',[],'a')]}).join(),/tree_cycle/);
 assert.match(validateDraft({...draft,nodes:[node('a',['b']),node('b',['a'])]}).join(),/dependency_cycle/);
 assert.match(validateDraft({...draft,nodes:[node('a',['missing'])]}).join(),/dependency_missing:a:missing/);
});
test('partial approvals retain exact subset closure',()=>{
 const v={...view(),nodes:[node('a'),node('b',['a'])]};
 assert.deepEqual(approvalMissingDependencies(v,['b']),['a']);
 v.approvals=[{revision:1,nodeIds:['a']}];
 assert.deepEqual(remainingNodeIds(v),['b']); assert.deepEqual(approvalMissingDependencies(v,['b']),[]);
});
test('version zero, receipt does not replace current pointer and local in-flight edits survive',async()=>{
 let current=view(); let resolve; let body;
 const c=new WorkflowController({workflow:async()=>structuredClone(current),saveWorkflow:async(_p,b)=>{body=b;await new Promise(r=>resolve=r);current={...current,version:2};return {...view(),version:1};}});
 await c.select('p'); c.setDraft({...draft,ownerMemberId:null}); const saving=c.save();
 c.setDraft({...draft,members:[{...draft.members[0],name:'New'}]});resolve(); await saving;
 assert.equal(body.expectedVersion,0);assert.equal(c.getSnapshot().view.version,2);assert.equal(c.getSnapshot().dirty,true);assert.equal(c.getSnapshot().draft.members[0].name,'New');
});
test('unknown write keeps same body/key through refresh and project switch',async()=>{
 const calls=[];let fail=true;
 const c=new WorkflowController({workflow:async(p)=>view(p),saveWorkflow:async(p,b,k)=>{calls.push([p,b,k]);if(fail)throw Error('network');return view(p);}});
 await c.select('p');c.setDraft(draft);await c.save();const pending=c.getSnapshot().pending;
 await c.refresh();await c.select('q');assert.equal(c.getSnapshot().pending,null);
 await c.select('p');assert.deepEqual(c.getSnapshot().pending,pending);fail=false;await c.retry();
 assert.deepEqual(calls[0],calls[1]);assert.equal(c.getSnapshot().pending,null);
});
test('conflict preserves draft and base until explicit adoption',async()=>{
 let current=view(); const c=new WorkflowController({workflow:async()=>current,saveWorkflow:async()=>{current={...view(),version:3};const e=Object.assign(Error('conflict'),{status:409,code:'version_conflict'});throw e;}});
 await c.select('p');c.setDraft({...draft,ownerMemberId:null});await c.save();
 assert.equal(c.getSnapshot().draftVersion,0);assert.equal(c.getSnapshot().draft.ownerMemberId,null);c.adoptCurrentVersion();assert.equal(c.getSnapshot().draftVersion,3);
});
test('late reads cannot regress current version and late writes do not replace another project',async()=>{
 let slow;let call=0;let finish;
 const c=new WorkflowController({workflow:async(p)=>{if(p==='p'&&++call===2)return new Promise(r=>slow=r);return view(p,call>=3?4:0);},saveWorkflow:async()=>{await new Promise(r=>finish=r);return view('p',1);}});
 await c.select('p');const stale=c.refresh();await c.refresh();slow(view('p',1));await stale;assert.equal(c.getSnapshot().view.version,4);
 c.setDraft(draft);const writing=c.save();await c.select('q');finish();await writing;assert.equal(c.getSnapshot().projectId,'q');assert.equal(c.getSnapshot().view.projectId,'q');
});
test('another project cannot write while unknown command exists',async()=>{
 let calls=0;const c=new WorkflowController({workflow:async p=>view(p),saveWorkflow:async()=>{calls++;throw Error('lost');}});
 await c.select('p');c.setDraft(draft);await c.save();await c.select('q');c.setDraft(draft);await c.save();assert.equal(calls,1);assert.equal(c.getSnapshot().error,'write_pending');
});
test('approve sends remaining IDs and obtains new workflow version from GET',async()=>{
 let current={...view(),nodes:[node('a'),node('b',['a'])],approvals:[{revision:1,nodeIds:['a']}]};let sent;
 const c=new WorkflowController({workflow:async()=>current,approveWorkflow:async(_p,b)=>{sent=b;current={...current,version:8};return {revision:1,nodeIds:['b']};}});
 await c.select('p');await c.approve(['a','b','b']);assert.deepEqual(sent.nodeIds,['b']);assert.equal(sent.expectedVersion,0);assert.equal(c.getSnapshot().view.version,8);
});
test('selection aborts old reads and null clears displayed project without losing drafts',async()=>{
 let signal;let resolve;let calls=0;
 const c=new WorkflowController({workflow:async(p,s)=>{if(p==='p'&&++calls===2){signal=s;return new Promise(r=>resolve=r);}return view(p);}});
 await c.select('p');c.setDraft({...draft,ownerMemberId:null});const old=c.refresh();await c.select('q');assert.equal(signal.aborted,true);
 await c.select(null);assert.equal(c.getSnapshot().projectId,null);assert.equal(c.getSnapshot().view,null);assert.equal(c.getSnapshot().draft,null);
 resolve(view('p',2));await old;assert.equal(c.getSnapshot().projectId,null);await c.select('p');assert.equal(c.getSnapshot().draft.ownerMemberId,null);
});
test('global pending owner is discoverable from other project and home',async()=>{
 const c=new WorkflowController({workflow:async p=>view(p),saveWorkflow:async()=>{throw Error('network');}});
 await c.select('p');c.setDraft(draft);await c.save();await c.select('q');assert.equal(c.pendingProjectId(),'p');await c.select(null);assert.equal(c.pendingProjectId(),'p');
});
test('writes are blocked until current workflow read completes',async()=>{
 let resolve;let defer=false;let calls=0;
 const c=new WorkflowController({workflow:async p=>defer?new Promise(r=>resolve=r):view(p),saveWorkflow:async()=>{calls++;return view();}});
 await c.select('p');c.setDraft(draft);defer=true;const reading=c.refresh();const writing=c.save();assert.equal(calls,0);assert.equal(c.getSnapshot().error,'workflow_loading');resolve(view());await reading;await writing;
});

test('StrictMode setup cleanup setup revives controller and ignores old write settlement',async()=>{
 let finish;let version=0;const c=new WorkflowController({workflow:async p=>view(p,version),saveWorkflow:async()=>{await new Promise(r=>finish=r);version=1;return view('p',1);}});
 await c.select('p');c.setDraft(draft);const old=c.save();c.dispose();c.activate();await c.select('p');assert.equal(c.getSnapshot().writing,false);assert.ok(c.getSnapshot().pending);finish();await old;assert.equal(c.getSnapshot().pending.kind,'save');assert.equal(c.getSnapshot().receipt,null);await c.refresh();assert.equal(c.getSnapshot().view.version,1);
});

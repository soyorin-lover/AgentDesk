import test from 'node:test';
import assert from 'node:assert/strict';
import { applyNodeForm } from './node-edit.ts';
import type { EditableWorkflow } from './state.ts';
const binding={id:'binding',revision:3,grantId:'grant',baselineCommit:'base'};
const form={id:'task',name:'任务',goal:'目标',criteria:'检查结果',instanceId:'codex',dependencyIds:[],parentId:''};
const empty:EditableWorkflow={roles:[],members:[],ownerMemberId:null,nodes:[]};
test('新增任务需要明确执行绑定，不凭空生成基线；用户只选 Agent 即可形成合法引用',()=>{assert.throws(()=>applyNodeForm(empty,form,null,'Codex'));const d=applyNodeForm(empty,form,binding,'Codex');assert.equal(d.nodes[0].memberId,d.members[0].id);assert.equal(d.nodes[0].roleId,d.roles[0].id);assert.deepEqual(d.nodes[0].executionBinding,binding);assert.equal(empty.nodes.length,0);});
test('普通编辑保留原固定配置；明确换 Agent 才移除旧绑定，不改写旧工作区基线',()=>{const d=applyNodeForm(empty,form,binding,'Codex');d.nodes[0].agentBinding={instanceId:'codex',revision:2,configurationId:'fixed'};const renamed=applyNodeForm(d,{...form,name:'新名称'}, {...binding,baselineCommit:'new-head'},'Codex');assert.deepEqual(renamed.nodes[0].agentBinding,d.nodes[0].agentBinding);assert.equal(renamed.nodes[0].executionBinding.baselineCommit,'base');assert.equal(renamed.members.length,1);const switched=applyNodeForm(d,{...form,instanceId:'other'},binding,'另一执行者');assert.equal(switched.nodes[0].agentBinding,undefined);assert.equal(switched.nodes[0].executionBinding.baselineCommit,'base');assert.equal(d.nodes[0].agentInstanceId,'codex');});

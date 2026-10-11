import {test} from 'node:test';
import assert from 'node:assert/strict';
import {visibleActions, acceptanceView, taskBelongsToProject} from './scope.ts';
test('未知动作不会开放执行或恢复能力',()=>{assert.deepEqual(visibleActions(['start','future_admin','recover_check']),['start','recover_check']);});
test('没有可信接受摘要时任务accepted不等于当前有效',()=>{assert.equal(acceptanceView(undefined).valid,false);assert.equal(acceptanceView({status:'unverifiable',checkedAt:''}).valid,false);});
test('摘要失效原因优先于丢失的增量事件；只有valid可显示当前接受有效',()=>{assert.match(acceptanceView({status:'invalid',reason:'workspace_changed',checkedAt:''}).text,/workspace_changed/);assert.equal(acceptanceView({status:'valid',checkedAt:''}).valid,true);});
test('跨项目详情不能进入会话',()=>{assert.equal(taskBelongsToProject({projectId:'a'},'b'),false);assert.equal(taskBelongsToProject({projectId:'a'},'a'),true);});

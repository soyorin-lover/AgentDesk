import {test} from 'node:test';
import assert from 'node:assert/strict';
import { modelLabels, authorizedActions, withInstance } from './evidence.ts';
test('configuration and routing never become actual models, including legacy Run.model',()=>{
 assert.deepEqual(modelLabels({model:'legacy'}),['实际模型未知']);
 assert.deepEqual(modelLabels({modelEvidence:{status:'unknown',configuredModel:'config',routingModel:'route',source:'model_rerouted'}}),['实际模型未知','配置模型 · config','路由模型 · route']);
 assert.deepEqual(modelLabels({modelEvidence:{status:'reported',actualModel:'actual',source:'adapter_reported'}}),['实际模型 · actual']);
});
test('configuration and workflow denial and missing business capability close execution gates',()=>{
 const d={task:{},availableActions:['start','feedback','interrupt','snapshot']};
 const i={capabilities:[{name:'start',businessSupport:'implemented'}]};
 assert.deepEqual(authorizedActions(d,i),['start','snapshot']);
 assert.deepEqual(authorizedActions({...d,agentAuthorization:{eligible:false}},i),['snapshot']);
 assert.deepEqual(authorizedActions({...d,workflowAuthorization:{eligible:false}},i),['snapshot']);
 assert.deepEqual(authorizedActions(d,undefined),['snapshot']);
});
test('explicit instance change clears obsolete fixed binding; same instance preserves it',()=>{
 const n={agentInstanceId:'old',agentBinding:{instanceId:'old',revision:2,configurationId:'fixed'}};
 assert.deepEqual(withInstance(n,'old'),n);
 assert.deepEqual(withInstance(n,'new'),{agentInstanceId:'new'});
});

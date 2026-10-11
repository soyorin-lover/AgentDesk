import { test } from 'node:test';import assert from 'node:assert/strict';
import { graphLayout,treeRows } from './layout.ts';
const nodes=[{id:'a',dependencyIds:[]},{id:'b',parentId:'a',dependencyIds:[]},{id:'c',dependencyIds:['a']}] as any;
test('层级与依赖分别布局：子节点无依赖时不会被误当依赖后继',()=>{const positions=graphLayout(nodes);assert.equal(positions.a.x,positions.b.x);assert.ok(positions.c.x>positions.a.x);assert.deepEqual(treeRows(nodes).map(x=>[x.node.id,x.depth]),[['a',0],['b',1],['c',0]]);});
test('任何节点均可在键盘等效树中找到；排列确定且不修改源节点',()=>{const before=JSON.stringify(nodes);assert.equal(treeRows(nodes).length,nodes.length);assert.deepEqual(graphLayout(nodes),graphLayout(nodes));assert.equal(JSON.stringify(nodes),before);});
test('循环或悬空数据不会使布局无限递归或遗漏节点',()=>{const bad=[{id:'a',parentId:'b',dependencyIds:['b']},{id:'b',parentId:'a',dependencyIds:['a']},{id:'c',parentId:'missing',dependencyIds:['missing']}] as any;assert.equal(treeRows(bad).length,3);assert.equal(Object.keys(graphLayout(bad)).length,3);});

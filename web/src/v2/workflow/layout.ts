import type { WorkflowNode } from '../api/backend/types.ts';
export type Point = {x:number;y:number};
export function graphLayout(nodes:WorkflowNode[]):Record<string,Point> {
  const depths=new Map<string,number>();const ids=new Set(nodes.map(n=>n.id));
  for(let pass=0;pass<nodes.length;pass++)for(const node of nodes)if(!depths.has(node.id)&&node.dependencyIds.every(id=>!ids.has(id)||depths.has(id)))depths.set(node.id,Math.max(-1,...node.dependencyIds.map(id=>depths.get(id)??-1))+1);
  const rows=new Map<number,number>();return Object.fromEntries(nodes.map(node=>{const depth=depths.get(node.id)??0,row=rows.get(depth)??0;rows.set(depth,row+1);return [node.id,{x:32+depth*310,y:32+row*145}];}));
}
export function treeRows(nodes:WorkflowNode[]) {
  const result:{node:WorkflowNode;depth:number}[]=[],seen=new Set<string>(),ids=new Set(nodes.map(n=>n.id));
  function visit(node:WorkflowNode,depth:number){if(seen.has(node.id))return;seen.add(node.id);result.push({node,depth});nodes.filter(n=>n.parentId===node.id).forEach(n=>visit(n,depth+1));}
  nodes.filter(n=>!n.parentId||!ids.has(n.parentId)).forEach(n=>visit(n,0));nodes.forEach(n=>visit(n,0));return result;
}

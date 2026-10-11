import {useEffect,useState} from 'react';
import type {ApiClient,AgentInstance} from '../api/client/api.ts';
import {EngineMark} from '../icons.tsx';
import {engineMark,engineName} from './evidence.ts';
export function useAgentInstances(client:ApiClient){
 const [items,setItems]=useState<AgentInstance[]>([]),[error,setError]=useState<string|null>(null),[epoch,setEpoch]=useState(0);
 useEffect(()=>{const abort=new AbortController();setItems([]);void client.agentInstances(abort.signal).then(v=>{if(!abort.signal.aborted){setItems(v.items);setError(null);}}).catch(()=>{if(!abort.signal.aborted)setError('实例事实读取失败；执行能力未核验。请刷新实例。');});return()=>abort.abort();},[client,epoch]);
 return {items,error,refresh:()=>setEpoch(e=>e+1)};
}
export function InstanceFacts({instance}:{instance?:AgentInstance}){
 if(!instance)return <p className="meta">实例事实尚未读取，不能核验执行能力。</p>;
 return <div className="instance-facts"><p><EngineMark mark={engineMark(instance.engineId)}/> {engineName(instance.engineId)} · {instance.name} <code>{instance.id}</code></p><p>{instance.available?'服务已登记业务适配':'当前不可执行'}{instance.reason?' · '+instance.reason:''}。登录 unknown · 额度 unknown · 在线 unknown</p>{instance.configuredModel&&<p>当前配置模型 · {instance.configuredModel}（不代表历史实际模型）</p>}<details><summary>查看能力事实</summary>{instance.capabilities.map(c=><p key={c.name}>{c.name} · 业务 {c.businessSupport} · 协议 {c.protocolSupport} · {c.verification}</p>)}<p>协议支持与 fixture 验证不代表真实账号可用。审批、恢复与 steer 尚无可执行接口。</p></details></div>;
}

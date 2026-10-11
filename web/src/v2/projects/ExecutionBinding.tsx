import { useEffect, useState, useSyncExternalStore } from 'react';
import { BindingController, bindingReason } from './binding.ts';
import { I, Spinner } from '../icons.tsx';

export function ExecutionBindingSettings({controller}:{controller:BindingController}) {
  const s=useSyncExternalStore(controller.subscribe,controller.getSnapshot);
  const [grantId,setGrantId]=useState('');const [ack,setAck]=useState(false);
  useEffect(()=>{setAck(false);},[s.project?.version,s.association?.inspectionId,s.error,grantId]);
  const binding=s.status?.binding;
  return <section className="project-section execution-binding" aria-labelledby="execution-binding-title">
    <div className="row gap-3"><h2 id="execution-binding-title">执行绑定</h2><button className="btn" disabled={s.loading||s.writing} onClick={()=>{setAck(false);void controller.refresh();}}>{s.loading?<Spinner/>:<I n="refresh"/>}重新核验执行绑定</button></div>
    <p>选择本机受信配置中已登记的授权。绑定只保存授权与固定基线，不准备 worktree、不启动 Agent。</p>
    <p className="meta">网页不能创建受信授权或把任意路径设为 trusted；没有匹配授权时，需要先在本机启动配置中登记。</p>
    {s.loading && <p role="status">正在核验授权与绑定…</p>}
    {s.status && <div className={'banner '+(s.status.available?'':'banner--warn')} role="status"><div><strong>{s.status.available?'执行绑定当前可用':'执行绑定当前不可用'}</strong><p>{s.status.reason ? bindingReason(s.status.reason) : s.status.available ? '此为本次专用查询的核验结果。登录、额度与实际执行仍需单独验证。' : '尚未保存执行绑定，请按下方步骤确认。'}</p>{s.status.reason && <span className="mono">{s.status.reason}</span>}</div></div>}
    {binding && <dl className="binding-facts"><dt>当前绑定 ID</dt><dd className="mono">{binding.id}</dd><dt>固定修订</dt><dd data-testid="binding-revision">{binding.revision}</dd><dt>授权 ID</dt><dd className="mono">{binding.grantId}</dd><dt>固定 commit</dt><dd className="mono" data-testid="binding-commit">{binding.baselineCommit}</dd><dt>绑定依据检查</dt><dd className="mono">{binding.associationInspectionId ?? '兼容启动配置，无关联检查'}</dd></dl>}
    {s.receipt && <p role="status">本次请求已保存绑定修订 {s.receipt.revision}。当前绑定与能力以上方重新核验结果为准；未启动任务。</p>}
    {s.error && <div className="banner banner--bad" role="alert">{s.error}</div>}
    {s.pending && <div className="binding-pending banner banner--warn"><div><strong>待核对的原绑定请求</strong><p>项目版本 {s.pending.body.expectedVersion} · 授权 {s.pending.body.grantId}</p><p className="mono">{s.pending.body.baselineCommit}</p><p>原检查 {s.pending.body.inspectionId}。已保留原键、正文与显式排除确认；刷新事实不会改写此请求。</p><div className="row gap-3"><button className="btn" disabled={s.writing} onClick={()=>void controller.retry()}>重试原绑定请求</button><button className="btn btn--quiet" disabled={s.writing} onClick={()=>{controller.discard();setAck(false);}}>放弃本地重试记录</button></div></div></div>}
    {s.project && <>
      {s.association ? <div className="binding-baseline"><h3>当前已确认仓库基线</h3><p className="mono">{s.association.baselineCommit}</p><p className="meta">项目版本 {s.project.version} · 关联检查 {s.association.inspectionId}</p><p>这是确认当时的事实。绑定时服务会重新核验仓库；未提交改动不会进入任务 worktree。</p></div> : <p>请先在“接入已有 Git 仓库”中检查并明确确认 HEAD，再选择执行授权。</p>}
      {!s.loading && !s.grants.length && <div className="banner banner--warn">服务没有可选受信授权。请先通过本机配置登记仓库授权，再重新核验。</div>}
      <label className="binding-select">受信执行授权<select className="input" value={grantId} disabled={s.loading||s.writing||!!s.pending} onChange={e=>setGrantId(e.target.value)}><option value="">请选择授权，不会自动选择</option>{s.grants.map(g=><option key={g.id} value={g.id} disabled={!g.available}>{g.name} · {g.id}{!g.available?' · 不可用':''}</option>)}</select></label>
      {s.grants.filter(g=>!g.available).map(g=><p className="meta" key={g.id}>{g.name}（{g.id}）：{bindingReason(g.reason)}</p>)}
      {s.requiresInspection && <div className="banner banner--warn">原关联不能再次用于绑定。请重新检查并明确确认仓库，再回到这里核验。</div>}
      {s.association && <><label className="repository-ack"><input type="checkbox" checked={ack} disabled={s.loading||s.writing||!!s.pending} onChange={e=>setAck(e.target.checked)}/>我明确确认以当前已关联的完整 commit 绑定所选授权；未提交改动排除，不会被自动提交、覆盖或纳入任务 worktree。</label><button className="btn btn--primary" disabled={!controller.canBind(grantId,ack)} onClick={()=>{void controller.bind(grantId,ack);setAck(false);}}>{s.writing?'正在保存绑定…':binding?'确认刷新执行绑定':'确认绑定执行'}</button></>}
    </>}
    <p className="meta">更新关联后需显式刷新绑定。旧任务固定自己的绑定修订与 commit；项目当前绑定不能替代旧任务代码。</p>
  </section>;
}

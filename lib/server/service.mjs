import { verifyScenario } from '../domain/checker.mjs';
import { query, graphFor, connectionStatus } from './db.mjs';
import { seedWorkspace, DEPARTMENTS } from './seed.mjs';
import { getAgentConfiguration } from './model-provider.mjs';
import { AppError, now, id, hash, hydrate, properties, parse, requireText, requireRevision, commandMeta } from './util.mjs';

export const ready=seedWorkspace;
function publicEntity(value) {const {leaseToken,payloadHash,...visible}=value;return visible;}
function mutationGuard(runId,guard={}) {
  if(!runId)return {clause:'',params:{}};
  if(!Number.isSafeInteger(guard.fence)||typeof guard.leaseToken!=='string')throw new AppError('LEASE_REQUIRED','Agent mutations require the current worker lease.',409);
  return {clause:"MATCH (activeRun:AgentRun {id:$activeRunId}) WHERE activeRun.fence=$activeFence AND activeRun.leaseToken=$activeLease AND activeRun.leaseExpiresAt>timestamp() AND activeRun.status='running'",params:{activeRunId:runId,activeFence:guard.fence,activeLease:guard.leaseToken}};
}
const entityRows=rows=>rows.map(row=>hydrate(row.entity));
async function entities(ctx,label) {return entityRows(await query(ctx,`MATCH (n:${label}) RETURN properties(n) AS entity ORDER BY n.createdAt DESC`,{},{readOnly:true}));}
async function entity(ctx,label,entityId) {return hydrate((await query(ctx,`MATCH (n:${label} {id:$id}) RETURN properties(n) AS entity`,{id:entityId},{readOnly:true}))[0]?.entity);}
function missing(value,message='This item no longer exists in this workspace.') {if(!value)throw new AppError('NOT_FOUND',message,404);return value;}
async function replay(ctx,meta) {
  const command=await entity(ctx,'Command',meta.commandId);
  if(!command)return null;
  if(command.payloadHash!==meta.payloadHash)throw new AppError('COMMAND_REUSED','This command identifier was already used for a different action.',409);
  return command.result??parse(command.resultJson);
}
async function stale(ctx,label,entityId,meta) {
  const previous=await replay(ctx,meta);if(previous)return previous;
  const current=missing(await entity(ctx,label,entityId));
  throw new AppError('REVISION_CONFLICT','The item changed while you were reviewing it. Reload to review the current version.',409,{currentRevision:current.revision,status:current.status??current.state});
}

export async function getScenario(ctx,scenarioId) {
  await ready(ctx);
  const all=entityRows(await query(ctx,'MATCH (n:Entity) WHERE n.scenarioId=$scenarioId RETURN properties(n) AS entity',{scenarioId},{readOnly:true}));
  const handoff=missing(all.find(n=>n.type==='Handoff'),'That handoff is not in this workspace.');
  const revisions=all.filter(n=>n.type==='SourceRevision');
  const sources=all.filter(n=>n.type==='Source').map(s=>({...s,...revisions.find(r=>r.sourceId===s.id && r.version===s.version),id:s.id,type:s.sourceType??'document',revisions:revisions.filter(r=>r.sourceId===s.id).sort((a,b)=>b.version-a.version)}));
  const rules=all.filter(n=>n.type==='Rule' && n.current).map(r=>({...r,revisionId:r.id,id:r.ruleId}));
  const owners=entityRows(await query(ctx,'MATCH (h:Handoff {id:$id})-[:ASSIGNED_TO]->(o:Person) RETURN properties(o) AS entity',{id:scenarioId},{readOnly:true}));
  return {...handoff,tenant:ctx.tenant,sources,rules,owners,obligation:all.find(n=>n.type==='Obligation'),definitions:all.filter(n=>n.type==='Definition'),events:all.filter(n=>n.type==='EventType'),producers:all.filter(n=>n.type==='Producer'),
    runs:all.filter(n=>n.type==='VerificationRun').map(v=>({...v,...v.result})).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),
    cases:all.filter(n=>n.type==='Case').map(c=>({...c,stale:c.scenarioRevision!==handoff.revision})),interpretations:all.filter(n=>n.type==='Interpretation')};
}
export async function findHandoffs(ctx,{scenarioId}={}) {
  await ready(ctx);
  const ids=entityRows(await query(ctx,'MATCH (h:Handoff) WHERE $id="" OR h.id=$id RETURN properties(h) AS entity ORDER BY h.id',{id:scenarioId??''},{readOnly:true}));
  return Promise.all(ids.map(h=>getScenario(ctx,h.id)));
}
export async function bootstrap(ctx) {
  await ready(ctx);
  const [workspace,scenarios,agents,counts,connection]=await Promise.all([
    entity(ctx,'Workspace','workspace'),findHandoffs(ctx),entities(ctx,'Agent'),query(ctx,'MATCH (n:Entity) RETURN n.type AS type,count(n) AS count',{},{readOnly:true}),connectionStatus()
  ]);
  const count=Object.fromEntries(counts.map(c=>[c.type,c.count]));
  const [relationships,cases,tasks]=await Promise.all([query(ctx,'MATCH ()-[r]->() RETURN count(r) AS count',{},{readOnly:true}),listCases(ctx),listTasks(ctx)]);
  return {workspace:{...workspace,tenant:ctx.tenant,synthetic:true,privateSession:true},scenarios,departments:DEPARTMENTS,agents,
    counts:{nodes:counts.reduce((n,c)=>n+c.count,0),edges:relationships[0]?.count??0,cases:count.Case??0,openCases:cases.filter(c=>c.status!=='resolved').length,tasks:count.Task??0,pendingTasks:tasks.filter(t=>t.state!=='completed').length,memories:count.Memory??0,runs:count.AgentRun??0,departments:16},connection,...getAgentConfiguration()};
}
export async function graphData(ctx,{scenarioId,q}={}) {
  await ready(ctx);
  const [nodes,edges]=await Promise.all([
    query(ctx,`MATCH (n:Entity) WHERE $scenarioId="" OR n.scenarioId=$scenarioId OR n.type IN ["Workspace","Launch","Department","Person","Agent"] RETURN properties(n) AS entity
      UNION MATCH (run:AgentRun {scenarioId:$scenarioId})-[:USED_TOOL]->(n:ToolCall) RETURN properties(n) AS entity`,{scenarioId:scenarioId??''},{readOnly:true}),
    query(ctx,'MATCH (a:Entity)-[r]->(b:Entity) WHERE $scenarioId="" OR r.scenarioId=$scenarioId OR a.scenarioId=$scenarioId OR b.scenarioId=$scenarioId RETURN a.id AS source,b.id AS target,type(r) AS label,r.id AS id',{scenarioId:scenarioId??''},{readOnly:true})
  ]);
  let matches=[];
  if(q) {
    const safe=requireText(q,'Search',120).replace(/[^\p{L}\p{N}\s_-]/gu,' ').trim();
    if(safe)matches=(await query(ctx,"CALL db.idx.fulltext.queryNodes('SourceRevision',$text) YIELD node,score RETURN node.id AS id,score ORDER BY score DESC LIMIT 20",{text:safe},{readOnly:true})).map(row=>row.id);
  }
  const resultNodes=entityRows(nodes).filter(n=>!['Command','Session','Message'].includes(n.type)).map(n=>({id:n.id,label:n.title??n.name??n.term??n.action??n.id,type:n.type,scenarioId:n.scenarioId,properties:publicEntity(n)}));
  const allowed=new Set(resultNodes.map(n=>n.id));
  return {nodes:resultNodes,edges:edges.filter(e=>allowed.has(e.source)&&allowed.has(e.target)).map(e=>({...e,id:e.id??`edge_${hash(`${e.source}:${e.label}:${e.target}`).slice(0,16)}`,type:e.label})),matches,query:q??null};
}
export async function traceEvidence(ctx,{scenarioId}) {
  const scenario=await getScenario(ctx,scenarioId);
  const paths=await query(ctx,'MATCH p=(h:Handoff {id:$id})-[:HAS_OBLIGATION|USES_DEFINITION|COMPARES|IMPLEMENTED_BY|SOURCED_FROM|READS_EVENT|EMITTED_BY|OWNED_BY*1..6]->(n) RETURN [x IN nodes(p) | x.id] AS nodes,[r IN relationships(p) | type(r)] AS relationships LIMIT 100',{id:scenarioId},{readOnly:true});
  return {scenarioId,scope:scenario.scope,scenarioRevision:scenario.revision,obligation:scenario.obligation,rules:scenario.rules,sources:scenario.sources,paths,queryName:'trace_reviewed_evidence',hops:6};
}
export async function getAffectedOwners(ctx,{scenarioId}) {
  await getScenario(ctx,scenarioId);
  const rows=await query(ctx,'MATCH (h:Handoff {id:$id}),(o:Person) WITH o,shortestPath((h)-[*1..6]->(o)) AS p WHERE p IS NOT NULL RETURN properties(o) AS entity,[n IN nodes(p) | n.id] AS path,length(p) AS distance ORDER BY distance',{id:scenarioId},{readOnly:true});
  return {owners:rows.map(row=>({...hydrate(row.entity),path:row.path,distance:row.distance})),algorithm:'shortestPath',maxHops:6};
}
export async function listCases(ctx) {await ready(ctx);const [cases,handoffs]=await Promise.all([entities(ctx,'Case'),entities(ctx,'Handoff')]);return cases.map(c=>({...c,stale:c.scenarioRevision!==handoffs.find(h=>h.id===c.scenarioId)?.revision}));}
export async function listTasks(ctx) {await ready(ctx);return entities(ctx,'Task');}
export async function listRuns(ctx) {
  await ready(ctx);const [runs,calls]=await Promise.all([entities(ctx,'AgentRun'),entities(ctx,'ToolCall')]);
  return runs.map(run=>({...publicEntity(run),tools:calls.filter(t=>t.runId===run.id).map(publicEntity).sort((a,b)=>a.startedAt.localeCompare(b.startedAt))}));
}
export async function listAudit(ctx) {await ready(ctx);return (await entities(ctx,'AuditEvent')).sort((a,b)=>(b.timestamp??b.createdAt).localeCompare(a.timestamp??a.createdAt));}
export async function listSources(ctx) {await ready(ctx);const scenarios=await findHandoffs(ctx);return {sources:scenarios.flatMap(s=>s.sources),interpretations:scenarios.flatMap(s=>s.interpretations)};}
export async function listMemory(ctx) {
  await ready(ctx);const [memories,handoffs]=await Promise.all([entities(ctx,'Memory'),entities(ctx,'Handoff')]);
  return memories.map(m=>{const h=handoffs.find(h=>h.id===m.scenarioId);const version=m.versions?.scenarioRevision;return {...m,applicable:!h||!version||h.revision===version,applicabilityReason:!h?'Workspace procedure':!version||h.revision===version?'Scope and current evidence revisions match':'Evidence changed since this memory was recorded'};});
}
export async function recallMemory(ctx,{scenarioId}) {const s=await getScenario(ctx,scenarioId);const memories=await listMemory(ctx);return {scenarioId,scope:s.scope,accepted:memories.filter(m=>(m.scenarioId===scenarioId||!m.scenarioId)&&m.applicable),rejected:memories.filter(m=>m.scenarioId===scenarioId&&!m.applicable),tenant:ctx.tenant};}

export async function checkObligation(ctx,{scenarioId,inputs,runId,fence,leaseToken,guard}) {
  const scenario=await getScenario(ctx,scenarioId);
  const agentGuard=mutationGuard(runId,guard??{fence,leaseToken});
  const result=verifyScenario(scenario,{...(inputs?{inputs}:{}),maxEvaluations:5000});
  const verification={id:id('verification'),scenarioId,scenarioRevision:scenario.revision,createdAt:now(),title:`${scenario.title} · ${result.verdict}`,checkerVersion:result.checkerVersion,verdict:result.verdict,complete:result.complete,result,sourceVersions:scenario.sources.map(s=>({id:s.id,version:s.version})),ruleVersions:scenario.rules.map(r=>({id:r.id,revision:r.revision})),agentRunId:runId??null};
  const witnessId=result.witness?id('counterexample'):null;
  const witness=properties('Counterexample',{id:witnessId,scenarioId,createdAt:verification.createdAt,title:'A customer scenario that breaks the handoff',...result.witness,explanation:result.explanation});
  const audit=properties('AuditEvent',{id:id('audit'),action:'obligation.verified',actor:'Cato · verifier',timestamp:verification.createdAt,title:`${scenario.title}: ${result.verdict}`,details:{verificationId:verification.id,scenarioRevision:scenario.revision,evaluatedCount:result.evaluatedCount}});
  const handoffState=inputs && result.verdict==='VALID_WITHIN_BOUND'?scenario.state:result.verdict;
  const rows=await query(ctx,`MATCH (h:Handoff {id:$scenarioId}) WHERE h.revision=$revision
    ${agentGuard.clause}
    CREATE (v:Entity:VerificationRun) SET v=$verification
    CREATE (v)-[:CHECKED]->(h) SET h.state=$verdict
    CREATE (a:Entity:AuditEvent) SET a=$audit CREATE (a)-[:AFFECTED]->(v)
    FOREACH (row IN $witnesses | CREATE (c:Entity:Counterexample) SET c=row CREATE (v)-[:FOUND]->(c) CREATE (c)-[:VIOLATES]->(h))
    WITH h,v MATCH (r:Rule {scenarioId:$scenarioId}) WHERE r.current=true MERGE (v)-[:USED_RULE]->(r)
    WITH DISTINCT v MATCH (s:Source {scenarioId:$scenarioId})-[:HAS_REVISION]->(sr:SourceRevision) WHERE sr.version=s.version MERGE (v)-[:USED_SOURCE]->(sr)
    RETURN DISTINCT v.id AS id`,{scenarioId,revision:scenario.revision,verification:properties('VerificationRun',verification),audit,witnesses:witnessId?[witness]:[],verdict:handoffState??'unexamined',...agentGuard.params});
  if(!rows.length)throw new AppError('REVISION_CONFLICT','Source evidence changed during verification. Run the investigation again.',409);
  return {...verification,...result};
}
export async function openCase(ctx,{scenarioId,verificationId,runId,fence,leaseToken,guard}) {
  const scenario=await getScenario(ctx,scenarioId);
  const agentGuard=mutationGuard(runId,guard??{fence,leaseToken});
  const verification=missing(await entity(ctx,'VerificationRun',verificationId),'A stored verification is required.');
  if(verification.scenarioId!==scenarioId || verification.verdict!=='VIOLATED' || !verification.result?.witness)throw new AppError('NO_COUNTEREXAMPLE','A case requires a concrete violation of this handoff.',422);
  if(verification.scenarioRevision!==scenario.revision)throw new AppError('STALE_EVIDENCE','Run verification again against the current source revisions.',409);
  const caseId=`case_${hash(`${scenarioId}:${scenario.revision}`).slice(0,24)}`;
  const createdAt=now();
  const caseData={id:caseId,scenarioId,scenarioRevision:scenario.revision,title:scenario.title,status:'open',revision:1,severity:'high',scope:scenario.scope,departmentIds:scenario.departmentIds,verificationId,summary:verification.result.explanation,createdAt,updatedAt:createdAt,runId:runId??null};
  const episode={id:`memory_${caseId}`,kind:'episodic',title:`Found · ${scenario.title}`,body:verification.result.explanation,scenarioId,scope:scenario.scope,versions:{scenarioRevision:scenario.revision},outcome:'clarification_opened',createdAt,witness:verification.result.witness};
  const audit={id:`audit_${caseId}`,action:'case.opened',actor:'Vega · coordinator',timestamp:createdAt,title:`Clarification opened: ${scenario.title}`,details:{caseId,verificationId}};
  const rows=await query(ctx,`MATCH (h:Handoff {id:$scenarioId}),(v:VerificationRun {id:$verificationId}) WHERE h.revision=$revision AND v.scenarioRevision=h.revision
    ${agentGuard.clause}
    MERGE (c:Entity:Case {id:$caseId}) ON CREATE SET c=$caseData
    MERGE (c)-[:ABOUT]->(h) MERGE (c)-[:BASED_ON]->(v)
    MERGE (m:Entity:Memory {id:$memoryId}) ON CREATE SET m=$episode MERGE (m)-[:LEARNED_FROM]->(c) MERGE (m)-[:APPLIES_TO]->(h)
    MERGE (a:Entity:AuditEvent {id:$auditId}) ON CREATE SET a=$audit MERGE (a)-[:AFFECTED]->(c)
    WITH c,h MATCH (h)-[:ASSIGNED_TO]->(owner:Person) MERGE (c)-[:ASSIGNED_TO]->(owner)
    RETURN DISTINCT properties(c) AS entity`,{scenarioId,verificationId,revision:scenario.revision,caseId,caseData:properties('Case',caseData),memoryId:episode.id,episode:properties('Memory',episode),auditId:audit.id,audit:properties('AuditEvent',audit),...agentGuard.params});
  if(!rows.length)throw new AppError('REVISION_CONFLICT','The handoff changed while opening the clarification.',409);
  return hydrate(rows[0].entity);
}

export async function getCase(ctx,caseId) {
  await ready(ctx);const c=missing(await entity(ctx,'Case',caseId));
  const [scenario,verification,tasks,decisions,audit]=await Promise.all([getScenario(ctx,c.scenarioId),entity(ctx,'VerificationRun',c.verificationId),listTasks(ctx),entities(ctx,'Decision'),listAudit(ctx)]);
  return {...c,scenario,choices:scenario.resolution?.choices??[],verification:verification?{...verification,...verification.result}:null,tasks:tasks.filter(t=>t.caseId===c.id),decisions:decisions.filter(d=>d.caseId===c.id),history:audit.filter(a=>a.details?.caseId===c.id),stale:c.scenarioRevision!==scenario.revision};
}

export async function listMessages(ctx) {await ready(ctx);return (await entities(ctx,'Message')).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));}
export async function persistMessage(ctx,{role,body,scenarioId}) {
  await ready(ctx);requireText(body,'Message',12000);if(!['user','assistant','system'].includes(role))throw new AppError('INVALID_ROLE','Unsupported conversation role.');
  const message={id:id('message'),role,body,scenarioId:scenarioId??null,createdAt:now()};
  await query(ctx,"MATCH (s:Session {id:'conversation'}) CREATE (m:Entity:Message) SET m=$message CREATE (s)-[:HAS_MESSAGE]->(m) RETURN m.id AS id",{message:properties('Message',message)});return message;
}

export async function createAgentRun(ctx,{scenarioId,commandId,mode,inputs,payload}) {
  await ready(ctx);if(scenarioId)await getScenario(ctx,scenarioId);
  const safeCommand=requireText(commandId,'Command identifier',160);
  const payloadHash=hash({scenarioId:scenarioId??null,mode,payload:payload??{scenarioId:scenarioId??null,inputs:inputs??null}});
  const runId=`run_${hash(safeCommand).slice(0,24)}`;
  const existing=await entity(ctx,'AgentRun',runId);
  if(existing && existing.payloadHash!==payloadHash)throw new AppError('COMMAND_REUSED','The investigation command was already used with different inputs.',409);
  if(existing?.status==='completed')return existing;
  const leaseToken=id('lease'),timestamp=now(),expires=Date.now()+65000;
  const run={id:runId,scenarioId:scenarioId??null,commandId:safeCommand,payloadHash,mode,status:'running',createdAt:timestamp,startedAt:timestamp,leaseToken,leaseExpiresAt:expires,fence:1,checkpoint:'created',title:scenarioId?`Investigate ${scenarioId}`:'External MCP operation'};
  const rows=await query(ctx,`MERGE (r:Entity:AgentRun {id:$id}) ON CREATE SET r=$run
    WITH r WHERE r.payloadHash=$payloadHash AND (r.leaseToken=$leaseToken OR (r.status<>'completed' AND (r.leaseExpiresAt<timestamp() OR r.status='failed')))
    SET r.fence=CASE WHEN r.leaseToken=$leaseToken THEN r.fence ELSE r.fence+1 END,r.leaseToken=$leaseToken,r.leaseExpiresAt=$expires,r.status='running'
    RETURN properties(r) AS entity`,{id:runId,run:properties('AgentRun',run),leaseToken,payloadHash,expires});
  if(!rows.length) {const current=await entity(ctx,'AgentRun',runId);if(current?.payloadHash!==payloadHash)throw new AppError('COMMAND_REUSED','The investigation command was already used with different inputs.',409);if(current?.status==='completed')return current;throw new AppError('RUN_IN_PROGRESS','This investigation is already running. Its shared state is preserved.',409,{runId});}
  return hydrate(rows[0].entity);
}
export async function recordToolCall(ctx,runId,call) {
  const timestamp=now(),callId=call.id??id('tool');
  const {leaseToken,fence,...publicCall}=call;
  const payload={...publicCall,id:callId,runId,createdAt:timestamp,startedAt:call.startedAt??timestamp,tool:call.tool??call.name,argsJson:JSON.stringify(call.arguments??call.args??{}),resultJson:JSON.stringify(call.result??null)};
  const rows=await query(ctx,`MATCH (r:AgentRun {id:$runId}) WHERE r.fence=$fence AND r.leaseToken=$leaseToken AND r.leaseExpiresAt>timestamp() AND r.status='running'
    CREATE (t:Entity:ToolCall) SET t=$call CREATE (r)-[:USED_TOOL]->(t) SET r.checkpoint=$tool RETURN t.id AS id`,{runId,fence:call.fence,leaseToken:call.leaseToken,clock:Date.now(),call:properties('ToolCall',payload),tool:payload.tool});
  if(!rows.length)throw new AppError('LEASE_LOST','A newer worker owns this investigation. Reload its current state.',409);return payload;
}
export async function finishAgentRun(ctx,runId,{status,result,error,fence,leaseToken}) {
  const completedAt=now();
  const rows=await query(ctx,`MATCH (r:AgentRun {id:$runId}) WHERE r.fence=$fence AND r.leaseToken=$leaseToken AND r.leaseExpiresAt>timestamp() AND r.status='running'
    SET r.status=$status,r.completedAt=$completedAt,r.resultJson=$result,r.error=$error,r.checkpoint='finished'
    RETURN properties(r) AS entity`,{runId,fence,leaseToken,clock:Date.now(),status,completedAt,result:JSON.stringify(result??null),error:typeof error==='string'?error:error?.message??''});
  if(!rows.length)throw new AppError('LEASE_LOST','This worker no longer owns the investigation.',409);return hydrate(rows[0].entity);
}

export async function approveDecision(ctx,caseId,body) {
  const expectedRevision=requireRevision(body.expectedRevision),choiceId=requireText(body.choice,'Decision choice',120),note=requireText(body.note??'Approved by the workspace reviewer.','Decision note',8000);
  const meta=commandMeta(body,'case.decision',{caseId,choice:choiceId,note,expectedRevision});
  const previous=await replay(ctx,meta);if(previous)return previous;
  const c=await getCase(ctx,caseId);
  if(c.stale)throw new AppError('STALE_EVIDENCE','The handoff has new source evidence. Investigate its current revision before deciding.',409);
  if(!['open','decision_proposed'].includes(c.status))return stale(ctx,'Case',caseId,meta);
  const choice=missing(c.choices.find(x=>x.id===choiceId),'Choose one of the reviewed resolution options.');
  const timestamp=now(),decisionId=id('decision');
  const decision={id:decisionId,caseId,scenarioId:c.scenarioId,choice:choice.id,title:choice.label,description:choice.description,note,status:'approved',approvedBy:ctx.actor,createdAt:timestamp,scope:c.scope,ruleUpdates:choice.ruleUpdates,versions:{scenarioRevision:c.scenarioRevision}};
  const tasks=choice.taskTemplates.map((template,index)=>({id:`${decisionId}_task_${index+1}`,caseId,decisionId,scenarioId:c.scenarioId,...template,ownerName:c.scenario.owners.find(o=>o.id===template.ownerId)?.name??DEPARTMENTS.find(d=>d.id===template.departmentId)?.name,state:'pending',revision:1,createdAt:timestamp,evidence:null}));
  const result={id:caseId,caseId,status:'implementation_pending',revision:expectedRevision+1,decisionId,taskIds:tasks.map(t=>t.id)};
  const semantic={id:`memory_${decisionId}`,kind:'semantic',title:`Approved · ${choice.label}`,body:`${choice.description} Reviewer note: ${note} Implementation is pending; this decision is not evidence that the underlying systems changed.`,scope:c.scope,scenarioId:c.scenarioId,caseId,createdAt:timestamp,versions:{scenarioRevision:c.scenarioRevision},outcome:'approved_pending_implementation',decisionId};
  const procedural={id:`procedure_${decisionId}`,kind:'procedural',title:`Coordinate · ${c.title}`,body:`Owners approved ${choice.label}. Resume ${tasks.length} human follow-ups, collect evidence, and verify the full finite domain before resolving this case.`,scope:c.scope,scenarioId:c.scenarioId,caseId,createdAt:timestamp,versions:{scenarioRevision:c.scenarioRevision},outcome:'follow_up_required',decisionId};
  const audit={id:id('audit'),action:'decision.approved',actor:ctx.actor,timestamp,title:choice.label,details:{caseId,decisionId,tasksCreated:tasks.length,implementationComplete:false}};
  const rows=await query(ctx,`MATCH (c:Case {id:$caseId})-[:ABOUT]->(h:Handoff)
    OPTIONAL MATCH (cmd:Command {id:$commandId})
    WITH c,h,cmd WHERE cmd IS NULL AND c.revision=$expectedRevision AND c.scenarioRevision=h.revision AND c.status IN ['open','decision_proposed']
    CREATE (newcmd:Entity:Command {id:$commandId,payloadHash:$payloadHash,resultJson:$result,createdAt:$timestamp,type:'Command'})
    CREATE (d:Entity:Decision) SET d=$decision CREATE (c)-[:HAS_DECISION]->(d) CREATE (d)-[:RESOLVES]->(c)
    SET c.status='implementation_pending',c.revision=c.revision+1,c.decisionId=$decisionId,c.updatedAt=$timestamp
    FOREACH (row IN $tasks | CREATE (t:Entity:Task) SET t=row CREATE (c)-[:HAS_TASK]->(t) CREATE (t)-[:IMPLEMENTS]->(d) MERGE (o:Entity:Person {id:row.ownerId}) CREATE (t)-[:ASSIGNED_TO]->(o))
    FOREACH (row IN $memories | CREATE (m:Entity:Memory) SET m=row CREATE (m)-[:LEARNED_FROM]->(d) CREATE (m)-[:APPLIES_TO]->(h))
    CREATE (a:Entity:AuditEvent) SET a=$audit CREATE (a)-[:AFFECTED]->(c) CREATE (newcmd)-[:CAUSED]->(d)
    RETURN c.id AS id`,{caseId,...meta,expectedRevision,timestamp,decisionId,decision:properties('Decision',decision),tasks:tasks.map(t=>properties('Task',t)),memories:[semantic,procedural].map(m=>properties('Memory',m)),audit:properties('AuditEvent',audit),result:JSON.stringify(result)});
  if(!rows.length)return stale(ctx,'Case',caseId,meta);return result;
}

export async function completeTask(ctx,taskId,body) {
  const expectedRevision=requireRevision(body.expectedRevision),evidence=requireText(body.evidence,'Implementation evidence',8000,8);
  const meta=commandMeta(body,'task.complete',{taskId,evidence,expectedRevision});const previous=await replay(ctx,meta);if(previous)return previous;
  const task=missing(await entity(ctx,'Task',taskId));
  const c=await getCase(ctx,task.caseId);
  if(c.stale)throw new AppError('STALE_EVIDENCE','This task belongs to an older handoff revision. Reconcile the updated source first.',409);
  const timestamp=now(),result={id:taskId,state:'completed',revision:expectedRevision+1,evidence,completedAt:timestamp,caseId:task.caseId};
  const audit={id:id('audit'),action:'task.completed',actor:ctx.actor,timestamp,title:task.title,details:{caseId:task.caseId,taskId,evidence}};
  const rows=await query(ctx,`MATCH (c:Case)-[:HAS_TASK]->(t:Task {id:$taskId}), (c)-[:ABOUT]->(h:Handoff)
    OPTIONAL MATCH (cmd:Command {id:$commandId})
    WITH c,t,h,cmd WHERE cmd IS NULL AND t.revision=$expectedRevision AND t.state='pending' AND c.status='implementation_pending' AND c.scenarioRevision=h.revision
    CREATE (newcmd:Entity:Command {id:$commandId,payloadHash:$payloadHash,resultJson:$result,createdAt:$timestamp,type:'Command'})
    SET t.state='completed',t.evidence=$evidence,t.completedAt=$timestamp,t.completedBy=$actor,t.revision=t.revision+1
    CREATE (a:Entity:AuditEvent) SET a=$audit CREATE (a)-[:AFFECTED]->(t) CREATE (newcmd)-[:CAUSED]->(t)
    WITH c,t OPTIONAL MATCH (c)-[:HAS_TASK]->(other:Task) WHERE other.state<>'completed'
    WITH c,t,count(other) AS pending SET c.status=CASE WHEN pending=0 THEN 'verification_pending' ELSE 'implementation_pending' END,c.revision=c.revision+1,c.updatedAt=$timestamp
    RETURN t.id AS id,c.status AS caseStatus`,{taskId,...meta,expectedRevision,timestamp,evidence,actor:ctx.actor,audit:properties('AuditEvent',audit),result:JSON.stringify(result)});
  if(!rows.length)return stale(ctx,'Task',taskId,meta);return {...result,caseStatus:rows[0].caseStatus};
}

export async function verifyCase(ctx,caseId,body) {
  const expectedRevision=requireRevision(body.expectedRevision),meta=commandMeta(body,'case.verify',{caseId,expectedRevision});
  const previous=await replay(ctx,meta);if(previous)return previous;
  const c=await getCase(ctx,caseId);
  if(c.stale)throw new AppError('STALE_EVIDENCE','The source evidence changed after this clarification. Investigate the current revision.',409);
  if(c.status!=='verification_pending' || c.tasks.some(t=>t.state!=='completed'||!t.evidence))throw new AppError('IMPLEMENTATION_PENDING','Every implementation task needs completion evidence before verification.',409);
  const decision=missing(c.decisions.find(d=>d.id===c.decisionId),'The approved decision is missing.');
  const candidate=structuredClone(c.scenario),timestamp=now(),updates=[];
  candidate.revision++;
  for(const update of decision.ruleUpdates??[]) {
    const rule=missing(candidate.rules.find(r=>r.id===update.ruleId),'The decision references an unavailable rule.');
    const source=missing(candidate.sources.find(s=>s.id===rule.sourceId),'The rule source is missing.');
    const oldId=rule.revisionId??`${rule.id}@${rule.revision}`,oldSourceId=`${source.id}@${source.version}`;
    Object.assign(rule,update,{revision:rule.revision+1});
    rule.revisionId=`${rule.id}@${rule.revision}`;
    source.version++;
    source.text=`Approved implementation mapping for ${rule.title}.\n${rule.statement}\nDecision: ${decision.title}.\nHuman reviewer: ${decision.approvedBy}.\nEvidence supplied for this synthetic workspace:\n${c.tasks.map(t=>`${t.title}: ${t.evidence}`).join('\n')}\nPrevious exact source retained as ${oldSourceId}.`;
    source.reviewed=true;
    updates.push({oldId,oldSourceId,sourceId:source.id,ruleId:rule.id,sourceVersion:source.version,sourceText:source.text,newRule:properties('Rule',{...rule,id:rule.revisionId,ruleId:rule.id,current:true,scenarioId:c.scenarioId,createdAt:timestamp}),newSource:properties('SourceRevision',{id:`${source.id}@${source.version}`,sourceId:source.id,title:source.title,text:source.text,contentHash:hash(source.text),version:source.version,reviewed:true,departmentId:source.departmentId,scenarioId:c.scenarioId,createdAt:timestamp}),interpretation:properties('Interpretation',{id:`interpretation_${rule.revisionId}`,scenarioId:c.scenarioId,title:`Implemented mapping: ${rule.title}`,ruleId:rule.id,sourceId:source.id,reviewed:true,status:'accepted',proposedRule:rule.expression,reviewer:ctx.actor,decisionId:decision.id,createdAt:timestamp,revision:1})});
  }
  if(!updates.length)throw new AppError('NO_REPAIR','The approved decision has no structured rule change.',422);
  const verificationResult=verifyScenario(candidate,{maxEvaluations:5000});
  if(verificationResult.verdict!=='VALID_WITHIN_BOUND'||!verificationResult.complete)throw new AppError('REPAIR_NOT_VERIFIED','The proposed mapping does not satisfy the whole declared finite domain.',422,{verification:verificationResult});
  const verificationId=id('verification'),verification={id:verificationId,scenarioId:c.scenarioId,scenarioRevision:candidate.revision,title:`Resolution verified · ${c.title}`,verdict:verificationResult.verdict,complete:true,checkerVersion:verificationResult.checkerVersion,result:verificationResult,createdAt:timestamp,caseId};
  const result={id:caseId,status:'resolved',revision:expectedRevision+1,scenarioRevision:candidate.revision,verificationId,verification:verificationResult};
  const memory={id:`memory_resolved_${decision.id}`,kind:'semantic',title:`Verified · ${decision.title}`,body:`${decision.description} Human implementation evidence was recorded. The adopted structured mapping satisfies every admissible input in the declared finite domain; this is not a claim about unmodeled behavior.`,scenarioId:c.scenarioId,scope:c.scope,caseId,decisionId:decision.id,versions:{scenarioRevision:candidate.revision},createdAt:timestamp,outcome:'verified_within_bound'};
  const audit={id:id('audit'),action:'case.resolved',actor:ctx.actor,timestamp,title:`Verified resolution: ${c.title}`,details:{caseId,decisionId:decision.id,verificationId,evaluatedCount:verificationResult.evaluatedCount,scope:c.scope,bounded:true}};
  const rows=await query(ctx,`MATCH (c:Case {id:$caseId})-[:ABOUT]->(h:Handoff),(d:Decision {id:$decisionId})
    OPTIONAL MATCH (cmd:Command {id:$commandId})
    WITH c,h,d,cmd WHERE cmd IS NULL AND c.revision=$expectedRevision AND c.status='verification_pending' AND h.revision=$scenarioRevision
    CREATE (newcmd:Entity:Command {id:$commandId,payloadHash:$payloadHash,resultJson:$result,createdAt:$timestamp,type:'Command'})
    SET c.status='resolved',c.revision=c.revision+1,c.originalVerificationId=c.verificationId,c.verificationId=$verificationId,c.resolvedAt=$timestamp,c.updatedAt=$timestamp,c.scenarioRevision=h.revision+1,h.revision=h.revision+1,h.state='VALID_WITHIN_BOUND',d.implementationVerified=true
    CREATE (v:Entity:VerificationRun) SET v=$verification CREATE (v)-[:CHECKED]->(h) CREATE (c)-[:VERIFIED_BY]->(v)
    CREATE (m:Entity:Memory) SET m=$memory CREATE (m)-[:LEARNED_FROM]->(d) CREATE (m)-[:APPLIES_TO]->(h)
    CREATE (a:Entity:AuditEvent) SET a=$audit CREATE (a)-[:AFFECTED]->(c) CREATE (newcmd)-[:CAUSED]->(v)
    WITH c,h,v,d UNWIND $updates AS row
    MATCH (old:Rule {id:row.oldId}),(s:Source {id:row.sourceId}),(oldSource:SourceRevision {id:row.oldSourceId}),(o:Obligation {id:$obligationId})
    SET old.current=false,s.version=row.sourceVersion,s.text=row.sourceText,s.reviewed=true
    CREATE (r:Entity:Rule) SET r=row.newRule CREATE (sr:Entity:SourceRevision) SET sr=row.newSource CREATE (i:Entity:Interpretation) SET i=row.interpretation
    CREATE (r)-[:SUPERSEDES]->(old) CREATE (sr)-[:SUPERSEDES]->(oldSource) CREATE (s)-[:HAS_REVISION]->(sr) CREATE (r)-[:SOURCED_FROM]->(sr)
    CREATE (sr)-[:SUPPORTS]->(i) CREATE (i)-[:PROPOSES_CHANGE]->(r) CREATE (o)-[:COMPARES]->(r) CREATE (v)-[:USED_RULE]->(r) CREATE (v)-[:USED_SOURCE]->(sr) CREATE (d)-[:ADOPTED]->(r)
    WITH c,row,r MATCH (definition:Definition {ruleId:row.ruleId}) CREATE (definition)-[:IMPLEMENTED_BY]->(r)
    RETURN DISTINCT c.id AS id`,{caseId,decisionId:decision.id,...meta,expectedRevision,scenarioRevision:c.scenario.revision,timestamp,result:JSON.stringify(result),verificationId,verification:properties('VerificationRun',verification),memory:properties('Memory',memory),audit:properties('AuditEvent',audit),updates,obligationId:c.scenario.obligation.id});
  if(!rows.length)return stale(ctx,'Case',caseId,meta);return result;
}

export async function intake(ctx,body) {
  const text=requireText(body.text,'Source text',16000,8),scenario=await getScenario(ctx,requireText(body.scenarioId,'Handoff',80));
  const departmentId=requireText(body.departmentId,'Department',80);
  if(!scenario.departmentIds.includes(departmentId))throw new AppError('INVALID_DEPARTMENT','Choose an owner of this handoff.');
  const choice=body.choiceId?missing(scenario.resolution.choices.find(c=>c.id===body.choiceId),'Choose an available reviewed mapping proposal.'):null;
  const targetRule=(choice?scenario.rules.find(r=>r.id===choice.ruleUpdates[0].ruleId):scenario.rules.find(r=>r.departmentId===departmentId))??scenario.rules[0];
  const source=missing(scenario.sources.find(s=>s.id===targetRule.sourceId));
  const timestamp=now(),interpretationId=id('interpretation');
  const proposal={id:interpretationId,title:`Proposed source review · ${source.title}`,scenarioId:scenario.id,sourceId:source.id,departmentId,ruleId:targetRule.id,sourceText:text,proposedRule:choice?.ruleUpdates.find(r=>r.ruleId===targetRule.id)?.expression??targetRule.expression,proposedStatement:choice?.ruleUpdates.find(r=>r.ruleId===targetRule.id)?.statement??targetRule.statement,choiceId:choice?.id??null,status:'pending',reviewed:false,revision:1,expectedRevision:scenario.revision,expectedSourceVersion:source.version,expectedRuleRevision:targetRule.revision,createdAt:timestamp,extractionMode:'human-selected structured mapping',explanation:choice?'The selected reviewed mapping is proposed against this new source. A reviewer must confirm that it faithfully represents the source.':'The current structured mapping is retained as a proposal. This intake does not automatically interpret arbitrary source text.'};
  const message={id:id('message'),role:'user',body:text,scenarioId:scenario.id,createdAt:timestamp};
  const audit={id:id('audit'),action:'source.proposed',actor:ctx.actor,timestamp,title:proposal.title,details:{interpretationId,scenarioId:scenario.id,sourceId:source.id}};
  await query(ctx,`MATCH (h:Handoff {id:$scenarioId}),(s:Source {id:$sourceId}),(session:Session {id:'conversation'})
    CREATE (i:Entity:Interpretation) SET i=$proposal CREATE (i)-[:INTERPRETS]->(s) CREATE (i)-[:APPLIES_TO]->(h)
    CREATE (m:Entity:Message) SET m=$message CREATE (session)-[:HAS_MESSAGE]->(m) CREATE (m)-[:REFERS_TO]->(i)
    CREATE (a:Entity:AuditEvent) SET a=$audit CREATE (a)-[:AFFECTED]->(i) RETURN i.id AS id`,{scenarioId:scenario.id,sourceId:source.id,proposal:properties('Interpretation',proposal),message:properties('Message',message),audit:properties('AuditEvent',audit)});
  return {interpretation:proposal,message};
}

export async function reviewInterpretation(ctx,interpretationId,body) {
  const action=body.action??(body.approved===true?'accept':body.approved===false?'reject':null);
  if(!['accept','reject'].includes(action))throw new AppError('INVALID_REVIEW','Accept or reject this proposed interpretation.');
  const expectedRevision=requireRevision(body.expectedRevision),meta=commandMeta(body,'source.review',{interpretationId,action,expectedRevision});
  const previous=await replay(ctx,meta);if(previous)return previous;
  const proposal=missing(await entity(ctx,'Interpretation',interpretationId));
  if(proposal.original)throw new AppError('FIXTURE_REVIEW','Submit a source update to review a new mapping. Original fixture reviews remain in history.',422);
  const scenario=await getScenario(ctx,proposal.scenarioId),timestamp=now(),status=action==='accept'?'accepted':'rejected';
  const result={id:interpretationId,status,revision:expectedRevision+1,scenarioId:scenario.id};
  const audit={id:id('audit'),action:`source.${status}`,actor:ctx.actor,timestamp,title:`${status==='accepted'?'Accepted':'Rejected'} source interpretation`,details:{interpretationId,scenarioId:scenario.id,oldRevision:scenario.revision,newRevision:action==='accept'?scenario.revision+1:scenario.revision}};
  let updates='';let params={};
  if(action==='accept') {
    if(proposal.expectedRevision!==scenario.revision)throw new AppError('STALE_EVIDENCE','The handoff changed since this interpretation was proposed. Submit an updated review.',409);
    const rule=missing(scenario.rules.find(r=>r.id===proposal.ruleId)),source=missing(scenario.sources.find(s=>s.id===proposal.sourceId));
    const nextRule={...rule,id:`${rule.id}@${rule.revision+1}`,ruleId:rule.id,revision:rule.revision+1,current:true,reviewed:true,expression:proposal.proposedRule,statement:proposal.proposedStatement,scenarioId:scenario.id,createdAt:timestamp};
    const nextSource={id:`${source.id}@${source.version+1}`,sourceId:source.id,title:source.title,text:proposal.sourceText,version:source.version+1,contentHash:hash(proposal.sourceText),reviewed:true,departmentId:proposal.departmentId,scenarioId:scenario.id,createdAt:timestamp};
    params={oldRuleId:rule.revisionId,oldSourceId:`${source.id}@${source.version}`,sourceId:source.id,nextRule:properties('Rule',nextRule),nextSource:properties('SourceRevision',nextSource),sourceVersion:nextSource.version,sourceText:nextSource.text,obligationId:scenario.obligation.id,ruleId:rule.id};
    updates=`WITH i,h MATCH (old:Rule {id:$oldRuleId}),(source:Source {id:$sourceId}),(oldSource:SourceRevision {id:$oldSourceId}),(o:Obligation {id:$obligationId}),(definition:Definition {ruleId:$ruleId})
      SET old.current=false,source.version=$sourceVersion,source.text=$sourceText,source.reviewed=true,h.revision=h.revision+1,h.state='unexamined'
      CREATE (r:Entity:Rule) SET r=$nextRule CREATE (sr:Entity:SourceRevision) SET sr=$nextSource
      CREATE (r)-[:SUPERSEDES]->(old) CREATE (sr)-[:SUPERSEDES]->(oldSource) CREATE (source)-[:HAS_REVISION]->(sr) CREATE (r)-[:SOURCED_FROM]->(sr)
      CREATE (sr)-[:SUPPORTS]->(i) CREATE (i)-[:PROPOSES_CHANGE]->(r) CREATE (o)-[:COMPARES]->(r) CREATE (definition)-[:IMPLEMENTED_BY]->(r)`;
  }
  const rows=await query(ctx,`MATCH (i:Interpretation {id:$interpretationId}),(h:Handoff {id:$scenarioId}) OPTIONAL MATCH (cmd:Command {id:$commandId})
    WITH i,h,cmd WHERE cmd IS NULL AND i.revision=$expectedRevision AND i.status='pending' AND ($action='reject' OR h.revision=$scenarioRevision)
    CREATE (newcmd:Entity:Command {id:$commandId,payloadHash:$payloadHash,resultJson:$result,createdAt:$timestamp,type:'Command'})
    SET i.status=$status,i.reviewed=$reviewed,i.revision=i.revision+1,i.reviewedAt=$timestamp,i.reviewer=$actor
    CREATE (a:Entity:AuditEvent) SET a=$audit CREATE (a)-[:AFFECTED]->(i) CREATE (newcmd)-[:CAUSED]->(i)
    ${updates}
    RETURN i.id AS id`,{interpretationId,scenarioId:scenario.id,...meta,expectedRevision,action,scenarioRevision:scenario.revision,status,reviewed:action==='accept',timestamp,actor:ctx.actor,audit:properties('AuditEvent',audit),result:JSON.stringify(result),...params});
  if(!rows.length)return stale(ctx,'Interpretation',interpretationId,meta);return result;
}

export async function resetWorkspace(ctx) {const graph=await graphFor(ctx);await graph.delete();await ready(ctx);return {reset:true,tenant:ctx.tenant};}

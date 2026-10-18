import { ConstraintType, EntityType } from 'falkordb';
import { listScenarios } from '../domain/scenarios.mjs';
import { graphFor, query } from './db.mjs';
import { hash, now, properties } from './util.mjs';

export const DEPARTMENTS = [
  ['product','Product','#537f78'],['engineering','Engineering','#687c99'],['billing','Billing','#be745a'],['qa','Quality assurance','#9d825b'],
  ['growth','Growth','#858457'],['marketing','Marketing','#ad7889'],['sales','Sales','#907757'],['support','Support','#758c70'],
  ['customer_success','Customer success','#6b9b94'],['data','Data','#8e82a3'],['design','Design','#b3826b'],['security','Security','#78868f'],
  ['operations','Operations','#859176'],['finance','Finance','#9f9177'],['legal','Policy & legal','#8d8796'],['leadership','Leadership','#776f66']
].map(([id,name,color])=>({id,name,color}));

export async function seedWorkspace(ctx) {
  const existing=await query(ctx,"MERGE (w:Entity:Workspace {id:'workspace'}) ON CREATE SET w.seedVersion=0 RETURN w.seedVersion AS version");
  if(existing[0]?.version===1)return;
  const graph=await graphFor(ctx);
  try { await graph.createNodeRangeIndex('Entity','id'); } catch(e) { if(!/already|exist|indexed/i.test(e.message))throw e; }
  try { await graph.constraintCreate(ConstraintType.UNIQUE,EntityType.NODE,'Entity','id'); } catch(e) { if(!/already|exist/i.test(e.message))throw e; }
  try { await graph.createNodeFulltextIndex('SourceRevision','text','title'); } catch(e) { if(!/already|exist/i.test(e.message))throw e; }
  const nodeGroups={},edgeGroups={},seen=new Set(),timestamp=now();
  const node=(type,data)=>{if(seen.has(data.id))return;seen.add(data.id);(nodeGroups[type]??=[]).push(properties(type,{createdAt:timestamp,revision:1,...data}));};
  const edge=(type,source,target,scenarioId='')=>{(edgeGroups[type]??=[]).push({id:`edge_${hash(`${type}:${source}:${target}`).slice(0,20)}`,source,target,scenarioId});};
  const scenarios=listScenarios(ctx.tenant);
  const owners=Object.fromEntries(scenarios.flatMap(s=>s.owners).map(o=>[o.departmentId,o]));
  node('Launch',{id:'launch_orbit',title:ctx.tenant==='acme'?'Orbit · Autumn release':'Nova · Platform release',state:'reviewing',tenant:ctx.tenant});
  edge('HAS_LAUNCH','workspace','launch_orbit');
  for(const department of DEPARTMENTS) {
    node('Department',department);
    const person=owners[department.id]??{id:`owner_${department.id}`,departmentId:department.id,name:`${department.name} lead`,role:'Department lead'};
    node('Person',person);edge('MEMBER_OF',person.id,department.id);edge('HAS_DEPARTMENT','workspace',department.id);
  }
  for(const [agentId,name,role] of [['investigator','Iris','Investigator'],['verifier','Cato','Verifier'],['coordinator','Vega','Coordinator']]) {
    node('Agent',{id:agentId,name,role,status:'ready',description:{investigator:'Follows evidence and retrieves scoped memory.',verifier:'Computes reproducible counterexamples.',coordinator:'Routes clarification and preserves human decisions.'}[agentId]});edge('HAS_AGENT','workspace',agentId);
  }
  for(const s of scenarios) {
    const {sources,rules,definitions,events,producers,obligation,owners:scenarioOwners,...handoff}=s;
    node('Handoff',{...handoff,scenarioId:s.id,state:'unexamined',title:s.title});
    node('Promise',{id:`promise_${s.id}`,text:s.promise,title:s.promise,scope:s.scope,scenarioId:s.id});
    node('Obligation',{...obligation,scenarioId:s.id,title:obligation.text});
    edge('HAS_HANDOFF','launch_orbit',s.id,s.id);edge('DELIVERS','launch_orbit',`promise_${s.id}`,s.id);
    edge('GOVERNED_BY',`promise_${s.id}`,obligation.id,s.id);edge('HAS_OBLIGATION',s.id,obligation.id,s.id);
    for(const [i,departmentId] of s.departmentIds.entries())edge(i===0?'FROM':'TO',s.id,departmentId,s.id);
    for(const owner of scenarioOwners)edge('ASSIGNED_TO',s.id,owner.id,s.id);
    for(const source of sources) {
      node('Source',{...source,id:source.id,type:'Source',sourceType:source.type,scenarioId:s.id});
      node('SourceRevision',{...source,id:`${source.id}@${source.version}`,sourceId:source.id,sourceType:source.type,type:'SourceRevision',contentHash:hash(source.text),scenarioId:s.id});
      edge('HAS_REVISION',source.id,`${source.id}@${source.version}`,s.id);edge('OWNED_BY',source.id,source.departmentId,s.id);
    }
    for(const rule of rules) {
      const revisionId=`${rule.id}@${rule.revision}`;
      node('Rule',{...rule,id:revisionId,ruleId:rule.id,current:true,scenarioId:s.id});
      const interpretationId=`interpretation_${rule.id}@1`;
      node('Interpretation',{id:interpretationId,title:`Reviewed mapping: ${rule.title}`,scenarioId:s.id,status:rule.reviewed?'accepted':'pending',ruleId:rule.id,sourceId:rule.sourceId,reviewed:rule.reviewed,proposedRule:rule.expression,expectedRevision:1,reviewer:rule.reviewed?'Synthetic fixture reviewer':null,original:true});
      edge('COMPARES',obligation.id,revisionId,s.id);edge('SOURCED_FROM',revisionId,`${rule.sourceId}@1`,s.id);
      edge('SUPPORTS',`${rule.sourceId}@1`,interpretationId,s.id);edge('PROPOSES_CHANGE',interpretationId,revisionId,s.id);
      edge('OWNED_BY',revisionId,rule.departmentId,s.id);
    }
    for(const definition of definitions) {
      node('Definition',{...definition,scenarioId:s.id,title:`${definition.term} · ${definition.departmentId}`});
      edge('USES_DEFINITION',s.id,definition.id,s.id);edge('IMPLEMENTED_BY',definition.id,`${definition.ruleId}@1`,s.id);edge('SOURCED_FROM',definition.id,`${definition.sourceId}@1`,s.id);
    }
    for(const event of events) {node('EventType',{...event,scenarioId:s.id});if(event.producerId)edge('EMITTED_BY',event.id,event.producerId,s.id);}
    for(const producer of producers) {node('Producer',{...producer,scenarioId:s.id});edge('OWNED_BY',producer.id,producer.departmentId,s.id);edge('SOURCED_FROM',producer.id,`${producer.sourceId}@1`,s.id);}
    if(s.id==='trial') {edge('READS_EVENT','trial_rule_billing@1','event_account_activated','trial');edge('READS_EVENT','trial_rule_product@1',ctx.tenant==='acme'?'event_workspace_first_used':'event_account_activated','trial');}
    if(s.id==='unknown')edge('READS_EVENT','unknown_rule_finance@1','event_settled','unknown');
    const memoryId=`memory_scope_${s.id}`;
    node('Memory',{id:memoryId,kind:'semantic',title:`Reviewed scope · ${s.term}`,body:`${s.obligation.text} Scope: ${s.scope}. This fixture supplies a reviewed starting interpretation, not a learned resolution.`,scope:s.scope,scenarioId:s.id,source:'reviewed synthetic fixture',versions:{scenarioRevision:1},applicable:true,outcome:'reviewed_scope'});edge('APPLIES_TO',memoryId,s.id,s.id);
  }
  node('Memory',{id:'memory_procedure_baseline',kind:'procedural',title:'Investigate before coordinating',body:'Read the shared obligation and exact source revisions. Search the finite domain. Open a case only for a concrete violation. Route to graph-linked owners. A decision creates human tasks; implementation requires evidence and a new verification.',scope:`${ctx.tenant}:workspace`,source:'curated starting procedure',outcome:'baseline',applicable:true});
  node('Session',{id:'conversation',title:'Workspace conversation',tenant:ctx.tenant});edge('HAS_SESSION','workspace','conversation');
  node('AuditEvent',{id:'audit_workspace_created',action:'workspace.created',actor:'System',timestamp,title:'Private synthetic workspace initialized',details:{scenarioCount:6,tenant:ctx.tenant}});edge('AFFECTED','audit_workspace_created','workspace');
  const params={workspaceName:ctx.tenant==='acme'?'Acme Orbit':'Nova Labs',tenant:ctx.tenant,timestamp};
  const statements=["MATCH (w:Workspace {id:'workspace'}) WHERE w.seedVersion=0 SET w.seedVersion=1, w.name=$workspaceName, w.title=$workspaceName, w.tenant=$tenant, w.revision=1, w.createdAt=$timestamp, w.type='Workspace'"];
  for(const [type,rows] of Object.entries(nodeGroups)) {params[`nodes${type}`]=rows;statements.push(`FOREACH (row IN $nodes${type} | MERGE (n:Entity:${type} {id:row.id}) SET n += row)`);}
  for(const [type,rows] of Object.entries(edgeGroups)) {params[`edges${type}`]=rows;statements.push(`FOREACH (row IN $edges${type} | MERGE (a:Entity {id:row.source}) MERGE (b:Entity {id:row.target}) MERGE (a)-[r:${type}]->(b) SET r.id=row.id,r.scenarioId=row.scenarioId)`);}
  statements.push('RETURN w.id AS id');
  await query(ctx,statements.join('\n'),params,{timeout:15000});
}

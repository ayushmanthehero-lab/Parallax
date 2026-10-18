import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import * as service from '@/lib/server/service.mjs';
import { investigate, chat, getAgentConfiguration } from '@/lib/server/agents.mjs';
import { handleMcpRequest } from '@/lib/server/mcp.mjs';
import { getVerification, runVerification } from '@/lib/server/verification.mjs';
import { connectionStatus } from '@/lib/server/db.mjs';
import { sessionFor, sessionCookie, contextFor, checkOrigin, checkAccess } from '@/lib/server/session.mjs';
import { AppError } from '@/lib/server/util.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function redact(value: unknown): unknown {
  if(Array.isArray(value))return value.map(redact);
  if(value && typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!['leaseToken','payloadHash','graphName','visitor'].includes(key)).map(([key,v])=>[key,redact(v)]));
  return value;
}
async function jsonBody(request: NextRequest) {
  const text=await request.text();
  if(text.length>32768)throw new AppError('INPUT_TOO_LARGE','This request exceeds the workspace input limit.',413);
  let value;try{value=JSON.parse(text || '{}');}catch{throw new AppError('INVALID_JSON','The request body must be JSON.',400);}
  if(!value || Array.isArray(value) || typeof value!=='object')throw new AppError('INVALID_INPUT','The request body must be an object.',400);
  return value;
}
async function handle(request: NextRequest, route: {params:Promise<{path:string[]}>}) {
  let context: ReturnType<typeof sessionFor> | undefined;
  try {
    const {path}=await route.params;
    const method=request.method;
    context=sessionFor(request);
    if(method!=='GET')checkOrigin(request);
    checkAccess(request);
    const reply=(data:unknown,status=200)=>{const response=NextResponse.json({ok:true,data:redact(data)},{status});response.headers.set('Cache-Control','private, no-store');response.headers.set('Set-Cookie',sessionCookie(context!));return response;};
    if(path[0]==='mcp') {
      const configured=process.env.PARALLAX_MCP_TOKEN;
      if(!configured)throw new AppError('MCP_NOT_CONFIGURED','Configure the external MCP bearer token to enable this endpoint. Internal MCP tools are available in the app.',503);
      const supplied=request.headers.get('authorization')?.replace(/^Bearer /i,'')??'';
      if(supplied.length!==configured.length || !timingSafeEqual(Buffer.from(supplied),Buffer.from(configured)) || context.isNew)throw new AppError('MCP_AUTH_REQUIRED','Use the external MCP bearer token and a current workspace session.',401);
      return await handleMcpRequest(context,request);
    }
    if(method==='GET') {
      if(path[0]==='health')return reply({...(await connectionStatus()),...getAgentConfiguration(),synthetic:true,externalMcpConfigured:Boolean(process.env.PARALLAX_MCP_TOKEN)});
      if(path[0]==='bootstrap')return reply(await service.bootstrap(context));
      if(path[0]==='graph')return reply(await service.graphData(context,{scenarioId:request.nextUrl.searchParams.get('scenarioId')??undefined,q:request.nextUrl.searchParams.get('q')??undefined}));
      if(path[0]==='scenarios' && path[1])return reply(await service.getScenario(context,path[1]));
      if(path[0]==='cases')return reply(path[1]?await service.getCase(context,path[1]):await service.listCases(context));
      if(path[0]==='tasks')return reply(await service.listTasks(context));
      if(path[0]==='runs')return reply(await service.listRuns(context));
      if(path[0]==='sources')return reply(await service.listSources(context));
      if(path[0]==='memory')return reply(await service.listMemory(context));
      if(path[0]==='chat')return reply(await service.listMessages(context));
      if(path[0]==='audit')return reply(await service.listAudit(context));
      if(path[0]==='verification')return reply(await getVerification(context));
    }
    if(method==='POST') {
      const body=await jsonBody(request);
      if(path[0]==='workspace') {
        const tenant=body.tenant??context.tenant;
        context={...context,...contextFor(context.visitor,tenant)};
        if(body.reset===true)await service.resetWorkspace(context);
        return reply(await service.bootstrap(context));
      }
      if(path[0]==='investigate')return reply(await investigate(context,body));
      if(path[0]==='chat')return reply(await chat(context,body));
      if(path[0]==='intake')return reply(await service.intake(context,body));
      if(path[0]==='interpretations' && path[1] && path[2]==='review')return reply(await service.reviewInterpretation(context,path[1],body));
      if(path[0]==='cases' && path[1] && path[2]==='decision')return reply(await service.approveDecision(context,path[1],body));
      if(path[0]==='cases' && path[1] && path[2]==='verify')return reply(await service.verifyCase(context,path[1],body));
      if(path[0]==='tasks' && path[1] && path[2]==='complete')return reply(await service.completeTask(context,path[1],body));
      if(path[0]==='verification')return reply(await runVerification(context));
    }
    throw new AppError('NOT_FOUND','This workspace endpoint does not exist.',404);
  } catch(error:unknown) {
    const e=error as {code?:string;status?:number;message?:string;details?:unknown};
    const status=Number.isInteger(e.status)?e.status!:500;
    const response=NextResponse.json({ok:false,error:{code:e.code??'INTERNAL_ERROR',message:e.code?e.message:'The operation could not be completed. Please try again.',...(e.details?{details:redact(e.details)}:{})}},{status});
    response.headers.set('Cache-Control','private, no-store');
    if(context)response.headers.set('Set-Cookie',sessionCookie(context));
    return response;
  }
}
export const GET=handle;
export const POST=handle;
export const DELETE=handle;

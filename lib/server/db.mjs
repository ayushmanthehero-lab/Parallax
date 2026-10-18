import { FalkorDB } from 'falkordb';
import { AppError } from './util.mjs';
import { createHttpDatabase } from './http-db.mjs';

const stateKey = Symbol.for('parallax.database');
const state = globalThis[stateKey] ??= {promise:null, lastError:null};
export async function database() {
  if (!state.promise) {
    state.promise = (async () => {
      if (process.env.FALKORDB_HTTP_URL) {
        const db = createHttpDatabase();
        state.lastError = null;
        return db;
      }
      const socketPath = process.env.FALKORDB_SOCKET || (!process.env.VERCEL && !process.env.FALKORDB_HOST ? '/tmp/parallax-falkordb/redis.sock' : undefined);
      const host = process.env.FALKORDB_HOST;
      if (!socketPath && !host) throw new AppError('DATABASE_NOT_CONFIGURED', 'Connect a persistent FalkorDB instance to enable this workspace.', 503);
      const socket = socketPath ? {path:socketPath,connectTimeout:4000,reconnectStrategy:false} : {
        host,port:Number(process.env.FALKORDB_PORT || 6379),tls:process.env.FALKORDB_TLS === 'true',
        connectTimeout:5000,reconnectStrategy:false
      };
      const db = await FalkorDB.connect({socket,username:process.env.FALKORDB_USERNAME || undefined,password:process.env.FALKORDB_PASSWORD || undefined});
      db.on('error', () => { state.lastError = 'The graph connection was interrupted.'; state.promise = null; });
      state.lastError = null;
      return db;
    })().catch(error => { state.promise = null; if (error instanceof AppError) throw error; throw new AppError('DATABASE_UNAVAILABLE', 'FalkorDB is unavailable. Check the connection and try again.', 503); });
  }
  return state.promise;
}
export async function graphFor(context) {
  if (!context?.graphName || !/^parallax_[a-f0-9]{24,40}$/.test(context.graphName)) throw new AppError('INVALID_WORKSPACE', 'A server-selected workspace is required.', 403);
  return (await database()).selectGraph(context.graphName);
}
export async function query(context, cypher, params = {}, {readOnly = false, timeout = 5000} = {}) {
  const graph = await graphFor(context);
  try {
    const reply = await graph[readOnly ? 'roQuery' : 'query'](cypher, {params, TIMEOUT:timeout});
    return reply.data ?? [];
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('GRAPH_QUERY_FAILED', 'The graph operation could not be completed.', 503, process.env.NODE_ENV === 'production' ? undefined : {reason:error.message});
  }
}
export async function connectionStatus() {
  const db = await database();
  if (typeof db.getStatus === 'function') return db.getStatus();
  const client = await db.connection;
  const [pong, modules, persistence] = await Promise.all([
    client.ping(), client.sendCommand(['MODULE','LIST']).catch(()=>[]), client.sendCommand(['INFO','persistence']).catch(()=>'')
  ]);
  let version = 'connected';
  for (const module of modules ?? []) {
    if (Array.isArray(module)) { const data=Object.fromEntries(Array.from({length:Math.floor(module.length/2)},(_,i)=>[String(module[i*2]),module[i*2+1]])); if (/graph/i.test(data.name ?? '')) version=String(data.ver); }
    else if (/graph/i.test(module.name ?? '')) version=String(module.ver);
  }
  const p=String(persistence);
  const aof=/aof_enabled:1/.test(p);
  return {status:'connected',engine:'FalkorDB',version,persistent:aof || process.env.FALKORDB_PERSISTENCE === 'managed',
    persistence:aof?'append-only log':process.env.FALKORDB_PERSISTENCE === 'managed'?'managed persistence (deployment configuration)':'snapshots / host durability unconfirmed',
    transport:process.env.FALKORDB_SOCKET || (!process.env.VERCEL && !process.env.FALKORDB_HOST)?'local Unix socket':process.env.FALKORDB_TLS==='true'?'TLS':'TCP',
    checkedAt:new Date().toISOString(),ping:pong};
}
export async function closeDatabase() { const promise=state.promise;state.promise=null;if(promise)await(await promise).close(); }

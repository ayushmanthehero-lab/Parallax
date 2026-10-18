import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';

const GRAPH_NAME = /^parallax_[a-f0-9]{24,40}$/;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_QUERY_BYTES = 256 * 1024;
const MAX_QUERY_TIMEOUT = 15000;
const OPERATIONS = new Set(['query', 'ro-query', 'range-index', 'fulltext-index', 'constraint']);

class GatewayError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}

export function validateGatewayToken(token) {
  if (typeof token !== 'string' || Buffer.byteLength(token) < 32 || Buffer.byteLength(token) > 1024 || /\s/.test(token)) {
    throw new Error('FALKORDB_GATEWAY_TOKEN must be a private token of at least 32 bytes without whitespace.');
  }
  return token;
}

function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function requireKeys(value, allowed) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new GatewayError('INVALID_REQUEST', 'The operation has invalid fields.');
}
function identifier(value) {
  if (typeof value !== 'string' || !IDENTIFIER.test(value) || ['__proto__', 'constructor', 'prototype'].includes(value)) throw new GatewayError('INVALID_IDENTIFIER', 'A valid graph schema or parameter identifier is required.');
  return value;
}
function validateParams(value, depth = 0) {
  if (depth > 32) throw new GatewayError('INVALID_PARAMETERS', 'Query parameters are nested too deeply.');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) { for (const item of value) validateParams(item, depth + 1); return; }
  if (object(value)) { for (const [key, item] of Object.entries(value)) { identifier(key); validateParams(item, depth + 1); } return; }
  throw new GatewayError('INVALID_PARAMETERS', 'Query parameters must be finite JSON values.');
}
function schema(body, constraint = false) {
  requireKeys(body, constraint ? ['label', 'properties', 'constraintType', 'entityType'] : ['label', 'properties']);
  identifier(body.label);
  if (!Array.isArray(body.properties) || body.properties.length < 1 || body.properties.length > 16) throw new GatewayError('INVALID_SCHEMA', 'One to sixteen indexed properties are required.');
  body.properties.forEach(identifier);
  if (constraint && (!['UNIQUE', 'MANDATORY'].includes(body.constraintType) || body.entityType !== 'NODE')) throw new GatewayError('INVALID_CONSTRAINT', 'Only supported node constraints can be created.');
}

async function readJson(request) {
  if (!/^application\/json(?:\s*;.*)?$/i.test(request.headers['content-type'] || '') || (request.headers['content-encoding'] && request.headers['content-encoding'] !== 'identity')) {
    throw new GatewayError('UNSUPPORTED_MEDIA_TYPE', 'An uncompressed application/json body is required.', 415);
  }
  const length = request.headers['content-length'];
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) throw new GatewayError('BODY_TOO_LARGE', 'The request body exceeds 2 MiB.', 413);
  return new Promise((resolve, reject) => {
    let chunks = [], bytes = 0, settled = false;
    const fail = error => {
      if (settled) return;
      settled = true; chunks = [];
      request.removeListener('data', onData);
      request.resume();
      reject(error);
    };
    const onData = chunk => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) return fail(new GatewayError('BODY_TOO_LARGE', 'The request body exceeds 2 MiB.', 413));
      chunks.push(chunk);
    };
    request.on('data', onData);
    request.once('aborted', () => fail(new GatewayError('REQUEST_ABORTED', 'The request was interrupted.', 400)));
    request.once('error', () => fail(new GatewayError('REQUEST_ABORTED', 'The request was interrupted.', 400)));
    request.once('end', () => {
      if (settled) return;
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!object(body)) throw new Error('object required');
        settled = true; resolve(body);
      } catch { fail(new GatewayError('INVALID_JSON', 'A valid JSON object is required.')); }
    });
  });
}

function respond(response, status, body) {
  const json = JSON.stringify(body);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-length': Buffer.byteLength(json) });
  response.end(json);
}

function databaseError(error, operation) {
  const message = String(error?.message || '');
  if (['range-index', 'fulltext-index', 'constraint'].includes(operation) && /already|exist|indexed/i.test(message)) return new GatewayError('SCHEMA_EXISTS', 'The requested schema item already exists.', 409);
  if (/timeout|timed.out/i.test(message)) return new GatewayError('QUERY_TIMEOUT', 'The graph operation exceeded its timeout.', 504);
  if (operation === 'ro-query' && /read.?only|write|mutation/i.test(message)) return new GatewayError('READ_ONLY_VIOLATION', 'A read-only query cannot perform a mutation.', 422);
  return new GatewayError('DATABASE_OPERATION_FAILED', 'FalkorDB could not complete this operation.', 503);
}

async function statusFor(db, durableVolume) {
  const connection = await db.connection;
  const [pong, modules, persistence] = await Promise.all([
    connection.ping(), connection.sendCommand(['MODULE', 'LIST']), connection.sendCommand(['INFO', 'persistence']),
  ]);
  let version;
  for (const module of modules || []) {
    const values = Array.isArray(module) ? Object.fromEntries(Array.from({ length: Math.floor(module.length / 2) }, (_, i) => [String(module[i * 2]), module[i * 2 + 1]])) : module;
    if (/graph/i.test(String(values.name || ''))) version = String(values.ver);
  }
  if (pong !== 'PONG' || !version) throw new Error('FalkorDB is not ready.');
  const aof = /(?:^|\r?\n)aof_enabled:1(?:\r?\n|$)/.test(String(persistence));
  const healthyAof = !/(?:aof_last_write_status|aof_last_bgrewrite_status):err/.test(String(persistence));
  return {
    status: 'connected', engine: 'FalkorDB', version, ping: pong,
    persistent: aof && healthyAof && durableVolume,
    persistence: aof ? `append-only log${durableVolume ? ' on attached volume' : ' / host durability unconfirmed'}` : 'append-only log disabled',
    persistenceHealthy: healthyAof, storage: durableVolume ? 'attached volume (deployment configuration)' : 'unconfirmed',
    transport: 'HTTP gateway / private Unix socket', checkedAt: new Date().toISOString(),
  };
}

/** The injected database must be the official connected FalkorDB client. */
export function createGatewayServer({ db, token = process.env.FALKORDB_GATEWAY_TOKEN, durableVolume = false } = {}) {
  validateGatewayToken(token);
  if (!db?.selectGraph || !db?.connection) throw new Error('A connected FalkorDB client is required.');
  const expected = createHash('sha256').update(token).digest();
  const authorized = request => {
    const header = request.headers.authorization;
    const candidate = typeof header === 'string' && header.startsWith('Bearer ') && header.length <= 1031 ? header.slice(7) : '';
    return timingSafeEqual(expected, createHash('sha256').update(candidate).digest());
  };
  const server = createServer({ maxHeaderSize: 8192, requestTimeout: 25000, headersTimeout: 10000, keepAliveTimeout: 5000 }, async (request, response) => {
    let operation;
    try {
      const url = new URL(request.url, 'http://gateway.local');
      if (request.method === 'GET' && url.pathname === '/health' && !url.search) {
        try {
          const connection = await db.connection;
          if (await connection.ping() !== 'PONG') throw new Error('Not ready');
          respond(response, 200, { status: 'ready' });
        } catch { respond(response, 503, { status: 'unavailable' }); }
        return;
      }
      if (!authorized(request)) throw new GatewayError('UNAUTHORIZED', 'A valid gateway bearer token is required.', 401);
      if (url.search) throw new GatewayError('INVALID_REQUEST', 'URL query parameters are not supported.');
      if (request.method === 'GET' && url.pathname === '/v1/status') { respond(response, 200, await statusFor(db, durableVolume)); return; }
      const route = /^\/v1\/graphs\/([^/]+)(?:\/([^/]+))?$/.exec(url.pathname);
      if (!route) throw new GatewayError('NOT_FOUND', 'This gateway operation does not exist.', 404);
      const [, graphName, name] = route;
      if (!GRAPH_NAME.test(graphName)) throw new GatewayError('INVALID_WORKSPACE', 'A server-selected workspace graph is required.', 403);
      operation = name;
      if (request.method === 'DELETE' && !name) {
        await db.selectGraph(graphName).delete();
        respond(response, 200, { result: null }); return;
      }
      if (request.method !== 'POST' || !OPERATIONS.has(name)) throw new GatewayError('NOT_FOUND', 'This gateway operation does not exist.', 404);
      const body = await readJson(request);
      const graph = db.selectGraph(graphName);
      let result;
      switch (name) {
        case 'query': case 'ro-query': {
          requireKeys(body, ['query', 'params', 'timeout']);
          if (typeof body.query !== 'string' || !body.query.trim() || Buffer.byteLength(body.query) > MAX_QUERY_BYTES) throw new GatewayError('INVALID_QUERY', 'A query of at most 256 KiB is required.');
          const timeout = body.timeout === undefined ? 5000 : body.timeout;
          if (!Number.isInteger(timeout) || timeout < 1 || timeout > MAX_QUERY_TIMEOUT) throw new GatewayError('INVALID_TIMEOUT', 'Query timeout must be an integer between 1 and 15000 milliseconds.');
          const params = body.params === undefined ? {} : body.params;
          if (!object(params)) throw new GatewayError('INVALID_PARAMETERS', 'Named query parameters must be a JSON object.');
          validateParams(params);
          result = name === 'ro-query' ? await graph.roQuery(body.query, { params, TIMEOUT: timeout }) : await graph.query(body.query, { params, TIMEOUT: timeout });
          break;
        }
        case 'range-index': schema(body); result = await graph.createNodeRangeIndex(body.label, ...body.properties); break;
        case 'fulltext-index': schema(body); result = await graph.createNodeFulltextIndex(body.label, ...body.properties); break;
        case 'constraint': schema(body, true); result = await graph.constraintCreate(body.constraintType, body.entityType, body.label, ...body.properties); break;
      }
      respond(response, 200, { result: result ?? null });
    } catch (cause) {
      const error = cause instanceof GatewayError ? cause : databaseError(cause, operation);
      request.resume();
      if (!request.complete) response.setHeader('connection', 'close');
      if (!response.headersSent) respond(response, error.status, { error: { code: error.code, message: error.message } });
      else response.destroy();
    }
  });
  return server;
}

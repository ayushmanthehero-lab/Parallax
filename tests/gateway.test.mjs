import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FalkorDB, ConstraintType, EntityType } from 'falkordb';

const token = randomBytes(32).toString('base64url');
const graphName = `parallax_${randomBytes(16).toString('hex')}`;
const secondName = `parallax_${randomBytes(16).toString('hex')}`;
let createGatewayServer, createHttpDatabase, server, db, remote, origin;

before(async () => {
  assert.ok(existsSync(new URL('../deploy/gateway/server.mjs', import.meta.url)), 'The authenticated graph gateway is not implemented.');
  assert.ok(existsSync(new URL('../lib/server/http-db.mjs', import.meta.url)), 'The HTTP database adapter is not implemented.');
  ({ createGatewayServer } = await import('../deploy/gateway/server.mjs'));
  ({ createHttpDatabase } = await import('../lib/server/http-db.mjs'));
  db = await FalkorDB.connect({ socket: { path: process.env.FALKORDB_SOCKET || '/tmp/parallax-falkordb/redis.sock', connectTimeout: 4000, reconnectStrategy: false } });
  server = createGatewayServer({ db, token });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  origin = `http://127.0.0.1:${server.address().port}`;
  remote = createHttpDatabase({ url: origin, token });
});

after(async () => {
  if (db) await Promise.allSettled([graphName, secondName].map(name => db.selectGraph(name).delete()));
  if (remote) await remote.close();
  if (server) await new Promise(resolve => server.close(resolve));
  if (db) await db.close();
});

async function request(path, { method = 'POST', body, authorization = `Bearer ${token}`, headers = {} } = {}) {
  const response = await fetch(`${origin}${path}`, {
    method, headers: { ...(authorization ? { authorization } : {}), 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json(), headers: response.headers };
}

test('public health exposes readiness without connection or authentication details', async () => {
  const result = await request('/health', { method: 'GET', authorization: null });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { status: 'ready' });
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal(result.headers.get('access-control-allow-origin'), null);
});

test('every graph operation and detailed status requires the bearer token', async () => {
  for (const [path, method] of [['/v1/status', 'GET'], [`/v1/graphs/${graphName}/query`, 'POST'], [`/v1/graphs/${graphName}`, 'DELETE']]) {
    for (const authorization of [null, 'Bearer wrong', `Bearer ${'x'.repeat(token.length)}`]) {
      const result = await request(path, { method, authorization, body: method === 'POST' ? { query: 'RETURN 1' } : undefined });
      assert.equal(result.status, 401);
      assert.equal(result.body.error.code, 'UNAUTHORIZED');
      assert.equal(JSON.stringify(result.body).includes(token), false);
    }
  }
});

test('gateway and adapter reject missing or short secrets before accepting requests', () => {
  for (const invalid of ['', 'too-short', 'secret with whitespace '.repeat(3)]) {
    assert.throws(() => createGatewayServer({ db, token: invalid }), /token/i);
    assert.throws(() => createHttpDatabase({ url: origin, token: invalid }), /token/i);
  }
});

test('remote adapter requires HTTPS except exact loopback addresses and rejects URL credentials', () => {
  for (const url of ['http://example.com', 'http://127.0.0.1.example.com', 'https://user:password@example.com', 'ftp://localhost', 'https://example.com?token=secret', 'https://example.com/#fragment']) {
    assert.throws(() => createHttpDatabase({ url, token }), /HTTPS|URL|credentials/i);
  }
});

test('graph names are checked by both sides of the HTTP boundary', async () => {
  for (const name of ['trial', 'parallax_abc', 'parallax_ABCDEFABCDEFABCDEFABCDEF', 'other_0123456789abcdef01234567', `${graphName}%2Fquery`]) {
    assert.throws(() => remote.selectGraph(name), /workspace|graph/i);
    const result = await request(`/v1/graphs/${name}/query`, { body: { query: 'RETURN 1' } });
    assert.equal(result.status, 403);
  }
});

test('HTTP graph mutations and reads preserve structured parameters and literal injection-like text', async () => {
  const graph = remote.selectGraph(graphName);
  const value = '\"}) DELETE n // MATCH (x) DETACH DELETE x RETURN \\\"literal\\\"';
  const reply = await graph.query('CREATE (n:Entity:GatewayProof {id:$id,text:$text,items:$items}) RETURN properties(n) AS entity', { params: { id: 'marker', text: value, items: [1, 2, 3] }, TIMEOUT: 5000 });
  assert.deepEqual(reply.data, [{ entity: { id: 'marker', text: value, items: [1, 2, 3] } }]);
  assert.ok(Array.isArray(reply.metadata));
  const read = await graph.roQuery('MATCH (n:GatewayProof {id:$id}) RETURN n.text AS text', { params: { id: 'marker' } });
  assert.deepEqual(read.data, [{ text: value }]);
});

test('GRAPH.RO_QUERY prevents writes on the actual database', async () => {
  const graph = remote.selectGraph(graphName);
  await assert.rejects(() => graph.roQuery("CREATE (n:GatewayForbidden {id:'forbidden'}) RETURN n.id AS id"), /read.only|mutation|operation/i);
  assert.deepEqual((await graph.roQuery('MATCH (n:GatewayForbidden) RETURN count(n) AS count')).data, [{ count: 0 }]);
});

test('separate graph names retain isolated data through HTTP', async () => {
  await remote.selectGraph(secondName).query("CREATE (n:Entity:GatewayProof {id:'second'}) RETURN n.id AS id");
  assert.deepEqual((await remote.selectGraph(secondName).roQuery('MATCH (n:GatewayProof) RETURN n.id AS id')).data, [{ id: 'second' }]);
  assert.deepEqual((await remote.selectGraph(graphName).roQuery('MATCH (n:GatewayProof) RETURN n.id AS id')).data, [{ id: 'marker' }]);
});

test('HTTP schema methods create actual indexes and enforce the unique constraint', async () => {
  const graph = remote.selectGraph(graphName);
  await graph.createNodeRangeIndex('Entity', 'id');
  await graph.constraintCreate(ConstraintType.UNIQUE, EntityType.NODE, 'Entity', 'id');
  await graph.createNodeFulltextIndex('GatewayProof', 'text');
  await assert.rejects(() => graph.query("CREATE (n:Entity {id:'marker'}) RETURN n.id AS id"));
  const indexes = await graph.roQuery('CALL db.indexes() YIELD label,properties,types RETURN label,properties,types');
  assert.ok(indexes.data.some(item => item.label === 'Entity' && item.properties.includes('id')));
  assert.ok(indexes.data.some(item => item.label === 'GatewayProof' && item.properties.includes('text')));
});

test('schema identifiers cannot inject Cypher or select unsupported schema operations', async () => {
  for (const [operation, body] of [
    ['range-index', { label: 'Entity) DELETE n //', properties: ['id'] }],
    ['fulltext-index', { label: 'Entity', properties: ['id) DELETE n //'] }],
    ['constraint', { label: 'Entity', properties: ['id'], constraintType: 'DROP', entityType: 'NODE' }],
    ['constraint', { label: 'Entity', properties: ['id'], constraintType: 'UNIQUE', entityType: 'ALL' }],
  ]) {
    assert.equal((await request(`/v1/graphs/${graphName}/${operation}`, { body })).status, 400);
  }
});

test('the gateway has no arbitrary named SDK method or Redis command endpoint', async () => {
  for (const operation of ['sendCommand', 'configSet', 'copy', 'constructor', '__proto__', 'delete']) {
    assert.equal((await request(`/v1/graphs/${graphName}/${operation}`, { body: { args: ['FLUSHALL'] } })).status, 404);
  }
  assert.equal((await request(`/v1/graphs/${graphName}/query`, { body: { query: 'RETURN 1', command: 'FLUSHALL' } })).status, 400);
});

test('query timeouts must be positive integers no greater than 15000 milliseconds', async () => {
  for (const timeout of [0, -1, 15001, 1.5, '5000', null]) {
    const result = await request(`/v1/graphs/${graphName}/query`, { body: { query: 'RETURN 1', timeout } });
    assert.equal(result.status, 400);
  }
  assert.deepEqual((await remote.selectGraph(graphName).roQuery('RETURN 1 AS value', { TIMEOUT: 15000 })).data, [{ value: 1 }]);
});

test('query parameter names and nested map keys cannot inject SDK-generated Cypher', async () => {
  for (const params of [{ 'x=1 RETURN 1 //': 1 }, { input: { 'x:1} RETURN 1 //': true } }, { input: 1e309 }]) {
    const body = params.input === Infinity ? '{"query":"RETURN $input","params":{"input":1e309}}' : { query: 'RETURN 1', params };
    assert.equal((await request(`/v1/graphs/${graphName}/query`, { body })).status, 400);
  }
});

test('malformed, non-JSON, compressed, and oversized request bodies are rejected', async () => {
  const path = `/v1/graphs/${graphName}/query`;
  assert.equal((await request(path, { body: '{broken' })).status, 400);
  assert.equal((await request(path, { body: '[]' })).status, 400);
  assert.equal((await request(path, { body: '{}', headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await request(path, { body: '{}', headers: { 'content-encoding': 'gzip' } })).status, 415);
  assert.equal((await request(path, { body: { query: 'RETURN 1', params: { large: 'x'.repeat(2 * 1024 * 1024) } } })).status, 413);
});

test('authenticated status reports actual FalkorDB without secrets or a false volume claim', async () => {
  const status = await remote.getStatus();
  assert.equal(status.engine, 'FalkorDB');
  assert.equal(status.status, 'connected');
  assert.equal(status.ping, 'PONG');
  assert.match(status.version, /^\d+$/);
  assert.equal(status.persistent, false, 'Tests did not assert that their Unix socket is backed by a managed volume.');
  assert.equal(JSON.stringify(status).includes(token), false);
  assert.equal(JSON.stringify(status).includes('/tmp/'), false);
});

test('graph deletion removes only the explicitly selected workspace', async () => {
  await remote.selectGraph(secondName).delete();
  assert.ok(!(await db.list()).includes(secondName));
  assert.deepEqual((await remote.selectGraph(graphName).roQuery('MATCH (n:GatewayProof) RETURN n.id AS id')).data, [{ id: 'marker' }]);
});

test('SIGTERM drains an accepted HTTP request before saving and stopping FalkorDB', { timeout: 15000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'parallax-gateway-signal-'));
  const child = spawn(process.execPath, [new URL('../deploy/gateway/main.mjs', import.meta.url).pathname], {
    env: { ...process.env, PORT: '0', FALKORDB_DATA_DIR: dataDir, FALKORDB_GATEWAY_TOKEN: token },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = once(child, 'exit');
  let port, request;
  try {
    port = await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error('Standalone gateway did not become ready.')), 8000);
      child.stdout.on('data', chunk => {
        output += chunk;
        const match = /ready on port (\d+)/.exec(output);
        if (match) { clearTimeout(timer); resolve(Number(match[1])); }
      });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Standalone gateway exited before readiness: ${code}`)); });
    });
    const body = JSON.stringify({ query: "CREATE (n:GatewayDrain {id:'drained'}) RETURN n.id AS id" });
    const reply = new Promise((resolve, reject) => {
      request = httpRequest(`http://127.0.0.1:${port}/v1/graphs/${graphName}/query`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, response => {
        let text = '';
        response.on('data', chunk => { text += chunk; });
        response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(text) }));
      });
      request.on('error', reject);
      request.write(body.slice(0, -1));
    }).catch(error => ({ status: 0, error: error.message }));
    await new Promise(resolve => setTimeout(resolve, 100));
    child.kill('SIGTERM');
    await new Promise(resolve => setTimeout(resolve, 100));
    request.end(body.slice(-1));
    assert.equal((await reply).status, 200, 'SIGTERM stopped the database before the accepted HTTP request drained.');
    const [code, signal] = await exited;
    assert.equal(signal, null);
    assert.equal(code, 0, 'The gateway did not finish its graceful save.');
    assert.ok(existsSync(join(dataDir, 'dump.rdb')), 'Graceful shutdown did not save a snapshot.');
  } finally {
    request?.destroy();
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; }
    await rm(dataDir, { recursive: true, force: true });
  }
});

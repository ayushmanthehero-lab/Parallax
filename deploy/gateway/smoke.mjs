import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startGateway } from './main.mjs';

// An isolated build-time/runtime probe. All data is disposable and never /data.
const dataDir = await mkdtemp(join(tmpdir(), 'parallax-gateway-smoke-'));
const token = randomBytes(32).toString('hex');
const graphName = `parallax_${randomBytes(16).toString('hex')}`;
let gateway;
async function query(query, readOnly = false) {
  const response = await fetch(`http://127.0.0.1:${gateway.server.address().port}/v1/graphs/${graphName}/${readOnly ? 'ro-query' : 'query'}`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query, params: {}, timeout: 5000 }), signal: AbortSignal.timeout(10000),
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  return body.result;
}
try {
  gateway = await startGateway({ dataDir, token, port: 0, host: '127.0.0.1' });
  await query("CREATE (n:GatewaySmoke {id:'saved',value:'acknowledged'}) RETURN n.value AS value");
  await gateway.close(); gateway = null;
  await rm(join(dataDir, 'dump.rdb'), { force: true });
  gateway = await startGateway({ dataDir, token, port: 0, host: '127.0.0.1' });
  assert.deepEqual((await query("MATCH (n:GatewaySmoke {id:'saved'}) RETURN n.value AS value", true)).data, [{ value: 'acknowledged' }]);
  console.log('Gateway smoke passed: official binary, HTTP round trip, shutdown, and AOF-only recovery.');
} finally {
  if (gateway) await gateway.close();
  await rm(dataDir, { recursive: true, force: true });
}

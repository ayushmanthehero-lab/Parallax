import test from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { getScenario } from '../lib/domain/scenarios.mjs';
import { verifyScenario } from '../lib/domain/checker.mjs';

// These tests exercise the actual SDK protocol. Database semantics are covered
// separately by the real FalkorDB integration suite.
const module = await import('../lib/server/mcp.mjs');
const agents = await import('../lib/server/agents.mjs');

const fixtureService = {
  findHandoffs: async (ctx, args) => [{ id: args.scenarioId || 'trial', tenant: ctx.tenant }],
  traceEvidence: async (ctx, args) => ({ scenarioId: args.scenarioId, tenant: ctx.tenant, paths: ['Promise → Obligation → Rule → SourceRevision'] }),
  recallMemory: async ctx => [{ id: `${ctx.tenant}:memory`, kind: 'semantic', applicable: true }],
  checkObligation: async (ctx, args) => ({ id: `${ctx.tenant}:verification`, scenarioId: args.scenarioId, verdict: 'VIOLATED', complete: false, witness: { inputs: { email_verified_day: 0, first_use_day: 7 }, outputs: { first_charge_at: 14, promised_access_until: 21 } } }),
  getAffectedOwners: async ctx => [{ id: `${ctx.tenant}:billing`, departmentId: 'billing' }],
  openCase: async (ctx, args) => ({ id: `${ctx.tenant}:case`, scenarioId: args.scenarioId, verificationId: args.verificationId, status: 'open' }),
};

async function connect(ctx = { tenant: 'acme' }, service = fixtureService, options = {}) {
  assert.equal(typeof module.createMcpServer, 'function', 'MCP server factory must exist');
  const server = module.createMcpServer(ctx, { service, ...options });
  const client = new Client({ name: 'parallax-protocol-tests', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server, close: () => client.close() };
}

function data(result) {
  return result.structuredContent?.data ?? JSON.parse(result.content.find(item => item.type === 'text').text).data;
}

test('MCP negotiation exposes six constrained tools and their argument schemas', async () => {
  const connection = await connect();
  try {
    const { tools } = await connection.client.listTools();
    assert.deepEqual(tools.map(tool => tool.name).sort(), ['affected_owners', 'check_obligation', 'find_handoffs', 'open_clarification', 'recall_memory', 'trace_evidence']);
    const verifier = tools.find(tool => tool.name === 'check_obligation');
    assert.equal(verifier.inputSchema.type, 'object');
    assert.deepEqual(verifier.inputSchema.required, ['scenarioId']);
    assert.equal(verifier.inputSchema.additionalProperties, false);
    assert.ok(!JSON.stringify(tools).includes('graphName'));
  } finally { await connection.close(); }
});

test('real tools/call returns structured evidence from the captured tenant context', async () => {
  const connection = await connect();
  try {
    const result = await connection.client.callTool({ name: 'trace_evidence', arguments: { scenarioId: 'trial' } });
    assert.equal(result.isError, undefined);
    assert.deepEqual(data(result), { scenarioId: 'trial', tenant: 'acme', paths: ['Promise → Obligation → Rule → SourceRevision'] });
  } finally { await connection.close(); }
});

test('MCP rejects a tenant override rather than forwarding it to a service', async () => {
  const connection = await connect();
  try {
    const result = await connection.client.callTool({ name: 'trace_evidence', arguments: { scenarioId: 'trial', tenant: 'nova' } });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /validation|unrecognized|invalid/i);
    assert.ok(!result.structuredContent?.data);
  } finally { await connection.close(); }
});

test('MCP rejects invalid scenario identifiers and nonfinite input before verification', async () => {
  const connection = await connect();
  try {
    const invalid = await connection.client.callTool({ name: 'check_obligation', arguments: { scenarioId: 'MATCH (n) DELETE n' } });
    assert.equal(invalid.isError, true);
    const invalidInput = await connection.client.callTool({ name: 'check_obligation', arguments: { scenarioId: 'trial', inputs: { first_use_day: Infinity } } });
    assert.equal(invalidInput.isError, true);
  } finally { await connection.close(); }
});

test('separate MCP clients never inherit another client’s captured tenant', async () => {
  const a = await connect({ tenant: 'acme' });
  const b = await connect({ tenant: 'nova' });
  try {
    const [left, right] = await Promise.all([
      a.client.callTool({ name: 'recall_memory', arguments: { scenarioId: 'trial' } }),
      b.client.callTool({ name: 'recall_memory', arguments: { scenarioId: 'trial' } }),
    ]);
    assert.equal(data(left)[0].id, 'acme:memory');
    assert.equal(data(right)[0].id, 'nova:memory');
  } finally { await a.close(); await b.close(); }
});

test('MCP receipts preserve returned evidence, tool role and failure status', async () => {
  const receipts = [];
  const connection = await connect({ tenant: 'acme' }, fixtureService, { onToolCall: trace => receipts.push(trace) });
  try {
    const result = await connection.client.callTool({ name: 'check_obligation', arguments: { scenarioId: 'trial' } });
    assert.equal(data(result).witness.outputs.promised_access_until, 21);
    assert.equal(receipts[0].agent, 'verifier');
    assert.equal(receipts[0].status, 'completed');
    assert.equal(receipts[0].result.id, 'acme:verification');
    assert.ok(Number.isFinite(receipts[0].durationMs));
    assert.ok(!Number.isNaN(Date.parse(receipts[0].startedAt)));
  } finally { await connection.close(); }
});

test('unexpected service exceptions return a safe error without connection credentials', async () => {
  const connection = await connect({ tenant: 'acme' }, { ...fixtureService, traceEvidence: async () => { throw new Error('redis://private:password@secret.example:6379'); } });
  try {
    const result = await connection.client.callTool({ name: 'trace_evidence', arguments: { scenarioId: 'trial' } });
    assert.equal(result.isError, true);
    assert.ok(!JSON.stringify(result).includes('password'));
    assert.match(result.content[0].text, /TOOL_FAILED/);
  } finally { await connection.close(); }
});

test('stateless HTTP uses the actual SDK initialization and tools/list protocol', async () => {
  assert.equal(typeof module.handleMcpRequest, 'function', 'Web Standard MCP handler must exist');
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  const initialized = await module.handleMcpRequest({ tenant: 'acme' }, new Request('https://parallax.example/api/mcp', { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }) }), { service: fixtureService });
  assert.equal(initialized.status, 200);
  const first = await initialized.json();
  assert.equal(first.result.serverInfo.name, 'parallax');
  assert.equal(initialized.headers.get('mcp-session-id'), null);
  const listed = await module.handleMcpRequest({ tenant: 'acme' }, new Request('https://parallax.example/api/mcp', { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) }), { service: fixtureService });
  assert.equal(listed.status, 200);
  assert.equal((await listed.json()).result.tools.length, 6);
});

test('model mode is explicit and cannot be inferred from an unconfigured endpoint', () => {
  assert.equal(typeof agents.getAgentMode, 'function', 'Agent mode helper must exist');
  assert.equal(agents.getAgentMode({}), 'guided');
  assert.equal(agents.getAgentMode({ LLM_BASE_URL: 'https://model.example/v1' }), 'guided');
  assert.equal(agents.getAgentMode({ LLM_API_KEY: 'test', LLM_MODEL: 'model', LLM_BASE_URL: 'https://model.example/v1' }), 'model');
});

test('Vercel Gateway mode is selected explicitly and its public configuration contains no credentials', () => {
  assert.equal(agents.getAgentMode({ PARALLAX_AI_PROVIDER: 'vercel-gateway' }), 'model');
  assert.equal(agents.getAgentMode({ VERCEL_OIDC_TOKEN: 'unused-oidc', AI_GATEWAY_API_KEY: 'unused-key' }), 'guided');
  assert.equal(agents.getAgentMode({ PARALLAX_AI_PROVIDER: 'guided', LLM_API_KEY: 'unused-direct-key' }), 'guided');
  assert.equal(typeof agents.getAgentConfiguration, 'function');
  assert.deepEqual(agents.getAgentConfiguration({ PARALLAX_AI_PROVIDER: 'vercel-gateway', AI_GATEWAY_API_KEY: 'never-public' }), {
    mode: 'model', provider: 'vercel-gateway', model: 'openai/gpt-4.1-mini',
  });
  assert.throws(() => agents.getAgentMode({ PARALLAX_AI_PROVIDER: 'misspelled-provider' }), error => error.code === 'MODEL_CONFIGURATION');
});

function orchestrationFixture() {
  const runs = new Map();
  const cases = new Map();
  const messages = [];
  const service = {
    ...fixtureService,
    getScenario: async (ctx, id) => getScenario(id, ctx.tenant),
    checkObligation: async (ctx, args) => {
      const result = verifyScenario(getScenario(args.scenarioId, ctx.tenant), { inputs: args.inputs });
      return { id: `${ctx.tenant}:verification:${args.runId}`, scenarioId: args.scenarioId, result, ...result };
    },
    openCase: async (ctx, args) => {
      const id = `${ctx.tenant}:case:${args.scenarioId}`;
      if (!cases.has(id)) cases.set(id, { id, scenarioId: args.scenarioId, verificationId: args.verificationId, status: 'open' });
      return cases.get(id);
    },
    createAgentRun: async (_ctx, args) => {
      if (runs.has(args.commandId)) return structuredClone(runs.get(args.commandId));
      const run = { id: `run:${args.commandId}`, commandId: args.commandId, mode: args.mode, scenarioId: args.scenarioId, status: 'running', fence: 1, leaseToken: 'opaque-lease', tools: [] };
      runs.set(args.commandId, run);
      return structuredClone(run);
    },
    recordToolCall: async (_ctx, id, trace) => {
      const run = [...runs.values()].find(item => item.id === id);
      assert.equal(trace.fence, run.fence);
      assert.equal(trace.leaseToken, run.leaseToken);
      run.tools.push(structuredClone(trace));
    },
    finishAgentRun: async (_ctx, id, update) => {
      const run = [...runs.values()].find(item => item.id === id);
      assert.equal(update.fence, run.fence);
      assert.equal(update.leaseToken, run.leaseToken);
      Object.assign(run, structuredClone(update));
      return structuredClone(run);
    },
    persistMessage: async (_ctx, message) => { const stored = { id: `message:${messages.length}`, ...message }; messages.push(stored); return stored; },
    listMessages: async () => structuredClone(messages),
  };
  return { service, runs, cases, messages };
}

function successfulModelResponse(options, scenarioId = 'equivalent') {
  const body = JSON.parse(options.body);
  const previousTools = body.messages.filter(message => message.role === 'tool');
  const names = previousTools.length ? ['check_obligation'] : ['find_handoffs', 'trace_evidence', 'recall_memory'];
  return Response.json({
    id: `generation-${previousTools.length}`,
    model: body.model,
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
    choices: [{ message: { role: 'assistant', content: null, tool_calls: names.map((name, index) => ({
      id: `provider-call-${previousTools.length}-${index}`, type: 'function', function: { name, arguments: JSON.stringify({ scenarioId }) },
    })) } }],
  });
}

test('Gateway resolves authentication on every model request and completes actual MCP verification', async () => {
  const fixture = orchestrationFixture();
  const requests = [];
  let tokenReads = 0;
  const orchestrator = agents.createAgentOrchestrator({
    service: fixture.service,
    env: { PARALLAX_AI_PROVIDER: 'vercel-gateway', LLM_API_KEY: 'unrelated-direct-key', LLM_BASE_URL: 'https://unrelated-provider.example/v1' },
    getOidcToken: async () => `fresh-test-oidc-${++tokenReads}`,
    fetchImpl: async (url, options) => { requests.push({ url, options }); return successfulModelResponse(options); },
  });
  const result = await orchestrator.investigate({ tenant: 'acme' }, { scenarioId: 'equivalent', commandId: 'gateway-model' });
  assert.equal(result.mode, 'model');
  assert.equal(result.verification.verdict, 'VALID_WITHIN_BOUND');
  assert.equal(result.case, null);
  assert.equal(requests.length, 2);
  assert.equal(tokenReads, 2);
  assert.deepEqual(requests.map(request => request.url), ['https://ai-gateway.vercel.sh/v1/chat/completions', 'https://ai-gateway.vercel.sh/v1/chat/completions']);
  assert.deepEqual(requests.map(request => request.options.headers.authorization), ['Bearer fresh-test-oidc-1', 'Bearer fresh-test-oidc-2']);
  assert.ok(requests.every(request => JSON.parse(request.options.body).model === 'openai/gpt-4.1-mini'));
  assert.equal(result.modelRequests.length, 2);
  assert.deepEqual(result.modelRequests[0], { provider: 'vercel-gateway', model: 'openai/gpt-4.1-mini', generationId: 'generation-0', usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } });
  assert.ok(!JSON.stringify(result).includes('fresh-test-oidc'));
  assert.ok(!JSON.stringify(fixture.runs.get('gateway-model')).includes('fresh-test-oidc'));
});

test('the installed Vercel OIDC helper reads each request context without sharing a previous request token', async () => {
  const requestContext = new AsyncLocalStorage();
  const symbol = Symbol.for('@vercel/request-context');
  const previous = globalThis[symbol];
  globalThis[symbol] = { get: () => requestContext.getStore() };
  const token = id => `${Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')}.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, sub: id })).toString('base64url')}.test-signature`;
  const tokens = [token('test-request-alpha'), token('test-request-beta')];
  const requests = [];
  const fixture = orchestrationFixture();
  const orchestrator = agents.createAgentOrchestrator({
    service: fixture.service, env: { PARALLAX_AI_PROVIDER: 'vercel-gateway' },
    fetchImpl: async (_url, options) => { requests.push({ command: requestContext.getStore().command, authorization: options.headers.authorization }); return successfulModelResponse(options); },
  });
  try {
    await Promise.all(tokens.map((value, index) => requestContext.run({ headers: { 'x-vercel-oidc-token': value }, command: `oidc-request-${index}` }, () =>
      orchestrator.investigate({ tenant: 'acme' }, { scenarioId: 'equivalent', commandId: `oidc-request-${index}` }))));
    for (let index = 0; index < tokens.length; index += 1) {
      const ownRequests = requests.filter(request => request.command === `oidc-request-${index}`);
      assert.equal(ownRequests.length, 2);
      assert.ok(ownRequests.every(request => request.authorization === `Bearer ${tokens[index]}`));
    }
  } finally {
    if (previous === undefined) delete globalThis[symbol];
    else globalThis[symbol] = previous;
  }
});

test('an explicit Gateway API key takes precedence without borrowing direct-provider credentials', async () => {
  const fixture = orchestrationFixture();
  const authorization = [];
  const orchestrator = agents.createAgentOrchestrator({
    service: fixture.service,
    env: { PARALLAX_AI_PROVIDER: 'vercel-gateway', AI_GATEWAY_MODEL: 'openai/gpt-4.1-mini', AI_GATEWAY_API_KEY: 'gateway-test-key', LLM_API_KEY: 'direct-test-key' },
    getOidcToken: async () => { throw new Error('An explicit gateway key must not read OIDC'); },
    fetchImpl: async (_url, options) => { authorization.push(options.headers.authorization); return successfulModelResponse(options); },
  });
  const result = await orchestrator.investigate({ tenant: 'acme' }, { scenarioId: 'equivalent', commandId: 'gateway-key' });
  assert.equal(result.run.status, 'completed');
  assert.deepEqual(authorization, ['Bearer gateway-test-key', 'Bearer gateway-test-key']);
  assert.ok(!JSON.stringify(result).includes('gateway-test-key'));
});

test('missing Gateway authentication persists a clear failed model run without substituting guided work', async () => {
  const fixture = orchestrationFixture();
  let requests = 0;
  const orchestrator = agents.createAgentOrchestrator({
    service: fixture.service, env: { PARALLAX_AI_PROVIDER: 'vercel-gateway' },
    getOidcToken: async () => { throw new Error('private-context-and-credential-details'); },
    fetchImpl: async () => { requests += 1; throw new Error('No request should be sent without authentication'); },
  });
  await assert.rejects(() => orchestrator.investigate({ tenant: 'acme' }, { scenarioId: 'equivalent', commandId: 'missing-gateway-auth' }), error => {
    assert.equal(error.code, 'MODEL_AUTHENTICATION');
    assert.ok(!error.message.includes('private-context'));
    return true;
  });
  const failed = fixture.runs.get('missing-gateway-auth');
  assert.equal(failed.mode, 'model');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.tools.length, 0);
  assert.equal(requests, 0);
  assert.equal(fixture.cases.size, 0);
});

test('OIDC authentication respects the remaining agent deadline even when its token source stalls', async () => {
  const { resolveModelConnection } = await import('../lib/server/model-provider.mjs');
  await assert.rejects(() => resolveModelConnection({
    env: { PARALLAX_AI_PROVIDER: 'vercel-gateway' },
    getOidcToken: () => new Promise(resolve => setTimeout(() => resolve('too-late-token'), 100)),
    deadline: Date.now() + 20,
  }), error => error.code === 'MODEL_AUTHENTICATION_TIMEOUT');
});

for (const [status, type, code] of [
  [401, 'invalid_api_key', 'MODEL_AUTHENTICATION'],
  [403, 'customer_verification_required', 'MODEL_CUSTOMER_VERIFICATION'],
  [402, 'insufficient_funds', 'MODEL_CREDITS_EXHAUSTED'],
  [402, 'quota_for_entity_exceeded', 'MODEL_BUDGET_EXHAUSTED'],
  [429, 'rate_limit_exceeded', 'MODEL_RATE_LIMITED'],
]) {
  test(`Gateway ${type} is an explicit model error with no raw provider details or fallback`, async () => {
    const fixture = orchestrationFixture();
    const orchestrator = agents.createAgentOrchestrator({
      service: fixture.service, env: { PARALLAX_AI_PROVIDER: 'vercel-gateway' },
      getOidcToken: async () => 'test-oidc',
      fetchImpl: async () => Response.json({ error: { type, message: 'private-provider-details test-oidc' } }, { status }),
    });
    await assert.rejects(() => orchestrator.investigate({ tenant: 'acme' }, { scenarioId: 'equivalent', commandId: `gateway-error-${status}-${type}` }), error => {
      assert.equal(error.code, code);
      assert.ok(!error.message.includes('private-provider-details'));
      assert.ok(!error.message.includes('test-oidc'));
      return true;
    });
    const failed = fixture.runs.get(`gateway-error-${status}-${type}`);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.mode, 'model');
    assert.equal(failed.tools.length, 0);
    assert.equal(fixture.cases.size, 0);
  });
}

test('guided investigation uses real MCP results, persists guards, and replays one durable case', async () => {
  assert.equal(typeof agents.createAgentOrchestrator, 'function', 'Agent orchestrator must exist');
  const fixture = orchestrationFixture();
  const orchestrator = agents.createAgentOrchestrator({ service: fixture.service, env: {} });
  const result = await orchestrator.investigate({ tenant: 'acme' }, { scenarioId: 'trial', commandId: 'same-command' });
  assert.equal(result.mode, 'guided');
  assert.equal(result.verification.verdict, 'VIOLATED');
  assert.equal(result.case.status, 'open');
  assert.equal(result.run.status, 'completed');
  assert.equal(result.tools.find(tool => tool.tool === 'check_obligation').result.id, result.verification.id);
  assert.equal(result.tools.find(tool => tool.tool === 'recall_memory').result[0].id, 'acme:memory');
  const restored = agents.createAgentOrchestrator({ service: fixture.service, env: {} });
  const replay = await restored.investigate({ tenant: 'acme' }, { scenarioId: 'trial', commandId: 'same-command' });
  assert.equal(replay.case.id, result.case.id);
  assert.equal(replay.replayed, true);
  assert.equal(fixture.cases.size, 1);
});

test('a compatible control or missing evidence never opens a clarification case', async () => {
  assert.equal(typeof agents.createAgentOrchestrator, 'function', 'Agent orchestrator must exist');
  const fixture = orchestrationFixture();
  const orchestrator = agents.createAgentOrchestrator({ service: fixture.service, env: {} });
  const compatible = await orchestrator.investigate({ tenant: 'acme' }, { scenarioId: 'equivalent', commandId: 'compatible' });
  const unknown = await orchestrator.investigate({ tenant: 'acme' }, { scenarioId: 'unknown', commandId: 'unknown' });
  assert.equal(compatible.verification.verdict, 'VALID_WITHIN_BOUND');
  assert.equal(unknown.verification.verdict, 'UNKNOWN');
  assert.equal(compatible.case, null);
  assert.equal(unknown.case, null);
  assert.equal(fixture.cases.size, 0);
});

test('model-selected case creation is rejected without a real matching verification', async () => {
  assert.equal(typeof agents.createAgentOrchestrator, 'function', 'Agent orchestrator must exist');
  const fixture = orchestrationFixture();
  const orchestrator = agents.createAgentOrchestrator({
    service: fixture.service,
    env: { LLM_API_KEY: 'test-key', LLM_MODEL: 'test-model', LLM_BASE_URL: 'https://model.example/v1' },
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      const alreadyRejected = body.messages.some(message => message.role === 'tool');
      return Response.json({ choices: [{ message: alreadyRejected ? { role: 'assistant', content: 'I have no verification.' } : { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'open_clarification', arguments: JSON.stringify({ scenarioId: 'trial', verificationId: 'invented' }) } }] } }] });
    },
  });
  await assert.rejects(() => orchestrator.investigate({ tenant: 'acme' }, { scenarioId: 'trial', commandId: 'unverified-model-action' }), error => error.code === 'AGENT_INCOMPLETE');
  assert.equal(fixture.cases.size, 0);
  assert.equal(fixture.runs.get('unverified-model-action').status, 'failed');
});

function modelWithVerifierInputs(service, verifierInputs, feedback) {
  return agents.createAgentOrchestrator({
    service,
    env: { LLM_API_KEY: 'test-key', LLM_MODEL: 'test-model', LLM_BASE_URL: 'https://model.example/v1' },
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      const responses = body.messages.filter(message => message.role === 'tool');
      if (responses.length) {
        feedback.push(...responses.map(message => JSON.parse(message.content)));
        return Response.json({ choices: [{ message: { role: 'assistant', content: 'The selected calls are finished.' } }] });
      }
      const calls = ['find_handoffs', 'trace_evidence', 'recall_memory', 'check_obligation'].map((name, index) => ({
        id: `bound_call_${index}`, type: 'function', function: {
          name,
          arguments: JSON.stringify({ scenarioId: 'trial', ...(name === 'check_obligation' && verifierInputs !== undefined ? { inputs: verifierInputs } : {}) }),
        },
      }));
      return Response.json({ choices: [{ message: { role: 'assistant', content: null, tool_calls: calls } }] });
    },
  });
}

for (const [name, requestedInputs, modelInputs] of [
  ['a full-domain request narrowed to a passing point', undefined, { email_verified_day: 0, first_use_day: 0 }],
  ['an explicit requested witness changed to a passing point', { email_verified_day: 0, first_use_day: 7 }, { email_verified_day: 0, first_use_day: 0 }],
  ['an explicit input omitted by the model', { email_verified_day: 0, first_use_day: 7 }, undefined],
]) {
  test(`model cannot substitute the verification bound: ${name}`, async () => {
    const fixture = orchestrationFixture();
    const feedback = [];
    const orchestrator = modelWithVerifierInputs(fixture.service, modelInputs, feedback);
    await assert.rejects(() => orchestrator.investigate({ tenant: 'acme' }, {
      scenarioId: 'trial', commandId: 'model-bound', ...(requestedInputs !== undefined ? { inputs: requestedInputs } : {}),
    }), error => error.code === 'AGENT_INCOMPLETE');
    const persisted = fixture.runs.get('model-bound');
    assert.equal(persisted.status, 'failed');
    assert.equal(persisted.result.verification, null, 'A check with an unauthorized bound must not become verification evidence');
    assert.ok(feedback.some(response => response.error?.code === 'AGENT_INPUT_BOUND_MISMATCH'));
    assert.equal(fixture.cases.size, 0);
  });
}

test('model verification preserves an explicitly requested bound regardless of key order', async () => {
  const fixture = orchestrationFixture();
  const orchestrator = modelWithVerifierInputs(fixture.service, { first_use_day: 0, email_verified_day: 0 }, []);
  const result = await orchestrator.investigate({ tenant: 'acme' }, { scenarioId: 'trial', commandId: 'exact-model-bound', inputs: { email_verified_day: 0, first_use_day: 0 } });
  assert.equal(result.run.status, 'completed');
  assert.equal(result.verification.verdict, 'VALID_WITHIN_BOUND');
  assert.equal(result.verification.domainSize, 1);
  assert.deepEqual(result.tools.find(tool => tool.tool === 'check_obligation').arguments.inputs, { email_verified_day: 0, first_use_day: 0 });
});

test('guided memory chat names applicable memories and discloses rejected reuse', async () => {
  const fixture = orchestrationFixture();
  fixture.service.recallMemory = async () => ({
    accepted: [{ id: 'memory:current', title: 'Honor first-use promise', body: 'Use the approved first workspace-use clock.', applicable: true }],
    rejected: [{ id: 'memory:old', title: 'Retired email clock', applicable: false }],
  });
  const orchestrator = agents.createAgentOrchestrator({ service: fixture.service, env: {} });
  const reply = await orchestrator.chat({ tenant: 'acme' }, { scenarioId: 'trial', message: 'Which memories apply to this handoff?', commandId: 'memory-chat' });
  assert.match(reply.body, /Honor first-use promise/);
  assert.match(reply.body, /1.*rejected|1.*not.*reus/i);
  assert.equal(fixture.cases.size, 0);
  assert.equal(fixture.messages.at(-1).body, reply.body);
});

test('guided human-work chat reports pending cases from connected state', async () => {
  const fixture = orchestrationFixture();
  fixture.service.findHandoffs = async () => [{ id: 'trial', title: 'Trial handoff', cases: [
    { id: 'case:one', title: 'First-use clock', status: 'open' },
    { id: 'case:two', title: 'Audience eligibility', status: 'implementation_pending' },
    { id: 'case:done', title: 'Resolved threshold', status: 'resolved' },
  ] }];
  const orchestrator = agents.createAgentOrchestrator({ service: fixture.service, env: {} });
  const reply = await orchestrator.chat({ tenant: 'acme' }, { scenarioId: 'trial', message: 'What is still waiting on humans?', commandId: 'work-chat' });
  assert.match(reply.body, /2.*clarification/i);
  assert.match(reply.body, /First-use clock/);
  assert.match(reply.body, /Audience eligibility/);
  assert.ok(!reply.body.includes('Resolved threshold'));
  assert.equal(fixture.cases.size, 0);
});

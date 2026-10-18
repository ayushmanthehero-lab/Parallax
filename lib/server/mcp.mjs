import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod/v4';

export const MCP_SERVER_INFO = Object.freeze({ name: 'parallax', version: '1.0.0' });

const identifier = z.string().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);
const scalar = z.union([z.number().finite(), z.boolean(), z.string().max(512)]);
const inputsSchema = z.record(z.string().min(1).max(128).regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/), scalar)
  .refine(value => Object.keys(value).length <= 64, 'At most 64 input fields are allowed')
  .refine(value => !Object.keys(value).some(key => ['__proto__', 'prototype', 'constructor'].includes(key)), 'Reserved input field');

/** Tools accept domain identifiers, never tenant, graph, credential or Cypher input. */
export const TOOL_CATALOG = Object.freeze([
  {
    name: 'find_handoffs', title: 'Find connected handoffs', agent: 'investigator', method: 'findHandoffs', readOnly: true,
    description: 'Discover reviewed cross-department handoffs and their shared obligations in the current workspace. Optionally filter by a scenario ID. Differences only matter when they violate an explicit shared obligation.',
    schema: z.object({ scenarioId: identifier.optional() }).strict(),
  },
  {
    name: 'trace_evidence', title: 'Trace source evidence', agent: 'investigator', method: 'traceEvidence', readOnly: true,
    description: 'Traverse the selected handoff through obligations, definitions, rules, event producers and immutable source revisions. Use this evidence before interpreting a handoff or requesting verification.',
    schema: z.object({ scenarioId: identifier }).strict(),
  },
  {
    name: 'recall_memory', title: 'Recall scoped memory', agent: 'investigator', method: 'recallMemory', readOnly: true,
    description: 'Read episodic, semantic and procedural memory for the selected handoff. The service evaluates tenant, scope and version applicability. Rejected or stale memories are evidence of prior work, not current approved facts.',
    schema: z.object({ scenarioId: identifier }).strict(),
  },
  {
    name: 'check_obligation', title: 'Verify the shared obligation', agent: 'verifier', method: 'checkObligation', readOnly: false,
    description: 'Evaluate reviewed structured rule versions against the explicit shared obligation with a bounded deterministic checker. Persist the result and concrete witness. Returns VIOLATED, VALID_WITHIN_BOUND, NOT_DISPROVED or UNKNOWN; never infer a violation from language alone.',
    schema: z.object({ scenarioId: identifier, inputs: inputsSchema.optional() }).strict(),
  },
  {
    name: 'affected_owners', title: 'Find affected owners', agent: 'coordinator', method: 'getAffectedOwners', readOnly: true,
    description: 'Follow graph ownership and downstream dependencies to find the people and departments affected by the selected handoff. Returns routing evidence; it does not send messages or perform human work.',
    schema: z.object({ scenarioId: identifier }).strict(),
  },
  {
    name: 'open_clarification', title: 'Open a clarification case', agent: 'coordinator', method: 'openCase', readOnly: false,
    description: 'Create or join a durable human clarification case for a persisted VIOLATED verification of the same current scenario revision. Requires that exact verification ID. This does not approve a decision, complete implementation or claim resolution.',
    schema: z.object({ scenarioId: identifier, verificationId: identifier }).strict(),
  },
]);

/** Preserve intentional application errors while hiding infrastructure details. */
export function publicToolError(error) {
  const code = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{2,63}$/.test(error.code) ? error.code : 'TOOL_FAILED';
  const intentional = (Number.isInteger(error?.status) && error.status >= 400 && error.status < 500) || /^(MODEL_|AGENT_|MCP_|RUN_)/.test(code);
  return {
    code,
    message: intentional && typeof error?.message === 'string'
      ? error.message.slice(0, 1200).replace(/(https?:\/\/|rediss?:\/\/)[^\s/@]+:[^\s/@]+@/g, '$1[redacted]@')
      : 'The tool could not complete. Check the workspace connection and retry.',
  };
}

function jsonResult(value) {
  // The graph client may return dates or bigint counters. Protocol output stays JSON.
  return JSON.parse(JSON.stringify(value ?? null, (_key, item) => typeof item === 'bigint' ? item.toString() : item));
}

function resultEnvelope(data, error) {
  const structuredContent = error ? { ok: false, error } : { ok: true, data: jsonResult(data) };
  return {
    content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
    structuredContent,
    ...(error ? { isError: true } : {}),
  };
}

/**
 * Construct one authenticated, tenant-bound MCP server.
 * Authentication is completed by the API before constructing ctx. Callers cannot
 * alter that context through a tool's arguments. `service` also supports embedding
 * this protocol layer in another host without requiring a global singleton.
 */
export function createMcpServer(ctx, options = {}) {
  const server = new McpServer(MCP_SERVER_INFO, {
    instructions: 'PARALLAX coordinates human clarification using connected evidence. Verify an explicit reviewed obligation before opening a case. Never claim human approval, implementation or an unrestricted proof.',
  });
  let servicePromise;
  const getService = () => options.service ? Promise.resolve(options.service) : (servicePromise ||= import('./service.mjs'));

  for (const tool of TOOL_CATALOG) {
    server.registerTool(tool.name, {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.schema,
      annotations: { readOnlyHint: tool.readOnly, destructiveHint: false, idempotentHint: tool.name === 'open_clarification' || tool.readOnly, openWorldHint: false },
    }, async args => {
      const startedAt = new Date().toISOString();
      const started = performance.now();
      let service;
      let standaloneRun;
      let value;
      let error;
      try {
        service = await getService();
        if (options.persistStandalone && !options.runId) {
          standaloneRun = await service.createAgentRun(ctx, {
            scenarioId: args.scenarioId ?? null,
            commandId: `mcp_${randomUUID()}`,
            mode: 'external_mcp',
            payload: { tool: tool.name, arguments: args },
          });
        }
        const runId = options.runId || standaloneRun?.id;
        const guard = standaloneRun ? { fence: standaloneRun.fence, leaseToken: standaloneRun.leaseToken } : options.guard;
        const serviceArgs = { ...args, ...(runId && ['checkObligation', 'openCase'].includes(tool.method) ? { runId, ...guard } : {}) };
        value = jsonResult(await service[tool.method](ctx, serviceArgs));
      } catch (cause) {
        error = publicToolError(cause);
      }
      const trace = {
        id: `tool_${randomUUID()}`,
        tool: tool.name,
        arguments: jsonResult(args),
        result: error ? { error } : value,
        status: error ? 'failed' : 'completed',
        durationMs: Math.max(0, Math.round(performance.now() - started)),
        startedAt,
        agent: tool.agent,
      };
      try {
        if (options.onToolCall) await options.onToolCall(trace);
        if (standaloneRun) {
          const guard = { fence: standaloneRun.fence, leaseToken: standaloneRun.leaseToken };
          await service.recordToolCall(ctx, standaloneRun.id, { ...trace, ...guard });
          await service.finishAgentRun(ctx, standaloneRun.id, {
            status: error ? 'failed' : 'completed',
            result: { tools: [trace], value: value ?? null, mode: 'external_mcp' },
            ...(error ? { error } : {}),
            ...guard,
          });
        }
      } catch (cause) {
        // A tool action is not represented as durably completed if its receipt
        // could not be committed (for example, when a worker loses its lease).
        error = publicToolError(cause);
      }
      return resultEnvelope(value, error);
    });
  }
  return server;
}

/** Negotiate the actual MCP protocol using the SDK's linked transports. */
export async function connectInternalMcp(ctx, options = {}) {
  const server = createMcpServer(ctx, options);
  const client = new Client({ name: 'parallax-agents', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return { client, server, close: () => client.close() };
  } catch (error) {
    await Promise.allSettled([client.close(), server.close()]);
    throw error;
  }
}

/** Unwrap a validated MCP result. No success is inferred from prose. */
export function readToolResult(result) {
  let envelope = result.structuredContent;
  if (!envelope) {
    const text = result.content?.find(item => item.type === 'text')?.text;
    try { envelope = JSON.parse(text); } catch { /* handled below */ }
  }
  if (result.isError || envelope?.ok !== true) {
    const error = new Error(envelope?.error?.message || 'The MCP tool returned an unsuccessful response.');
    error.code = envelope?.error?.code || 'MCP_TOOL_ERROR';
    error.status = 422;
    throw error;
  }
  return envelope.data;
}

/**
 * Native Request → Response endpoint for the Next.js Node runtime.
 * The API layer requires its bearer token and signed workspace session first.
 * A new stateless SDK server handles each request; graph state outlives requests.
 */
export async function handleMcpRequest(ctx, request, options = {}) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Origin is not permitted.' } }, { status: 403 });
  }
  if (request.method !== 'POST') {
    return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Use POST for this stateless MCP endpoint.' } }, { status: 405, headers: { Allow: 'POST' } });
  }
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    maxRequestBodySize: 128 * 1024,
  });
  const server = createMcpServer(ctx, { ...options, persistStandalone: true });
  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    // JSON mode finishes the complete response before this promise resolves.
    // Materializing it permits deterministic cleanup without closing an SSE body.
    const body = await response.arrayBuffer();
    return new Response(body.byteLength ? body : null, { status: response.status, statusText: response.statusText, headers: response.headers });
  } finally {
    await server.close();
  }
}

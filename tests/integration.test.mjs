import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { contextFor } from '../lib/server/session.mjs';
import { graphFor, query, closeDatabase } from '../lib/server/db.mjs';
import * as service from '../lib/server/service.mjs';
import { runVerification, getVerification } from '../lib/server/verification.mjs';

const ctx = contextFor(`integration-${randomUUID()}`, 'acme');
const nova = contextFor(`integration-nova-${randomUUID()}`, 'nova');
let report, baseline;
const reportChecks = [
  ['scenario-verdicts', 'all six reviewed fixture verdicts come from actual stored graph rules'],
  ['evidence-traversal', 'multi-hop evidence traversal reaches source revisions'],
  ['native-shortest-path', 'native shortestPath returns accountable owners'],
  ['concurrent-case-merge', 'concurrent coordinators create exactly one canonical case'],
  ['decision-revision-guard', 'one concurrent approval succeeds and stale revisions fail'],
  ['command-idempotency', 'commands replay safely and reject payload reuse'],
  ['human-task-boundary', 'approval and empty evidence cannot complete human implementation'],
  ['full-domain-resolution', 'completed tasks require a fresh full-domain repair verification'],
  ['source-revision-staleness', 'source updates retain history and invalidate old evidence'],
  ['tenant-isolation', 'scoped definitions, conversations and learned memory stay isolated'],
  ['lease-fencing', 'an expired worker cannot commit through an old fencing token'],
  ['read-only-enforcement', 'GRAPH.RO_QUERY cannot execute a mutation'],
  ['client-restart', 'stored state survives an independent client reconnect'],
  ['concurrent-read-write', 'concurrent graph reads and atomic writes lose no acknowledged data'],
  ['fixture-cleanup', 'the verification lab removes its temporary graphs'],
];

before(async () => {
  await service.ready(ctx);
  const unrun = await getVerification(ctx);
  assert.equal(unrun.status, 'not-run');
  assert.deepEqual(unrun.checks, []);
  await service.persistMessage(ctx, { role: 'user', body: 'This pre-existing visitor message must survive the verification lab.', scenarioId: 'trial' });
  baseline = await query(ctx, 'MATCH (n:Entity) WHERE NOT n:VerificationReport RETURN properties(n) AS entity ORDER BY n.id', {}, { readOnly: true });
  report = await runVerification(ctx);
});

after(async () => {
  await Promise.allSettled([ctx, nova].map(async context => (await graphFor(context)).delete()));
  await closeDatabase();
});

for (const [id, description] of reportChecks) {
  test(description, () => {
    const check = report.checks.find(item => item.id === id);
    assert.ok(check, `The lab did not execute ${id}.`);
    assert.equal(check.passed, true, check.details);
    assert.equal(check.status, 'passed');
  });
}

test('the public verification lab changes no existing visitor entities', async () => {
  const current = await query(ctx, 'MATCH (n:Entity) WHERE NOT n:VerificationReport RETURN properties(n) AS entity ORDER BY n.id', {}, { readOnly: true });
  assert.deepEqual(current, baseline);
  assert.equal(report.status, 'passed', JSON.stringify(report.checks.filter(check => !check.passed)));
});

test('reported concurrency metrics are measured and internally reconcile', () => {
  const metrics = report.concurrency;
  assert.equal(metrics.workers, 16);
  assert.equal(metrics.acceptedWrites, metrics.workers * metrics.writesPerWorker);
  assert.equal(metrics.readOperations, metrics.acceptedWrites);
  assert.equal(metrics.storedReceipts, metrics.acceptedWrites);
  assert.equal(metrics.counterValue, metrics.acceptedWrites);
  assert.equal(metrics.lostAcknowledgedWrites, 0);
  assert.equal(metrics.duplicateCases, 0);
  assert.equal(metrics.guardedWrites, 1);
  assert.equal(metrics.staleRejected, 15);
  assert.ok(metrics.p50Ms > 0);
  assert.ok(metrics.p95Ms >= metrics.p50Ms);
  assert.ok(metrics.maxMs >= metrics.p95Ms);
});

test('the actual report persists across database client restart', async () => {
  await closeDatabase();
  const restored = await getVerification(ctx);
  assert.equal(restored.id, report.id);
  assert.equal(restored.status, 'passed');
  assert.deepEqual(restored.concurrency, report.concurrency);
  assert.equal(restored.checks.length, report.checks.length);
});

test('verification also succeeds when initiated from the second tenant', async () => {
  const second = await runVerification(nova);
  assert.equal(second.status, 'passed', JSON.stringify(second.checks.filter(check => !check.passed)));
  assert.equal(second.tenant, 'nova');
  const trial = await service.getScenario(nova, 'trial');
  assert.equal(trial.revision, 1);
  assert.equal(trial.expectedVerdict, 'VALID_WITHIN_BOUND');
  assert.equal((await service.listCases(nova)).length, 0);
});

test('Cypher-like conversation input is stored literally through parameters', async () => {
  const payload = '"}) DELETE n // MATCH (x) DETACH DELETE x RETURN "literal source text"';
  const beforeCount = (await query(ctx, 'MATCH (n:Entity) RETURN count(n) AS count', {}, { readOnly: true }))[0].count;
  const message = await service.persistMessage(ctx, { role: 'user', body: payload });
  const messages = await service.listMessages(ctx);
  assert.equal(messages.find(item => item.id === message.id).body, payload);
  const afterCount = (await query(ctx, 'MATCH (n:Entity) RETURN count(n) AS count', {}, { readOnly: true }))[0].count;
  assert.equal(afterCount, beforeCount + 1);
});

test('graph access requires a server-derived workspace identifier', async () => {
  await assert.rejects(() => graphFor({ graphName: 'trial' }), error => error.code === 'INVALID_WORKSPACE');
  assert.throws(() => contextFor('visitor', 'arbitrary-tenant'), error => error.code === 'INVALID_TENANT');
  assert.notEqual(contextFor('same-visitor', 'acme').graphName, contextFor('same-visitor', 'nova').graphName);
  assert.notEqual(contextFor('visitor-one', 'acme').graphName, contextFor('visitor-two', 'acme').graphName);
});

test('a passing single-customer check never clears a known full-handoff violation', async () => {
  const context = contextFor(`narrow-bound-${randomUUID()}`, 'acme');
  try {
    const full = await service.checkObligation(context, { scenarioId: 'trial' });
    assert.equal(full.verdict, 'VIOLATED');
    const selected = await service.checkObligation(context, {
      scenarioId: 'trial', inputs: { email_verified_day: 0, first_use_day: 0 },
    });
    assert.equal(selected.verdict, 'VALID_WITHIN_BOUND');
    assert.equal(selected.domainSize, 1);
    const scenario = await service.getScenario(context, 'trial');
    assert.equal(scenario.state, 'VIOLATED');
    assert.ok(scenario.runs.some(run => run.id === full.id && run.verdict === 'VIOLATED'));
    assert.ok(scenario.runs.some(run => run.id === selected.id && run.domainSize === 1));
  } finally { await (await graphFor(context)).delete(); }
});

test('scenario graph views retain runtime case, task, memory and tool relationships', async () => {
  const context = contextFor(`runtime-edges-${randomUUID()}`, 'acme');
  try {
    const verification = await service.checkObligation(context, { scenarioId: 'trial' });
    const opened = await service.openCase(context, { scenarioId: 'trial', verificationId: verification.id });
    const scenario = await service.getScenario(context, 'trial');
    await service.approveDecision(context, opened.id, {
      choice: scenario.resolution.choices[0].id,
      note: 'Synthetic reviewer approval for the runtime graph regression.',
      expectedRevision: opened.revision, commandId: randomUUID(),
    });
    const run = await service.createAgentRun(context, { scenarioId: 'trial', commandId: randomUUID(), mode: 'guided' });
    await service.recordToolCall(context, run.id, {
      tool: 'trace_evidence', args: { scenarioId: 'trial' }, result: { checked: true }, status: 'success',
      fence: run.fence, leaseToken: run.leaseToken,
    });
    const graph = await service.graphData(context, { scenarioId: 'trial' });
    assert.ok(graph.edges.some(edge => edge.source === opened.id && edge.label === 'HAS_TASK'));
    assert.ok(graph.edges.some(edge => edge.target === 'trial' && edge.label === 'APPLIES_TO'));
    assert.ok(graph.edges.some(edge => edge.source === run.id && edge.label === 'USED_TOOL'));
    const visible = new Set(graph.nodes.map(node => node.id));
    assert.ok(graph.edges.every(edge => visible.has(edge.source) && visible.has(edge.target)));
  } finally { await (await graphFor(context)).delete(); }
});

test('a separate FalkorDBLite process recovers graph data from its AOF without an RDB snapshot', {
  skip: process.env.PARALLAX_SKIP_LITE_RESTART === '1' ? 'Local process restart explicitly disabled for this environment.' : false,
  timeout: 30000,
}, async () => {
  const { FalkorDB: FalkorDBLite } = await import('falkordblite');
  const directory = await mkdtemp(join(tmpdir(), 'parallax-aof-proof-'));
  let first, second;
  const options = { path: directory, timeout: 8000, additionalConfig: { appendonly: 'yes', appendfsync: 'always', save: '""' } };
  try {
    first = await FalkorDBLite.open(options);
    const firstPid = first.pid;
    await first.selectGraph('durable_handoff').query("CREATE (d:Decision {id:'approved_mapping',status:'implementation_pending'})-[:REQUIRES]->(t:Task {id:'human_task',state:'pending'}) RETURN d.id AS id");
    await first.close();
    first = null;
    // The orderly close can create dump.rdb. Remove only this disposable fixture
    // snapshot so the next process must recover the graph from its append-only log.
    await rm(join(directory, 'dump.rdb'), { force: true });
    const files = await readdir(directory);
    assert.ok(files.some(file => /appendonly/.test(file)), 'No append-only log was created.');
    assert.ok(!files.includes('dump.rdb'));
    second = await FalkorDBLite.open(options);
    assert.notEqual(second.pid, firstPid);
    const result = await second.selectGraph('durable_handoff').roQuery("MATCH (d:Decision {id:'approved_mapping'})-[:REQUIRES]->(t:Task) RETURN d.status AS decision,t.state AS task");
    assert.deepEqual(result.data, [{ decision: 'implementation_pending', task: 'pending' }]);
  } finally {
    if (first) await first.close();
    if (second) await second.close();
    await rm(directory, { recursive: true, force: true });
  }
});

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { FalkorDB } from 'falkordb';
import { createHttpDatabase } from './http-db.mjs';
import * as service from './service.mjs';
import { contextFor } from './session.mjs';
import { graphFor, query, connectionStatus } from './db.mjs';
import { hydrate, properties, now } from './util.mjs';

const millis = value => Math.round(value * 1000) / 1000;
const percentile = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] : 0;
const command = prefix => `${prefix}-${randomUUID()}`;
const requireCode = code => error => error?.code === code;

function clientOptions() {
  const path = process.env.FALKORDB_SOCKET || (!process.env.VERCEL && !process.env.FALKORDB_HOST ? '/tmp/parallax-falkordb/redis.sock' : undefined);
  return {
    socket: path ? { path, connectTimeout: 5000, reconnectStrategy: false } : {
      host: process.env.FALKORDB_HOST, port: Number(process.env.FALKORDB_PORT || 6379),
      tls: process.env.FALKORDB_TLS === 'true', connectTimeout: 5000, reconnectStrategy: false,
    },
    username: process.env.FALKORDB_USERNAME || undefined,
    password: process.env.FALKORDB_PASSWORD || undefined,
  };
}

async function independentDatabase() {
  return process.env.FALKORDB_HTTP_URL ? createHttpDatabase() : FalkorDB.connect(clientOptions());
}

/** Read the latest actual measurement; an unrun lab never invents passing checks. */
export async function getVerification(ctx) {
  await service.ready(ctx);
  const rows = await query(ctx, 'MATCH (v:VerificationReport) RETURN properties(v) AS entity ORDER BY v.createdAt DESC LIMIT 1', {}, { readOnly: true });
  return rows.length ? hydrate(rows[0].entity).report : {
    status: 'not-run', checks: [], createdAt: null,
    message: 'Run the verification lab to measure an isolated FalkorDB workspace. No measurements have been recorded yet.',
  };
}

/**
 * Exercise the real database in private disposable fixture graphs. The caller's
 * source, decisions, tasks and conversation are never modified by test fixtures.
 * Only the measured report is appended to the caller's graph.
 */
export async function runVerification(ctx) {
  await service.ready(ctx);
  const started = performance.now();
  const createdAt = now();
  const visitor = `verification-${randomUUID()}`;
  const fixture = contextFor(visitor, ctx.tenant);
  const other = contextFor(visitor, ctx.tenant === 'acme' ? 'nova' : 'acme');
  const checks = [];
  const report = {
    id: `verification_report_${randomUUID()}`, status: 'running', createdAt,
    engine: 'FalkorDB', tenant: ctx.tenant, isolated: true, synthetic: true,
    checks, concurrency: null, durationMs: 0,
    methodology: 'Real typed graph queries, application mutations and independent client connections. All fixtures use private temporary graphs. Latency measures acknowledged counter writes; counts come from queries after all workers settle.',
  };
  async function check(id, name, fn) {
    const start = performance.now();
    try {
      const detail = await fn();
      checks.push({ id, name, status: 'passed', passed: true, durationMs: millis(performance.now() - start), details: detail ?? 'Behavior verified against FalkorDB.' });
      return true;
    } catch (error) {
      checks.push({ id, name, status: 'failed', passed: false, durationMs: millis(performance.now() - start), details: error?.message || 'Verification failed.', code: error?.code });
      return false;
    }
  }
  const verifications = new Map();
  let canonicalCase, approvedCase, winningCommand, winningBody;
  const primaryId = ctx.tenant === 'acme' ? 'trial' : 'beta';
  try {
    await service.ready(fixture);
    await service.ready(other);
    report.connection = await connectionStatus();

    await check('scenario-verdicts', 'Six reviewed scenarios produce the expected bounded verdicts', async () => {
      const scenarios = await service.findHandoffs(fixture);
      assert.equal(scenarios.length, 6);
      for (const scenario of scenarios) {
        const result = await service.checkObligation(fixture, { scenarioId: scenario.id });
        assert.equal(result.verdict, scenario.expectedVerdict, scenario.id);
        verifications.set(scenario.id, result);
        if (result.verdict === 'VALID_WITHIN_BOUND') assert.equal(result.complete, true);
        if (result.verdict === 'VIOLATED') assert.equal(result.witness.obligationValue, false);
      }
      return scenarios.map(scenario => `${scenario.id}: ${verifications.get(scenario.id).verdict}`).join('; ');
    });

    await check('evidence-traversal', 'Source evidence is reached through real multi-hop relationships', async () => {
      const evidence = await service.traceEvidence(fixture, { scenarioId: 'trial' });
      assert.ok(evidence.paths.some(path => path.nodes.length >= 4), 'No path traversed at least three relationships.');
      assert.ok(evidence.paths.some(path => path.relationships.includes('SOURCED_FROM')), 'No source provenance path was found.');
      const sources = new Set(evidence.sources.map(source => source.id));
      assert.ok(sources.has('trial_source_engineering'));
      return `${evidence.paths.length} evidence paths returned; source and rule revisions are present.`;
    });

    await check('native-shortest-path', 'Native shortestPath reaches accountable human owners', async () => {
      const result = await service.getAffectedOwners(fixture, { scenarioId: 'trial' });
      assert.equal(result.algorithm, 'shortestPath');
      assert.ok(result.owners.length >= 4);
      assert.ok(result.owners.every(owner => owner.path[0] === 'trial' && owner.path.at(-1) === owner.id && owner.distance >= 1));
      return `${result.owners.length} owners returned with measured path lengths.`;
    });

    await check('concurrent-case-merge', 'Sixteen coordinators converge on one canonical clarification', async () => {
      const verification = verifications.get(primaryId) || await service.checkObligation(fixture, { scenarioId: primaryId });
      const cases = await Promise.all(Array.from({ length: 16 }, () => service.openCase(fixture, { scenarioId: primaryId, verificationId: verification.id })));
      assert.equal(new Set(cases.map(item => item.id)).size, 1);
      canonicalCase = cases[0];
      const rows = await query(fixture, 'MATCH (c:Case {scenarioId:$scenarioId}) RETURN count(c) AS count', { scenarioId: primaryId }, { readOnly: true });
      const duplicateCases = Math.max(0, Number(rows[0].count) - 1);
      report.duplicateCases = duplicateCases;
      assert.equal(duplicateCases, 0);
      return `16 acknowledged opens; ${rows[0].count} stored case; ${duplicateCases} duplicates.`;
    });

    await check('decision-revision-guard', 'Concurrent approvals accept one revision and reject stale writers', async () => {
      assert.ok(canonicalCase, 'Canonical case setup did not complete.');
      const scenario = await service.getScenario(fixture, primaryId);
      const requests = Array.from({ length: 16 }, (_, worker) => ({
        choice: scenario.resolution.choices[0].id,
        note: `Synthetic verification reviewer ${worker}: approve the reviewed mapping.`,
        expectedRevision: canonicalCase.revision, commandId: command('decision'),
      }));
      const results = await Promise.allSettled(requests.map(body => service.approveDecision(fixture, canonicalCase.id, body)));
      const successes = results.flatMap((result, i) => result.status === 'fulfilled' ? [{ value: result.value, body: requests[i] }] : []);
      const rejected = results.filter(result => result.status === 'rejected');
      assert.equal(successes.length, 1, 'Exactly one approval must acquire the expected revision.');
      assert.equal(rejected.length, 15);
      assert.ok(rejected.every(result => result.reason?.code === 'REVISION_CONFLICT'), 'A stale writer failed for an unrelated reason.');
      winningBody = successes[0].body;
      winningCommand = winningBody.commandId;
      approvedCase = await service.getCase(fixture, canonicalCase.id);
      assert.equal(approvedCase.status, 'implementation_pending');
      assert.ok(approvedCase.tasks.length >= 2);
      assert.ok(approvedCase.tasks.every(task => task.state === 'pending'));
      assert.equal(approvedCase.decisions.length, 1);
      report.staleRejected = rejected.length;
      report.guardedWrites = successes.length;
      return `${successes.length} approval accepted; ${rejected.length} stale updates rejected; ${approvedCase.tasks.length} tasks remain pending.`;
    });

    await check('command-idempotency', 'Command replay is idempotent and changed payload reuse is rejected', async () => {
      assert.ok(winningCommand, 'Decision setup did not complete.');
      await service.approveDecision(fixture, canonicalCase.id, winningBody);
      await assert.rejects(() => service.approveDecision(fixture, canonicalCase.id, { ...winningBody, note: 'A different payload must not reuse this command.' }), requireCode('COMMAND_REUSED'));
      const current = await service.getCase(fixture, canonicalCase.id);
      assert.equal(current.decisions.length, 1);
      assert.equal(current.tasks.length, approvedCase.tasks.length);
      return 'Exact replay preserved one decision and one task set; a different payload returned COMMAND_REUSED.';
    });

    await check('human-task-boundary', 'Approval never substitutes for implementation evidence', async () => {
      assert.ok(approvedCase?.tasks.length, 'Decision tasks were not created.');
      const task = approvedCase.tasks[0];
      await assert.rejects(() => service.completeTask(fixture, task.id, { evidence: '', expectedRevision: task.revision, commandId: command('empty-evidence') }), error => error?.status >= 400 && error?.status < 500);
      await assert.rejects(() => service.verifyCase(fixture, canonicalCase.id, { expectedRevision: approvedCase.revision, commandId: command('early-verify') }), error => error?.status >= 400 && error?.status < 500);
      const current = await service.getCase(fixture, canonicalCase.id);
      assert.ok(current.tasks.every(item => item.state !== 'completed'));
      assert.equal(current.status, 'implementation_pending');
      return 'Empty evidence and premature resolution were rejected; human work stayed pending.';
    });

    await check('full-domain-resolution', 'Evidence-backed tasks and a fresh full-domain check resolve the case', async () => {
      assert.ok(approvedCase?.tasks.length, 'Decision setup did not complete.');
      for (const task of approvedCase.tasks) await service.completeTask(fixture, task.id, {
        evidence: `Synthetic test evidence for ${task.title}: the approved mapping was implemented and reviewed in this disposable fixture.`,
        expectedRevision: task.revision, commandId: command('complete-task'),
      });
      const pending = await service.getCase(fixture, canonicalCase.id);
      assert.equal(pending.status, 'verification_pending');
      await service.verifyCase(fixture, canonicalCase.id, { expectedRevision: pending.revision, commandId: command('resolve') });
      const resolved = await service.getCase(fixture, canonicalCase.id);
      assert.equal(resolved.status, 'resolved');
      assert.ok(resolved.tasks.every(task => task.state === 'completed' && task.evidence));
      const scenario = await service.getScenario(fixture, primaryId);
      const runs = scenario.runs.filter(run => run.verdict === 'VALID_WITHIN_BOUND');
      assert.ok(runs.some(run => run.complete && (run.result?.domainSize ?? run.domainSize) > 1), 'No exhaustive full-domain repair verification was stored.');
      assert.ok(scenario.runs.some(run => run.verdict === 'VIOLATED'), 'Original counterexample history disappeared.');
      return 'All tasks retained evidence; exhaustive adopted-rule verification resolved the case; original violation remains stored.';
    });

    await check('source-revision-staleness', 'Reviewed source changes preserve history and reject stale case evidence', async () => {
      const scenario = await service.getScenario(fixture, 'threshold');
      const verification = verifications.get('threshold') || await service.checkObligation(fixture, { scenarioId: 'threshold' });
      const originalCase = await service.openCase(fixture, { scenarioId: 'threshold', verificationId: verification.id });
      const proposal = await service.intake(fixture, {
        scenarioId: 'threshold', departmentId: 'engineering', choiceId: scenario.resolution.choices[0].id,
        text: 'Reviewed change proposal: priority routing must include a score of exactly 100. Adopt the inclusive routing predicate and retain the earlier source for audit.',
      });
      const interpretation = proposal.interpretation || proposal;
      await service.reviewInterpretation(fixture, interpretation.id, { action: 'accept', expectedRevision: interpretation.revision, commandId: command('review-source') });
      const current = await service.getScenario(fixture, 'threshold');
      assert.ok(current.revision > scenario.revision);
      const stale = await service.getCase(fixture, originalCase.id);
      assert.equal(stale.stale, true);
      await assert.rejects(() => service.openCase(fixture, { scenarioId: 'threshold', verificationId: verification.id }), requireCode('STALE_EVIDENCE'));
      const revisions = await query(fixture, 'MATCH (s:Source {scenarioId:$scenarioId})-[:HAS_REVISION]->(r:SourceRevision) RETURN s.id AS id,count(r) AS count', { scenarioId: 'threshold' }, { readOnly: true });
      assert.ok(revisions.some(row => row.count >= 2), 'No source retained multiple revisions.');
      const recall = await service.recallMemory(fixture, { scenarioId: 'threshold' });
      assert.ok(recall.rejected.length > 0, 'Outdated scoped memory was reused without a revision check.');
      return `Scenario advanced from revision ${scenario.revision} to ${current.revision}; old source and counterexample remain; ${recall.rejected.length} stale memories rejected.`;
    });

    await check('tenant-isolation', 'Tenant definitions, conversations, cases and learned memory remain separate', async () => {
      const marker = `PRIVATE-${randomUUID()}`;
      await service.persistMessage(fixture, { role: 'user', body: marker, scenarioId: primaryId });
      const [otherMessages, otherCases, firstTrial, secondTrial, otherMemory] = await Promise.all([
        service.listMessages(other), service.listCases(other), service.getScenario(fixture, 'trial'),
        service.getScenario(other, 'trial'), service.listMemory(other),
      ]);
      assert.notEqual(firstTrial.promise, secondTrial.promise);
      assert.ok(!otherMessages.some(message => message.body.includes(marker)));
      assert.equal(otherCases.length, 0);
      assert.ok(!otherMemory.some(memory => memory.outcome === 'decision_approved' || memory.caseId === canonicalCase?.id));
      assert.ok(otherMemory.every(memory => memory.scope.startsWith(`${other.tenant}:`)));
      const otherTrial = await service.checkObligation(other, { scenarioId: 'trial' });
      assert.equal(otherTrial.verdict, other.tenant === 'nova' ? 'VALID_WITHIN_BOUND' : 'VIOLATED');
      return 'Same visitor, separate tenant graphs: definitions differ as intended and no private conversation, case or learned decision crossed the boundary.';
    });

    await check('lease-fencing', 'An expired agent cannot write after another worker takes ownership', async () => {
      const input = { scenarioId: 'equivalent', commandId: command('lease'), mode: 'guided' };
      const old = await service.createAgentRun(fixture, input);
      await query(fixture, 'MATCH (r:AgentRun {id:$id}) SET r.leaseExpiresAt=0 RETURN r.id AS id', { id: old.id });
      const current = await service.createAgentRun(fixture, input);
      assert.ok(current.fence > old.fence);
      assert.notEqual(current.leaseToken, old.leaseToken);
      await assert.rejects(() => service.recordToolCall(fixture, old.id, { tool: 'stale_worker', args: {}, result: {}, status: 'success', fence: old.fence, leaseToken: old.leaseToken }), requireCode('LEASE_LOST'));
      await assert.rejects(() => service.finishAgentRun(fixture, old.id, { status: 'completed', result: {}, fence: old.fence, leaseToken: old.leaseToken }), requireCode('LEASE_LOST'));
      await service.recordToolCall(fixture, current.id, { tool: 'current_worker', args: {}, result: { accepted: true }, status: 'success', fence: current.fence, leaseToken: current.leaseToken });
      await service.finishAgentRun(fixture, current.id, { status: 'completed', result: { verified: true }, fence: current.fence, leaseToken: current.leaseToken });
      const calls = await query(fixture, 'MATCH (r:AgentRun {id:$id})-[:USED_TOOL]->(t:ToolCall) RETURN t.tool AS tool', { id: current.id }, { readOnly: true });
      assert.deepEqual(calls.map(call => call.tool), ['current_worker']);
      return `Ownership advanced from fence ${old.fence} to ${current.fence}; stale tool and completion writes were rejected.`;
    });

    await check('read-only-enforcement', 'GRAPH.RO_QUERY rejects mutation and stores no forbidden node', async () => {
      await assert.rejects(() => query(fixture, "CREATE (n:Entity:VerificationForbidden {id:'forbidden-readonly'}) RETURN n.id AS id", {}, { readOnly: true }));
      const rows = await query(fixture, "MATCH (n:Entity {id:'forbidden-readonly'}) RETURN count(n) AS count", {}, { readOnly: true });
      assert.equal(rows[0].count, 0);
      return 'The database rejected CREATE through the read-only query channel; no forbidden node exists.';
    });

    await check('client-restart', 'Acknowledged graph state survives independent client reconnection', async () => {
      const marker = command('reconnect');
      const first = await independentDatabase();
      try {
        await first.selectGraph(fixture.graphName).query('CREATE (n:Entity:VerificationMarker {id:$id, value:$value}) RETURN n.value AS value', { params: { id: marker, value: 'persisted-after-client-close' } });
      } finally { await first.close(); }
      const second = await independentDatabase();
      try {
        const rows = await second.selectGraph(fixture.graphName).roQuery('MATCH (n:VerificationMarker {id:$id}) RETURN n.value AS value', { params: { id: marker } });
        assert.equal(rows.data[0].value, 'persisted-after-client-close');
      } finally { await second.close(); }
      return process.env.FALKORDB_HTTP_URL
        ? 'A new authenticated gateway client read the value after the writing client closed. The gateway executes through the official FalkorDB client. This checks client continuity, not host disaster recovery.'
        : 'A new official FalkorDB client read the value after the writing client closed. This checks client continuity, not host disaster recovery.';
    });

    await check('concurrent-read-write', 'Sixteen workers preserve every acknowledged atomic write under concurrent reads', async () => {
      const workers = 16, writesPerWorker = 8;
      await query(fixture, "CREATE (c:Entity:VerificationCounter {id:'verification_counter',value:0}) RETURN c.value AS value");
      const latency = [], acknowledged = new Set(), failures = [];
      let reads = 0;
      await Promise.all(Array.from({ length: workers }, async (_, worker) => {
        for (let index = 0; index < writesPerWorker; index++) {
          const receiptId = `verification_receipt_${worker}_${index}`;
          const start = performance.now();
          try {
            const result = await query(fixture, `MATCH (c:VerificationCounter {id:'verification_counter'})
              CREATE (r:Entity:VerificationReceipt {id:$id,worker:$worker,sequence:$sequence})
              SET c.value=c.value+1 RETURN r.id AS id,c.value AS count`, { id: receiptId, worker, sequence: index });
            assert.equal(result[0].id, receiptId);
            latency.push(millis(performance.now() - start));
            acknowledged.add(receiptId);
            const read = await query(fixture, 'MATCH (r:VerificationReceipt {id:$id}) RETURN r.id AS id', { id: receiptId }, { readOnly: true });
            assert.equal(read[0].id, receiptId);
            reads++;
          } catch (error) { failures.push(error?.message || 'A concurrent operation failed.'); }
        }
      }));
      const [counter, receipts, duplicateRows] = await Promise.all([
        query(fixture, "MATCH (c:VerificationCounter {id:'verification_counter'}) RETURN c.value AS count", {}, { readOnly: true }),
        query(fixture, 'MATCH (r:VerificationReceipt) RETURN r.id AS id', {}, { readOnly: true }),
        query(fixture, 'MATCH (c:Case {scenarioId:$scenarioId}) RETURN count(c) AS count', { scenarioId: primaryId }, { readOnly: true }),
      ]);
      const saved = new Set(receipts.map(row => row.id));
      const lostAcknowledgedWrites = [...acknowledged].filter(receipt => !saved.has(receipt)).length;
      const sorted = latency.sort((a, b) => a - b);
      const p50Ms = percentile(sorted, 0.5), p95Ms = percentile(sorted, 0.95), maxMs = sorted.at(-1) || 0;
      report.concurrency = {
        workers, writesPerWorker, operations: workers * writesPerWorker, attemptedWrites: workers * writesPerWorker,
        acceptedWrites: acknowledged.size, readOperations: reads, storedReceipts: saved.size,
        counterValue: Number(counter[0]?.count ?? 0), failedOperations: failures.length,
        staleRejected: report.staleRejected ?? null, rejectedStaleUpdates: report.staleRejected ?? null,
        guardedWrites: report.guardedWrites ?? null,
        duplicateCases: Math.max(0, Number(duplicateRows[0]?.count ?? 0) - 1), lostAcknowledgedWrites,
        p50Ms, p95Ms, maxMs, latencyMs: { p50: p50Ms, p95: p95Ms, max: maxMs },
      };
      assert.equal(failures.length, 0, failures[0]);
      assert.equal(acknowledged.size, workers * writesPerWorker);
      assert.equal(reads, acknowledged.size);
      assert.equal(saved.size, acknowledged.size);
      assert.equal(counter[0].count, acknowledged.size, 'Atomic increments lost an acknowledged write.');
      assert.equal(lostAcknowledgedWrites, 0);
      assert.equal(report.concurrency.duplicateCases, 0);
      return `${workers} workers, ${acknowledged.size} acknowledged writes, ${reads} confirmed reads; p50 ${p50Ms} ms, p95 ${p95Ms} ms; no lost receipts or increments.`;
    });
  } catch (error) {
    checks.push({ id: 'fixture-setup', name: 'Isolated verification workspace initializes', status: 'failed', passed: false, durationMs: millis(performance.now() - started), details: error?.message || 'Fixture setup failed.' });
  } finally {
    await check('fixture-cleanup', 'Verification fixtures are removed without altering the user workspace', async () => {
      const results = await Promise.allSettled([fixture, other].map(async context => (await graphFor(context)).delete()));
      const failures = results.filter(result => result.status === 'rejected');
      assert.equal(failures.length, 0, 'A temporary graph could not be removed.');
      return 'Both temporary tenant graphs were deleted. Only this measured report is retained in the requested workspace.';
    });
  }
  report.status = checks.length > 0 && checks.every(check => check.passed) ? 'passed' : 'failed';
  report.durationMs = millis(performance.now() - started);
  report.completedAt = now();
  report.summary = { total: checks.length, passed: checks.filter(check => check.passed).length, failed: checks.filter(check => !check.passed).length };
  await query(ctx, 'CREATE (v:Entity:VerificationReport) SET v=$properties RETURN v.id AS id', {
    properties: properties('VerificationReport', { id: report.id, title: `Verification lab · ${report.status}`, createdAt, status: report.status, report }),
  });
  return report;
}

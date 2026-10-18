import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { contextFor } from '../lib/server/session.mjs';
import { query, graphFor, closeDatabase } from '../lib/server/db.mjs';
import * as service from '../lib/server/service.mjs';

const fixtures = [];
function fixture() {
  const context = contextFor(`rule-provenance-${randomUUID()}`, 'acme');
  fixtures.push(context);
  return context;
}
after(async () => {
  await Promise.allSettled(fixtures.map(async context => (await graphFor(context)).delete()));
  await closeDatabase();
});

async function evidenceFor(context, id) {
  const [result] = await query(context, `MATCH (r:Rule {id:$id})
    OPTIONAL MATCH (r)-[:OWNED_BY]->(owner:Department)
    OPTIONAL MATCH (r)-[:READS_EVENT]->(event:EventType)
    RETURN r.id AS id,r.current AS current,collect(DISTINCT owner.id) AS owners,collect(DISTINCT event.id) AS events`, { id }, { readOnly: true });
  return { ...result, owners: result.owners.sort(), events: result.events.sort() };
}

async function assertRevisionEvidence(context, { scenarioId, ruleId, ownerId, oldEvents, events, sourceId, producers = [] }) {
  assert.deepEqual(await evidenceFor(context, `${ruleId}@2`), { id: `${ruleId}@2`, current: true, owners: [ownerId], events }, 'The current Rule must retain ownership and use its actual expression event dependencies.');
  assert.deepEqual(await evidenceFor(context, `${ruleId}@1`), { id: `${ruleId}@1`, current: false, owners: [ownerId], events: oldEvents }, 'Historical provenance must remain attached to the superseded Rule.');
  const sources = await query(context, `MATCH (:Handoff {id:$scenarioId})-[:HAS_OBLIGATION]->(:Obligation)-[:COMPARES]->(r:Rule {id:$ruleRevision}),
    (:Definition {ruleId:$ruleId})-[:IMPLEMENTED_BY]->(r),(r)-[:SOURCED_FROM]->(source:SourceRevision)
    RETURN DISTINCT source.id AS id,source.version AS version`, { scenarioId, ruleRevision: `${ruleId}@2`, ruleId }, { readOnly: true });
  assert.deepEqual(sources, [{ id: `${sourceId}@2`, version: 2 }]);
  const producerPaths = await query(context, `MATCH (r:Rule {id:$id})-[:READS_EVENT]->(:EventType)-[:EMITTED_BY]->(producer:Producer)-[:OWNED_BY]->(:Department)
    RETURN DISTINCT producer.id AS id ORDER BY id`, { id: `${ruleId}@2` }, { readOnly: true });
  assert.deepEqual(producerPaths.map(row => row.id), producers);
}

const firstUse = { scenarioId: 'trial', ruleId: 'trial_rule_billing', ownerId: 'billing', oldEvents: ['event_account_activated'], events: ['event_workspace_first_used'], sourceId: 'trial_source_billing', producers: ['producer_workspace'], choiceId: 'honor_first_use' };
const emailPromise = { scenarioId: 'trial', ruleId: 'trial_rule_product', ownerId: 'product', oldEvents: ['event_workspace_first_used'], events: ['event_account_activated'], sourceId: 'trial_source_product', producers: ['producer_identity'], choiceId: 'align_public_promise' };

for (const scenario of [
  { ...firstUse, departmentId: 'engineering', description: 'accepted billing mapping moves from email activation to first use without changing the rule owner' },
  { ...emailPromise, departmentId: 'product', description: 'accepted Product mapping moves from first use to email activation' },
  { scenarioId: 'unknown', ruleId: 'unknown_rule_finance', ownerId: 'finance', departmentId: 'finance', oldEvents: ['event_settled'], events: ['event_settled'], sourceId: 'unknown_source_finance', description: 'accepted unchanged settlement mapping preserves its event and missing producer evidence' },
  { scenarioId: 'threshold', ruleId: 'threshold_rule_engineering', ownerId: 'engineering', departmentId: 'engineering', oldEvents: [], events: [], sourceId: 'threshold_source_engineering', choiceId: 'include_boundary', description: 'accepted scalar mapping retains its owner without inventing event dependencies' },
]) {
  test(scenario.description, async () => {
    const context = fixture();
    const { interpretation } = await service.intake(context, { scenarioId: scenario.scenarioId, departmentId: scenario.departmentId, choiceId: scenario.choiceId, text: 'Synthetic reviewed source update for the isolated rule-provenance regression.' });
    await service.reviewInterpretation(context, interpretation.id, { action: 'accept', expectedRevision: interpretation.revision, commandId: randomUUID() });
    await assertRevisionEvidence(context, scenario);
  });
}

for (const scenario of [firstUse, emailPromise]) {
  test(`verified repair ${scenario.choiceId} connects current rule ownership and remapped producer evidence`, async () => {
    const context = fixture();
    const verification = await service.checkObligation(context, { scenarioId: scenario.scenarioId });
    const opened = await service.openCase(context, { scenarioId: scenario.scenarioId, verificationId: verification.id });
    const current = await service.getCase(context, opened.id);
    await service.approveDecision(context, current.id, { choice: scenario.choiceId, note: 'Synthetic human approval for the isolated provenance test.', expectedRevision: current.revision, commandId: randomUUID() });
    const approved = await service.getCase(context, current.id);
    for (const task of approved.tasks) await service.completeTask(context, task.id, { evidence: `Synthetic implementation evidence for ${task.title}.`, expectedRevision: task.revision, commandId: randomUUID() });
    const pending = await service.getCase(context, current.id);
    const resolved = await service.verifyCase(context, pending.id, { expectedRevision: pending.revision, commandId: randomUUID() });
    assert.equal(resolved.status, 'resolved');
    await assertRevisionEvidence(context, scenario);
  });
}

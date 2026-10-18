import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateExpression, verifyScenario } from '../lib/domain/checker.mjs';
import { getScenario, listScenarios } from '../lib/domain/scenarios.mjs';

const clone = value => structuredClone(value);

test('trial witness proves the reviewed obligation is violated by seven days', () => {
  const result = verifyScenario(getScenario('trial'));
  assert.equal(result.verdict, 'VIOLATED');
  assert.deepEqual(result.witness.inputs, { email_verified_day: 0, first_use_day: 7 });
  assert.equal(result.witness.outputs.first_charge_at, 14);
  assert.equal(result.witness.outputs.promised_access_until, 21);
  assert.equal(result.witness.obligationValue, false);
  assert.equal(result.versions.sources.length, 4);
});

test('all six scenario classes return their declared verdicts', () => {
  const scenarios = listScenarios();
  assert.deepEqual(scenarios.map(s => s.id), ['trial', 'beta', 'threshold', 'bundle', 'equivalent', 'unknown']);
  for (const scenario of scenarios) {
    assert.equal(verifyScenario(scenario).verdict, scenario.expectedVerdict, scenario.id);
  }
});

test('eligibility witness contains automation activity but no human session', () => {
  const result = verifyScenario(getScenario('beta'));
  assert.equal(result.witness.inputs.automation_runs, 1);
  assert.equal(result.witness.inputs.human_sessions, 0);
  assert.equal(result.witness.outputs.will_invite, true);
  assert.equal(result.witness.outputs.is_eligible, false);
});

test('the threshold boundary produces a witness at exactly 100', () => {
  const result = verifyScenario(getScenario('threshold'));
  assert.equal(result.witness.inputs.score, 100);
});

test('bundle mismatch is about the all-capabilities obligation, not word similarity', () => {
  const result = verifyScenario(getScenario('bundle'));
  assert.deepEqual(result.witness.inputs, { has_analytics: false, has_exports: true });
  assert.equal(result.witness.outputs.bundle_promised, false);
  assert.equal(result.witness.outputs.bundle_granted, true);
});

test('equivalent expressions exhaust a disclosed finite domain', () => {
  const result = verifyScenario(getScenario('equivalent'));
  assert.equal(result.verdict, 'VALID_WITHIN_BOUND');
  assert.equal(result.complete, true);
  assert.equal(result.evaluatedCount, result.domainSize);
  assert.equal(result.witness, null);
});

test('second tenant has isolated, intentionally compatible trial semantics', () => {
  const first = verifyScenario(getScenario('trial', 'acme'));
  const second = verifyScenario(getScenario('trial', 'nova'));
  assert.equal(first.verdict, 'VIOLATED');
  assert.equal(second.verdict, 'VALID_WITHIN_BOUND');
  assert.notEqual(getScenario('trial').promise, getScenario('trial', 'nova').promise);
  assert.throws(() => listScenarios('untrusted_graph_name'), /Unknown tenant/);
});

test('approved structured mapping resolves the conflict while original scenario stays unchanged', () => {
  const original = getScenario('trial');
  const adopted = clone(original);
  const choice = adopted.resolution.choices[0];
  assert.ok(choice.taskTemplates.length >= 2);
  for (const update of choice.ruleUpdates) {
    const rule = adopted.rules.find(r => r.id === update.ruleId);
    Object.assign(rule, update, { revision: rule.revision + 1 });
  }
  assert.equal(verifyScenario(adopted).verdict, 'VALID_WITHIN_BOUND');
  assert.equal(verifyScenario(original).verdict, 'VIOLATED');
});

test('explicit user inputs restrict the reported finite bound', () => {
  const result = verifyScenario(getScenario('trial'), { inputs: { email_verified_day: 0, first_use_day: 0 } });
  assert.equal(result.verdict, 'VALID_WITHIN_BOUND');
  assert.equal(result.domainSize, 1);
  assert.deepEqual(result.bounds.effectiveDomain.first_use_day, [0]);
  const outside = verifyScenario(getScenario('trial'), { inputs: { email_verified_day: 0, first_use_day: 999 } });
  assert.equal(outside.verdict, 'UNKNOWN');
  assert.match(outside.explanation, /declared domain/);
});

test('an incomplete search never claims validity', () => {
  const result = verifyScenario(getScenario('trial'), { maxEvaluations: 1 });
  assert.equal(result.verdict, 'NOT_DISPROVED');
  assert.equal(result.complete, false);
  assert.equal(result.evaluatedCount, 1);
  assert.equal(result.witness, null);
});

test('inadmissible inputs are not reported as a counterexample', () => {
  const scenario = getScenario('trial');
  scenario.domain = { email_verified_day: [7], first_use_day: [0] };
  scenario.inputs = scenario.inputs.map(input => ({ ...input, values: scenario.domain[input.key] }));
  const result = verifyScenario(scenario);
  assert.equal(result.verdict, 'UNKNOWN');
  assert.equal(result.evaluatedCount, 0);
  assert.match(result.explanation, /admissible/);
});

test('unreviewed rules and missing producer evidence return unknown', () => {
  const scenario = getScenario('trial');
  scenario.rules[0].reviewed = false;
  assert.equal(verifyScenario(scenario).verdict, 'UNKNOWN');
  assert.equal(verifyScenario(getScenario('unknown')).verdict, 'UNKNOWN');
});

test('rules from a different obligation scope cannot produce a false conflict', () => {
  const scenario = getScenario('trial');
  scenario.rules[0].scope = 'unrelated-scope';
  const result = verifyScenario(scenario);
  assert.equal(result.verdict, 'UNKNOWN');
  assert.match(result.explanation, /scope/);
});

test('unknown variables, wrong types and unsupported syntax are rejected', () => {
  assert.throws(() => evaluateExpression({ op: 'var', name: 'absent' }, {}), /Missing variable/);
  assert.throws(() => evaluateExpression({ op: 'add', args: [{ op: 'const', value: '1' }, { op: 'const', value: 2 }] }, {}), /number/);
  assert.throws(() => evaluateExpression({ op: 'eval', code: 'process.exit()' }, {}), /Unsupported/);
  assert.throws(() => evaluateExpression({ op: 'const', value: Infinity }, {}), /finite/);
  const scenario = getScenario('trial');
  scenario.rules[0].expression = { op: 'var', name: 'process.env.SECRET' };
  assert.equal(verifyScenario(scenario).verdict, 'UNKNOWN');
});

test('AST nesting, oversized domains and non-finite inputs have bounded failure', () => {
  let expression = { op: 'const', value: true };
  for (let i = 0; i < 50; i++) expression = { op: 'not', args: [expression] };
  assert.throws(() => evaluateExpression(expression, {}), /depth/);
  const scenario = getScenario('trial');
  scenario.domain.first_use_day = [NaN];
  assert.equal(verifyScenario(scenario).verdict, 'UNKNOWN');
  const huge = getScenario('equivalent');
  huge.domain.request_count = Array.from({ length: 100001 }, (_, i) => i);
  assert.equal(verifyScenario(huge).verdict, 'UNKNOWN');
});

test('membership and boolean operators preserve strict types without evaluating source text', () => {
  assert.equal(evaluateExpression({ op: 'in', args: [{ op: 'var', name: 'tier' }, { op: 'const', value: ['pro', 'team'] }] }, { tier: 'pro' }), true);
  assert.equal(evaluateExpression({ op: 'eq', args: [{ op: 'const', value: '100' }, { op: 'const', value: 100 }] }, {}), false);
  assert.throws(() => evaluateExpression({ op: 'not', args: [{ op: 'const', value: 1 }] }, {}), /boolean/);
});

test('cyclic rule dependencies fail closed instead of recursing indefinitely', () => {
  const scenario = getScenario('trial');
  scenario.rules[0].expression = { op: 'var', name: scenario.rules[1].name };
  scenario.rules[1].expression = { op: 'var', name: scenario.rules[0].name };
  const result = verifyScenario(scenario);
  assert.equal(result.verdict, 'UNKNOWN');
  assert.match(result.explanation, /cyclic/);
});

test('scenario callers receive independent copies of immutable fixtures', () => {
  const first = getScenario('trial');
  first.sources[0].text = 'mutated';
  assert.notEqual(getScenario('trial').sources[0].text, 'mutated');
  assert.equal(getScenario('does-not-exist'), null);
});

test('unequal outputs are compatible when they satisfy the actual shared obligation', () => {
  const scenario = getScenario('trial');
  scenario.rules[1].expression = { op: 'add', args: [{ op: 'var', name: 'first_use_day' }, { op: 'const', value: 21 }] };
  const result = verifyScenario(scenario);
  assert.equal(result.verdict, 'VALID_WITHIN_BOUND');
  assert.notEqual(result.outputs.first_charge_at, result.outputs.promised_access_until);
});

test('dependent rule outputs are evaluated in dependency order', () => {
  const scenario = getScenario('trial');
  scenario.rules[1].expression = { op: 'var', name: 'promised_access_until' };
  scenario.rules.reverse();
  assert.equal(verifyScenario(scenario).verdict, 'VALID_WITHIN_BOUND');
});

test('numeric rules cannot compare unrelated units', () => {
  const scenario = getScenario('trial');
  scenario.inputs[0].unit = 'count';
  const result = verifyScenario(scenario);
  assert.equal(result.verdict, 'UNKNOWN');
  assert.match(result.explanation, /units/);
});

test('every proposed repair satisfies its scenario obligation on the full domain', () => {
  for (const original of listScenarios()) {
    for (const choice of original.resolution.choices) {
      const scenario = clone(original);
      for (const update of choice.ruleUpdates) Object.assign(scenario.rules.find(rule => rule.id === update.ruleId), update);
      const result = verifyScenario(scenario);
      assert.equal(result.verdict, 'VALID_WITHIN_BOUND', `${original.id}/${choice.id}`);
      assert.equal(result.complete, true);
      assert.ok(result.domainSize > 1);
    }
  }
});

test('malformed evidence fails closed and array equality is not invented', () => {
  const scenario = getScenario('trial');
  scenario.rules = [null];
  assert.equal(verifyScenario(scenario).verdict, 'UNKNOWN');
  assert.throws(() => evaluateExpression({ op: 'eq', args: [{ op: 'const', value: [1] }, { op: 'const', value: [1] }] }, {}), /number, boolean or string/);
});

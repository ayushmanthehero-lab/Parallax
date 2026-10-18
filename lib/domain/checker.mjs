/**
 * Bounded, deterministic verifier for reviewed handoff obligations.
 *
 * No natural-language text is executed. JSON expressions use constant nodes,
 * variable nodes, and the closed operator set below. Explicit user inputs narrow
 * the effective finite domain; VALID_WITHIN_BOUND never means global validity.
 * `complete` describes exhaustive coverage, not whether a witness is conclusive.
 */
export const CHECKER_VERSION = 'parallax-bounded/1.0.0';
const MAX_DEPTH = 24;
const MAX_AST_NODES = 512;
const MAX_INPUTS = 16;
const MAX_RULES = 32;
const MAX_DOMAIN_VALUES = 1024;
const MAX_DOMAIN_SIZE = 100000;
const DEFAULT_BUDGET = 10000;
const NAME = /^[a-z][a-z0-9_]{0,79}$/;
const ARITY = { add: [2, 16], sub: [2, 2], eq: [2, 2], neq: [2, 2], gt: [2, 2], gte: [2, 2], lt: [2, 2], lte: [2, 2], and: [2, 16], or: [2, 16], not: [1, 1], in: [2, 2] };
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

function fail(message) { throw new Error(message); }
function primitive(value, label = 'Value') {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(`${label} must be a finite number.`);
  } else if (typeof value === 'string') {
    if (value.length > 512) fail(`${label} exceeds the 512-character limit.`);
  } else if (typeof value !== 'boolean') fail(`${label} must be a number, boolean or string.`);
  return value;
}
function numeric(value) { if (typeof value !== 'number' || !Number.isFinite(value)) fail('Numeric operators require a finite number.'); return value; }
function boolean(value) { if (typeof value !== 'boolean') fail('Boolean operators require a boolean.'); return value; }

function compile(expression) {
  let nodes = 0;
  const variables = new Set();
  function visit(node, depth) {
    if (++nodes > MAX_AST_NODES) fail(`Expression exceeds the ${MAX_AST_NODES}-node limit.`);
    if (depth > MAX_DEPTH) fail(`Expression exceeds the maximum depth of ${MAX_DEPTH}.`);
    if (!plain(node) || typeof node.op !== 'string') fail('Each expression must be an object with an operator.');
    if (node.op === 'const') {
      if (Object.keys(node).some(key => !['op', 'value'].includes(key))) fail('Constant expressions contain unsupported fields.');
      if (Array.isArray(node.value)) {
        if (node.value.length > MAX_DOMAIN_VALUES) fail('Constant set exceeds the allowed size.');
        node.value.forEach(value => primitive(value, 'Set member'));
      } else primitive(node.value, 'Constant');
      return;
    }
    if (node.op === 'var') {
      if (Object.keys(node).some(key => !['op', 'name'].includes(key))) fail('Variable expressions contain unsupported fields.');
      if (typeof node.name !== 'string' || !NAME.test(node.name)) fail('Variable names must be simple lowercase identifiers.');
      variables.add(node.name);
      return;
    }
    if (!own(ARITY, node.op)) fail(`Unsupported operator: ${node.op}.`);
    if (Object.keys(node).some(key => !['op', 'args'].includes(key))) fail('Operator expressions contain unsupported fields.');
    const [min, max] = ARITY[node.op];
    if (!Array.isArray(node.args) || node.args.length < min || node.args.length > max) fail(`Operator ${node.op} requires ${min === max ? min : `${min}–${max}`} arguments.`);
    node.args.forEach(child => visit(child, depth + 1));
  }
  visit(expression, 0);
  return { expression, variables };
}

function run(node, input) {
  if (node.op === 'const') return Array.isArray(node.value) ? [...node.value] : node.value;
  if (node.op === 'var') {
    if (!own(input, node.name)) fail(`Missing variable: ${node.name}.`);
    return primitive(input[node.name], `Variable ${node.name}`);
  }
  // Evaluate every branch: unsupported or absent evidence must not disappear
  // behind short-circuit truth values.
  const values = node.args.map(arg => run(arg, input));
  switch (node.op) {
    case 'add': return numeric(values.map(numeric).reduce((sum, value) => sum + value, 0));
    case 'sub': return numeric(numeric(values[0]) - numeric(values[1]));
    case 'eq': return primitive(values[0], 'Equality value') === primitive(values[1], 'Equality value');
    case 'neq': return primitive(values[0], 'Equality value') !== primitive(values[1], 'Equality value');
    case 'gt': return numeric(values[0]) > numeric(values[1]);
    case 'gte': return numeric(values[0]) >= numeric(values[1]);
    case 'lt': return numeric(values[0]) < numeric(values[1]);
    case 'lte': return numeric(values[0]) <= numeric(values[1]);
    case 'and': return values.map(boolean).every(Boolean);
    case 'or': return values.map(boolean).some(Boolean);
    case 'not': return !boolean(values[0]);
    case 'in': {
      primitive(values[0], 'Membership value');
      if (!Array.isArray(values[1])) fail('Membership requires a constant set as its second argument.');
      return values[1].some(value => value === values[0]);
    }
    default: fail(`Unsupported operator: ${node.op}.`);
  }
}

/** Evaluate one validated expression. Invalid semantics throw an explanatory Error. */
export function evaluateExpression(ast, input) {
  if (!plain(input)) fail('Expression input must be an object.');
  compile(ast);
  return run(ast, input);
}

function infer(node, types) {
  if (node.op === 'const') return { type: Array.isArray(node.value) ? 'set' : typeof node.value, unit: null };
  if (node.op === 'var') {
    if (!own(types, node.name)) fail(`Missing variable: ${node.name}.`);
    return types[node.name];
  }
  const values = node.args.map(arg => infer(arg, types));
  const requireType = (items, type) => { if (items.some(item => item.type !== type)) fail(`Operator ${node.op} requires ${type} values.`); };
  const compatibleUnits = items => {
    const units = new Set(items.map(item => item.unit).filter(Boolean));
    if (units.size > 1) fail(`Incompatible units in ${node.op}: ${[...units].join(' and ')}.`);
    return [...units][0] || null;
  };
  if (['add', 'sub'].includes(node.op)) { requireType(values, 'number'); return { type: 'number', unit: compatibleUnits(values) }; }
  if (['gt', 'gte', 'lt', 'lte'].includes(node.op)) { requireType(values, 'number'); compatibleUnits(values); return { type: 'boolean', unit: null }; }
  if (['and', 'or', 'not'].includes(node.op)) { requireType(values, 'boolean'); return { type: 'boolean', unit: null }; }
  if (['eq', 'neq'].includes(node.op)) { if (values.every(value => value.type === 'number')) compatibleUnits(values); return { type: 'boolean', unit: null }; }
  if (node.op === 'in') { if (values[1].type !== 'set') fail('Membership requires a constant set.'); return { type: 'boolean', unit: null }; }
  fail(`Unsupported operator: ${node.op}.`);
}

function snapshotVersions(scenario) {
  return {
    scenario: { id: scenario?.id ?? null, revision: scenario?.revision ?? null, scope: scenario?.scope ?? null },
    obligation: { id: scenario?.obligation?.id ?? null, revision: scenario?.obligation?.revision ?? null },
    rules: (Array.isArray(scenario?.rules) ? scenario.rules : []).filter(plain).map(rule => ({ id: rule.id, name: rule.name, revision: rule.revision, sourceId: rule.sourceId, expression: rule.expression })),
    sources: (Array.isArray(scenario?.sources) ? scenario.sources : []).filter(plain).map(source => ({ id: source.id, version: source.version, reviewed: source.reviewed === true })),
  };
}

function prepare(scenario, options) {
  if (!plain(scenario)) fail('A reviewed scenario is required.');
  if (typeof scenario.scope !== 'string' || !scenario.scope) fail('A shared handoff scope is required.');
  if (!plain(scenario.obligation) || scenario.obligation.reviewed !== true) fail('The shared obligation has not been reviewed.');
  if (scenario.obligation.scope !== scenario.scope) fail('The obligation belongs to a different handoff scope.');
  if (!Array.isArray(scenario.rules) || scenario.rules.length < 1 || scenario.rules.length > MAX_RULES) fail(`A scenario requires between 1 and ${MAX_RULES} reviewed rules.`);
  if (!Array.isArray(scenario.sources)) fail('Source evidence is missing.');
  if (!Array.isArray(scenario.inputs) || scenario.inputs.length < 1 || scenario.inputs.length > MAX_INPUTS) fail(`A scenario requires between 1 and ${MAX_INPUTS} declared inputs.`);
  if (!plain(scenario.domain)) fail('A finite domain must be explicitly declared.');
  if (options.inputs !== undefined && !plain(options.inputs)) fail('Selected inputs must be an object.');
  const budget = options.maxEvaluations ?? DEFAULT_BUDGET;
  if (!Number.isInteger(budget) || budget < 1 || budget > MAX_DOMAIN_SIZE) fail(`Search budget must be an integer from 1 to ${MAX_DOMAIN_SIZE}.`);
  const sourceById = new Map(scenario.sources.map(source => [source.id, source]));
  for (const evidence of scenario.evidenceRequirements || []) {
    if (evidence.reviewed !== true || !sourceById.has(evidence.sourceId) || sourceById.get(evidence.sourceId).reviewed !== true) fail(`Missing reviewed evidence: ${evidence.label || evidence.id}.`);
  }
  const fields = new Map();
  const types = Object.create(null);
  for (const field of scenario.inputs) {
    if (typeof field.key !== 'string' || !NAME.test(field.key)) fail('Input names must be simple lowercase identifiers.');
    if (fields.has(field.key)) fail(`Duplicate input: ${field.key}.`);
    if (!['number', 'boolean', 'string'].includes(field.type)) fail(`Unsupported input type for ${field.key}.`);
    if (field.type === 'number' && (typeof field.unit !== 'string' || !field.unit)) fail(`Numeric input ${field.key} must declare its unit.`);
    fields.set(field.key, field);
    types[field.key] = { type: field.type, unit: field.unit || null };
  }
  if (Object.keys(scenario.domain).length !== fields.size || Object.keys(scenario.domain).some(key => !fields.has(key))) fail('Declared domain and input fields do not match.');
  if (Object.keys(options.inputs || {}).some(key => !fields.has(key))) fail('Selected inputs contain an undeclared variable.');
  const declaredDomain = {}, effectiveDomain = {};
  let declaredSize = 1, domainSize = 1;
  for (const [key, field] of fields) {
    const values = scenario.domain[key];
    if (!Array.isArray(values) || values.length < 1 || values.length > MAX_DOMAIN_VALUES) fail(`The declared domain for ${key} must contain 1–${MAX_DOMAIN_VALUES} values.`);
    const unique = new Set();
    for (const value of values) {
      primitive(value, `Input ${key}`);
      if (typeof value !== field.type) fail(`Input ${key} must be a ${field.type}.`);
      if (unique.has(value)) fail(`The declared domain for ${key} contains duplicate values.`);
      unique.add(value);
    }
    declaredDomain[key] = [...values];
    declaredSize *= values.length;
    if (declaredSize > MAX_DOMAIN_SIZE) fail(`Declared domain exceeds the ${MAX_DOMAIN_SIZE}-candidate safety limit.`);
    if (own(options.inputs || {}, key)) {
      const selected = primitive(options.inputs[key], `Selected input ${key}`);
      if (!unique.has(selected)) fail(`Selected input ${key} is outside the declared domain.`);
      effectiveDomain[key] = [selected];
    } else effectiveDomain[key] = [...values];
    domainSize *= effectiveDomain[key].length;
  }
  const rulesByName = new Map();
  const ruleIds = new Set();
  for (const rule of scenario.rules) {
    if (rule.reviewed !== true) fail(`Rule ${rule.title || rule.id} has not been reviewed.`);
    if (rule.scope !== scenario.scope) fail(`Rule ${rule.id} belongs to a different handoff scope.`);
    if (!sourceById.has(rule.sourceId) || sourceById.get(rule.sourceId).reviewed !== true) fail(`Missing reviewed source evidence for rule ${rule.id}.`);
    if (typeof rule.name !== 'string' || !NAME.test(rule.name) || fields.has(rule.name)) fail(`Rule output ${rule.name} is invalid or shadows an input.`);
    if (rulesByName.has(rule.name) || ruleIds.has(rule.id)) fail('Rule IDs and output names must be unique.');
    ruleIds.add(rule.id);
    rulesByName.set(rule.name, { ...rule, compiled: compile(rule.expression) });
  }
  const orderedRules = [], visiting = new Set(), visited = new Set();
  function order(name) {
    if (visited.has(name)) return;
    if (visiting.has(name)) fail(`Unsupported cyclic rule dependency: ${name}.`);
    visiting.add(name);
    const rule = rulesByName.get(name);
    for (const variable of rule.compiled.variables) {
      if (rulesByName.has(variable)) order(variable);
      else if (!fields.has(variable)) fail(`Missing variable: ${variable}.`);
    }
    visiting.delete(name);
    visited.add(name);
    orderedRules.push(rule);
    const inferred = infer(rule.expression, types);
    if (rule.unit && inferred.unit && rule.unit !== inferred.unit) fail(`Rule ${rule.id} declares incompatible units.`);
    types[name] = { ...inferred, unit: rule.unit || inferred.unit };
  }
  for (const name of rulesByName.keys()) order(name);
  compile(scenario.obligation.expression);
  if (infer(scenario.obligation.expression, types).type !== 'boolean') fail('The shared obligation must evaluate to a boolean.');
  const constraints = scenario.constraints || [];
  if (!Array.isArray(constraints) || constraints.length > 32) fail('Admissibility constraints exceed the allowed count.');
  for (const constraint of constraints) {
    const compiled = compile(constraint);
    if ([...compiled.variables].some(variable => !fields.has(variable))) fail('Admissibility constraints may reference declared inputs only.');
    if (infer(constraint, types).type !== 'boolean') fail('Admissibility constraints must evaluate to a boolean.');
  }
  return { orderedRules, constraints, declaredDomain, effectiveDomain, domainSize, declaredSize, budget };
}

function* assignments(domain, keys = Object.keys(domain), index = 0, current = {}) {
  if (index === keys.length) { yield { ...current }; return; }
  const key = keys[index];
  for (const value of domain[key]) {
    current[key] = value;
    yield* assignments(domain, keys, index + 1, current);
  }
}

function describeWitness(scenario, witness) {
  const { inputs, outputs } = witness;
  if (scenario.id === 'trial' && typeof outputs.first_charge_at === 'number' && typeof outputs.promised_access_until === 'number') return `Email verification on day ${inputs.email_verified_day} and first workspace use on day ${inputs.first_use_day} schedule a charge on day ${outputs.first_charge_at}, but promised access lasts until day ${outputs.promised_access_until}. The charge is ${outputs.promised_access_until - outputs.first_charge_at} days early.`;
  if (scenario.id === 'beta') return `A workspace with ${inputs.human_sessions} human sessions and ${inputs.automation_runs} automation runs is invited by Growth but fails Product's beta admission condition.`;
  if (scenario.id === 'threshold') return `At score ${inputs.score}, the reviewed policy promises priority routing while the implementation sends the lead to the standard queue.`;
  if (scenario.id === 'bundle') return `The workspace has analytics=${inputs.has_analytics} and exports=${inputs.has_exports}. Provisioning grants the combined bundle even though both required entitlements are not present.`;
  return `The admissible input ${JSON.stringify(inputs)} violates the reviewed obligation: ${scenario.obligation.text}`;
}

/**
 * Verify every admissible candidate within the declared budget, stopping at a
 * witness. maxEvaluations bounds candidate exploration (including exclusions).
 * UNKNOWN is returned for unsupported, unreviewed or missing semantics.
 */
export function verifyScenario(scenario, options = {}) {
  const startedAt = new Date().toISOString();
  const result = {
    verdict: 'UNKNOWN', complete: false, evaluatedCount: 0, examinedCount: 0,
    excludedCount: 0, domainSize: 0, witness: null, outputs: null, explanation: '',
    trace: [], checkerVersion: CHECKER_VERSION, versions: snapshotVersions(scenario),
    bounds: { declaredDomain: {}, effectiveDomain: {}, maxEvaluations: null }, startedAt,
  };
  try {
    if (!plain(options)) fail('Verification options must be an object.');
    const prepared = prepare(scenario, options);
    const { orderedRules, constraints, effectiveDomain, domainSize, budget } = prepared;
    result.domainSize = domainSize;
    result.bounds = { declaredDomain: prepared.declaredDomain, effectiveDomain, declaredSize: prepared.declaredSize, maxEvaluations: budget };
    for (const inputs of assignments(effectiveDomain)) {
      if (result.examinedCount >= budget) {
        result.verdict = 'NOT_DISPROVED';
        result.explanation = `No counterexample was found in ${result.evaluatedCount} admissible checks. The budget ended after ${result.examinedCount} of ${domainSize} candidate inputs; remaining inputs were not checked.`;
        return result;
      }
      result.examinedCount++;
      const trace = constraints.map((expression, index) => ({ kind: 'constraint', id: `constraint_${index + 1}`, label: `Admissibility condition ${index + 1}`, expression, value: boolean(run(expression, inputs)) }));
      if (trace.some(item => item.value === false)) { result.excludedCount++; continue; }
      const environment = Object.assign(Object.create(null), inputs);
      const outputs = {};
      for (const rule of orderedRules) {
        const value = primitive(run(rule.expression, environment), `Rule output ${rule.name}`);
        environment[rule.name] = value;
        outputs[rule.name] = value;
        trace.push({ kind: 'rule', id: rule.id, label: rule.title || rule.name, outputName: rule.name, expression: rule.expression, value, revision: rule.revision, sourceId: rule.sourceId });
      }
      const obligationValue = boolean(run(scenario.obligation.expression, environment));
      trace.push({ kind: 'obligation', id: scenario.obligation.id, label: scenario.obligation.text, expression: scenario.obligation.expression, value: obligationValue, revision: scenario.obligation.revision });
      result.evaluatedCount++;
      result.outputs = outputs;
      result.trace = trace;
      if (!obligationValue) {
        result.verdict = 'VIOLATED';
        result.complete = result.examinedCount === domainSize;
        result.witness = { inputs, outputs, obligationValue: false, trace };
        result.explanation = describeWitness(scenario, result.witness);
        return result;
      }
    }
    result.complete = true;
    if (result.evaluatedCount === 0) {
      result.verdict = 'UNKNOWN';
      result.explanation = 'The selected finite domain contains no admissible inputs. No handoff behavior was verified.';
    } else {
      result.verdict = 'VALID_WITHIN_BOUND';
      result.explanation = `All ${result.evaluatedCount} admissible inputs in the disclosed finite domain satisfy the reviewed obligation (${result.excludedCount} excluded by constraints). This result applies only to these bounds and source revisions.`;
    }
    return result;
  } catch (error) {
    result.verdict = 'UNKNOWN';
    result.complete = false;
    result.witness = null;
    result.explanation = error instanceof Error ? error.message : 'Verification failed because the semantics could not be established.';
    return result;
  }
}

/**
 * Reviewed synthetic handoff fixtures. No fixture is a claim about a real company.
 * Every call returns a deep copy so a tenant's adopted mapping cannot mutate another.
 * AST: {op:'const',value}, {op:'var',name}, or {op, args:[...expressions]}.
 */
const C = value => ({ op: 'const', value });
const V = name => ({ op: 'var', name });
const O = (op, ...args) => ({ op, args });
const people = {
  product: ['Maya Chen', 'Product lead'],
  engineering: ['Noah Patel', 'Engineering lead'],
  billing: ['Sofia Reyes', 'Billing owner'],
  qa: ['Leo Martin', 'Quality engineer'],
  growth: ['Amara Okafor', 'Growth lead'],
  marketing: ['Ellis Park', 'Marketing lead'],
  sales: ['Priya Shah', 'Sales operations'],
  support: ['Sam Rivera', 'Support lead'],
  customer_success: ['Ari Morgan', 'Customer success lead'],
  data: ['Jordan Kim', 'Data engineer'],
  design: ['Robin Cole', 'Design lead'],
  security: ['Imani Brooks', 'Security lead'],
  operations: ['Alex Silva', 'Operations lead'],
  finance: ['Jamie Hart', 'Finance partner'],
  legal: ['Drew Tan', 'Policy reviewer'],
  leadership: ['Taylor Reed', 'Launch sponsor'],
};
const owner = departmentId => ({ id: `owner_${departmentId}`, departmentId, name: people[departmentId][0], role: people[departmentId][1] });
const input = (key, label, type, unit, values, defaultValue = values[0]) => ({ key, label, type, unit, values, defaultValue });
const source = (id, title, departmentId, text, type = 'document') => ({ id, title, departmentId, text, type, version: 1, reviewed: true });
const task = (title, departmentId, description) => ({ title, departmentId, ownerId: `owner_${departmentId}`, description });

function build(tenant) {
  const nova = tenant === 'nova';
  const prefix = tenant === 'acme' ? 'Orbit' : 'Nova';
  const tenantTitle = nova ? 'Nova Labs' : 'Acme Orbit';
  const trialScope = `${tenant}:standard-trial:v1`;
  const trialRules = [
    {
      id: 'trial_rule_product', name: 'promised_access_until', title: 'Product: promised access end', departmentId: 'product', sourceId: 'trial_source_product',
      expression: O('add', V(nova ? 'email_verified_day' : 'first_use_day'), C(14)), unit: 'day',
      statement: nova ? 'promised_access_until = email_verified_day + 14 days' : 'promised_access_until = first_use_day + 14 days',
    },
    {
      id: 'trial_rule_billing', name: 'first_charge_at', title: 'Billing: first charge', departmentId: 'billing', sourceId: 'trial_source_billing',
      expression: O('add', V('email_verified_day'), C(14)), unit: 'day', statement: 'first_charge_at = email_verified_day + 14 days',
    },
  ];
  const trial = {
    id: 'trial', title: 'The seven-day trial gap', subtitle: 'One word. Two clocks.', category: 'Event anchor', term: 'activated', scope: trialScope,
    summary: nova ? 'A control workspace whose public promise and billing rule both start at email verification.' : 'Product and Billing both agree on a 14-day trial. They disagree about when the customer becomes activated.',
    departmentIds: ['product', 'engineering', 'billing', 'qa'],
    promise: nova ? 'Every standard customer receives 14 trial days from email verification.' : 'Every standard customer receives 14 trial days from their first workspace use.',
    obligation: { id: 'trial_obligation', text: 'The first charge must not occur before the promised trial access expires.', expression: O('gte', V('first_charge_at'), V('promised_access_until')) },
    rules: trialRules,
    inputs: [input('email_verified_day', 'Email verified on day', 'number', 'day', [0, 7, 14], 0), input('first_use_day', 'First workspace use on day', 'number', 'day', [0, 7, 14, 21], 7)],
    constraints: [O('gte', V('first_use_day'), V('email_verified_day'))],
    suggestedInputs: { email_verified_day: 0, first_use_day: 7 },
    sources: [
      source('trial_source_product', `${prefix} trial experience specification`, 'product', nova ? 'Standard trial: fourteen days beginning when the customer verifies their email. All customer-facing trial promises use that event.' : 'Standard trial: customers get fourteen full days to try their workspace, beginning with their first actual workspace use. “Activated” in the launch brief refers to that first use.'),
      source('trial_source_engineering', 'Activation event contract', 'engineering', 'The identity service emits ACCOUNT_ACTIVATED immediately after successful email verification. Workspace interaction is recorded separately as WORKSPACE_FIRST_USED.', 'event contract'),
      source('trial_source_billing', 'Subscription scheduler mapping', 'billing', 'Subscribe to ACCOUNT_ACTIVATED. Set first_charge_at to the event timestamp plus fourteen days. This scheduler does not currently consume WORKSPACE_FIRST_USED.', 'configuration'),
      source('trial_source_qa', 'Trial acceptance checklist', 'qa', 'Verify email and open the workspace on day zero. Advance the clock fourteen days and confirm the scheduled first charge. The current checklist does not separate email verification from first use.', 'checklist'),
    ],
    definitions: [
      { id: 'trial_definition_product', term: 'activated', meaning: nova ? 'Email verification completed' : 'First actual workspace use', departmentId: 'product', ruleId: 'trial_rule_product', sourceId: 'trial_source_product' },
      { id: 'trial_definition_billing', term: 'activated', meaning: 'ACCOUNT_ACTIVATED event received after email verification', departmentId: 'billing', ruleId: 'trial_rule_billing', sourceId: 'trial_source_billing' },
    ],
    events: [
      { id: 'event_account_activated', name: 'ACCOUNT_ACTIVATED', meaning: 'Email verification succeeded', producerId: 'producer_identity', departmentId: 'engineering' },
      { id: 'event_workspace_first_used', name: 'WORKSPACE_FIRST_USED', meaning: 'The customer used the workspace for the first time', producerId: 'producer_workspace', departmentId: 'engineering' },
    ],
    producers: [
      { id: 'producer_identity', name: 'Identity service', departmentId: 'engineering', sourceId: 'trial_source_engineering', reviewed: true },
      { id: 'producer_workspace', name: 'Workspace service', departmentId: 'engineering', sourceId: 'trial_source_engineering', reviewed: true },
    ],
    expectedVerdict: nova ? 'VALID_WITHIN_BOUND' : 'VIOLATED',
    resolution: { choices: [
      { id: 'honor_first_use', label: 'Honor the first-use promise', description: 'Move the billing anchor to first workspace use and add a delayed-activation acceptance test.',
        ruleUpdates: [{ ruleId: 'trial_rule_billing', expression: O('add', V('first_use_day'), C(14)), statement: 'first_charge_at = first_use_day + 14 days', reviewed: true, reason: 'Approved cross-department mapping to the first-use promise.' }],
        taskTemplates: [task('Connect billing to WORKSPACE_FIRST_USED', 'engineering', 'Implement and review the event mapping. Attach the change or deployment evidence.'), task('Update the first-charge scheduler', 'billing', 'Apply the approved first-use clock and attach configuration evidence.'), task('Test email verification seven days before first use', 'qa', 'Confirm day 14 does not charge and day 21 matches the promise; attach test evidence.')],
      },
      { id: 'align_public_promise', label: 'Approve an email-verification promise', description: 'Ask Product to approve revised customer wording. The existing promise stays in history; downstream communication and implementation remain human tasks.',
        ruleUpdates: [{ ruleId: 'trial_rule_product', expression: O('add', V('email_verified_day'), C(14)), statement: 'promised_access_until = email_verified_day + 14 days', reviewed: true, reason: 'Human-approved new trial mapping uses email verification.' }],
        taskTemplates: [task('Review and publish revised trial wording', 'product', 'Approve the new promise and attach the reviewed source revision.'), task('Review customer transition communication', 'support', 'Check treatment of customers on the old promise and attach the reviewed communication.'), task('Verify email-anchored trial acceptance cases', 'qa', 'Attach test evidence for the newly approved promise.')],
      },
    ] },
  };
  const beta = {
    id: 'beta', title: 'The invisible beta customer', subtitle: 'Activity without a human.', category: 'Eligibility', term: 'active workspace', scope: `${tenant}:beta-invitation:v1`,
    summary: 'Growth counts automated activity as active. The beta requires a human session, and the invitation handoff promises that every invitee is eligible.',
    departmentIds: ['growth', 'product', 'data'], promise: 'Every workspace invited by Growth can enter the beta.',
    obligation: { id: 'beta_obligation', text: 'If Growth sends a beta invitation, Product must consider that workspace eligible.', expression: O('or', O('not', V('will_invite')), V('is_eligible')) },
    rules: [
      { id: 'beta_rule_growth', name: 'will_invite', title: 'Growth: invitation audience', departmentId: 'growth', sourceId: 'beta_source_growth', statement: 'will_invite = human_sessions > 0 OR automation_runs > 0', expression: O('or', O('gt', V('human_sessions'), C(0)), O('gt', V('automation_runs'), C(0))) },
      { id: 'beta_rule_product', name: 'is_eligible', title: 'Product: beta admission', departmentId: 'product', sourceId: 'beta_source_product', statement: 'is_eligible = human_sessions > 0', expression: O('gt', V('human_sessions'), C(0)) },
    ],
    inputs: [input('human_sessions', 'Human sessions in the last seven days', 'number', 'count', [0, 1, 3], 0), input('automation_runs', 'Automation runs in the last seven days', 'number', 'count', [0, 1, 10], 1)], constraints: [], suggestedInputs: { human_sessions: 0, automation_runs: 1 },
    sources: [
      source('beta_source_growth', 'Beta audience segment', 'growth', 'Invite active workspaces. The active segment includes a human session OR an automated job in the last seven days. Every invited workspace must pass beta eligibility.', 'segment definition'),
      source('beta_source_product', 'Beta access policy', 'product', 'Beta admission requires at least one human session in the last seven days. Automation-only workspaces are not eligible.', 'policy'),
      source('beta_source_data', 'Activity field dictionary', 'data', 'human_sessions counts authenticated interactive sessions. automation_runs counts unattended scheduled jobs. The counters describe distinct kinds of activity.', 'data dictionary'),
    ],
    definitions: [
      { id: 'beta_definition_growth', term: 'active workspace', meaning: 'Human or automated activity', departmentId: 'growth', ruleId: 'beta_rule_growth', sourceId: 'beta_source_growth' },
      { id: 'beta_definition_product', term: 'active workspace', meaning: 'At least one human session', departmentId: 'product', ruleId: 'beta_rule_product', sourceId: 'beta_source_product' },
    ], expectedVerdict: 'VIOLATED',
    resolution: { choices: [{ id: 'align_invite_eligibility', label: 'Invite only human-active workspaces', description: 'Align the invitation audience to the reviewed beta admission condition.',
      ruleUpdates: [{ ruleId: 'beta_rule_growth', expression: O('gt', V('human_sessions'), C(0)), statement: 'will_invite = human_sessions > 0', reviewed: true, reason: 'The invitation handoff must guarantee beta eligibility.' }],
      taskTemplates: [task('Update the beta audience segment', 'growth', 'Change the reviewed segment and attach the saved audience definition.'), task('Verify automation-only exclusion', 'data', 'Show that an automation-only workspace is excluded without excluding human-active workspaces.')],
    }] },
  };
  const threshold = {
    id: 'threshold', title: 'The boundary nobody tested', subtitle: 'At 100, agreement breaks.', category: 'Boundary condition', term: 'qualified', scope: `${tenant}:qualified-lead:v1`,
    summary: 'Sales promises priority routing from a score of 100. The implementation uses a strict greater-than comparison.',
    departmentIds: ['sales', 'engineering', 'qa'], promise: 'Every lead scoring 100 or more receives priority routing.',
    obligation: { id: 'threshold_obligation', text: 'Every lead promised priority routing must receive it.', expression: O('or', O('not', V('priority_promised')), V('priority_routed')) },
    rules: [
      { id: 'threshold_rule_sales', name: 'priority_promised', title: 'Sales: qualification policy', departmentId: 'sales', sourceId: 'threshold_source_sales', statement: 'priority_promised = score >= 100', expression: O('gte', V('score'), C(100)) },
      { id: 'threshold_rule_engineering', name: 'priority_routed', title: 'Engineering: router predicate', departmentId: 'engineering', sourceId: 'threshold_source_engineering', statement: 'priority_routed = score > 100', expression: O('gt', V('score'), C(100)) },
    ],
    inputs: [input('score', 'Lead score', 'number', 'points', [0, 99, 100, 101, 150], 100)], constraints: [], suggestedInputs: { score: 100 },
    sources: [source('threshold_source_sales', 'Priority routing agreement', 'sales', 'A qualified lead has a score of at least 100. All qualified leads must reach the priority queue.', 'agreement'), source('threshold_source_engineering', 'Router rule configuration', 'engineering', 'Priority queue predicate: score > 100. Standard queue handles all other scores.', 'configuration'), source('threshold_source_qa', 'Routing regression examples', 'qa', 'Existing examples cover scores 99 and 101. Score 100 is not covered.', 'checklist')],
    definitions: [{ id: 'threshold_definition_sales', term: 'qualified', meaning: 'Score of 100 or more', departmentId: 'sales', ruleId: 'threshold_rule_sales', sourceId: 'threshold_source_sales' }, { id: 'threshold_definition_engineering', term: 'qualified', meaning: 'Score strictly above 100', departmentId: 'engineering', ruleId: 'threshold_rule_engineering', sourceId: 'threshold_source_engineering' }], expectedVerdict: 'VIOLATED',
    resolution: { choices: [{ id: 'include_boundary', label: 'Include the promised boundary', description: 'Adopt the inclusive comparison in priority routing.', ruleUpdates: [{ ruleId: 'threshold_rule_engineering', expression: O('gte', V('score'), C(100)), statement: 'priority_routed = score >= 100', reviewed: true, reason: 'The agreed qualification threshold includes exactly 100.' }], taskTemplates: [task('Update the priority routing predicate', 'engineering', 'Attach the reviewed inclusive comparison change.'), task('Add the exact-100 regression case', 'qa', 'Attach a passing regression test at the boundary and adjacent values.')] }] },
  };
  const bundle = {
    id: 'bundle', title: 'The inclusive bundle', subtitle: 'Any is not every.', category: 'Boolean condition', term: 'bundle eligible', scope: `${tenant}:analytics-export-bundle:v1`,
    summary: 'The bundle contract requires both analytics and exports. Provisioning grants the bundle when either capability is present.',
    departmentIds: ['product', 'engineering', 'finance'], promise: 'Grant the combined bundle only to workspaces entitled to both analytics and exports.',
    obligation: { id: 'bundle_obligation', text: 'A granted combined bundle must satisfy every required capability entitlement.', expression: O('or', O('not', V('bundle_granted')), V('bundle_promised')) },
    rules: [
      { id: 'bundle_rule_product', name: 'bundle_promised', title: 'Product: bundle entitlement', departmentId: 'product', sourceId: 'bundle_source_product', statement: 'bundle_promised = has_analytics AND has_exports', expression: O('and', V('has_analytics'), V('has_exports')) },
      { id: 'bundle_rule_engineering', name: 'bundle_granted', title: 'Engineering: provisioning guard', departmentId: 'engineering', sourceId: 'bundle_source_engineering', statement: 'bundle_granted = has_analytics OR has_exports', expression: O('or', V('has_analytics'), V('has_exports')) },
    ],
    inputs: [input('has_analytics', 'Analytics entitlement', 'boolean', null, [false, true], false), input('has_exports', 'Export entitlement', 'boolean', null, [false, true], true)], constraints: [], suggestedInputs: { has_analytics: false, has_exports: true },
    sources: [source('bundle_source_product', 'Combined bundle eligibility', 'product', 'The combined bundle is eligible only when a workspace holds every required entitlement: analytics AND exports.', 'specification'), source('bundle_source_engineering', 'Bundle provisioning guard', 'engineering', 'Grant the combined bundle when has_analytics OR has_exports is true.', 'configuration'), source('bundle_source_finance', 'Bundle reconciliation handoff', 'finance', 'Every provisioned combined bundle must be supported by both billed entitlements. One entitlement alone is insufficient.', 'agreement')],
    definitions: [{ id: 'bundle_definition_product', term: 'bundle eligible', meaning: 'Every required entitlement is present', departmentId: 'product', ruleId: 'bundle_rule_product', sourceId: 'bundle_source_product' }, { id: 'bundle_definition_engineering', term: 'bundle eligible', meaning: 'At least one required entitlement is present', departmentId: 'engineering', ruleId: 'bundle_rule_engineering', sourceId: 'bundle_source_engineering' }], expectedVerdict: 'VIOLATED',
    resolution: { choices: [{ id: 'require_all_capabilities', label: 'Require both entitlements', description: 'Use the approved all-capabilities condition for the combined bundle.', ruleUpdates: [{ ruleId: 'bundle_rule_engineering', expression: O('and', V('has_analytics'), V('has_exports')), statement: 'bundle_granted = has_analytics AND has_exports', reviewed: true, reason: 'The combined bundle requires both reviewed entitlements.' }], taskTemplates: [task('Correct the bundle provisioning guard', 'engineering', 'Attach the reviewed AND guard change.'), task('Reconcile mixed-entitlement workspaces', 'finance', 'Review affected workspaces and attach reconciliation evidence.')] }] },
  };
  const equivalent = {
    id: 'equivalent', title: 'Different words, same promise', subtitle: 'A useful negative control.', category: 'Compatible meanings', term: 'within quota', scope: `${tenant}:request-quota:v1`,
    summary: 'Support describes a quota inclusively. Engineering uses the equivalent negated comparison. The finite check finds no violated handoff.',
    departmentIds: ['support', 'engineering'], promise: 'Requests at or below the quota remain permitted.',
    obligation: { id: 'equivalent_obligation', text: 'The request admission result must match the reviewed quota promise within this handoff.', expression: O('eq', V('access_promised'), V('access_permitted')) },
    rules: [
      { id: 'equivalent_rule_support', name: 'access_promised', title: 'Support: quota promise', departmentId: 'support', sourceId: 'equivalent_source_support', statement: 'access_promised = request_count <= 100', expression: O('lte', V('request_count'), C(100)) },
      { id: 'equivalent_rule_engineering', name: 'access_permitted', title: 'Engineering: admission check', departmentId: 'engineering', sourceId: 'equivalent_source_engineering', statement: 'access_permitted = NOT (request_count > 100)', expression: O('not', O('gt', V('request_count'), C(100))) },
    ],
    inputs: [input('request_count', 'Request count', 'number', 'count', [0, 1, 99, 100, 101, 200], 100)], constraints: [], suggestedInputs: { request_count: 100 },
    sources: [source('equivalent_source_support', 'Published quota explanation', 'support', 'Within the standard quota, up to and including 100 requests are permitted.', 'help article'), source('equivalent_source_engineering', 'Quota admission predicate', 'engineering', 'Permit a request when NOT (request_count > 100).', 'configuration')],
    definitions: [{ id: 'equivalent_definition_support', term: 'within quota', meaning: 'At most 100 requests', departmentId: 'support', ruleId: 'equivalent_rule_support', sourceId: 'equivalent_source_support' }, { id: 'equivalent_definition_engineering', term: 'within quota', meaning: 'Not above 100 requests', departmentId: 'engineering', ruleId: 'equivalent_rule_engineering', sourceId: 'equivalent_source_engineering' }], expectedVerdict: 'VALID_WITHIN_BOUND', resolution: { choices: [] },
  };
  const unknown = {
    id: 'unknown', title: 'The missing event owner', subtitle: 'Evidence before certainty.', category: 'Missing evidence', term: 'settled', scope: `${tenant}:settlement-confirmation:v1`,
    summary: 'Finance relies on a settled event, but the reviewed producer contract is missing. PARALLAX must ask for evidence before verifying the handoff.',
    departmentIds: ['finance', 'engineering', 'operations'], promise: 'A settlement confirmation is sent only after settlement is complete.',
    obligation: { id: 'unknown_obligation', text: 'A settlement confirmation requires evidence of completed settlement.', expression: O('or', O('not', V('confirmation_sent')), V('settlement_complete')) },
    rules: [
      { id: 'unknown_rule_finance', name: 'confirmation_sent', title: 'Finance: confirmation trigger', departmentId: 'finance', sourceId: 'unknown_source_finance', statement: 'confirmation_sent = settled_event_seen', expression: V('settled_event_seen') },
      { id: 'unknown_rule_engineering', name: 'settlement_complete', title: 'Engineering: settlement mapping', departmentId: 'engineering', sourceId: 'unknown_source_engineering', statement: 'settlement_complete = bank_settlement_complete (interpretation awaiting review)', expression: V('bank_settlement_complete'), reviewed: false },
    ],
    inputs: [input('settled_event_seen', 'SETTLED event observed', 'boolean', null, [false, true], true), input('bank_settlement_complete', 'Bank settlement complete', 'boolean', null, [false, true], false)], constraints: [], suggestedInputs: { settled_event_seen: true, bank_settlement_complete: false },
    sources: [source('unknown_source_finance', 'Settlement confirmation procedure', 'finance', 'Send the settlement confirmation on SETTLED. Confirmations must only describe completed settlement.', 'procedure'), { ...source('unknown_source_engineering', 'Unreviewed settlement event note', 'engineering', 'Draft note: SETTLED may mean bank settlement complete. The event producer, timing guarantee and owner still need review.', 'draft note'), reviewed: false }],
    evidenceRequirements: [{ id: 'unknown_producer_review', label: 'Reviewed SETTLED producer and timing contract', sourceId: 'unknown_source_engineering', reviewed: false }],
    definitions: [{ id: 'unknown_definition_finance', term: 'settled', meaning: 'SETTLED event received', departmentId: 'finance', ruleId: 'unknown_rule_finance', sourceId: 'unknown_source_finance' }, { id: 'unknown_definition_engineering', term: 'settled', meaning: 'Producer meaning has not been reviewed', departmentId: 'engineering', ruleId: 'unknown_rule_engineering', sourceId: 'unknown_source_engineering', reviewed: false }],
    events: [{ id: 'event_settled', name: 'SETTLED', meaning: 'Unreviewed producer semantics', producerId: null, departmentId: 'engineering' }], producers: [], expectedVerdict: 'UNKNOWN', resolution: { choices: [] },
  };
  return [trial, beta, threshold, bundle, equivalent, unknown].map(scenario => ({
    ...scenario, tenant, tenantTitle, revision: 1, synthetic: true,
    owners: scenario.departmentIds.map(owner),
    domain: Object.fromEntries(scenario.inputs.map(field => [field.key, [...field.values]])),
    obligation: { ...scenario.obligation, scope: scenario.scope, reviewed: true, revision: 1 },
    rules: scenario.rules.map(rule => ({ scope: scenario.scope, reviewed: true, revision: 1, ...rule })),
    definitions: (scenario.definitions || []).map(definition => ({ scope: scenario.scope, revision: 1, reviewed: true, ...definition })),
    events: scenario.events || [], producers: scenario.producers || [], evidenceRequirements: scenario.evidenceRequirements || [],
  }));
}

const tenants = new Set(['acme', 'nova']);
const fixtures = Object.fromEntries([...tenants].map(tenant => [tenant, build(tenant)]));

/** @returns {Array<Record<string, any>>} */
export function listScenarios(tenant = 'acme') {
  if (!tenants.has(tenant)) throw new Error(`Unknown tenant: ${String(tenant)}`);
  return structuredClone(fixtures[tenant]);
}

/** Return a deep copy of the scenario, or null for an unknown scenario ID. */
export function getScenario(id, tenant = 'acme') {
  return listScenarios(tenant).find(scenario => scenario.id === id) || null;
}

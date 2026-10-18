# Cypher query catalog

This catalog describes the queries used by PARALLAX and useful read-only inspection queries over the same implemented schema. **Application queries run against a graph already selected by the server's authenticated workspace context.** The public API and MCP catalog do not accept graph keys or arbitrary Cypher. Keep graph access on the server.

Source of truth: `lib/server/seed.mjs`, `service.mjs`, `verification.mjs` and `db.mjs`. The official `falkordb@6.8.0` client uses `{params, TIMEOUT}`; `TIMEOUT` is uppercase. `roQuery` invokes GRAPH.RO_QUERY, which the test suite checks rejects mutation.

## Execution pattern

```js
import { graphFor } from './lib/server/db.mjs';

// ctx was already created by the server's session and tenant boundary.
const graph = await graphFor(ctx);
const reply = await graph.roQuery(
  'MATCH (h:Handoff {id:$id}) RETURN properties(h) AS entity',
  { params: { id: 'trial' }, TIMEOUT: 5000 }
);
const rows = reply.data ?? [];
```

Graph data has two forms: scalar fields support Cypher matching/indexing; each entity's `dataJson` contains its structured fields. Use `hydrate` from `lib/server/util.mjs` after returning `properties(n)` to recover expressions, bounds, memory versions and nested trace information. A JSON property belongs to its specific node; the complete workspace is not one JSON blob.

## Q01. Discover handoffs

**Used by:** `find_handoffs`, Overview and Handoffs. **Access:** read-only. **Parameter:** `id` is empty for all handoffs or a stable scenario ID.

```cypher
MATCH (h:Handoff)
WHERE $id = "" OR h.id = $id
RETURN properties(h) AS entity
ORDER BY h.id
```

The service then loads each handoff's current rules, sources and graph-linked owners. A handoff's stored title or terminology difference does not itself establish a violation.

## Q02. Inspect current definition-to-rule provenance

**Purpose:** explain which current rule implements each reviewed definition. **Access:** read-only. **Parameter:** `id = "trial"`.

```cypher
MATCH (h:Handoff {id:$id})-[:USES_DEFINITION]->(d:Definition)
      -[:IMPLEMENTED_BY]->(r:Rule)-[:SOURCED_FROM]->(s:SourceRevision)
WHERE r.current = true
RETURN d.id AS definitionId, d.meaning AS meaning,
       properties(r) AS rule, properties(s) AS source
ORDER BY definitionId
```

Rule versions have IDs such as `trial_rule_billing@1`, a stable logical `ruleId`, and a `current` flag. Historical `IMPLEMENTED_BY` and `COMPARES` relationships remain, so a current-state read must filter `current=true`. Inspecting all versions without that filter is a history query.

## Q03. Trace reviewed evidence through up to six hops

**Used by:** `trace_evidence`. **Access:** read-only. **Parameter:** `id` is the scenario ID.

```cypher
MATCH p=(h:Handoff {id:$id})-
  [:HAS_OBLIGATION|USES_DEFINITION|COMPARES|IMPLEMENTED_BY|
    SOURCED_FROM|READS_EVENT|EMITTED_BY|OWNED_BY*1..6]->(n)
RETURN [x IN nodes(p) | x.id] AS nodes,
       [r IN relationships(p) | type(r)] AS relationships
LIMIT 100
```

The real service returns these paths together with the selected scope, revision, current sources and rules. Traversal covers both current and historical connections; the current rule/source selection provides the version context. The 100-path cap is a presentation and execution bound, not a claim to enumerate every path in a large graph.

In the trial fixture, a concrete chain is:

`trial -> trial_obligation -> trial_rule_billing@1 -> event_account_activated -> producer_identity -> trial_source_engineering@1`.

The relationship sequence is `HAS_OBLIGATION`, `COMPARES`, `READS_EVENT`, `EMITTED_BY`, `SOURCED_FROM`. This reveals what the event producer actually means by activation.

## Q04. Route to accountable owners with native shortestPath

**Used by:** `affected_owners`. **Access:** read-only. **Parameter:** `id` is a current handoff.

```cypher
MATCH (h:Handoff {id:$id}), (o:Person)
WITH o, shortestPath((h)-[*1..6]->(o)) AS p
WHERE p IS NOT NULL
RETURN properties(o) AS entity,
       [n IN nodes(p) | n.id] AS path,
       length(p) AS distance
ORDER BY distance
```

This uses FalkorDB's native path function, with resolved endpoints in `WITH`. On the verified 4.16.3 engine, placing `p=shortestPath(...)` directly in a MATCH pattern is not the supported syntax. Results explain graph reachability, not a communication already sent. The seed's `ASSIGNED_TO` edges connect the handoff to its accountable people. [Official function reference](https://docs.falkordb.com/cypher/functions).

## Q05. Search exact source text

**Used by:** Knowledge graph search. **Access:** read-only. **Parameter:** `text` is a bounded, sanitized search string.

```cypher
CALL db.idx.fulltext.queryNodes('SourceRevision', $text)
YIELD node, score
RETURN node.id AS id, score
ORDER BY score DESC
LIMIT 20
```

The seed creates the full-text index on SourceRevision `text` and `title`. The search runs inside the already selected tenant graph. Results are lexical entry points into the graph; no embeddings or vector recall are claimed. Input is limited to 120 characters and punctuation outside the permitted character set is removed before the call. [Official full-text reference](https://docs.falkordb.com/cypher/indexing/fulltext-index).

## Q06. Retrieve a verification's exact evidence

**Purpose:** inspect a durable proof record. **Access:** read-only. **Parameter:** `id` is an existing verification ID returned by the API.

```cypher
MATCH (v:VerificationRun {id:$id})-[:CHECKED]->(h:Handoff)
OPTIONAL MATCH (v)-[:FOUND]->(c:Counterexample)
RETURN properties(v) AS verification,
       h.id AS scenarioId, properties(c) AS witness
```

```cypher
MATCH (v:VerificationRun {id:$id})-[:USED_RULE]->(r:Rule)
RETURN properties(r) AS rule
ORDER BY r.id
```

```cypher
MATCH (v:VerificationRun {id:$id})-[:USED_SOURCE]->(s:SourceRevision)
RETURN properties(s) AS source
ORDER BY s.id
```

These are three separate read queries. Hydrate the verification node to inspect declared/effective domains, source/rule snapshots, checker version and completeness. A witness with `complete=false` is still conclusive for that input. A passing selected-input check is not a full-domain result.

## Q07. Inspect pending human follow-through

**Purpose:** connect cases, tasks, decisions and owners. **Access:** read-only. **Parameter:** `id` is a case ID.

```cypher
MATCH (c:Case {id:$id})-[:HAS_TASK]->(t:Task)
      -[:ASSIGNED_TO]->(o:Person)
MATCH (t)-[:IMPLEMENTS]->(d:Decision)
RETURN c.status AS caseStatus,
       properties(t) AS task, properties(o) AS owner,
       d.title AS approvedChoice
ORDER BY t.createdAt, t.id
```

Read task state and evidence independently of the approved choice. `Decision-[:RESOLVES]->Case` exists on approval to record intent; it is not a substitute for `Case.status="resolved"` and a fresh verification.

## Q08. Compare old and adopted evidence

**Purpose:** inspect source/rule history after review or resolution. **Access:** read-only. **Parameter:** `scenarioId`.

```cypher
MATCH (new:Rule {scenarioId:$scenarioId})-[:SUPERSEDES]->(old:Rule)
MATCH (new)-[:SOURCED_FROM]->(s:SourceRevision)
RETURN new.ruleId AS ruleId,
       old.revision AS previousRevision,
       new.revision AS nextRevision,
       new.current AS current,
       properties(s) AS adoptedSource
ORDER BY ruleId, nextRevision
```

```cypher
MATCH (c:Case {id:$id})-[:BASED_ON|VERIFIED_BY]->(v:VerificationRun)
RETURN v.id AS verificationId, v.verdict AS verdict,
       v.scenarioRevision AS scenarioRevision, v.createdAt AS createdAt
ORDER BY createdAt
```

The latter returns the original case evidence and, after resolution, the new verification. It does not overwrite the old witness. These examples intentionally retain history instead of assuming that the first adjacent rule is current.

## Q09. Read memory and decide applicability

**Purpose:** inspect graph-linked scenario memory. **Access:** read-only. **Parameter:** `id` is a scenario.

```cypher
MATCH (m:Memory)-[:APPLIES_TO]->(h:Handoff {id:$id})
RETURN properties(m) AS memory, h.revision AS currentRevision
ORDER BY m.createdAt DESC
```

Hydrate each memory and compare its `versions.scenarioRevision` with `currentRevision`. `recallMemory` performs this check in application code and also includes the current graph's workspace procedure. It returns separate `accepted` and `rejected` lists. There is no cross-tenant memory search, and no claim that a semantic embedding independently validated a memory.

## Q10. Inspect actual tool receipts

**Used by:** Agent activity. **Access:** read-only. **Parameter:** `id` is a run ID.

```cypher
MATCH (r:AgentRun {id:$id})-[:USED_TOOL]->(t:ToolCall)
RETURN r.status AS runStatus, r.mode AS mode,
       t.tool AS tool, t.status AS toolStatus,
       t.startedAt AS startedAt, t.durationMs AS durationMs,
       t.argsJson AS argsJson, t.resultJson AS resultJson
ORDER BY startedAt
```

The graph stores real receipt data and the named role on ToolCall. The public service strips lease tokens and payload hashes. Avoid broad `properties(r)` dumps in operator logs: private coordination fields belong only on the server.

## Q11. Inspect the latest measured lab

**Used by:** Verification & audit. **Access:** read-only.

```cypher
MATCH (v:VerificationReport)
RETURN properties(v) AS entity
ORDER BY v.createdAt DESC
LIMIT 1
```

Hydrate to read `report`. An empty result means the lab has not run. Counts and latency are generated by actual requests, not seeded outcomes. The lab's temporary VerificationCounter, VerificationReceipt and VerificationMarker nodes are removed with its fixture graphs.

## Q12. The atomic approval pattern

**Used by:** `approveDecision`. **Access:** mutation; invoke the application service rather than composing this from browser input.

The core guard and writes are one query. The service prepares every property map, verifies the reviewed choice and hashes the complete operation payload before executing:

```cypher
MATCH (c:Case {id:$caseId})-[:ABOUT]->(h:Handoff)
OPTIONAL MATCH (cmd:Command {id:$commandId})
WITH c,h,cmd
WHERE cmd IS NULL
  AND c.revision=$expectedRevision
  AND c.scenarioRevision=h.revision
  AND c.status IN ['open','decision_proposed']
CREATE (newcmd:Entity:Command {
  id:$commandId, payloadHash:$payloadHash,
  resultJson:$result, createdAt:$timestamp, type:'Command'
})
CREATE (d:Entity:Decision)
SET d=$decision
CREATE (c)-[:HAS_DECISION]->(d)
CREATE (d)-[:RESOLVES]->(c)
SET c.status='implementation_pending', c.revision=c.revision+1,
    c.decisionId=$decisionId, c.updatedAt=$timestamp
FOREACH (row IN $tasks |
  CREATE (t:Entity:Task) SET t=row
  CREATE (c)-[:HAS_TASK]->(t)
  CREATE (t)-[:IMPLEMENTS]->(d)
  MERGE (o:Entity:Person {id:row.ownerId})
  CREATE (t)-[:ASSIGNED_TO]->(o)
)
FOREACH (row IN $memories |
  CREATE (m:Entity:Memory) SET m=row
  CREATE (m)-[:LEARNED_FROM]->(d)
  CREATE (m)-[:APPLIES_TO]->(h)
)
CREATE (a:Entity:AuditEvent) SET a=$audit
CREATE (a)-[:AFFECTED]->(c)
CREATE (newcmd)-[:CAUSED]->(d)
RETURN c.id AS id
```

The result is either one accepted transition or no matching transition. The service then checks durable replay and returns an HTTP 409 for a genuinely stale revision. Exact replay returns the stored result. A reused command ID with different payload is rejected. Application revisions are ordinary properties; the GRAPH.QUERY schema-cache version option is not used for concurrency.

The 16-writer test expects one accepted approval, fifteen revision conflicts, one decision and one task set. Read the generated report for what a specific run actually measured. [FalkorDB concurrency documentation](https://docs.falkordb.com/design/concurrency).

## Q13. Lease fencing on agent mutations

**Used by:** agent-originated verification/case writes and receipt completion. A server-owned clause is included inside the same mutation:

```cypher
MATCH (activeRun:AgentRun {id:$activeRunId})
WHERE activeRun.fence=$activeFence
  AND activeRun.leaseToken=$activeLease
  AND activeRun.leaseExpiresAt>timestamp()
  AND activeRun.status='running'
```

This is a guard excerpt, not a complete query. If a new worker has reclaimed the expired run, old credentials no longer match. Token/fence parameters are injected by the orchestrator and are absent from the public tool schema. No process-local lock is used as the application correctness boundary.

## Schema helpers and inspection

The actual seed calls these official SDK helpers:

```js
await graph.createNodeRangeIndex('Entity', 'id');
await graph.constraintCreate(
  ConstraintType.UNIQUE, EntityType.NODE, 'Entity', 'id'
);
await graph.createNodeFulltextIndex('SourceRevision', 'text', 'title');
```

Inspect schema with `CALL db.indexes()` and `CALL db.constraints()` using an operator-selected graph. A constraint declaration and an operational constraint are distinct; validate its reported status when preparing a new engine or migrating data. The app uses a uniqueness constraint and ID-producing constructors; it does not currently install the optional MANDATORY constraint illustrated in the broader resource notes.

For engine changes, run the suite against the exact hosted module. Do not infer compatibility from a package's major version alone. Queries are bounded, values are parameterized, and their authority comes from the application context, not from source text or model instructions.

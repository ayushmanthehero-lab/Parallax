# FalkorDB integration reference

Verified 2026-10-18 against official documentation and the published npm package declarations. This is an implementation reference, not evidence that a production database has been provisioned.

## Runtime and package versions

- Production client: `falkordb@6.8.0`; requires Node.js **22 or newer**.
- Local engine: `falkordblite@0.3.0`; declares Node >=20 but depends on `falkordb ^6.6.0`. Use Node >=22 for both.
- Lite provides actual Redis + FalkorDB processes over a Unix socket, without Docker. Use the verified Linux x64 binary package `@falkordblite/linux-x64@8.2.3-falkordb.4.16.3`. The upstream Lite 0.3.0 metadata declares an incorrect optional binary version; the project corrected that dependency explicitly.
- The project’s real-engine check reports FalkorDB module version `41603` (4.16.3) with AOF enabled. Current core documentation covers FalkorDB 6.0. Inspect the running module and test capabilities on both local and hosted versions; npm client versions and database engine versions are separate. AOF on local storage does not establish production durability.

Sources: [TypeScript client](https://github.com/FalkorDB/falkordb-ts), [published client metadata](https://registry.npmjs.org/falkordb/6.8.0), [Lite](https://github.com/FalkorDB/falkordblite-ts), [published Lite metadata](https://registry.npmjs.org/falkordblite/0.3.0), [FalkorDB 6.0](https://www.falkordb.com/blog/announcing-falkordb-6-0/).

## Connection and queries

Use the client in a server-only Node.js module. Read all connection settings from server environment variables; the hosted endpoint's port may differ from 6379. Match the instance's actual TLS setting. FalkorDB Cloud Free has no TLS.

```ts
import { FalkorDB } from "falkordb";

// Example for a TLS-enabled hosted instance.
const db = await FalkorDB.connect({
  username: process.env.FALKORDB_USERNAME,
  password: process.env.FALKORDB_PASSWORD,
  socket: {
    host: process.env.FALKORDB_HOST,
    port: Number(process.env.FALKORDB_PORT),
    tls: true,
    connectTimeout: 5000,
  },
});

const graph = db.selectGraph("server_selected_workspace_graph");
const result = await graph.roQuery<{ id: string }>(
  "MATCH (n:Entity {id:$id}) RETURN n.id AS id",
  { params: { id: "entity_1" }, TIMEOUT: 1500 },
);
const rows = result.data ?? [];
```

Published 6.8.0 details:

- `query<T>` and `roQuery<T>` return a reply with optional `data?: T[]` and metadata.
- Query timeout is uppercase **`TIMEOUT`**, not `timeout`.
- `QueryOptions` is not a top-level export in published 6.8.0, despite current GitHub `main` exporting it.
- `FalkorDB` is an EventEmitter; `await db.connection` returns its underlying node-redis connection.
- `close()` forcibly closes the client. Do not close a shared client at the end of every concurrent request.
- Parameterize values. For grammar positions that cannot be parameterized, select fixed server-owned query templates or validate a small integer/enum allowlist.

Sources: [connection settings](https://docs.falkordb.com/cloud/console/connect), [GRAPH.QUERY](https://docs.falkordb.com/commands/graph.query), and the `dist/*.d.ts` declarations in the published npm package.

## Local execution and persistence

```ts
import { FalkorDB } from "falkordblite";
const db = await FalkorDB.open({ path: "/absolute/local/dev-data" });
await db.selectGraph("parallax_test").query("RETURN 1");
await db.close();
```

`path` enables periodic local snapshots; omission uses a temporary directory. Lite is suitable for real-engine development and integration tests. A Lite process or files inside a Vercel Function are not the production system of record.

## Indexes and constraints

The actual published TS constraint API is **`graph.constraintCreate`**, not the website example `client.createConstraint`.

```ts
import { ConstraintType, EntityType } from "falkordb";

await graph.createNodeRangeIndex("Entity", "id");
await graph.constraintCreate(
  ConstraintType.UNIQUE, EntityType.NODE, "Entity", "id",
);
await graph.constraintCreate(
  ConstraintType.MANDATORY, EntityType.NODE, "Entity", "id",
);
const status = await graph.roQuery("CALL db.constraints()");
```

Run migrations deliberately. Constraints build asynchronously: the command returns `PENDING`; poll `db.constraints()` for `OPERATIONAL`, and treat `FAILED` as migration failure. UNIQUE needs a supporting range index and does not apply when constrained properties are missing/null or array-valued. Add MANDATORY for stable IDs.

```cypher
CREATE INDEX FOR (n:Entity) ON (n.id)
CALL db.idx.fulltext.createNodeIndex('Entity', 'name', 'description')
CALL db.idx.fulltext.queryNodes('Entity', $text)
YIELD node, score RETURN node.id AS id, score

CREATE VECTOR INDEX FOR (n:Entity) ON (n.embedding)
OPTIONS {dimension:384, similarityFunction:'cosine'}

CALL db.idx.vector.queryNodes('Entity','embedding',10,vecf32($embedding))
YIELD node, score RETURN node.id AS id, score
```

The snippets above are separate statements. Vector dimensions must match real embeddings; the documented metrics are `cosine` and `euclidean`. Use semantic matches as entry points into graph traversal. `CALL db.indexes()` and `graph.explain()` support validation.

Sources: [constraints](https://docs.falkordb.com/commands/graph.constraint-create), [range indexes](https://docs.falkordb.com/cypher/indexing/range-index), [full-text indexes](https://docs.falkordb.com/cypher/indexing/fulltext-index), [vector indexes](https://docs.falkordb.com/cypher/indexing/vector-index).

## Multi-hop queries and algorithms

| Behavior | Database operation |
|---|---|
| Dependency/impact exploration | `MATCH p=(a)-[:DEPENDS_ON*1..5]->(b)`; return `nodes(p)` and `relationships(p)` |
| Fewest-hop explanation | Resolve endpoints, then `WITH shortestPath((a)-[:DEPENDS_ON*1..6]->(b)) AS p RETURN p` |
| Weighted path | `CALL algo.SPpaths({sourceNode:a,targetNode:b,relTypes:['DEPENDS_ON'],weightProp:'cost',maxLen:6,pathCount:3}) YIELD path,pathWeight` |
| Neighborhood expansion | `CALL algo.bfs(start, depth, 'REL_TYPE') YIELD nodes, edges` |
| Influence and communities | PageRank, betweenness, WCC, CDLP; use each documented signature |

Always bound interactive traversal. `shortestPath` requires resolved endpoints, allows minimum length only 0 or 1, forbids property filters inside its pattern, and returns one shortest path or null. Use `allShortestPaths` when alternatives of the same minimum length matter. Keep stable application UUIDs in properties; internal `id()` values are not immutable.

Sources: [MATCH](https://docs.falkordb.com/cypher/match), [functions/path restrictions](https://docs.falkordb.com/cypher/functions), [BFS](https://docs.falkordb.com/algorithms/bfs), [SPpaths](https://docs.falkordb.com/algorithms/sppath), [algorithm catalog](https://docs.falkordb.com/algorithms), [Cypher coverage](https://docs.falkordb.com/cypher/cypher-support), [known limitations](https://docs.falkordb.com/cypher/known-limitations).

## Revisions, atomic edits, and isolation

`GRAPH.QUERY ... version n` is a **schema-cache version**, not an application content revision. Implement conflict checks as properties within the same write query as the edit and its audit record:

```cypher
MATCH (n:Entity {id:$id})
WHERE n.revision = $expectedRevision
SET n.title = $title, n.revision = n.revision + 1
RETURN n.revision AS revision
```

Current docs guarantee atomic single queries and serialized writers per graph. A zero-row conditional edit signals a missing entity or revision conflict. Verify concurrency and rollback on the exact deployed engine: two writes using one expected revision should produce one success. Do not infer application-wide multi-query rollback from Redis MULTI/EXEC.

Choose graph keys on the server from authenticated workspace identity. Cloud ACLs support key patterns and command permissions. Built-in Read/Write roles use `~*`; choose Custom ACLs for a narrower graph scope. Per-workspace graphs can simplify isolation for full-text and vector retrieval.

Sources: [atomicity/concurrency](https://docs.falkordb.com/design/concurrency), [schema version argument](https://docs.falkordb.com/commands/graph.query), [graph ACLs](https://docs.falkordb.com/cloud/operations/user-management).

## Vercel hosting and honest health reporting

Use Vercel Node.js Functions, a module-scoped lazy connection promise, bounded timeouts, and connection-error recovery. Fluid compute can reuse a connection within a warm instance; instances can still suspend or disappear and scaling increases connection counts. Locate functions near the hosted graph. `attachDatabasePool` compatibility with the FalkorDB wrapper has not been verified; SQL examples do not establish that compatibility.

Distinguish these states explicitly:

| Check | What it proves |
|---|---|
| HTTP liveness | The web function responds |
| Selected graph `RETURN 1` | The real graph server is reachable and can execute a query |
| Required indexes/constraints/migration revision | The graph is ready for this application version |
| Configured persistence + restart/restore verification | Committed data survives the relevant server/process lifecycle |

Database connectivity alone does not prove durability. Production readiness should fail when required hosted graph credentials or the real DB are unavailable. Report local-development mode accurately; do not silently present in-memory/sample fallback as persistent production storage. Never expose credentials in health output.

Sources: [Vercel Node runtime](https://vercel.com/docs/functions/runtimes/node-js), [Fluid compute connection guidance](https://vercel.com/kb/guide/connection-pooling-with-functions), [function limits](https://vercel.com/docs/functions/limitations).

### Current Vercel containers, Services, and Daemons

The current Vercel platform supports OCI container Functions and Services; this is broader than historical frontend-only hosting. However, container Functions expect an HTTP server, scale down after 5 minutes without production traffic (30 seconds in preview), and receive `SIGTERM` with a 30-second shutdown grace period. Larger bundles and longer function durations do not establish persistent database storage.

Vercel Daemons are a newer public beta for continuously running background containers, including Hobby within quota. Their documented beta limitations explicitly exclude **persistent local storage**, **inbound HTTP or TCP**, and **service bindings/rewrites**. They cannot directly serve as a durable FalkorDB endpoint. A custom queue-driven graph worker would still need external durable state and recovery semantics; it is not a provisioned graph database.

Sources: [container runtime](https://vercel.com/docs/functions/runtimes/container), [Services](https://vercel.com/docs/services), [Daemons](https://vercel.com/docs/daemons), [Daemons limits](https://vercel.com/docs/daemons/limits).

## Durable hosted database route

| FalkorDB Cloud tier | Relevant guarantees and limitations |
|---|---|
| Free | 100 MB, no card; no TLS, persistence, or backups; stops after 1 idle day, deletes after 7. Does not satisfy production durability. |
| Startup | TLS and scheduled backups, but no continuous persistence in the documented tier matrix. Confirm acceptable recovery-point guarantees before production. |
| Pro | Documented continuous persistence, high availability, TLS, and automated backups. Suitable managed starting point when these guarantees are required. |
| Self-hosted | Needs an actual persistent VM/container host, durable volume, explicitly configured persistence, TLS/authentication, backups, and restore verification. A source repository is not a host. |

Use a paid managed instance with appropriate durability guarantees, or an already-authorized persistent host. Obtain host/port/user/password/TLS from its console and configure only server-side Vercel environment variables. No paid service was provisioned during this research.

Read-only connected-account check on 2026-10-18: Vercel `list_integration_configurations(view:account)` returned no installations; `list_connectors(search:falkor)` returned none. Available storage tools expose Blob creation/store inspection and integration product/plan listing, but no general FalkorDB host creation tool. Vercel Blob/Global Config, Postgres, or generic Redis do not establish the presence of a FalkorDB engine.

A targeted Vercel documentation search returned generic Marketplace provisioning guidance, not a FalkorDB provider. No already-connected persistent compute provider or supported automated FalkorDB provisioning route was identified in the available tool metadata. This is an access/capability finding, not a claim that no Marketplace integration can ever exist. The deployment handoff needs an actual provisioned endpoint and credentials; do not mark production durability verified before that step.

Sources: [Cloud](https://docs.falkordb.com/cloud), [Free tier and matrix](https://docs.falkordb.com/cloud/tiers/free), [connection details](https://docs.falkordb.com/cloud/console/connect), [signup](https://app.falkordb.cloud/signup), [Vercel storage](https://vercel.com/docs/storage), [Marketplace](https://vercel.com/marketplace).

### Graph Hacks sponsor resources and Cloud trial check

The official Graph Hacks Resources page links the standard FalkorDB Cloud signup, local Docker setup, client libraries, SDKs, and videos. Neither that public resource page nor the organizer's event listing advertises a cloud-credit code, a sponsored persistent instance, or a special Pro trial. This finding does not rule out private participant offers; none was verified or assumed.

FalkorDB Cloud's documented free trial is its normal 100 MB Free tier, with the durability limitations above. Onboarding supports GitHub/Google sign-in or email registration, followed by a plan subscription. Paid instances require a payment method before running, except where billing is arranged by contract. A connected GitHub or Vercel integration does not by itself provide a FalkorDB Cloud account, credit entitlement, or database endpoint. No account, subscription, resource, or charge was created during this read-only investigation.

Sources: [official Graph Hacks Resources](https://www.wemakedevs.org/hackathons/falkordb/resources), [organizer's event listing](https://luma.com/graph-hacks), [Cloud overview and trial](https://docs.falkordb.com/cloud), [sign up and subscribe](https://docs.falkordb.com/cloud/console/sign-up), [billing requirements](https://docs.falkordb.com/cloud/console/billing).

## Optional agent integrations

- [FalkorDB-MCPServer](https://github.com/FalkorDB/FalkorDB-MCPServer): TypeScript/Node, stdio or Streamable HTTP, schema tools, parameterized queries, explicit read-only tool, TLS and HTTP bearer authentication. Enforce application permissions outside arbitrary raw-query access.
- [falkordb-mcp](https://github.com/FalkorDB/falkordb-mcp): separate Rust implementation, read-only by default with opt-in write tools.
- [GraphRAG SDK](https://docs.falkordb.com/graphrag/api-reference): Python SDK with `ingest`, `retrieve`, `completion`; current API prefers `ontology=` over deprecated `schema=`. Optional Python service, not a requirement for the TS application.
- [FalkorDB LangChain JS/TS integration](https://www.falkordb.com/blog/falkordb-langchain-js-ts-integration/): optional `@falkordb/langchain-ts` integration for existing LangChain workflows; direct Cypher repository logic does not require it.

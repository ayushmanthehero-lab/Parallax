# PARALLAX build ledger

Plan: docs/superpowers/plans/2026-10-18-parallax.md

## Authorized scope
Full architecture, workflow, design, implementation, Vercel deployment, narrated three-minute demo. User expressly requested completion in sequence; continue through reversible work without repeated design confirmations.

## Design review
- Reviewed domain semantics independently: shared obligations rather than arbitrary equality; four truthful outcomes; source revisions; approval/implementation separation.
- Reviewed hosting: persistent graph outside Vercel; actual FalkorDBLite for development.
- Network downloads require elevated proxy access, which succeeded; normal sandbox network was blocked.
- GitHub repository initialized: ayushmanthehero-lab/Parallax.
- Vercel project parallax-graph deployed at https://parallax-graph-sigma.vercel.app from the reviewed source files. Production deployment dpl_3uYhYUbiDgubFhXatyBfdKwNqsKA is READY. Anonymous page check returned HTTP 200; API health returned DATABASE_NOT_CONFIGURED / HTTP 503 until the hosted FalkorDB instance is connected.
- Three production secrets and AI Gateway configuration were saved in the authorized default account scope. No private value is included in the repository. The initial Git-source deployment failed with git_info_fail; deploying the same reviewed source files succeeded. Direct build-log retrieval was unavailable under the connector's scope.
- The user selected FalkorDB Cloud for the hosted database, then requested Docker on their own computer for local verification. FalkorDB is the actual database in either topology; Railway remains an optional self-hosting reference. No Railway service or volume has been provisioned.
- FalkorDB Cloud was opened, but the secure sign-in request was declined. No Cloud instance has been provisioned or inspected, and authentication was not retried. The hosted graph connection remains pending.

## Interface ownership
| Task pair | Shared contract | Resolution |
|---|---|---|
| Domain/server | verifyScenario result + scenario schema | Use lib/contracts.ts and exact JS exports from plan. |
| Server/client | API envelopes and endpoint names | docs/ARCHITECTURE.md is authoritative. |
| Server/agents | service operations and tenant context | MCP never accepts arbitrary graph names. |
| Agents/client | persisted traces + execution mode | UI shows actual provider mode and real receipts. |
| Deployment/recording | deployed health + running workflow | Capture verified interface, disclose any hosting blocker. |

## Progress
- Architecture and implementation plan written before application code.
- Complete application implemented, including reviewed source intake, bounded verification, actual MCP tools, human decision/task lifecycle, graph exploration, conversation and three memory types.
- Full local suite: 99 passing tests, including six new rule-provenance regressions and 17 authenticated gateway checks. Root independently reran the full suite and the production Next.js build after the final provenance fix; both passed.
- Full browser journey passed, including source review, task completion, resolution, graph search, persistent conversation, tenant switch and mobile layout.
- Real HTTP gateway verification: 15 of 15 checks passed; 16 workers acknowledged 128 writes and 128 reads, with one guarded approval, 15 stale rejections, no duplicates and no lost writes. See verification.json for measured local latency and storage scope.
- Official pinned FalkorDB process restored an acknowledged record from AOF after an orderly restart with its fixture RDB removed. SIGTERM drain regression passed. Host/volume disaster recovery is not established by these tests.
- The architecture PDF contains 16 visually reviewed pages. Fourteen documented read-only Cypher examples executed on a fresh actual FalkorDB fixture.
- The narrated demo is exactly 180.000 seconds, 1920×1080, with H.264 video, AAC audio and 46 caption cues. Its actual local browser workflow returned eight successful mutation requests, zero browser/API errors and 15 passing lab checks. It explicitly discloses synthetic data, real FalkorDB, guided MCP and local recording; no live Cloud or LLM execution is claimed. See demo-verification.json.
- The complete local Docker package is available in compose.yaml and deploy/local/. It pins the official multi-platform FalkorDB v4.16.3 image, mounts its exact data directory on a named volume, provides PARALLAX and the official graph Browser, and generates stable private settings. Its verification script passed all 15 checks against the running actual engine. The configuration, source inputs and secret handling were checked; image build/startup were not executed because this shared workspace has neither a Docker CLI nor a Docker socket, and this session exposes no connection to the user's computer.
- Published application source commit: 73d8da9a33a6c6ccdbf1ef5f61574e2dd4003c88. Source was independently retrieved from GitHub after publication.

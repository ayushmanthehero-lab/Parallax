# PARALLAX build ledger

Plan: docs/superpowers/plans/2026-10-18-parallax.md

## Authorized scope
Full architecture, workflow, design, implementation, Vercel deployment, narrated three-minute demo. User expressly requested completion in sequence; continue through reversible work without repeated design confirmations.

## Design review
- Reviewed domain semantics independently: shared obligations rather than arbitrary equality; four truthful outcomes; source revisions; approval/implementation separation.
- Reviewed hosting: persistent graph outside Vercel; actual FalkorDBLite for development.
- Network downloads require elevated proxy access, which succeeded; normal sandbox network was blocked.
- GitHub repository initialized: ayushmanthehero-lab/Parallax.
- Vercel project parallax-graph created; server secrets and AI Gateway configuration saved in the authorized default account scope. Public deployment remains to be created.
- Railway is installed, but its account controls are not exposed in the current session. No Railway service or volume has been provisioned.

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
- Full local suite: 93 passing tests, including 17 authenticated gateway checks. Production Next.js build passed.
- Full browser journey passed, including source review, task completion, resolution, graph search, persistent conversation, tenant switch and mobile layout.
- Real HTTP gateway verification: 15 of 15 checks passed; 16 workers acknowledged 128 writes and 128 reads, with one guarded approval, 15 stale rejections, no duplicates and no lost writes. See verification.json for measured local latency and storage scope.
- Official pinned FalkorDB process restored an acknowledged record from AOF after an orderly restart with its fixture RDB removed. SIGTERM drain regression passed. Host/volume disaster recovery is not established by these tests.
- Narration generated; production browser recording and architecture PDF are in progress.

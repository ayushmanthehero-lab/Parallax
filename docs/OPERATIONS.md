# PARALLAX operations guide

**The selected hosted route is Vercel → official FalkorDB SDK → FalkorDB Cloud.** FalkorDB stores connected evidence, actions, agent memory and shared state. Vercel hosts the application. The authenticated self-hosted gateway and Railway instructions are optional reproducibility references; Cloud does not require Railway. Keep the release's actual URLs, deployed commit, health checks and measured test results in [reports/PROGRESS.md](../reports/PROGRESS.md). Configuration files are not evidence that deployment succeeded.

**Observed deployment checkpoint, 18 October 2026:** source is published in [GitHub](https://github.com/ayushmanthehero-lab/Parallax), and [the Vercel homepage](https://parallax-graph-sigma.vercel.app) is public with HTTP 200. Its API health returns `503 DATABASE_NOT_CONFIGURED` pending its FalkorDB Cloud connection; no provisioned Cloud instance is claimed at this checkpoint. Local HTTP-gateway verification passed all 15 lab checks; host durability remains unconfirmed. This is a partial deployment checkpoint, not completion of the hosted release gates below. The release record is the current status authority.

## 1. Local development

### Local Docker workflow

Use this path to check PARALLAX and the actual FalkorDB graph on your computer. Prerequisites are a running Docker Desktop or Docker Engine, Compose v2 and Node.js 24 for the private configuration helper. Clone the repository, then run from its root:

```bash
node scripts/docker-setup.mjs
docker compose --env-file .env.docker.local up --build --wait
docker compose --env-file .env.docker.local ps
```

The local environment file is generated once with private random secrets. The helper retains valid existing settings and refuses to replace a malformed existing file. Preserve it with the named data volume: the application signing secret and visitor cookie are part of workspace continuity. Compose builds the application itself; host installation of the project's npm dependencies is not required. `--wait` waits for container health while running the services in the background. If host Node.js is unavailable, the [Docker-only setup commands](../deploy/local/README.md#start) cover macOS/Linux and PowerShell.

The `app` service serves [PARALLAX at localhost:3000](http://localhost:3000). The official `falkordb` image supplies both the database and [FalkorDB Browser at localhost:3002](http://localhost:3002). The app connects through the official SDK to `falkordb:6379` inside the Compose network. Host ports bind to loopback. This local password-authenticated connection is separate from the selected public Cloud connection, which requires TLS.

The named volume mounts at `/var/lib/falkordb/data`, the official image's **actual configured data directory**. Its startup script appends its own `--dir` after `REDIS_ARGS`; an arbitrary `/data` mount is not sufficient unless `FALKORDB_DATA_PATH` agrees with it. The checked-in Compose recipe pins `falkordb/falkordb:v4.16.3` by digest, enables AOF with `appendfsync always` and retains storage across ordinary container recreation. Exact image pins, paths and browser credentials are documented in [deploy/local/README.md](../deploy/local/README.md).

If FalkorDB Browser shows a connection form, use `localhost`, port `6379`, username `default` and the generated `FALKORDB_PASSWORD` from the local Docker configuration. The Browser server and database share the FalkorDB container, so this hostname is valid there. The web app uses the separate Compose service hostname `falkordb`. Automatic Browser connection is not assumed. `FALKORDB_BROWSER_ENABLED=0` disables the optional browser when recreating the service.

Run the included verification command after the app is healthy:

```bash
docker compose --env-file .env.docker.local exec app node deploy/local/verify.mjs
```

It checks the running HTTP service, runs the actual verification lab using the same database settings, prints the measured report and removes its temporary verification graph. The script itself has been checked against the real local engine; that does not establish that a Docker image was built or started.

Verify on the actual computer before claiming this route is running:

1. Confirm both Compose services report healthy and application `/api/health` reports a real FalkorDB connection.
2. Open the application at a consistent hostname and run the trial investigation. Check the witness and actual tool receipts.
3. Approve a choice, leave its human tasks pending and record a case/task identifier. Reload and confirm the pending state.
4. Run **Verification & audit** and retain that machine's measured report.
5. Run `docker compose --env-file .env.docker.local down`, then start again with the same `up --build --wait` command. Confirm the original case, task and memory return under the same cookie and signing secret.
6. Inspect the seeded `parallax_...` graph in FalkorDB Browser. The [query guide](QUERIES.md) supplies actual Cypher patterns; the app's scoped MCP tools remain the normal agent interface.

Ordinary `down` retains named volumes. Adding `--volumes` or `-v` removes them and deletes the stored graph. A successful same-volume restart does not establish protection against disk loss or prove backup restoration. Use the local guide's recovery procedure and retain the original volume when investigating a fault.

**Docker execution has not been verified on the user's computer or in this environment:** no local Docker daemon is available here. Source/configuration checks and the separately measured real FalkorDB tests do not imply a successful Docker build, container startup or restart on another machine. Record those outcomes after running the commands above.

### Native Node.js development

Use Node 24; the official client requires Node >=22. Install the root lockfile with `npm ci`. Follow [README](../README.md#native-nodejs-development) to generate a unique `.env.local` signing secret. Never put private values into source control or `NEXT_PUBLIC_` variables.

Run `npm run db` in one terminal and `npm run dev` in another. The default local database directory is `/tmp/parallax-falkordb`. It enables AOF with `appendfsync everysec`, writes periodic snapshots, and maintains a stable `redis.sock` symlink. This directory is disposable; host cleanup can remove it.

For an explicit persistent development directory, choose a path you own:

```bash
PARALLAX_DB_PATH=/absolute/path/to/parallax-data npm run db
```

Set `FALKORDB_SOCKET=/absolute/path/to/parallax-data/redis.sock` in the web environment. The database launcher and standalone scripts read process environment settings, not Next.js's automatic `.env.local` loader. `node --env-file=.env.local scripts/verify.mjs` loads that file explicitly on Node 24.

The gateway container is the reproducible Linux x64 alternative when a local native binary cannot load. Its Trixie base supplies the verified native ABI. Follow [deploy/gateway/README.md](../deploy/gateway/README.md) for build, volume and smoke-test commands.

## 2. Configuration reference

### Web application secrets and connections

| Setting | Meaning |
|---|---|
| `PARALLAX_SESSION_SECRET` | Required on Vercel, at least 32 characters; use 32 random bytes encoded as 64 hexadecimal characters |
| `FALKORDB_HTTP_URL` | HTTPS gateway origin, without path, credentials, query or fragment; takes precedence over socket/TCP |
| `FALKORDB_GATEWAY_TOKEN` | Same private service token in Vercel and the optional gateway host; at least 32 bytes, no whitespace |
| `FALKORDB_SOCKET` | Local Unix socket; omit for hosted connections; a configured socket takes precedence over host/port |
| `FALKORDB_HOST`, `FALKORDB_PORT` | Direct FalkorDB endpoint, including Cloud; hostname without a URL scheme and actual assigned port |
| `FALKORDB_USERNAME`, `FALKORDB_PASSWORD`, `FALKORDB_TLS` | Direct connection credentials/TLS; match the actual host |
| `FALKORDB_PERSISTENCE=managed` | Operator assertion for an alternative managed direct connection, not automatic persistence provisioning |
| `PARALLAX_ACCESS_TOKEN` | Optional API header gate, requiring `x-parallax-access-token`; no browser sign-in flow is supplied |
| `PARALLAX_MCP_TOKEN` | Optional external MCP bearer token; a valid signed workspace cookie remains required |

The documented public production paths use either gateway HTTPS or direct database TLS. The gateway token is a privileged server credential across accepted graph names; the direct database credentials also remain server-only. Visitor/tenant authorization belongs to the Next.js boundary.

### Optional model provider

| Setting | Meaning |
|---|---|
| `PARALLAX_AI_PROVIDER=guided` | Explicit guided execution with actual tools and no LLM request |
| `PARALLAX_AI_PROVIDER=vercel-gateway` | Enable Vercel AI Gateway for investigations |
| `AI_GATEWAY_MODEL=openai/gpt-4.1-mini` | Default catalog-verified Gateway model; can be changed to a supported tool-using model |
| `AI_GATEWAY_API_KEY` | Optional Gateway key, especially for local use; without it, obtain fresh deployed OIDC identity |
| `PARALLAX_AI_PROVIDER=openai-compatible` | Direct provider mode |
| `LLM_API_KEY`, `LLM_MODEL`, `LLM_BASE_URL` | Direct model credentials/model and optional HTTPS base URL; base defaults to `https://api.openai.com/v1` |

With no explicit provider and no LLM key, the application uses guided mode. With a direct LLM key, it selects the direct provider and still requires a model. Explicit provider selection wins over implicit detection. Gateway OIDC is resolved inside the active request, with an authentication timeout, and is not held in global mutable state. Provider IDs, returned model/generation IDs and numeric token usage are safe durable receipts; tokens are excluded.

Configured provider status does not prove successful model execution. Inspect an actual completed run and its model request receipts. Ordinary chat lookup remains guided/read-only; a chat request to investigate invokes the configured investigation mode.

## 3. Deploy the persistent graph service

Use the direct FalkorDB Cloud route for the selected deployment. FalkorDB remains the database in both documented routes; Cloud does not need the repository's gateway container or a Railway service.

### Direct FalkorDB Cloud option

Use the actual instance's connection details with the official client already wired in `lib/server/db.mjs`. Confirm that the selected endpoint supports TLS and is reachable from the Vercel deployment. TLS, backups and continuous persistence vary by Cloud plan; an account or instance alone is not evidence that all are enabled. Check [FalkorDB's current plan features](https://www.falkordb.com/plans/) and the provisioned instance settings before selecting the production connection.

In the Vercel server environment, **remove `FALKORDB_HTTP_URL` and `FALKORDB_SOCKET`**, then set:

| Setting | Value to copy from the provisioned instance |
|---|---|
| `FALKORDB_HOST` | Actual database hostname, without `https://`, `redis://` or a port suffix |
| `FALKORDB_PORT` | Actual assigned database port; do not assume the local default |
| `FALKORDB_USERNAME` | Instance-provided username |
| `FALKORDB_PASSWORD` | Private instance password |
| `FALKORDB_TLS` | `true` for the TLS-enabled public production endpoint |

The HTTP URL wins over direct settings, and a configured socket wins over host/port. Remove the unused gateway token as well. Keep the unique `PARALLAX_SESSION_SECRET` and any deliberate model settings. The adapter forwards hostname, numeric port and TLS to `FalkorDB.connect({socket, username, password})`; see the [official client connection options](https://github.com/FalkorDB/falkordb-ts#connection-options).

Set `FALKORDB_PERSISTENCE=managed` only after confirming the selected instance's storage guarantees and retention. It is an operator assertion shown in status, not persistence provisioning or a restore test. Redeploy the Vercel application and run the application-level release checks below. For a managed service, use that provider's supported restart, backup and restore procedures; gateway HTTP health routes and `/data` volume instructions apply only to the self-hosted route.

### Optional Railway gateway route

Create one isolated Railway service from the intended source commit. Use **repository root** as build context, with `RAILWAY_DOCKERFILE_PATH=deploy/gateway/Dockerfile`. Attach a persistent volume mounted at `/data` before the first successful startup. Configure `FALKORDB_DATA_DIR=/data`, a generated `FALKORDB_GATEWAY_TOKEN`, `NODE_ENV=production` and one replica.

Use the Dockerfile entrypoint; leave start-command override empty. The entrypoint sets volume ownership, acquires a file lock and runs as the unprivileged `node` user. The service refuses Railway startup if the attached volume path does not match its data directory. TCP is disabled on the database; only the gateway's HTTP listener is exposed. Railway supplies public HTTPS forwarding to `PORT`.

Set health path `/health` and a startup health timeout of 120 seconds. The gateway guide specifies zero deployment overlap and a 30-second drain window for a single volume owner. Expect brief database unavailability during engine redeployment. Health checks gate activation; they are not a continuous external monitor. The complete current dashboard/IaC settings are maintained in [the gateway guide](../deploy/gateway/README.md#railway-deployment-current-setup). Do not add a legacy Railway JSON configuration and assume it configures a newly created service.

Check the active account's current allowance, credit and storage retention before treating the deployment as permanent hosting. Service availability depends on that allowance and account state. An attached volume is required even when the account has trial compute credits. This runbook does not assume a subscription upgrade or create a spending commitment.

## 4. Deploy the Vercel application

Import the source repository as a Next.js project. Use Node 24, install command `npm ci --include=dev` and build command `npm run build`. The included `vercel.json` supplies framework/build settings and a 60-second API-function bound.

Add the selected graph connection and unique session secret to the intended Vercel environment: either gateway HTTPS origin and matching token, or the direct FalkorDB endpoint/TLS credentials above. Configure optional model and MCP settings separately. Enable project OIDC when using AI Gateway without a key. Keep preview and production environments deliberate; a preview should not accidentally point to a sensitive production dataset. The synthetic graph scheme isolates browser visitors but does not replace independent environment configuration.

Redeploy after changing runtime environment settings. For a public synthetic hackathon link, verify that its deployment protection settings allow the intended anonymous visitors. Do not confuse an authenticated preview with a publicly reachable submission URL. Keep the final URL, source commit and deployment timestamp in the release record.

## 5. Verify the full hosted path

Perform checks from the same public application URL that judges will open:

1. For the self-hosted route, gateway public `GET /health` returns ready and authenticated `GET /v1/status` reports the actual FalkorDB module, AOF health and attached-volume status. For direct Cloud, confirm the provisioned endpoint and its actual TLS/storage settings; there is no gateway HTTP route.
2. Application `GET /api/health` returns successful graph status and an honest provider configuration. No token, visitor ID or graph key appears in the response.
3. Open a new browser workspace. It loads its real seeded sources and graph counts without a simulated fallback.
4. Run a trial investigation. Check the real witness and tool receipts. If model mode is selected, inspect the provider receipt; an authentication/credit failure is not a successful model run.
5. Approve a reviewed choice, reload, attach synthetic task evidence, reload again and run full-domain verification. Ensure the case resolves only after the required task evidence.
6. Switch company and verify distinct trial semantics and no cross-company conversation/case memory.
7. Run the verification lab. Read its actual summary and concurrency measurements.
8. Create a disposable durability marker, perform the host's supported restart procedure while retaining storage, and confirm the marker plus a pending case/task survive. For the self-hosted gateway, retain the same volume. Delete only the disposable marker after the check.

The last step tests the actual hosted process lifecycle. The lab's client-reconnection check alone cannot prove a host restart preserved data. Do not reset or delete a user's workspace as part of verification. The in-app lab uses separate temporary graphs.

## 6. Tests and release evidence

```bash
npm test
npm run typecheck
npm run build
npm run verify
```

Run domain-only checks with `npm run test:domain`. Focused graph/MCP integration uses `npm run test:integration`. The root test command also includes gateway and provider behavior. Use an actual local FalkorDB or the configured gateway for data tests; never replace it with a fixture JSON store to obtain a passing count.

The lab implements 15 checks and a 16-worker, 8-write-per-worker workload with interleaved reads. It measures latency after acknowledged writes, queries the final counter and receipts, and counts lost acknowledged writes, duplicate cases and stale approval conflicts. The generated `reports/verification.json` is a record of that run; remeasure on the hosted network before discussing deployed latency. It is a focused correctness workload, not sustained load testing or a production scalability claim.

Keep a compact release record: commit, versions, exact commands and outcome, browser journey, host/transport, measured report, restart result and unresolved limitations. No permanent badge should replace a fresh test result. The architecture PDF is regenerated with `python3 scripts/render-architecture.py` and should be rendered/visually inspected after content changes.

## 7. Persistence, backups and recovery

### What each check establishes

| Evidence | Scope |
|---|---|
| Browser reload | The API returns persisted state to the same valid visitor cookie |
| Independent graph-client reconnect | A new client can read acknowledged state while the database service remains available |
| Local orderly engine restart with AOF | The tested engine can reload its write log after that shutdown/reopen path |
| Hosted restart retaining its storage | The selected self-hosted or managed deployment lifecycle retains graph state |
| Independent backup and restore drill | Recovery from a particular saved snapshot/log set is demonstrated |
| High availability | Requires an additional architecture; one engine and one volume do not supply it |

For direct Cloud, use the selected provider's documented persistence, backup, retention and restore controls; the file-level runbook below applies to the self-hosted gateway. The application does not provision or upgrade managed storage features.

The gateway enables AOF, `appendfsync always`, continued fsync during rewrite, periodic snapshots, explicit SAVE on graceful shutdown and rejection of truncated AOF. These are configured engine behaviors, not an independent backup. The local developer launcher uses `everysec` instead; do not generalize its durability characteristics to the gateway.

Establish backups using the host's supported volume snapshot/backup procedure. If taking a file-level copy, quiesce writes and stop the engine cleanly first, then copy the complete data directory, including any AOF manifest and companion files. Copying a live directory while a rewrite changes files can produce an inconsistent backup. Keep a copy outside the source volume and record engine version, timestamp and checksum. Protect any backup as application data.

Restore into a separate test volume with the same pinned engine first. Keep the failed/source volume intact. Start the isolated gateway, inspect engine health, reopen known case/task IDs and validate source history plus a test query. Only promote a restored volume after its checks pass. If the log is truncated, the gateway intentionally fails startup; do not disable that protection to make a health check green without understanding the data loss.

The application does not implement automatic backup scheduling, cross-region replicas or disaster-recovery orchestration. Volume deletion and workspace reset are destructive. Reset is scoped to the current visitor/company graph; it is useful for a fresh synthetic walkthrough, not a repair for persistence failure.

## 8. Troubleshooting

| Symptom | Likely boundary | Concrete next check |
|---|---|---|
| `DATABASE_NOT_CONFIGURED` | Web environment | Set hosted gateway origin/token or a valid direct connection; redeploy |
| `DATABASE_UNAVAILABLE` / `GRAPH_QUERY_FAILED` | Connection, engine or schema | Check gateway readiness, authenticated status, service logs and exact engine module |
| Gateway fails startup on Railway | Volume, token, native binary or duplicate owner | Confirm `/data` mount, private token, Trixie image and one replica; inspect sanitized logs |
| `SESSION_NOT_CONFIGURED` | Deployment identity | Set a stable random signing secret with at least 32 characters |
| New empty workspace after restart | Cookie/secret identity or storage | Confirm the same cookie and signing secret before diagnosing data loss; then check volume reuse |
| `REVISION_CONFLICT` | Concurrent or stale human action | Reload current case/task/proposal, review the updated state, then issue a new command |
| `COMMAND_REUSED` | Idempotency contract | Retry the exact same payload or create a new command ID for the changed action |
| `STALE_EVIDENCE` | New source/scenario revision | Re-investigate the current version; keep the old record as history |
| `RUN_IN_PROGRESS` | Valid worker lease | Read persisted activity; allow the active run to settle before retrying |
| `LEASE_LOST` | New worker owns the run | Stop using old run credentials and read current durable state |
| `IMPLEMENTATION_PENDING` | Missing task evidence | Complete every human task with evidence before requesting resolution |
| `MODEL_AUTHENTICATION` or timeout | OIDC/key configuration | Check active request OIDC, project identity or local Gateway key; do not substitute a fake result |
| `MODEL_CUSTOMER_VERIFICATION` | Gateway account access | Review account verification in the Gateway settings |
| `MODEL_CREDITS_EXHAUSTED` / `MODEL_BUDGET_EXHAUSTED` | Available model allowance | Inspect the account's current credits/budget; use explicit guided mode if that is the intended release |
| `MODEL_RATE_LIMITED` / `MODEL_TIMEOUT` | Provider capacity or deadline | Retry later with the same investigation command; inspect already persisted tool receipts |
| Browser gets an access error | Application token or deployment protection | Confirm the intended public/demo access mode and the API header gate |
| Lab remains `not-run` | No measurement yet | Run it against the real connection; do not prepopulate passing numbers |

Production query errors intentionally avoid returning raw database paths or credentials. Detailed operator logs should likewise exclude source text, cookies, tokens and private lease fields. The gateway exposes no generic Redis administration route.

## 9. Rotation, retention and capacity

A gateway-token rotation must update both services; coordinate deployment order to minimize temporary authentication failures. An MCP-token rotation changes external-client access without changing the internal tool workflow.

Changing the session secret invalidates old cookies **and changes the derived graph names**. Existing graphs remain on the database, but the new visitor context cannot automatically rediscover them. Plan an explicit migration/recovery strategy before rotating a secret for non-disposable data. The current cookie identity has no account login or cross-device recovery.

Graphs, messages, audit events and verification histories have no automatic application retention/garbage-collection policy. An expired cookie does not delete its graph. Monitor volume usage, service memory, AOF/snapshot health, request errors and run duration. Add retention and rate limiting before exposing an unrestricted real-data deployment. A single graph serializes writes, so high read concurrency does not imply unlimited simultaneous write throughput. Use the measured lab to catch correctness regressions, then run a separate realistic capacity exercise for operational sizing.

## Primary references

- [Gateway implementation and exact deployment settings](../deploy/gateway/README.md)
- [FalkorDB concurrency](https://docs.falkordb.com/design/concurrency) and [client source](https://github.com/FalkorDB/falkordb-ts)
- [Railway volumes](https://docs.railway.com/volumes), [volume reference](https://docs.railway.com/volumes/reference), [public networking](https://docs.railway.com/networking/public-networking)
- [Vercel Node.js runtime](https://vercel.com/docs/functions/runtimes/node-js), [environment variables](https://vercel.com/docs/environment-variables)
- [AI Gateway authentication](https://vercel.com/docs/ai-gateway/authentication-and-byok)

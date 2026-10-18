# Persistent FalkorDB gateway for PARALLAX

This service runs a single genuine FalkorDB process on a persistent disk and exposes the narrow HTTP interface used by PARALLAX's Vercel server. It uses the official `falkordblite` runtime and `falkordb` client. The database never listens on a TCP port; its Unix socket has owner-only permissions. Railway terminates public HTTPS before forwarding requests to the gateway's `PORT` listener.

The repository provides the deployable service and verification probes. A Railway account, an attached volume, a successful gateway deployment, and the corresponding Vercel environment settings are still required for a live installation. Creating these files does not provision hosting or prove production availability.

## Runtime and persistence

| Component | Exact setting |
|---|---|
| Container | `node:24-trixie-slim`, Linux x64 |
| Official client | `falkordb@6.8.0` |
| Official local supervisor | `falkordblite@0.3.0` |
| Official binary package | `@falkordblite/linux-x64@8.2.3-falkordb.4.16.3` |
| Persistent data directory | `/data` |
| Database transport | Private Unix socket; `port 0`, `unixsocketperm 700` |
| Append-only log | `appendonly yes`, `appendfsync always` |
| Rewrite behavior | Continue fsync during AOF rewrites; reject truncated AOF recovery |
| Snapshots | `save 60 1`; explicit `SAVE` during graceful shutdown |
| Database ownership | One replica; process-wide singleton and volume file lock |
| Query bound | Default 5 seconds; maximum 15 seconds; module default also 15 seconds |
| HTTP request body | Uncompressed JSON, maximum 2 MiB |

The pinned binary's `redis-server` requires `GLIBC_2.38` and `GLIBCXX_3.4.32`; the Bookworm image does not provide the required ABI. The Trixie image and explicit runtime libraries address this. Both binary paths are supplied directly to FalkorDBLite, and npm install scripts are disabled so a build cannot silently download a different module. The Docker build runs an actual HTTP write/read and AOF recovery smoke test against these binaries.

`appendfsync always` asks the database to sync every acknowledged write to the attached storage. That protects normal process/container restarts; continued durability also depends on the volume and its host. A single volume is not an independent backup or a replicated database. The authenticated status reports `persistent: true` only when AOF is healthy and the deployment supplies an attached-volume declaration. A local socket with unconfirmed storage remains explicitly unconfirmed.

## Railway deployment: current setup

Use a single service with the **repository root** as its build context. Apply the following dashboard settings before deploying:

| Railway setting | Value |
|---|---|
| Source | This repository and the intended branch/commit |
| Root directory | Repository root |
| Dockerfile override variable | `RAILWAY_DOCKERFILE_PATH=deploy/gateway/Dockerfile` |
| Volume mount path | `/data` |
| Replicas | `1` |
| Health check path | `/health` |
| Health check timeout | `120` seconds |
| Start command override | Leave empty; use the Dockerfile entrypoint |
| Public networking | Generate a Railway HTTPS domain; target the gateway `PORT` |
| Deployment overlap | `RAILWAY_DEPLOYMENT_OVERLAP_SECONDS=0` |
| Shutdown draining | `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=30` |

Railway attaches the volume at startup and exposes its path through `RAILWAY_VOLUME_MOUNT_PATH`. The gateway refuses to start on Railway if that path does not match its configured data directory. The entrypoint sets ownership at runtime, then runs Node as the unprivileged `node` user. Its `flock` lock prevents two processes from owning the same AOF files.

As verified on 2026-10-18, Railway's legacy `railway.json` / `railway.toml` Config as Code is deprecated and new services cannot opt into it. This guide therefore specifies the current dashboard setup. Teams using Railway's current IaC can express the same settings in `.railway/railway.ts` and review `railway config plan` before applying it. A legacy JSON file would not configure a new service by itself. See [Railway Config as Code](https://docs.railway.com/config-as-code), [Infrastructure as Code](https://docs.railway.com/infrastructure-as-code), and [Dockerfile configuration](https://docs.railway.com/builds/dockerfiles).

Volumes support only a single replica and prevent overlapping mounts during a deployment. Expect brief database downtime during redeployments. Health checks gate activation; they do not provide continuous uptime monitoring. See [volume behavior and caveats](https://docs.railway.com/volumes/reference), [volume initialization](https://docs.railway.com/volumes), [health checks](https://docs.railway.com/deployments/healthchecks), and [deployment teardown](https://docs.railway.com/deployments/deployment-teardown).

### Gateway environment

| Variable | Value |
|---|---|
| `FALKORDB_GATEWAY_TOKEN` | A fresh secret with at least 32 random bytes, encoded as 64 hex characters or base64url |
| `FALKORDB_DATA_DIR` | `/data` |
| `PORT` | Railway's injected port; default `8080` outside Railway |
| `NODE_ENV` | `production` |
| `RAILWAY_DOCKERFILE_PATH` | `deploy/gateway/Dockerfile` |
| `RAILWAY_DEPLOYMENT_OVERLAP_SECONDS` | `0` |
| `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` | `30` |

Generate the gateway token using a password manager or `openssl rand -hex 32`. Store the exact same value privately in Railway and Vercel. The token belongs only in server environment variables; it must never use a `NEXT_PUBLIC_` prefix or appear in client code, source control, query strings, documentation, or logs.

### Vercel environment

| Variable | Value |
|---|---|
| `FALKORDB_HTTP_URL` | The gateway's generated HTTPS origin, with no path, credentials, query, or fragment |
| `FALKORDB_GATEWAY_TOKEN` | The same secret configured in Railway |

Redeploy PARALLAX after saving these settings. The application's `database()` selects the HTTP adapter when `FALKORDB_HTTP_URL` is configured. `FALKORDB_HOST`, `FALKORDB_SOCKET`, and raw TCP credentials are not needed for this transport. Production availability is established only after `/health` returns readiness, authenticated `/v1/status` confirms FalkorDB and the attached volume, and the deployed application successfully creates and reopens a workspace.

Railway automatically manages TLS on its public domains. PARALLAX rejects insecure HTTP endpoints except exact localhost/loopback addresses used in development. See [Railway public networking](https://docs.railway.com/networking/public-networking).

## Local container verification

Run from the repository root with Docker installed. Supply the gateway secret through the environment; these commands do not print it:

```sh
export FALKORDB_GATEWAY_TOKEN="$(openssl rand -hex 32)"
docker build --platform linux/amd64 -f deploy/gateway/Dockerfile -t parallax-gateway .
docker volume create parallax-graph
docker run --detach --name parallax-gateway \
  --mount source=parallax-graph,target=/data \
  --publish 127.0.0.1:8080:8080 \
  --env FALKORDB_GATEWAY_TOKEN \
  --env FALKORDB_DURABLE_VOLUME=true \
  parallax-gateway
```

For a container started outside Railway, `FALKORDB_DURABLE_VOLUME=true` is an explicit operator assertion that `/data` is mounted to persistent storage. Do not set it for an ephemeral container directory.

The focused protocol tests connect to an already running actual FalkorDB instance through `FALKORDB_SOCKET` or `/tmp/parallax-falkordb/redis.sock`, inject that connected official client into the gateway, and listen on an ephemeral loopback port:

```sh
node --test tests/gateway.test.mjs
```

The standalone supervisor smoke test starts isolated FalkorDB processes in a temporary directory, acknowledges a write through HTTP, closes the gateway, removes only its disposable RDB snapshot, and reopens the AOF in a fresh process:

```sh
node deploy/gateway/smoke.mjs
```

## HTTP protocol and trust boundary

All detailed status and data operations require `Authorization: Bearer <gateway-secret>`. Token comparison hashes both inputs to a fixed length and uses `timingSafeEqual`. No CORS access is granted. Only the trusted PARALLAX application server holds the secret and supplies Cypher text; browser text is passed as parameters.

| Method and path | Request | Reply |
|---|---|---|
| `GET /health` | Public readiness check | `{"status":"ready"}` or `{"status":"unavailable"}` |
| `GET /v1/status` | Bearer authentication | Sanitized actual engine/version/persistence status |
| `POST /v1/graphs/:name/query` | `{query, params?, timeout?}` | `{result: GraphReply}` |
| `POST /v1/graphs/:name/ro-query` | `{query, params?, timeout?}` | `{result: GraphReply}` from actual `GRAPH.RO_QUERY` |
| `POST /v1/graphs/:name/range-index` | `{label, properties}` | `{result: QueryReply}` |
| `POST /v1/graphs/:name/fulltext-index` | `{label, properties}` | `{result: QueryReply}` |
| `POST /v1/graphs/:name/constraint` | `{constraintType, entityType, label, properties}` | `{result: null}` or the SDK result |
| `DELETE /v1/graphs/:name` | Bearer authentication | `{result: null}` |

Graph names must match `^parallax_[a-f0-9]{24,40}$`. The application derives them from the visitor and tenant; this gateway checks the namespace again. Schema identifiers and every nested parameter-map key are validated before the SDK renders its parameter preamble. Bodies reject unknown operation fields, queries are limited to 256 KiB, parameter nesting is limited to 32 levels, and timeouts cannot exceed 15 seconds. Only `UNIQUE` and `MANDATORY` node constraints are accepted. There is no generic Redis command, configurable SDK method, graph-copy, configuration-change, or graph-listing HTTP route.

Errors expose stable codes and general descriptions. SQL/Cypher text, raw Redis errors, paths, tokens, and connection credentials are not included. The adapter refuses redirects and does not automatically retry mutations: the application owns idempotency and conflict resolution.

## Availability and hosting limits

Continuous access depends on an active Railway account with sufficient hosting allowance or credits. If credits or a compute allowance run out, the gateway and its database can become unavailable. Trial-created storage also has a retention limit after trial credits expire. Keep independent backups before relying on trial hosting for long-term records; deployment files do not imply that paid hosting or permanent storage has been provisioned. See [Railway Free Trial](https://docs.railway.com/pricing/free-trial) and [cost control](https://docs.railway.com/pricing/cost-control).

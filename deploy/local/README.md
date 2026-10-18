# PARALLAX on your local Docker Desktop

This setup runs the production Next.js app and the official FalkorDB container on your computer. It needs Docker Desktop with Docker Compose v2; no Railway account or hosted database is involved. Run every command below from the PARALLAX repository directory.

## Start

Generate private local settings with Node.js:

```sh
node scripts/docker-setup.mjs
docker compose --env-file .env.docker.local up --build --wait
```

If Node.js is not installed on your computer, Docker can run the setup script. On macOS or Linux:

```sh
docker run --rm --user "$(id -u):$(id -g)" --mount "type=bind,source=$PWD,target=/workspace" --workdir /workspace node:24-alpine node scripts/docker-setup.mjs
docker compose --env-file .env.docker.local up --build --wait
```

On Windows PowerShell:

```powershell
docker run --rm --mount "type=bind,source=$($PWD.Path),target=/workspace" --workdir /workspace node:24-alpine node scripts/docker-setup.mjs
docker compose --env-file .env.docker.local up --build --wait
```

The first build downloads the images and installs the pinned application dependencies. `--wait` starts the services in the background and waits for their health checks.

| Service | Local address | Purpose |
| --- | --- | --- |
| PARALLAX | http://localhost:3000 | Open the app and run the guided investigation workflows. |
| FalkorDB Browser | http://localhost:3002 | Inspect the graph through the official bundled Browser. |
| FalkorDB protocol | 127.0.0.1:6379 | Connect another local Redis/FalkorDB client if needed. |

All published ports bind to `127.0.0.1`. Within Docker, the app connects directly to `falkordb:6379`; the Browser connects to its bundled server on `localhost:6379`. If the Browser requests a connection, use host `localhost`, port `6379`, username `default`, and the `FALKORDB_PASSWORD` value in your private local settings. Visit PARALLAX first to initialize your workspace graph. Graph names begin with `parallax_`.

No model-provider key is required to use the guided fixtures and deterministic semantic checking. The app reports whether a model provider is configured.

## Verify the real application and graph workflow

```sh
docker compose --env-file .env.docker.local ps
docker compose --env-file .env.docker.local exec app node deploy/local/verify.mjs
```

The database health check authenticates and sends `PING`. The app health check checks its actual database connection, engine identity, and append-only persistence status. The verification command also runs the application's semantic and repair workflow against a fresh graph in that database, prints the report, and deletes only its temporary verification graph. It exits unsuccessfully if the running app is unhealthy or verification fails.

Inspect startup errors with:

```sh
docker compose --env-file .env.docker.local logs --tail=100 app falkordb
```

This repository's local Docker configuration was checked against the versioned official image sources and registry metadata. The build environment used to prepare it did not expose a Docker daemon, so these image build and container startup commands must be run on your computer to validate that environment.

## Persistence and restart

The named volume `parallax_falkordb_data` is mounted at `/var/lib/falkordb/data`, the exact data directory used by the official image's entrypoint. AOF persistence is enabled with `appendfsync always`; fsync remains enabled during AOF rewrites. Truncated AOF files cause a startup error instead of silent acceptance. This preserves database files when the containers are replaced and minimizes the gap between acknowledged writes and disk synchronization. The Docker volume still depends on your computer's storage and is not an independent backup.

Keep `.env.docker.local` across restarts: it contains the database password, the Browser signing secret, the MCP token, and the app's stable session secret. The setup script creates 32 random bytes per secret, writes a private file, and retains valid existing settings on subsequent runs. Losing or replacing the session secret prevents existing browser sessions from resolving their previous workspace.

Stop while retaining the containers and data:

```sh
docker compose --env-file .env.docker.local stop
docker compose --env-file .env.docker.local start --wait
```

Remove the containers while retaining the named database volume:

```sh
docker compose --env-file .env.docker.local down
docker compose --env-file .env.docker.local up --build --wait
```

Do not add `--volumes` to `down` unless you intend to delete the graph data. Retain the same browser cookies to return to the same isolated workspace.

## Local settings

Edit `.env.docker.local` before starting. If a port is already in use, choose another host port using `PARALLAX_PORT`, `PARALLAX_DB_PORT`, or `FALKORDB_BROWSER_PORT`. Docker's internal ports stay unchanged. Set `FALKORDB_BROWSER_ENABLED=0` to disable the optional Browser process; its published local port then has no Browser listener. Re-run `docker compose --env-file .env.docker.local up --build --wait` after changes.

The production app image runs as the unprivileged `node` user. Its build context explicitly includes application sources and excludes private environment files. The app receives its settings at container startup, never during the image build. Do not publish the private settings file or the output of a fully interpolated `docker compose config`, which includes those settings.

## Verified upstream inputs

- Official image: `falkordb/falkordb:v4.16.3`, pinned to multi-platform digest `sha256:c7082788609c4d7033129e55272581c49322c4cd7024cec75464ca343b6a6fb5` (Linux AMD64 and ARM64).
- [Official registry tag metadata](https://hub.docker.com/v2/repositories/falkordb/falkordb/tags/v4.16.3).
- [Versioned Dockerfile](https://github.com/FalkorDB/FalkorDB/blob/v4.16.3/build/docker/Dockerfile): Redis 8.2.3 base, bundled Browser, and default data path.
- [Versioned startup script](https://github.com/FalkorDB/FalkorDB/blob/v4.16.3/build/docker/run.sh): `REDIS_ARGS`, `FALKORDB_ARGS`, Browser toggle, and final database directory.
- [Official Docker documentation](https://docs.falkordb.com/operations/docker).
- [Official Browser documentation](https://github.com/FalkorDB/falkordb-browser#readme).

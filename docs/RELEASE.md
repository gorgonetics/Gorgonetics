# Release Procedure

This document covers how to cut a release, deploy the Docker container to a cloud host, handle the database correctly, and perform routine maintenance.

---

## Table of Contents

1. [Architecture overview](#1-architecture-overview)
2. [Pre-release checklist](#2-pre-release-checklist)
3. [Version bump](#3-version-bump)
4. [Build and test the image locally](#4-build-and-test-the-image-locally)
5. [Push the image to a registry](#5-push-the-image-to-a-registry)
6. [Database strategy for cloud deployments](#6-database-strategy-for-cloud-deployments)
7. [Deploying to a cloud host](#7-deploying-to-a-cloud-host)
8. [First-run initialisation](#8-first-run-initialisation)
9. [Upgrading an existing deployment](#9-upgrading-an-existing-deployment)
10. [Backup and restore](#10-backup-and-restore)
11. [Environment variable reference](#11-environment-variable-reference)
12. [Rollback](#12-rollback)

---

## 1. Architecture overview

The container ships both the FastAPI backend and the pre-built Svelte frontend as a single unit. At runtime:

```
container
├── /app/.venv/         Python dependencies
├── /app/src/           Python source
├── /app/assets/        Read-only gene template JSON files
├── /app/static/svelte/ Pre-built frontend (served by FastAPI)
└── /app/data/          ← MUST be a persistent volume
    ├── users.sqlite     Auth database (users, sessions)
    ├── metadata.sqlite  DuckLake catalog (schema, snapshot log, file manifest)
    └── *.parquet        Immutable data files written by DuckLake
```

**Critical:** everything under `/app/data` is the live database. If that directory is not on a persistent volume the entire database — users, pets, gene edits — is lost on every container restart.

### Why DuckLake is filesystem-based

DuckLake stores its catalog in SQLite and its data in Parquet files, both on-disk. This means:

- **No external DB service required** — simple to deploy.
- **Cannot be shared across multiple container replicas** — single-container deployments only (which matches the target architecture).
- **Backups = a directory copy** — see [Section 10](#10-backup-and-restore).

---

## 2. Pre-release checklist

Run these steps locally before building the release image.

```bash
# 1. Run the full test suite
uv run pytest

# 2. Lint and format check
uv run ruff check src/
uv run ruff format --check src/

# 3. Type check
uv run ty check src/gorgonetics

# 4. Build the frontend (catches build errors early)
pnpm run build

# 5. Verify the Docker build succeeds
docker build -t gorgonetics:release-candidate .
```

All commands must pass without errors before proceeding.

---

## 3. Version bump

Version is declared in two places; keep them in sync:

| File | Key |
|---|---|
| `pyproject.toml` | `version = "x.y.z"` |
| `src/gorgonetics/__init__.py` | `__version__ = "x.y.z"` |

We follow [Semantic Versioning](https://semver.org):

- **patch** (`0.1.x`): bug fixes, no schema changes.
- **minor** (`0.x.0`): new features; check for [schema changes](#schema-migrations).
- **major** (`x.0.0`): breaking changes; coordinate migration in advance.

After bumping, commit and tag:

```bash
git add pyproject.toml src/gorgonetics/__init__.py
git commit -m "chore: bump version to 0.2.0"
git tag v0.2.0
git push && git push --tags
```

---

## 4. Build and test the image locally

```bash
# Build with the release tag
docker build -t gorgonetics:0.2.0 -t gorgonetics:latest .

# Smoke-test the image
docker compose up
```

With `docker compose up`, the `./data` directory on your local machine is mounted into the container. Verify:

- `http://localhost:8000/health` returns `{"status": "healthy", ...}`
- `http://localhost:8000` serves the frontend

---

## 5. Push the image to a registry

```bash
# Tag for your registry (example: GitHub Container Registry)
docker tag gorgonetics:0.2.0 ghcr.io/YOUR_ORG/gorgonetics:0.2.0
docker tag gorgonetics:0.2.0 ghcr.io/YOUR_ORG/gorgonetics:latest

docker push ghcr.io/YOUR_ORG/gorgonetics:0.2.0
docker push ghcr.io/YOUR_ORG/gorgonetics:latest
```

---

## 6. Database strategy for cloud deployments

This is the most important section for getting cloud deployments right.

### What needs to be persisted

The `/app/data` directory contains two distinct but inseparable parts:

| Path | What it is | Consequence of losing it |
|---|---|---|
| `/app/data/users.sqlite` | Auth database — user accounts, sessions, password hashes | All users must be re-created |
| `/app/data/metadata.sqlite` | DuckLake catalog — maps snapshots to Parquet files, tracks schema versions | Cannot read any data (Parquet files are orphaned) |
| `/app/data/*.parquet` | Data files for genes and pets | Gene edits and pet data lost |

**All three must be persisted together.** A backup of one without the others is not usable.

### How to persist: persistent volume

All major cloud platforms support attaching a persistent volume to a container. Mount it at `/app/data`.

| Platform | How to attach a persistent volume |
|---|---|
| **Railway** | Add a Volume in the service settings, mount path `/app/data` |
| **Fly.io** | `fly volumes create gorgonetics_data --size 1` then mount in `fly.toml` |
| **Render** | Add a Disk in the service settings, mount path `/app/data` |
| **Generic Docker** | `docker run -v gorgonetics_data:/app/data ...` or the compose file |

The `docker-compose.yml` already declares this correctly:

```yaml
volumes:
  - ./data:/app/data
```

For cloud, replace `./data` with a named volume or a platform-managed volume.

### Single-container constraint

DuckLake with a SQLite catalog is **not safe for concurrent writes from multiple processes**. Do not run more than one replica of this container pointing at the same volume. Cloud platforms that auto-scale to zero and back up to one instance (Railway, Render free tier) are fine; those that spin up multiple replicas simultaneously (horizontal scaling) are not.

If you ever need horizontal scaling, the database backend must be replaced with a server-based catalog (PostgreSQL or MySQL). The `DuckLakeGeneDatabase` constructor already accepts `catalog_type="postgresql"` for this upgrade path.

### Schema migrations

The application uses `CREATE TABLE IF NOT EXISTS` for all tables, so the schema initialises itself on first start. However, **adding new columns to existing tables requires explicit migration** — the `IF NOT EXISTS` guard prevents re-running the `CREATE TABLE` statement.

When a new version adds columns to an existing table:
1. Write a one-off migration script (plain SQL via `docker exec`).
2. Document it in the release notes.
3. Run it against the live database before (or just after) starting the new container.

Example:
```bash
docker exec -it <container> python -c "
from gorgonetics.database_config import create_database_instance
db = create_database_instance()
db.conn.execute('ALTER TABLE pets ADD COLUMN new_field VARCHAR')
db.conn.commit()
db.close()
"
```

---

## 7. Deploying to a cloud host

### Generic (any platform supporting Docker + persistent volumes)

```bash
docker run -d \
  --name gorgonetics \
  --restart unless-stopped \
  -p 8000:8000 \
  -v gorgonetics_data:/app/data \
  -e GORGONETICS_ENV=production \
  -e GORGONETICS_JWT_SECRET_KEY=<strong-random-secret> \
  -e GORGONETICS_AUTH_DB_PATH=/app/data/users.sqlite \
  -e GORGONETICS_CATALOG_PATH=/app/data/metadata.sqlite \
  -e GORGONETICS_DATA_PATH=/app/data \
  -e GORGONETICS_LOAD_SAMPLE_DATA=true \
  -e GORGONETICS_CORS_ORIGINS=https://yourdomain.com \
  ghcr.io/YOUR_ORG/gorgonetics:0.2.0
```

### Fly.io (`fly.toml` excerpt)

```toml
[build]
  image = "ghcr.io/YOUR_ORG/gorgonetics:0.2.0"

[[mounts]]
  source = "gorgonetics_data"
  destination = "/app/data"

[env]
  GORGONETICS_ENV = "production"
  GORGONETICS_AUTH_DB_PATH = "/app/data/users.sqlite"
  GORGONETICS_CATALOG_PATH = "/app/data/metadata.sqlite"
  GORGONETICS_DATA_PATH = "/app/data"
  GORGONETICS_LOAD_SAMPLE_DATA = "true"

# Set GORGONETICS_JWT_SECRET_KEY as a secret:
# fly secrets set GORGONETICS_JWT_SECRET_KEY=$(python -c "import secrets; print(secrets.token_hex(32))")

[[services]]
  internal_port = 8000
  protocol = "tcp"
  [[services.ports]]
    port = 443
    handlers = ["tls", "http"]
```

---

## 8. First-run initialisation

On the very first deployment (empty volume), two manual steps are required after the container is running.

### Step 1 — Populate gene data

This is automatic if `GORGONETICS_LOAD_SAMPLE_DATA=true` is set (recommended). The app reads gene JSON files from the baked-in `assets/` directory and loads them on startup if the database is empty.

Alternatively, run it manually:

```bash
docker exec -it <container> gorgonetics populate
```

### Step 2 — Create the admin user

This cannot be automated via environment variable (passwords must not live in env vars for security). Run once after first start:

```bash
docker exec -it <container> gorgonetics create-admin \
  --username admin \
  --password <your-strong-password>
```

Store the password in a password manager. There is currently no password-reset flow; if you lose it you can re-run `create-admin` with a new username.

### Verify

```bash
curl https://yourdomain.com/health
# → {"status": "healthy", ...}

curl -X POST https://yourdomain.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "<your-password>"}'
# → {"access_token": "...", "refresh_token": "...", ...}
```

---

## 9. Upgrading an existing deployment

```
1. Back up the database  (see Section 10)
2. Pull/push the new image
3. Stop the old container
4. Start the new container pointing at the same volume
5. Run any schema migrations (if the release notes require it)
6. Verify /health and smoke-test a login
```

The key rule: **always back up before stopping the old container**. The moment the new container starts it may modify the DuckLake catalog; a backup taken after that point cannot be used to restore to the pre-upgrade state.

Downtime during upgrade is approximately the container restart time (a few seconds), since the volume persists across container replacements.

---

## 10. Backup and restore

### What to back up

The entire `/app/data` directory. Both the SQLite catalog and the Parquet files must be captured together for the backup to be usable.

### Backup script

```bash
#!/usr/bin/env bash
# Usage: ./scripts/db-backup.sh <container_name> <backup_dir>
# Example: ./scripts/db-backup.sh gorgonetics ./backups

set -euo pipefail

CONTAINER="${1:-gorgonetics}"
BACKUP_DIR="${2:-./backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/gorgonetics_${TIMESTAMP}.tar.gz"

mkdir -p "$BACKUP_DIR"

echo "Flushing DuckLake WAL before backup..."
docker exec "$CONTAINER" python -c "
from gorgonetics.database_config import create_database_instance
db = create_database_instance()
db.conn.execute('CHECKPOINT')
db.conn.commit()
db.close()
print('Checkpoint complete.')
"

echo "Archiving /app/data..."
docker run --rm \
  --volumes-from "$CONTAINER" \
  alpine \
  tar czf - /app/data | tee "$BACKUP_FILE" > /dev/null

echo "Backup written to: $BACKUP_FILE ($(du -sh "$BACKUP_FILE" | cut -f1))"
```

The `CHECKPOINT` flushes any in-memory WAL state in the SQLite catalog to disk before the archive is taken, ensuring a clean snapshot. The container keeps running during the backup.

### Restore script

```bash
#!/usr/bin/env bash
# Usage: ./scripts/db-restore.sh <backup_file> <volume_name>
# Example: ./scripts/db-restore.sh ./backups/gorgonetics_20260311_120000.tar.gz gorgonetics_data
#
# WARNING: This overwrites the target volume. Stop the app container first.

set -euo pipefail

BACKUP_FILE="$1"
VOLUME_NAME="${2:-gorgonetics_data}"

if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "Error: backup file not found: $BACKUP_FILE"
  exit 1
fi

echo "Restoring from $BACKUP_FILE into volume $VOLUME_NAME..."
echo "The app container must be stopped before proceeding."
read -rp "Continue? [y/N] " confirm
[[ "$confirm" =~ ^[Yy]$ ]] || exit 1

docker run --rm \
  -v "${VOLUME_NAME}:/app/data" \
  -v "$(realpath "$BACKUP_FILE"):/backup.tar.gz:ro" \
  alpine \
  sh -c "rm -rf /app/data/* && tar xzf /backup.tar.gz -C / --strip-components=1"

echo "Restore complete. You can now start the container."
```

### Backup schedule

There is no built-in scheduler. For cloud deployments, set up a cron job on a separate host (or a platform scheduler) to call the backup script and ship the archive to object storage (S3, Backblaze B2, etc.). Daily backups with 30-day retention is a reasonable starting point.

---

## 11. Environment variable reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `GORGONETICS_ENV` | Yes (prod) | `development` | Set to `production` to enforce strong JWT secret |
| `GORGONETICS_JWT_SECRET_KEY` | Yes (prod) | weak dev key | HS256 signing key. Generate: `python -c "import secrets; print(secrets.token_hex(32))"` |
| `GORGONETICS_JWT_ACCESS_TOKEN_EXPIRE_MINUTES` | No | `30` | Access token lifetime |
| `GORGONETICS_JWT_REFRESH_TOKEN_EXPIRE_DAYS` | No | `7` | Refresh token lifetime |
| `GORGONETICS_AUTH_DB_PATH` | Yes | `users.sqlite` | Path to the SQLite auth database (users, sessions) |
| `GORGONETICS_CATALOG_PATH` | Yes | `metadata.sqlite` | Path to the DuckLake SQLite catalog file |
| `GORGONETICS_DATA_PATH` | Yes | `data` | Path to the Parquet data directory |
| `DUCKDB_MEMORY_LIMIT` | No | *(none)* | DuckDB memory cap (e.g. `256MB`). Set on constrained VMs to prevent OOM |
| `GORGONETICS_DUCKLAKE_NAME` | No | `gorgonetics_lake` | DuckLake attachment name |
| `GORGONETICS_CORS_ORIGINS` | No | `*` | Comma-separated list of allowed origins. Lock this down in production |
| `GORGONETICS_LOAD_SAMPLE_DATA` | No | `false` | Set to `true` to auto-populate gene data from `assets/` on first start |
| `GORGONETICS_MAX_UPLOAD_BYTES` | No | `5242880` (5 MB) | Maximum genome file upload size |
| `GORGONETICS_LOG_LEVEL` | No | `INFO` | Python log level (`DEBUG`, `INFO`, `WARNING`, `ERROR`) |
| `GORGONETICS_CSP` | No | *(see below)* | Custom `Content-Security-Policy` header value |
| `PORT` | No | `8000` | Port the server listens on (used by Railway, Fly.io, Render) |
| `WEB_CONCURRENCY` | No | `1` | Number of Uvicorn worker processes. **Keep at 1** with SQLite catalog |

The app will **refuse to start** if `GORGONETICS_ENV=production` and `GORGONETICS_JWT_SECRET_KEY` is left at its default development value.

---

## 12. Rollback

If a deployment is bad and you need to revert:

```bash
# 1. Stop the bad container
docker stop gorgonetics && docker rm gorgonetics

# 2. Restore the pre-upgrade backup (see Section 10)
./scripts/db-restore.sh ./backups/gorgonetics_<pre-upgrade-timestamp>.tar.gz gorgonetics_data

# 3. Start the previous image version
docker run -d \
  --name gorgonetics \
  -v gorgonetics_data:/app/data \
  -e ... \
  ghcr.io/YOUR_ORG/gorgonetics:0.1.0  # ← previous version
```

This is why the backup step in [Section 9](#9-upgrading-an-existing-deployment) is mandatory before every upgrade.

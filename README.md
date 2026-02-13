# Boot

Dev stack lifecycle manager. One command to setup, start, stop, and reboot your projects.

```
boot init     → creates boot.yaml (auto-detects your stack)
boot setup    → one-time setup (deps, DB, migrations)
boot up       → start everything (Docker + apps)
boot down     → stop everything
boot reboot   → restart everything
boot status   → show what's running
```

## Install

```bash
npm install -g boot
```

Or use without installing:

```bash
npx boot init
```

## Quick Start

```bash
# In any project
boot init       # creates boot.yaml by auto-detecting your stack
boot setup      # one-time: install deps, start DB, run migrations
boot up         # start Docker + all app processes
```

That's it. `boot init` detects your Docker setup, apps, package manager, env requirements, and generates the config.

## Config

`boot init` creates a `boot.yaml` in your project root:

```yaml
name: my-project

env:
  file: .env
  required:
    - DATABASE_URL
    - JWT_SECRET
  reject:
    JWT_SECRET:
      - your-super-secret-jwt-key-change-this

setup:
  - pnpm install
  - pnpm db:generate
  - pnpm db:push

docker:
  # Option A: Docker Compose
  composeFile: docker-compose.yml
  services:
    - name: postgres
      container: my-project-postgres
      readyCheck: pg_isready -U postgres
      timeout: 30

  # Option B: Standalone containers (no compose needed)
  containers:
    - name: my-db
      image: postgres:15
      ports:
        - "5433:5432"
      env:
        POSTGRES_DB: myapp
        POSTGRES_PASSWORD: secret
      readyCheck: pg_isready -U postgres
      timeout: 30

apps:
  - name: api
    path: apps/api
    command: pnpm dev
    port: 3001
    health: http://localhost:3001/health
  - name: web
    path: apps/web
    command: pnpm dev
    port: 3000
    health: http://localhost:3000
```

### Config Reference

| Field | Description |
|-------|-------------|
| `name` | Project name (display only) |
| `packageManager` | `pnpm`, `npm`, or `yarn` (auto-detected if omitted) |
| **env** | |
| `env.file` | Path to `.env` file (default: `.env`) |
| `env.required` | Env vars that must be set — `boot up` fails if missing |
| `env.reject` | Values to reject per key (blocks example/default secrets) |
| **setup** | |
| `setup` | Commands to run on `boot setup` |
| **docker** | |
| `docker.composeFile` | Path to compose file (default: `docker-compose.yml`) |
| `docker.services[].name` | Compose service name |
| `docker.services[].container` | Container name for `docker exec` |
| `docker.services[].readyCheck` | Command to check if service is ready |
| `docker.services[].timeout` | Seconds to wait for readiness (default: 30) |
| `docker.containers[].name` | Standalone container name |
| `docker.containers[].image` | Docker image (e.g. `postgres:15`) |
| `docker.containers[].ports` | Port mappings (e.g. `"5433:5432"`) |
| `docker.containers[].env` | Environment variables for the container |
| `docker.containers[].volumes` | Volume mounts |
| `docker.containers[].readyCheck` | Readiness check command |
| `docker.containers[].timeout` | Seconds to wait (default: 30) |
| **apps** | |
| `apps[].name` | App name (used for logs and PID tracking) |
| `apps[].path` | Working directory relative to project root |
| `apps[].command` | Command to start the app |
| `apps[].port` | Port the app listens on |
| `apps[].health` | URL to poll for health check |
| `apps[].env` | Extra environment variables |

## What `boot init` Auto-Detects

- **Package manager** — from lockfiles (`pnpm-lock.yaml`, `yarn.lock`, `package-lock.json`)
- **Docker Compose** — `docker-compose.yml` / `compose.yml`
- **Raw Docker containers** — scans `scripts/*.sh` for `docker start` / `docker run` patterns
- **Database services** — Postgres, MySQL, Redis (with appropriate readiness checks)
- **Monorepo apps** — scans `apps/*/package.json` for dev scripts
- **Sub-directory apps** — detects `dashboard/`, `frontend/`, `backend/`, `server/`, etc.
- **Single-app projects** — detects `dev` or `start` scripts in root `package.json`
- **Prisma** — detects `prisma/` directory and adds generate/push to setup
- **Ports** — guesses 3000 for web/frontend, 3001 for api/server
- **`.env` requirements** — parses `env.example` / `.env.example` for required and sensitive vars

## What Each Command Does

### `boot up`

1. Validates `.env` file (required vars, rejects default secrets)
2. Auto-installs deps if `node_modules` is missing
3. Starts Docker (compose services and/or standalone containers)
4. Waits for each service's readiness check
5. Starts each app in the background
6. Polls health URLs until ready
7. Prints summary with URLs

### `boot down`

1. Stops all tracked app processes (SIGTERM → SIGKILL)
2. Falls back to `pkill -f` if PID file is stale (catches orphan processes)
3. Force-kills anything still holding app ports
4. Stops standalone Docker containers
5. Stops Docker Compose services

### `boot status`

Shows a table of all services with:
- Status (running / stopped / port in use)
- Port numbers
- PIDs (with mismatch warnings if PID file ≠ port owner)
- Live health checks (curl)
- Log file paths

### `boot reboot`

Runs `down` then `up`.

## Docker Support

Boot handles two styles of Docker usage:

### Docker Compose
For projects with a `docker-compose.yml`:
- `boot up` runs `docker compose up -d`
- Detects port conflicts and auto-remaps to free ports
- Reuses existing containers when possible

### Standalone Containers
For projects that use raw `docker run` (no compose):
- Starts existing stopped containers with `docker start`
- Creates new containers with `docker run -d` if needed
- Port conflict detection + auto-remap

## Process Management

- App processes run in the background (detached)
- PIDs are stored in `.boot/pids/`
- Logs are written to `.boot/logs/`
- `boot down` kills the full process tree (not just the parent)
- Falls back to `pkill -f` for orphan process cleanup
- Ports are freed before starting if occupied

Add `.boot/` to your `.gitignore`.

## License

[FSL-1.1-MIT](LICENSE)

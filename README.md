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

That's it. `boot init` detects your Docker Compose, monorepo apps, package manager, Prisma, and generates the config.

## Config

`boot init` creates a `boot.yaml` in your project root:

```yaml
name: my-project

setup:
  - pnpm install
  - pnpm db:generate
  - pnpm db:push

docker:
  composeFile: docker-compose.yml
  services:
    - name: postgres
      container: my-project-postgres
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
| `setup` | Commands to run on `boot setup` |
| `docker.composeFile` | Path to compose file (default: `docker-compose.yml`) |
| `docker.services[].name` | Service name |
| `docker.services[].container` | Container name for `docker exec` |
| `docker.services[].readyCheck` | Command to check if service is ready |
| `docker.services[].timeout` | Seconds to wait for readiness (default: 30) |
| `apps[].name` | App name (used for logs and PID tracking) |
| `apps[].path` | Working directory relative to project root |
| `apps[].command` | Command to start the app |
| `apps[].port` | Port the app listens on |
| `apps[].health` | URL to poll for health check |
| `apps[].env` | Extra environment variables |

## What `boot init` Auto-Detects

- **Package manager** — from lockfiles (`pnpm-lock.yaml`, `yarn.lock`, `package-lock.json`)
- **Docker Compose** — `docker-compose.yml` / `compose.yml`
- **Database services** — Postgres, MySQL, Redis (with appropriate readiness checks)
- **Monorepo apps** — scans `apps/*/package.json` for dev scripts
- **Single-app projects** — detects `dev` or `start` scripts in root `package.json`
- **Prisma** — detects `prisma/` directory and adds generate/push to setup
- **Ports** — guesses 3000 for web/frontend, 3001 for api/server

## What Each Command Does

### `boot up`

1. Auto-installs deps if `node_modules` is missing
2. Starts Docker services (`docker compose up -d`)
3. Waits for each service's readiness check
4. Starts each app in the background
5. Polls health URLs until ready
6. Prints summary with URLs

### `boot down`

1. Stops all tracked app processes (SIGTERM → SIGKILL)
2. Stops Docker services (`docker compose down`)

### `boot status`

Shows a table of all services with their status, ports, PIDs, and log paths.

### `boot reboot`

Runs `down` then `up`.

## Process Management

- App processes run in the background (detached)
- PIDs are stored in `.boot/pids/`
- Logs are written to `.boot/logs/`
- `boot down` kills the full process tree (not just the parent)
- Ports are freed before starting if occupied

Add `.boot/` to your `.gitignore`.

## License

[FSL-1.1-MIT](LICENSE)

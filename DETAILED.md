# Openboot

Every project has the same problem: a README that says "run these 12 commands to get started," a `start.sh` that half works, Docker containers you forgot to start, and env vars you didn't set. New teammates spend hours just trying to run the thing.

Then there's the AI problem: every tool wants its own instruction file — `.cursorrules`, `AGENTS.md`, `CLAUDE.md`. `SKILL.md`, `SOUL.md`, `copilot-instructions.md`, and you're copy-pasting the same conventions between projects and files.

Boot fixes both. One config file, one command, everything starts, and your AI agent context stays in sync across every tool and every project.

> Stop writing start scripts. Stop copy-pasting agent files. Just boot.

```
boot init        → creates boot.yaml (auto-detects your stack)
boot setup       → one-time setup (deps, DB, migrations)
boot up          → start everything (Docker + apps) in the background
boot up -a       → start everything + stream logs (Ctrl+C detaches)
boot dev         → interactive dev mode with live logs (Ctrl+C stops all)
boot down        → stop everything
boot reboot      → restart everything
boot status      → show what's running
boot logs        → view service logs (boot logs api -f)
boot clean       → nuke deps, caches, build outputs for a fresh start
boot agent init  → generate AI agent context (.cursorrules, AGENTS.md, CLAUDE.md)
boot editor init → generate editor config (.vscode/tasks.json, .zed/tasks.json)
boot hub init    → generate CI workflows (.github/workflows, .forgejo/workflows)
```

## Install

Requires Node 18+.

```bash
npm install -g openboot
```

Or use without installing:

```bash
npx openboot init
```

## Quick Start

```bash
# In any project
boot init        # creates boot.yaml by auto-detecting your stack
boot setup       # one-time: install deps, start DB, run migrations
boot up          # start Docker + all app processes
boot dev         # or: start + stream live logs (Ctrl+C stops all)
boot agent init  # optional: generate AI agent context for Cursor, Copilot, Claude, Codex
```

That's it. `boot init` detects your Docker setup, apps, package manager, env requirements, and generates the config. Boot doesn't replace your scripts—it orchestrates them: one place to maintain, and `boot init` / `boot agent init` do the rest so you rarely edit by hand.

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
    port: auto          # assigns a free port (4000–4999) at startup

agent:
  description: "E-commerce platform with Next.js frontend and Express API"
  conventions:
    - Use server components by default
    - All DB access through Prisma
    - Tests use Vitest
  targets:
    - .cursorrules
    - AGENTS.md
    - CLAUDE.md
    - .github/copilot-instructions.md

editor:
  tasks:
    - name: dev
      command: pnpm dev
    - name: test
      command: pnpm test
      group: test
    - name: lint
      command: pnpm lint
  targets:
    - .vscode
    - .zed

hub:
  ci:
    on: [push, pull_request]
    node: "18"
    steps:
      - name: Install
        run: pnpm install
      - name: Lint
        run: pnpm lint
      - name: Test
        run: pnpm test
  targets:
    - .github
    - .forgejo
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
| `apps[].port` | Port the app listens on. Set to `"auto"` to assign a free port dynamically (range 4000–4999) |
| `apps[].health` | URL to poll for health check |
| `apps[].env` | Extra environment variables |
| **agent** | |
| `agent.description` | Project description included in AI agent context |
| `agent.conventions` | Coding conventions for AI agents to follow |
| `agent.targets` | Files to write agent context to (default: `.cursorrules`, `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`) |
| `agent.references` | Git repos to clone as AI context. String (URL) or object (`url` + `include` paths) |
| **editor** | |
| `editor.tasks[].name` | Task label shown in the editor |
| `editor.tasks[].command` | Shell command to run |
| `editor.tasks[].cwd` | Working directory relative to project root |
| `editor.tasks[].group` | Task group: `"build"` or `"test"` |
| `editor.targets` | Editor directories to write to (default: `[".vscode", ".zed"]`) |
| **hub** | |
| `hub.ci.on` | Trigger events (default: `["push", "pull_request"]`) |
| `hub.ci.node` | Node.js version (auto-detected from `.nvmrc`/engines if omitted) |
| `hub.ci.steps[].name` | CI step display name |
| `hub.ci.steps[].run` | Shell command to run |
| `hub.targets` | Hub directories to write to (default: `[".github", ".forgejo"]`) |
| **team** | |
| `team.url` | Git URL (SSH or HTTPS) of the team profile repo |
| `team.required` | If true, Boot fails when the team profile can't be resolved |
| `team.branch` | Branch to track (default: `main`) |

## What `boot init` Auto-Detects

- **Package manager** — from lockfiles (`pnpm-lock.yaml`, `yarn.lock`, `package-lock.json`)
- **Docker Compose** — `docker-compose.yml` / `compose.yml`
- **Raw Docker containers** — scans `scripts/*.sh` for `docker start` / `docker run` patterns
- **Database services** — Postgres, MySQL, Redis (with appropriate readiness checks)
- **Monorepo apps** — scans `apps/*/package.json` for dev scripts
- **Sub-directory apps** — detects `dashboard/`, `frontend/`, `backend/`, `server/`, etc.
- **Single-app projects** — detects `dev` or `start` scripts in root `package.json`
- **Editor tasks** — detects common scripts (`dev`, `build`, `test`, `lint`, `start`, `format`, `typecheck`) from `package.json`
- **Hub CI steps** — detects CI-relevant scripts (`lint`, `test`, `build`, `typecheck`) from `package.json`; detects Node version from `.nvmrc`, `.node-version`, or `engines`
- **Python / uv** — detects `pyproject.toml` or `uv.lock` and adds `uv sync` to setup (or `pip install -e .` when only `requirements.txt` is present)
- **Build-before-run** — if `dashboard/`, `frontend/`, `web/`, `client/`, or `admin/` has a `build` script, adds `cd <dir> && <pm> install && <pm> run build` to setup so the main app can assume the bundle is built
- **Python main app** — when `pyproject.toml` has `[project.scripts]` (or uses project name), adds a primary app with `uv run <script>` and a known port when applicable (e.g. exo → 52415)
- **Prisma** — detects `prisma/` directory and adds generate/push to setup
- **Ports** — guesses 3000 for web/frontend, 3001 for api/server
- **`.env` requirements** — parses `env.example` / `.env.example` for required and sensitive vars
- **AI agent files** — detects `.cursorrules`, `AGENTS.md`, `CLAUDE.md`, `.windsurfrules`, etc.

## What Each Command Does

### `boot up`

1. Checks prerequisites (Node.js 18+, Docker if needed)
2. Auto-creates `.env` from template (`env.example` / `.env.example`) if missing
3. Validates `.env` file (required vars, rejects default secrets)
4. Ensures package manager is available (auto-enables pnpm/yarn via corepack)
5. Auto-installs root deps if `node_modules` is missing
6. Auto-installs per-app deps in monorepo sub-apps
7. Smart Prisma check — generates client only if `.prisma` is missing
8. Starts Docker (compose services and/or standalone containers)
9. Waits for each service's readiness check
10. Starts each app in the background
11. Polls health URLs until ready
12. Prints summary with URLs

#### `boot up --attach` / `boot up -a`

Same as `boot up` but after starting, streams all app logs to your terminal (color-coded by service). Press Ctrl+C to detach — services keep running in the background.

### `boot dev`

Interactive development mode — the closest replacement for your old `start.sh` scripts:

1. Starts Docker services
2. Starts all apps
3. Streams live, color-coded logs for every service
4. **Ctrl+C gracefully stops everything** (apps + Docker)

This is the "one terminal" experience. No separate tabs needed.

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
- Process name (what binary is actually running, e.g. `node`, `nuxt`)
- Live health checks (curl for apps, `pg_isready` / `redis-cli ping` for DBs)
- Log file paths

### `boot clean`

Nukes everything for a fresh start:
1. Removes `node_modules` in root and all sub-apps
2. Removes lockfiles (`package-lock.json`, `yarn.lock`)
3. Removes caches (`.nuxt`, `.next`, `.turbo`, `.vite`, `.parcel-cache`)
4. Removes build outputs (`dist/`, `build/`)
5. Removes `.boot/` runtime data (PIDs, logs)
6. Pass `--all` to also remove `pnpm-lock.yaml`

### `boot logs`

View logs for any service:
```bash
boot logs                    # show recent logs for all services
boot logs api                # show logs for a specific service
boot logs api -f             # follow mode (like tail -f)
boot logs api -n 100         # last 100 lines
boot logs postgres           # Docker container logs too
```

### `boot setup`

One-time setup with smart Prisma handling:
1. Checks prerequisites (Node.js, Docker)
2. Auto-creates `.env` from template
3. Starts Docker services (DB needs to be up for migrations)
4. Runs configured setup commands
5. Smart Prisma: generate client + migrations with fallback (`migrate deploy` → `db push`)
6. Non-fatal seed failures (skips gracefully)

### `boot reboot`

Runs `down` then `up`.

## AI Agent Context

Boot can generate and manage AI agent instruction files for Cursor, GitHub Copilot, Claude Code, and Codex. One source of truth, synced to every tool.

### Why

Every AI coding tool wants its own instruction file (`.cursorrules`, `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`). Without Boot, you maintain near-identical files by hand. They go stale. New projects start from scratch.

Boot solves this: it already knows your stack, so it generates agent context automatically and writes to all targets at once.

### `boot agent init`

Generate agent context from your project stack and sync to all target files. Boot **uses existing agent files** (e.g. `.cursorrules`, `AGENTS.md`) when present: their content is included in the generated output, and **existing target files are not overwritten** — only missing targets are created. Use `--overwrite` to replace existing files.

```bash
boot agent init
# ▶ Stack: Next.js, Hono, Prisma, tRPC, Zod, Vitest, TypeScript, Tailwind CSS, Turborepo
# ✓ Wrote .github/copilot-instructions.md
# Skipped existing (use --overwrite to replace): .cursorrules, AGENTS.md, CLAUDE.md
```

Works with or without `boot.yaml`. With a config, you get richer output (apps, services, env requirements, conventions). Without one, Boot still auto-detects your stack from `package.json`.

### `boot agent sync`

Regenerate and sync after editing `boot.yaml`. Same as init: existing target files are skipped unless you pass `--overwrite`.

```bash
boot agent sync          # regenerate; only write to missing targets
boot agent sync --no-global  # exclude personal conventions
boot agent sync --overwrite  # replace existing agent files
```

### `boot agent check`

Validate that target files are in sync with your config. Exits with code 1 if anything is stale or missing — use it in CI or as a pre-commit hook:

```bash
boot agent check
# ✓ .cursorrules — in sync
# ✓ AGENTS.md — in sync
# ⚠ CLAUDE.md — out of date
# Run `boot agent sync` to update all targets.
```

### `boot agent remember`

Save conventions and patterns to a global store (`~/.boot/agent/`) that carries across all your projects:

```bash
boot agent remember "Always validate API inputs with zod schemas"
boot agent remember "Use early returns for guard clauses"
boot agent remember "Prefer named exports over default exports"
```

These show up automatically in every future `boot agent init` / `boot agent sync` under a "Remembered Patterns" section.

### `boot agent save`

Push your project's conventions to the global store so they apply to all future projects:

```bash
boot agent save
# ✓ Saved 3 conventions to global store
# Location: ~/.boot/agent/conventions.md
```

### `boot agent status`

See what Boot knows about your project's agent context:

```bash
boot agent status
# ▶ Stack: Next.js, Prisma, TypeScript
# ▶ Agent files: .cursorrules, AGENTS.md, CLAUDE.md
# ▶ Config: boot.yaml has agent section
# ▶ Global: 3 conventions, 3 remembered patterns
# ✓ 4 target(s) in sync
```

### Cross-Project Transfer

Your global conventions travel with you. When you start a new project and run `boot agent init`, your personal conventions and remembered patterns are automatically included.

You can also import directly from another project:

```bash
boot agent init --from ~/other-project
# ✓ Imported 5 conventions to global store
# ✓ Wrote .cursorrules
# ✓ Wrote AGENTS.md
# ...
```

### How It Works

Three sources merge into one output:

```
~/.boot/agent/               boot.yaml agent:           auto-detection
(personal, travels           (project-specific,         (stack, frameworks,
 with you)                    committed to repo)         structure)
       │                           │                          │
       └───────────────────────────┼──────────────────────────┘
                                   ▼
                         boot agent init / sync
                                   │
               ┌───────────────────┼───────────────────┐
               ▼                   ▼                   ▼
         .cursorrules         AGENTS.md           CLAUDE.md
                                                       ▼
                                        .github/copilot-instructions.md
```

### Generated Output

The generated markdown includes (when available):

- **Stack** — detected frameworks, tools, package manager
- **Project Structure** — apps with paths and ports
- **Services** — Docker services (Postgres, Redis, etc.)
- **Commands** — boot dev, boot setup, etc.
- **Environment** — required env vars
- **Conventions** — from `boot.yaml` agent section
- **Personal Conventions** — from `~/.boot/agent/conventions.md`
- **Remembered Patterns** — from `~/.boot/agent/memory.md`
- **References** — content from repos listed in `agent.references`

### References

Point your agent context at any git repo. Boot clones it to a global cache (`~/.boot/references/`), keeps it updated (auto-pull every 10 minutes), and includes the content in the generated agent markdown.

**Short form**, just a URL, includes the README:

```yaml
agent:
  references:
    - git@github.com:Effect-TS/effect.git
    - https://github.com/drizzle-team/drizzle-orm.git
```

**Long form** — specify exactly what to include:

```yaml
agent:
  references:
    - url: git@github.com:Effect-TS/effect.git
      include:
        - docs/
        - packages/effect/README.md
        - packages/effect/src/index.ts
```

`include` accepts files and directories. Directories are walked recursively and all text files are included. This lets you pull in exactly the docs, types, or source your AI tools need.

**Limits:** Individual files are capped at 15,000 characters, total content per reference at 50,000 characters. Binary files and `node_modules` are skipped. Team profiles can also define references — they get merged with project references (deduplicated by URL, project entries win).

### Stack Detection

Boot auto-detects 30+ technologies from your `package.json` (root + monorepo sub-apps):

Next.js, Nuxt, React, Vue, SvelteKit, SolidJS, Express, Fastify, Hono, NestJS, Elysia, Prisma, Drizzle, TypeORM, Mongoose, Supabase, tRPC, GraphQL, Zod, Vitest, Jest, Playwright, Cypress, TypeScript, Tailwind CSS, Turborepo, Nx, Python, Go, Rust.

## Development Workflow

```bash
# Option 1: Background (CI-friendly, scriptable)
boot up               # starts everything, exits immediately
boot logs api -f      # follow one service's logs in another terminal
boot down             # stop when done

# Option 2: Attach (start background + watch logs)
boot up --attach      # starts everything, streams logs; Ctrl+C detaches (services stay up)
boot down             # stop when done

# Option 3: Interactive (replaces start.sh)
boot dev              # starts everything + live logs; Ctrl+C stops everything
```

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

### Auto Port Assignment

Set `port: auto` in `boot.yaml` and Boot picks a free port in the 4000–4999 range at startup:

```yaml
apps:
  - name: web
    command: pnpm dev
    port: auto
```

The resolved port is persisted in `.boot/ports/` so `boot status` and `boot down` can reference it. The `PORT` environment variable is set automatically for the child process.

### Framework Port Injection

Some frameworks (Vite, Astro, Angular CLI, Webpack Dev Server, React Router) ignore the `PORT` environment variable. When Boot detects one of these in your app command — either directly or by resolving the underlying script from `package.json` — it automatically appends the correct `--port` (and `--host` where needed) flags so the app listens on the port Boot assigned.

This works for both explicit ports and `port: auto`. No config needed — Boot handles the detection and injection transparently.

### `.localhost` Proxy

Boot runs a reverse proxy on port 1355 that gives every app a stable, named URL:

```
api  → http://api.localhost:1355
web  → http://web.localhost:1355
docs → http://docs.localhost:1355
```

The proxy starts automatically with `boot dev` and `boot up`. No config, no `/etc/hosts` editing — `*.localhost` resolves to `127.0.0.1` in all modern browsers per RFC 6761.

**Why this matters:**
- URLs survive restarts — auto-assigned ports change, names don't
- One port to remember across all projects (1355)
- Cookies and localStorage isolate per app name (no cross-app bleed)
- AI agents can use stable URLs instead of guessing ports
- Visit `http://localhost:1355` for a status page listing all registered apps

The proxy handles HTTP and WebSocket upgrades (HMR, live-reload) transparently. If port 1355 is already in use, Boot falls back to showing direct `localhost:<port>` URLs.

Add `.boot/` to your `.gitignore`.

## Editor Config

Boot syncs editor tasks from one source in `boot.yaml` to multiple editors. Define tasks once, generate `.vscode/tasks.json` and `.zed/tasks.json`. One source, many targets — same philosophy as agent sync.

### Config

Add an `editor` section to `boot.yaml`:

```yaml
editor:
  tasks:
    - name: dev
      command: pnpm dev
      cwd: apps/web          # optional, relative to project root
      group: build            # optional: "build" or "test"
    - name: test
      command: pnpm test
      group: test
    - name: lint
      command: pnpm lint
  targets:                    # default: [".vscode", ".zed"]
    - .vscode
    - .zed
```

| Field | Required | Default | Description |
|---|---|---|---|
| `tasks[].name` | yes | — | Task label shown in the editor |
| `tasks[].command` | yes | — | Shell command to run |
| `tasks[].cwd` | no | project root | Working directory relative to project root |
| `tasks[].group` | no | — | `"build"` or `"test"` (maps to editor-specific grouping) |
| `targets` | no | `[".vscode", ".zed"]` | Editor directories to write to |

### Commands

```bash
boot editor init               # detect tasks from package.json, write to targets
boot editor sync               # regenerate after editing boot.yaml
boot editor check              # verify targets are in sync (CI-friendly)
```

Options:

```bash
boot editor init --overwrite   # overwrite existing editor config files
boot editor sync --overwrite   # overwrite existing editor config files
```

### Generated Output

**VS Code** — `.vscode/tasks.json`:

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "dev",
      "type": "shell",
      "command": "pnpm dev",
      "options": { "cwd": "${workspaceFolder}/apps/web" },
      "group": "build",
      "problemMatcher": []
    }
  ]
}
```

**Zed** — `.zed/tasks.json`:

```json
[
  {
    "label": "dev",
    "command": "pnpm dev",
    "cwd": "apps/web",
    "tags": ["build"]
  }
]
```

### Auto-Detection

`boot editor init` scans `package.json` for common scripts (`dev`, `build`, `test`, `lint`, `start`, `format`, `typecheck`) and generates a task for each. It also creates per-app start tasks from `boot.yaml` apps.

## Hub Config

Boot syncs CI workflows from one source in `boot.yaml` to multiple code hosts. Define your pipeline once, generate `.github/workflows/ci.yml` and `.forgejo/workflows/ci.yml`. Forgejo Actions uses GitHub Actions-compatible syntax, so the workflow content is the same — only the directory differs.

### Config

Add a `hub` section to `boot.yaml`:

```yaml
hub:
  ci:
    on: [push, pull_request]   # default: [push, pull_request]
    node: "18"                 # auto-detected from .nvmrc/engines if omitted
    steps:
      - name: Install
        run: pnpm install
      - name: Lint
        run: pnpm lint
      - name: Test
        run: pnpm test
  targets:                     # default: [".github", ".forgejo"]
    - .github
    - .forgejo
```

| Field | Required | Default | Description |
|---|---|---|---|
| `ci.on` | no | `["push", "pull_request"]` | Trigger events |
| `ci.node` | no | auto-detected or `"18"` | Node.js version for `actions/setup-node` |
| `ci.steps[].name` | yes | — | Step display name |
| `ci.steps[].run` | yes | — | Shell command to run |
| `targets` | no | `[".github", ".forgejo"]` | Hub directories to write to |

### Commands

```bash
boot hub init                  # detect CI steps from package.json, write workflows
boot hub sync                  # regenerate after editing boot.yaml
boot hub check                 # verify targets are in sync (CI-friendly)
```

Options:

```bash
boot hub init --overwrite      # overwrite existing workflow files
boot hub sync --overwrite      # overwrite existing workflow files
```

### Generated Output

Both `.github/workflows/ci.yml` and `.forgejo/workflows/ci.yml` get the same content:

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "18"
      - name: Install
        run: pnpm install
      - name: Lint
        run: pnpm lint
      - name: Test
        run: pnpm test
```

For pnpm projects, Boot automatically adds the `pnpm/action-setup@v4` step.

### Auto-Detection

`boot hub init` scans `package.json` for CI-relevant scripts (`lint`, `test`, `build`, `typecheck`) and generates a step for each. Node version is detected from `.nvmrc`, `.node-version`, or `engines.node` in `package.json`.

## Team Profiles

Share a company-wide baseline across every repo. The team profile lives in a git repo and applies to the **whole tool**, setup commands, env rules, agent conventions, everything.

### Config

Add a `team` section to your project's `boot.yaml`:

```yaml
team:
  url: git@github.com:company/boot-standards.git
  required: true    # optional: fail if the profile can't be resolved
  branch: main      # optional: defaults to main
```

| Field | Required | Default | Description |
|---|---|---|---|
| `url` | yes | — | Git URL (SSH or HTTPS) of the team profile repo |
| `required` | no | `false` | If true, Boot refuses to run when the team profile can't be resolved |
| `branch` | no | `main` | Branch to track |

### Team Profile Repo

The team repo contains a `boot.yaml` (or `boot.yml` / `boot.json`) with the shared baseline. It uses the same format as a project `boot.yaml` but typically only defines the fields you want to enforce across all repos:

```yaml
# Example: company/boot-standards/boot.yaml

env:
  reject:
    JWT_SECRET:
      - your-super-secret-jwt-key-change-this
    API_KEY:
      - changeme

setup:
  - npm run lint:check

agent:
  conventions:
    - Use conventional commits for PR titles
    - Never commit secrets or .env files
    - Always run tests before pushing
    - Write scripts in TypeScript, not bash
  targets:
    - .cursorrules
    - AGENTS.md
    - CLAUDE.md
    - .github/copilot-instructions.md
```

### Commands

```bash
boot team set <url>     # add team.url to boot.yaml + clone the profile
boot team sync          # force-pull the latest version
boot team check         # verify the profile is applied and up to date (CI-friendly)
boot team status        # show what the team profile includes
boot team remove        # remove team.url from boot.yaml + clear cache
```

Options for `boot team set`:

```bash
boot team set <url> --branch develop    # track a specific branch
boot team set <url> --required          # enforce: fail if unavailable
```

### How Merge Works

When `loadConfig()` sees a `team.url`, it clones (or pulls) the team repo to `~/.boot/teams/<hash>/` and merges the team config as the base layer under the project config.

**Merge strategy (field by field):**

| Field | Strategy |
|---|---|
| `name` | Always project |
| `packageManager` | Project if set, else team |
| `setup` | Team first, then project (concatenate, deduplicate) |
| `env.file` | Project if set, else team |
| `env.required` | Concatenate + deduplicate |
| `env.reject` | Deep merge (both apply, project overrides per-key) |
| `docker` | Project wins entirely (too project-specific) |
| `apps` | Project wins entirely (too project-specific) |
| `agent.description` | Project if set, else team |
| `agent.conventions` | Team first, then project (concatenate, deduplicate) |
| `agent.targets` | Project if set, else team |
| `team` | Always project (don't inherit nested team refs) |

### Caching

The team repo is cloned to `~/.boot/teams/<url-hash>/` on first use. On subsequent runs, Boot auto-pulls if the cache is older than 10 minutes. Use `boot team sync` to force an immediate pull.

If a pull fails (offline, auth issue), Boot uses the cached version silently. If `required: true` is set and no cached version exists, Boot fails with a clear error.

### CI Usage

Add `boot team check` to your CI pipeline to verify the team profile is applied:

```yaml
# GitHub Actions example
- name: Verify team profile
  run: boot team check
```

### Agent Context

When generating agent markdown (`boot agent init` / `boot agent sync`), team conventions appear in a separate **Team Conventions** section so it's clear what comes from the team vs. the project.

## License

[FSL-1.1-MIT](LICENSE)

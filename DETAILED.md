# OpenBoot — Full Reference

This document covers the complete configuration reference, auto-detection list, command details, and session tracking internals. Start with the [README](README.md) for the quick overview.

---

## `boot.yaml` — Full Config Reference

`boot init` creates this file. Everything is optional except what you explicitly need.

```yaml
name: my-project
packageManager: pnpm          # auto-detected from lockfiles if omitted

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
  composeFile: docker-compose.yml
  services:
    - name: postgres
      container: my-project-postgres
      readyCheck: pg_isready -U postgres
      timeout: 30
  containers:                  # standalone containers (no compose)
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
    port: auto                 # assigns free port in 4000–4999 range

agent:
  description: "E-commerce platform — Next.js + Prisma"
  conventions:
    - Use server components by default
    - All DB access through Prisma
  targets:
    - .cursorrules
    - AGENTS.md
    - CLAUDE.md
    - .github/copilot-instructions.md
  soul:
    identity: "Senior fullstack engineer. Correctness over speed."
    values:
      - Type safety is non-negotiable
      - Ask before making breaking changes
    boundaries:
      - Never modify production configs directly
      - Always run tests before marking work complete
    voice:
      - Be direct and concise
      - When uncertain, say so
  skills:
    paths:
      - my-skills/
      - shared/workflows/
  references:
    - git@github.com:Effect-TS/effect.git
    - url: git@github.com:Effect-TS/effect.git
      include:
        - docs/
        - packages/effect/README.md

editor:
  tasks:
    - name: dev
      command: pnpm dev
      cwd: apps/web
      group: build
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

team:
  url: git@github.com:company/boot-standards.git
  required: true
  branch: main
```

### Field reference

| Field | Description |
|---|---|
| `name` | Project name (display only) |
| `packageManager` | `pnpm`, `npm`, or `yarn` (auto-detected from lockfiles) |
| **env** | |
| `env.file` | Path to `.env` file (default: `.env`) |
| `env.required` | Vars that must be set — `boot up` fails if missing |
| `env.reject` | Values to reject per key (blocks default/example secrets) |
| **setup** | |
| `setup` | Commands to run on `boot setup`, in order |
| **docker** | |
| `docker.composeFile` | Path to compose file (default: `docker-compose.yml`) |
| `docker.services[].name` | Compose service name |
| `docker.services[].container` | Container name for `docker exec` |
| `docker.services[].readyCheck` | Command to verify service is ready |
| `docker.services[].timeout` | Seconds to wait for readiness (default: 30) |
| `docker.containers[].name` | Standalone container name |
| `docker.containers[].image` | Docker image (e.g. `postgres:15`) |
| `docker.containers[].ports` | Port mappings (e.g. `"5433:5432"`) |
| `docker.containers[].env` | Environment variables for the container |
| `docker.containers[].volumes` | Volume mounts |
| `docker.containers[].readyCheck` | Readiness check command |
| `docker.containers[].timeout` | Seconds to wait (default: 30) |
| **apps** | |
| `apps[].name` | App name — used in logs and PID tracking |
| `apps[].path` | Working directory relative to project root |
| `apps[].command` | Command to start the app |
| `apps[].port` | Port the app listens on. `"auto"` assigns a free port (4000–4999) |
| `apps[].health` | URL to poll for health check |
| `apps[].env` | Extra environment variables for this app |
| **agent** | |
| `agent.description` | Project description included in agent context |
| `agent.conventions` | Coding conventions for agents to follow |
| `agent.targets` | Files to write to (default: `.cursorrules`, `AGENTS.md`, `CLAUDE.md`, `copilot-instructions.md`) |
| `agent.soul.identity` | Freeform paragraph — who the agent is in this project |
| `agent.soul.values` | What the agent should prioritize |
| `agent.soul.boundaries` | Hard limits on agent behavior |
| `agent.soul.voice` | Communication style |
| `agent.skills.paths` | Extra directories to scan for `SKILL.md` files |
| `agent.references` | Git repos to clone as context. String (URL) or object with `url` + `include` |
| **editor** | |
| `editor.tasks[].name` | Task label shown in the editor |
| `editor.tasks[].command` | Shell command to run |
| `editor.tasks[].cwd` | Working directory relative to project root |
| `editor.tasks[].group` | `"build"` or `"test"` |
| `editor.targets` | Editor directories to write to (default: `[".vscode", ".zed"]`) |
| **hub** | |
| `hub.ci.on` | Trigger events (default: `["push", "pull_request"]`) |
| `hub.ci.node` | Node.js version (auto-detected from `.nvmrc`/`engines` if omitted) |
| `hub.ci.steps[].name` | CI step display name |
| `hub.ci.steps[].run` | Shell command to run |
| `hub.targets` | Hub directories to write to (default: `[".github", ".forgejo"]`) |
| **team** | |
| `team.url` | Git URL (SSH or HTTPS) of the team profile repo |
| `team.required` | If `true`, Boot fails when the profile can't be resolved |
| `team.branch` | Branch to track (default: `main`) |

---

## Auto-Detection

`boot init` and `boot agent init` detect the following without any config:

**Package manager** — from lockfiles (`pnpm-lock.yaml`, `yarn.lock`, `package-lock.json`)

**Docker** — `docker-compose.yml` / `compose.yml`; also scans `scripts/*.sh` for `docker start` / `docker run` patterns

**Database services** — Postgres, MySQL, Redis with appropriate readiness checks

**Apps** — monorepo `apps/*/package.json`; sub-directories (`dashboard/`, `frontend/`, `backend/`, `server/`); single-app root `dev`/`start` scripts

**Stack (30+ technologies)** — Next.js, Nuxt, React, Vue, SvelteKit, SolidJS, Express, Fastify, Hono, NestJS, Elysia, Prisma, Drizzle, TypeORM, Mongoose, Supabase, tRPC, GraphQL, Zod, Vitest, Jest, Playwright, Cypress, TypeScript, Tailwind CSS, Turborepo, Nx, Python, Go, Rust

**Tooling** — `dev`, `build`, `test`, `lint`, `start`, `format`, `typecheck` scripts from `package.json`; Node version from `.nvmrc`, `.node-version`, or `engines`

**Prisma** — detects `prisma/` and adds generate/push to setup

**Ports** — guesses 3000 for web/frontend, 3001 for api/server

**Env requirements** — parses `env.example` / `.env.example`

**Existing agent files** — `.cursorrules`, `AGENTS.md`, `CLAUDE.md`, `.windsurfrules`, etc. (content is preserved and included in generated output)

**Python / uv** — detects `pyproject.toml` or `uv.lock`, adds `uv sync` to setup

**Build-before-run** — if a frontend directory has a `build` script, adds it to setup so the main app can assume the bundle is ready

---

## Command Details

### `boot up`

1. Checks prerequisites (Node.js 18+, Docker if needed)
2. Auto-creates `.env` from `env.example` / `.env.example` if missing
3. Validates `.env` (required vars, rejects default secrets)
4. Ensures package manager is available (auto-enables pnpm/yarn via corepack)
5. Auto-installs root deps if `node_modules` is missing
6. Auto-installs per-app deps in monorepo sub-apps
7. Smart Prisma check — generates client only if `.prisma` is missing
8. Starts Docker (compose services and/or standalone containers)
9. Waits for each service's readiness check
10. Starts each app in the background
11. Polls health URLs until ready
12. Prints summary with URLs

```bash
boot up               # start everything, exit immediately
boot up --attach      # start + stream logs; Ctrl+C detaches (services keep running)
boot up -a            # same as --attach
```

### `boot dev`

Same startup sequence as `boot up`, then streams live color-coded logs for every service. Ctrl+C gracefully stops everything (apps + Docker). The "one terminal" replacement for `start.sh`.

### `boot down`

1. Stops tracked app processes (SIGTERM → SIGKILL)
2. Falls back to `pkill -f` for orphan process cleanup
3. Force-kills anything still holding app ports
4. Stops standalone Docker containers
5. Stops Docker Compose services

### `boot status`

Shows a table with: status, port, PID, process name, live health check result, log file path. PID mismatches (PID file ≠ port owner) are flagged with a warning.

```bash
boot status           # table output
boot status --json    # machine-readable
```

### `boot clean`

Removes `node_modules` (root + sub-apps), lockfiles (`package-lock.json`, `yarn.lock`), caches (`.nuxt`, `.next`, `.turbo`, `.vite`, `.parcel-cache`), build outputs (`dist/`, `build/`), and `.boot/` runtime data. Pass `--all` to also remove `pnpm-lock.yaml`.

### `boot logs`

```bash
boot logs                    # recent logs for all services
boot logs api                # specific service
boot logs api -f             # follow mode
boot logs api -n 100         # last 100 lines
boot logs postgres           # Docker container logs
```

### `boot setup`

One-time setup with smart Prisma handling: starts Docker services, runs configured setup commands, runs `migrate deploy` → `db push` fallback. Seed failures are non-fatal.

---

## Process Management

- App processes run detached in the background
- PIDs stored in `.boot/pids/`, logs in `.boot/logs/`
- `boot down` kills the full process tree (not just the parent PID)
- Falls back to `pkill -f` for orphan cleanup
- Ports are freed before starting if occupied

Add `.boot/` to your `.gitignore`.

### Auto port assignment

```yaml
apps:
  - name: web
    command: pnpm dev
    port: auto               # picks free port in 4000–4999
```

The resolved port is stored in `.boot/ports/` and set as `PORT` env var for the child process.

### Framework port injection

Some frameworks (Vite, Astro, Angular CLI, Webpack Dev Server, React Router) ignore `PORT`. Boot detects these from the command or the underlying `package.json` script and appends the correct `--port` / `--host` flags automatically.

### `.localhost` proxy

Boot runs a reverse proxy on port 1355:

```
api  → http://api.localhost:1355
web  → http://web.localhost:1355
```

No `/etc/hosts` editing — `*.localhost` resolves to `127.0.0.1` per RFC 6761. The proxy handles HTTP and WebSocket (HMR, live-reload). Visit `http://localhost:1355` for a status page. Falls back to `localhost:<port>` if port 1355 is taken.

### Tunnel (Private Connect)

With `boot up --tunnel` or `tunnel: true` in `boot.yaml`, Boot starts a [Private Connect](https://github.com/treadiehq/private-connect) tunnel for the proxy port. You get a public URL (e.g. `https://abc123.privateconnect.co`) that forwards to your local stack — share it for demos or collaboration. No signup required. `boot down` stops the tunnel; `boot status` shows the tunnel URL when active.

---

## Agent Sync Details

### How the merge works

Three sources combine into one output:

```
~/.boot/agent/         boot.yaml agent:        auto-detection
(personal)             (project)               (stack, tools)
      └──────────────────────┴──────────────────────┘
                             ▼
                   boot agent init / sync
                             │
          ┌──────────────────┼──────────────────┐
          ▼                  ▼                  ▼
    .cursorrules         AGENTS.md          CLAUDE.md
                                    copilot-instructions.md
```

Existing target files are **never overwritten** unless you pass `--overwrite`. Boot only creates missing targets.

### Generated content

Each target file includes:

- **Stack** — detected frameworks and tools
- **Project structure** — apps with paths and ports
- **Services** — Docker services (Postgres, Redis, etc.)
- **Tooling** — test runner, linter, formatter, DB commands, dev server
- **Environment** — required env vars
- **Conventions** — merged from project, team, and personal stores
- **Skills** — detected skills with names and descriptions
- **References** — content fetched from repos in `agent.references`

`SOUL.md` is generated only when `agent.soul` is defined.

### References — limits

Individual files are capped at 15,000 characters. Total content per reference is capped at 50,000 characters. Binary files and `node_modules` are skipped. Repos are cached at `~/.boot/references/` and auto-refreshed every 10 minutes.

### Skills — detection paths

Boot auto-scans: `skills/`, `.codex/skills/`, `.cursor/skills/`. Add custom paths via `agent.skills.paths`. Each skill must be a directory with a `SKILL.md` containing `name` and `description` in YAML frontmatter.

If your team profile repo has a `skills/` directory, Boot copies those into your project on `boot agent init` / `boot agent sync`. Existing project skills are never overwritten.

---

## Team Profiles

The team repo contains its own `boot.yaml` with the fields you want to enforce:

```yaml
# company/boot-standards/boot.yaml
env:
  reject:
    JWT_SECRET:
      - your-super-secret-jwt-key-change-this

agent:
  conventions:
    - Use conventional commits for PR titles
    - Never commit secrets or .env files
    - Always run tests before pushing
```

### Merge strategy

| Field | Strategy |
|---|---|
| `name` | Always project |
| `packageManager` | Project if set, else team |
| `setup` | Team first, then project (concatenate, deduplicate) |
| `env.required` | Concatenate + deduplicate |
| `env.reject` | Deep merge — both apply, project overrides per-key |
| `docker` | Project wins (too project-specific) |
| `apps` | Project wins (too project-specific) |
| `agent.description` | Project if set, else team |
| `agent.conventions` | Team first, then project (concatenate, deduplicate) |
| `agent.targets` | Project if set, else team |
| `agent.soul.identity` | Project if set, else team |
| `agent.soul.values/boundaries/voice` | Concatenate (team base + project additions) |
| `team` | Always project (no nested team refs) |

### Caching

Cloned to `~/.boot/teams/<url-hash>/`. Auto-pulled when cache is older than 10 minutes. `boot team sync` forces an immediate pull. On pull failure, Boot uses the cached version silently — unless `required: true` is set and no cache exists.

### Commands

```bash
boot team set <url>             # add to boot.yaml + clone
boot team set <url> --branch develop --required
boot team sync                  # force pull latest
boot team check                 # CI: verify profile is applied
boot team status                # show what the profile includes
boot team remove                # remove from boot.yaml + clear cache
```

---

## Editor and Hub Config

Both follow the same pattern: define once in `boot.yaml`, generate to multiple targets.

### Editor — generated output

**`.vscode/tasks.json`:**
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

**`.zed/tasks.json`:**
```json
[{ "label": "dev", "command": "pnpm dev", "cwd": "apps/web", "tags": ["build"] }]
```

```bash
boot editor init               # detect from package.json, write targets
boot editor sync               # regenerate from boot.yaml
boot editor check              # CI: verify in sync
boot editor init --overwrite   # replace existing files
```

### Hub — generated output

Both `.github/workflows/ci.yml` and `.forgejo/workflows/ci.yml` receive the same content. For pnpm projects, Boot adds `pnpm/action-setup@v4` automatically.

```bash
boot hub init                  # detect from package.json, write workflows
boot hub sync                  # regenerate from boot.yaml
boot hub check                 # CI: verify in sync
boot hub init --overwrite      # replace existing files
```

---

## Session Tracking — Full Reference

### Storage layout

```
.openboot/
  sessions/
    active/           ← sessions created via boot session start or boot run
    imported/         ← sessions pulled from local tool history files
      .manifest.json  ← deduplication tracker (prevents re-importing the same file)
  tasks/              ← one JSON file per task
  snapshots/          ← continuity checkpoints
  context/
    latest-context.md ← rebuilt by boot context build
  sync/
    config.json       ← sync provider config
    daemon.json       ← background daemon config
  exports/            ← written by boot session export
  bundles/            ← portable bundle files

~/.openboot/
  workspaces/         ← global workspace definitions
  .openboot-daemon.json  ← daemon runtime state
```

### Session schema

```json
{
  "id": "uuid",
  "createdAt": "ISO timestamp",
  "updatedAt": "ISO timestamp",
  "tool": "cursor | claude | cli | other",
  "project": "repo-name",
  "branch": "git-branch",
  "task": "short description",
  "status": "active | idle | imported | completed",
  "taskId": "optional linked task uuid",
  "snapshotIds": [],
  "summary": "generated summary",
  "git": {
    "repoRoot": "/path/to/repo",
    "repoName": "openboot",
    "branch": "main",
    "commit": "abc123",
    "isDirty": true,
    "changedFiles": ["src/foo.ts"],
    "stagedFiles": []
  },
  "source": {
    "type": "openboot | imported | wrapped",
    "name": "cursor | claude | opencode | openai | manual"
  },
  "messages": [
    { "role": "user | assistant | system", "content": "...", "timestamp": "..." }
  ],
  "events": [
    { "id": "uuid", "type": "command | stdout | stderr | file-change | import | note", "timestamp": "...", "data": {} }
  ],
  "metadata": {
    "filesTouched": [],
    "commandsRun": [],
    "rawSource": {}
  }
}
```

Older session files are backward compatible — missing fields are backfilled with safe defaults on read.

### Task schema

```json
{
  "id": "uuid",
  "title": "Add branch-aware resume",
  "description": "...",
  "status": "open | active | paused | completed",
  "repo": { "name": "openboot", "root": "/repo" },
  "git": { "branch": "feature/sync", "commit": "abc123" },
  "linkedSessionIds": [],
  "linkedSnapshotIds": [],
  "summary": "",
  "tags": []
}
```

### All session commands

```bash
# Sessions
boot session start --task "Add rate limiting" --tool cursor
boot session resume [--json]
boot session list
boot session attach --role assistant --message "Implemented token bucket"
boot session export <id>
boot session import cursor
boot session import claude
boot session import opencode
boot session import openai

# Tasks
boot task create
boot task create --title "Add sync"
boot task list
boot task list --status open
boot task resume <id>
boot task close <id>
boot task pause <id>

# Snapshots
boot snapshot create
boot snapshot create --files "src/auth.ts,src/db.ts" --summary "Before refactor"
boot snapshot list
boot snapshot restore <id>

# Context + resume
boot resume
boot resume --context
boot resume --json
boot context build
boot context build --json
boot context build --no-save
boot continue

# Timeline + replay
boot timeline
boot timeline --branch feature/sync
boot timeline --task <id>
boot timeline --limit 30
boot timeline --json
boot replay
boot replay <id>
boot replay --messages-only
boot replay --events-only
boot replay --json

# Sync
boot sync enable icloud
boot sync enable dropbox-folder --path ~/Dropbox/MyOpenBoot
boot sync status
boot push
boot sync pull
boot sync disable

# Daemon
boot daemon start
boot daemon start --interval 120
boot daemon status
boot daemon stop

# Summaries
boot summarize session
boot summarize session <id>
boot summarize task <id>
boot summarize session --json

# Sharing
boot share create
boot share create <artifactId>
boot share list
boot import bundle ./path/to/bundle.json

# Workspaces
boot workspace create myapp
boot workspace create myapp --repo /path/to/backend --repo /path/to/frontend
boot workspace add-repo <id> /path/to/repo
boot workspace list
boot workspace show <id>

# Wrapped tools
boot run claude
boot run opencode --help
boot watch
```

### Adapters — what's actually imported

Imports are best-effort and read local files only. No cloud API access for any tool.

| Source | What's read |
|---|---|
| `cursor` | Session/history JSON and JSONL from `~/.cursor` and `~/Library/Application Support/Cursor` |
| `claude` | Transcripts from `~/.claude` and `~/.config/claude` |
| `opencode` | History from `~/.opencode` |
| `openai` | CLI artifacts from `~/.openai` and `~/.codex` — not cloud chat history |

Duplicates are tracked in `.manifest.json` and skipped on re-import. Source files are never modified.

### Branch-aware resume — selection priority

1. Exact repo + branch match with an active session
2. Active task on the same branch
3. Most recently active task for this repo
4. Most recently active session

### Sync providers

| Provider | Path used |
|---|---|
| `icloud` | `~/Library/Mobile Documents/com~apple~CloudDocs/OpenBoot/` |
| `dropbox-folder` | `~/Dropbox/OpenBoot/` (or `--path`) |
| `google-drive-folder` | `~/Google Drive/My Drive/OpenBoot/` (or `--path`) |
| `onedrive-folder` | `~/OneDrive/OpenBoot/` (or `--path`) |
| `git` | Folder copy into a git-managed directory — not git push/pull |
| `folder` | Any custom folder path |

Conflict handling: if content differs on pull, the incoming file is saved as `.conflict.json` beside the original. Nothing is overwritten silently.

Sync never includes `.env` files, SSH keys, API tokens, cloud credentials, or private keys.

### AI summaries — providers

Set one of these environment variables to enable AI-generated summaries:

| Variable | Provider | Model |
|---|---|---|
| `OPENAI_API_KEY` | OpenAI | `gpt-4o-mini` |
| `ANTHROPIC_API_KEY` | Anthropic | `claude-haiku-4-5` |
| `GEMINI_API_KEY` | Google | `gemini-2.0-flash` |

The first configured provider is used. Without any key, deterministic summarization runs automatically — no network required.

### Security rules

- Bundles never include `.env`, `.pem`, `.key`, `id_rsa`, `id_ed25519`, credentials, or API tokens
- The daemon self-disables after 3 consecutive errors
- AI provider keys are read from environment variables only — never stored
- Sync never transmits data through OpenBoot servers
- Wrapper (`boot run`) captures env variable key names only — never values

---

## Programmatic Integration

### JSON Schema

A JSON Schema for `boot.yaml` is at [`schema.json`](schema.json). Add to your config for editor autocomplete:

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/treadiehq/openboot/main/schema.json
name: my-project
```

### `boot config`

Dumps the fully resolved config (team profile merged) as JSON:

```bash
boot config           # resolved (team + project merged)
boot config --raw     # project config only
```

### `--json` flag

```bash
boot status --json          # service status: type, port, health, pid, url
boot agent status --json    # stack, agent files, conventions, sync status
boot session list --json
boot task list --json
boot timeline --json
boot context build --json
boot resume --json
```

---

## License

[FSL-1.1-MIT](LICENSE)

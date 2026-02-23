# Openboot

> One config for every AI coding tool. One command to start your whole stack.

Every AI coding tool wants its own instruction file — `.cursorrules`, `AGENTS.md`, `CLAUDE.md`, `SOUL.md`, `SKILL.md`, `copilot-instructions.md` — and you're copy-pasting the same conventions between them. They drift. New projects start from scratch. Your team has no shared baseline.

Boot fixes this. It auto-detects your stack and generates agent context for Cursor, GitHub Copilot, OpenCode Claude Code, and Codex from one source. Your conventions follow you across projects. Your team's standards apply everywhere.

```bash
npx openboot agent init
# ▶ Stack: Next.js, Prisma, TypeScript, Tailwind CSS, Vitest
# ✓ Wrote .cursorrules
# ✓ Wrote AGENTS.md
# ✓ Wrote CLAUDE.md
# ✓ Wrote .github/copilot-instructions.md
# ✓ Wrote SKILL.md
```

No config file needed. Boot reads your `package.json` and project structure. Add a `boot.yaml` when you want control over conventions, soul, skills, or team profiles.

Boot also starts your whole stack with one command: Docker, apps, env checks, reverse proxy — but you can use it just for agent sync. No commitment to the rest.

## Install

```bash
npm install -g openboot
```

Or try without installing:

```bash
npx openboot agent init
```

Requires Node 18+.

## Agent Sync

Boot generates and syncs AI agent instruction files from one source of truth. It detects 30+ technologies from your project, merges personal and team conventions, and writes to every target at once.

```bash
boot agent init               # auto-detect stack, generate all targets
boot agent sync               # regenerate after editing boot.yaml
boot agent sync --overwrite   # replace existing agent files
boot agent check              # verify targets are in sync (CI-friendly)
boot agent remember "..."     # save a pattern that carries across projects
boot agent status             # see what Boot knows about your project
```

Existing agent files are preserved — Boot only creates missing targets. Use `--overwrite` to replace them.

### Conventions That Follow You

Your conventions live in `~/.boot/agent/` and apply to every project automatically.

```bash
boot agent remember "Always validate API inputs with zod schemas"
boot agent remember "Prefer named exports over default exports"
boot agent save          # push project conventions to your global store
```

Import conventions from another project:

```bash
boot agent init --from ~/other-project
```

### Project Config

Add an `agent` section to `boot.yaml` for project-specific conventions:

```yaml
agent:
  description: "E-commerce platform with Next.js frontend and Express API"
  conventions:
    - Use server components by default
    - All DB access through Prisma
  references:
    - git@github.com:Effect-TS/effect.git
  targets:
    - .cursorrules
    - AGENTS.md
    - CLAUDE.md
    - .github/copilot-instructions.md
```

### Soul — AI Identity

Define who the AI agent is in your project — its values, boundaries, and voice. Inspired by the [soul document](https://soul.md/) concept. Boot generates a `SOUL.md` when you add a `soul` section.

```yaml
agent:
  soul:
    identity: "You are a senior fullstack engineer. You care about code quality and user experience."
    values:
      - Correctness over speed
      - Ask before making breaking changes
    boundaries:
      - Never modify production configs directly
      - Always run tests before marking work complete
    voice:
      - Be direct and concise
      - When uncertain, say so
```

### Skills — Project Workflows

Define step-by-step workflows for common tasks. Boot auto-generates skills from your stack (setup, testing, migrations) and merges your custom ones. A `SKILL.md` is always generated, no config needed for auto-detected skills.

```yaml
agent:
  skills:
    - name: Add API endpoint
      steps:
        - Create route file in apps/api/src/routes/
        - Add Zod input validation
        - Register route in apps/api/src/index.ts
        - Add tests
```

### References

Point your agent context at any git repo. Boot clones it to a global cache, keeps it updated, and includes the content so AI tools can answer questions about your dependencies.

```yaml
agent:
  references:
    - git@github.com:Effect-TS/effect.git

    - url: git@github.com:Effect-TS/effect.git
      include:
        - docs/
        - packages/effect/README.md
```

Without `include`, Boot pulls the README. With `include`, you control exactly what gets included. Repos are cached at `~/.boot/references/` and auto-refreshed.

## Team Profiles

Share a company-wide baseline across every repo. The team profile lives in a git repo — conventions, env rules, setup commands — and Boot merges it under your project config.

```bash
boot team set git@github.com:company/boot-standards.git
boot team sync       # force-pull latest
boot team check      # CI: verify it's applied
boot team status     # see what's merged
boot team remove     # disconnect
```

```yaml
team:
  url: git@github.com:company/boot-standards.git
  required: true
```

Team conventions appear in a separate section in generated agent files, so it's clear what comes from the team vs. the project.

## Project Setup & Dev

Boot also orchestrates your entire dev environment — Docker, app processes, env validation, reverse proxy — from the same `boot.yaml`.

```bash
boot init          # auto-detect stack, create boot.yaml
boot setup         # one-time: install deps, start DB, run migrations
boot dev           # start everything with live logs (Ctrl+C stops all)
boot up            # start everything in the background
boot down          # stop everything
boot status        # show what's running
boot logs api -f   # follow a service's logs
```

Every app gets a stable `.localhost` URL on port 1355 — no more remembering port numbers:

```
api  → http://api.localhost:1355
web  → http://web.localhost:1355
```

### Config

```yaml
name: my-project

env:
  required:
    - DATABASE_URL
    - JWT_SECRET

setup:
  - pnpm install
  - pnpm db:push

docker:
  composeFile: docker-compose.yml
  services:
    - name: postgres
      readyCheck: pg_isready -U postgres

apps:
  - name: api
    path: apps/api
    command: pnpm dev
    port: 3001
  - name: web
    path: apps/web
    command: pnpm dev
    port: auto
```

## Editor & CI Sync

Define editor tasks and CI workflows once, generate for multiple targets.

```bash
boot editor init     # → .vscode/tasks.json + .zed/tasks.json
boot hub init        # → .github/workflows/ci.yml + .forgejo/workflows/ci.yml
```

```yaml
editor:
  tasks:
    - name: dev
      command: pnpm dev
    - name: test
      command: pnpm test
      group: test
  targets: [.vscode, .zed]

hub:
  ci:
    on: [push, pull_request]
    steps:
      - name: Install
        run: pnpm install
      - name: Test
        run: pnpm test
  prTemplate:
    sections:
      - name: Summary
        prompt: "What changed and why?"
      - name: Test plan
        prompt: "How was this tested?"
  targets: [.github, .forgejo]
```

Both support `sync`, `check`, and `--overwrite` — same pattern as agent sync.

## Docs

See [DETAILED.md](DETAILED.md) for the full config reference, auto-detection list, and command details.

## License

[FSL-1.1-MIT](LICENSE)

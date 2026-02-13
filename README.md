# Openboot

> Stop writing start scripts. Stop copy-pasting agent files. Just boot.

Every project has the same problem: a README that says "run these 12 commands to get started," a `start.sh` that half works, Docker containers you forgot to start, and env vars you didn't set. New teammates spend hours just trying to run the thing.

Then there's the AI problem: every tool wants its own instruction file — `.cursorrules`, `AGENTS.md`, `CLAUDE.md`. `SKILL.md`, `SOUL.md`, `copilot-instructions.md`, and you're copy-pasting the same conventions between projects and files.

Boot fixes both. One config file, one command, everything starts, and your AI agent context stays in sync across every tool and every project.

```
boot init        → creates boot.yaml (auto-detects your stack)
boot setup       → one-time setup (deps, DB, migrations)
boot up          → start everything (Docker + apps)
boot dev         → interactive dev mode with live logs
boot down        → stop everything
boot status      → show what's running
boot logs        → view service logs
boot agent init  → generate AI agent context for your tools
```

## Install

```bash
npm install -g openboot
```

## Quick Start

```bash
boot init        # auto-detects your stack, creates boot.yaml
boot setup       # install deps, start DB, run migrations
boot dev         # start everything with live logs (Ctrl+C stops all)
```

That's it. Boot detects your Docker services, apps, package manager, env requirements, and generates the config.

## AI Agent Context

Boot generates instruction files for AI coding tools — one source of truth, synced to `.cursorrules`, `AGENTS.md`, `CLAUDE.md`, and `.github/copilot-instructions.md`.

```bash
boot agent init      # generate from your stack + config
boot agent sync      # regenerate after editing boot.yaml
boot agent check     # verify targets are in sync (CI-friendly)
boot agent remember  # save patterns that carry across projects
boot agent save      # push conventions to your global store
boot agent status    # see what Boot knows about your project
```

Your conventions live in `~/.boot/agent/` and follow you to every project. When you run `boot agent init` in a new repo, your personal patterns are included automatically.

Import from another project:

```bash
boot agent init --from ~/other-project
```

## Config

`boot init` creates a `boot.yaml`:

```yaml
name: my-project

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
    port: 3000

env:
  required:
    - DATABASE_URL
    - JWT_SECRET

agent:
  conventions:
    - Use server components by default
    - All DB access through Prisma
  targets:
    - .cursorrules
    - AGENTS.md
    - CLAUDE.md
    - .github/copilot-instructions.md
```

## Docs

See [DETAILED.md](DETAILED.md) for the full config reference, auto-detection list, and command details.

## License

[FSL-1.1-MIT](LICENSE)

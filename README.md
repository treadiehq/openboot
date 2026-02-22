# Openboot

> Stop writing start scripts. Stop copy-pasting agent files. Just boot.

Every project has the same problem: a README that says "run these 12 commands to get started," a `start.sh` that half works, Docker containers you forgot to start, and env vars you didn't set. New teammates spend hours just trying to run the thing. If that sounds familiar, Openboot is for you.

Then there's the AI problem: every tool wants its own instruction file — `.cursorrules`, `AGENTS.md`, `CLAUDE.md`. `SKILL.md`, `SOUL.md`, `copilot-instructions.md`, and you're copy-pasting the same conventions between projects and files.

Boot fixes both. One config file, one command, everything starts, and your AI agent context stays in sync across every tool and every project.

```
boot init        → creates boot.yaml (auto-detects your stack)
boot setup       → one-time setup (deps, DB, migrations)
boot up          → start everything (Docker + apps + proxy)
boot dev         → interactive dev mode with live logs
boot down        → stop everything
boot status      → show what's running
boot logs        → view service logs
boot agent init  → generate AI agent context for your tools
boot editor init → generate editor config (.vscode, .zed)
boot hub init    → generate CI workflows (.github, .forgejo)
boot team set    → connect a shared team profile from a git repo
```

## Install

Requires Node 18+. Use `npx openboot` to avoid a global install.

```bash
npm install -g openboot
```

## Quick Start

```bash
boot init        # auto-detects your stack, creates boot.yaml
boot setup       # install deps, start DB, run migrations
boot dev         # start everything with live logs (Ctrl+C stops all)
# → api: http://api.localhost:1355
# → web: http://web.localhost:1355
```

That's it. Boot detects your Docker services, apps, package manager, env requirements, and generates the config. Every app gets a stable `.localhost` URL — no more remembering port numbers. Boot doesn't replace your scripts, it runs them in the right order, together with Docker and env checks.

## AI Agent Context

Boot generates instruction files for AI coding tools — one source of truth, synced to `.cursorrules`, `AGENTS.md`, `CLAUDE.md`, and `.github/copilot-instructions.md`. If those files already exist, Boot uses their content and does not overwrite them (only creates missing targets). Use `--overwrite` to replace existing files.

**Agent only?** You can use Boot just for agent sync: run `boot agent init` (and optionally `boot agent remember` or `--from`); no need to use setup/up/dev.

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

## Team Profiles

Share a company-wide baseline across every repo. The team profile lives in a git repo and covers the whole tool, setup commands, env rules, agent conventions, everything. Boot fetches it and merges it under your project config so the team baseline always applies.

```bash
boot team set git@github.com:company/boot-standards.git   # connect
boot team sync                                             # force-pull latest
boot team check                                            # CI: verify it's applied
boot team status                                           # see what's merged
boot team remove                                           # disconnect
```

In your `boot.yaml`:

```yaml
team:
  url: git@github.com:company/boot-standards.git
  required: true    # fail if the profile can't be resolved
  branch: main      # optional, defaults to main
```

The team repo contains its own `boot.yaml` with the shared rules. Boot merges it as the base layer: team setup commands run first, env requirements are combined, agent conventions are included (labeled separately), and project-specific fields (apps, docker) always come from the project.

## Editor Config

Boot syncs editor tasks from one source in `boot.yaml` to multiple editors. Define tasks once, generate `.vscode/tasks.json` and `.zed/tasks.json`.

```bash
boot editor init     # detect tasks from package.json, write to .vscode/ and .zed/
boot editor sync     # regenerate after editing boot.yaml
boot editor check    # verify targets are in sync (CI-friendly)
```

In your `boot.yaml`:

```yaml
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
```

## Hub Config

Boot syncs CI workflows and PR templates from one source to multiple code hosts. Define your pipeline once, generate `.github/workflows/ci.yml` and `.forgejo/workflows/ci.yml`. Define your PR template once, generate `.github/PULL_REQUEST_TEMPLATE.md` and `.forgejo/PULL_REQUEST_TEMPLATE.md`.

```bash
boot hub init        # detect CI steps from package.json, write workflows + PR template
boot hub sync        # regenerate after editing boot.yaml
boot hub check       # verify targets are in sync (CI-friendly)
```

In your `boot.yaml`:

```yaml
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
  prTemplate:
    sections:
      - name: Summary
        prompt: "What changed and why?"
      - name: Prompt context
        prompt: "Key prompts or decisions from AI conversations."
        optional: true
      - name: Test plan
        prompt: "How was this tested?"
  targets:
    - .github
    - .forgejo
```

The `prTemplate` section generates a PR template with the sections you define. Each section becomes a markdown heading with the `prompt` as an HTML comment hint. Sections marked `optional: true` get "(optional)" appended to the heading. Boot includes a default PR template with Summary, Prompt context, and Test plan sections when you run `boot hub init`.

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
    port: auto          # assigns a free port (4000–4999) at startup

env:
  required:
    - DATABASE_URL
    - JWT_SECRET

agent:
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

editor:
  tasks:
    - name: dev
      command: pnpm dev
    - name: test
      command: pnpm test
      group: test
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
      - name: Test
        run: pnpm test
  prTemplate:
    sections:
      - name: Summary
        prompt: "What changed and why?"
      - name: Prompt context
        prompt: "Key prompts or decisions from AI conversations."
        optional: true
      - name: Test plan
        prompt: "How was this tested?"
  targets:
    - .github
    - .forgejo
```

## References

Point your agent context at any git repo. Boot clones it to a global cache, keeps it updated, and includes the content in your agent context so AI tools can answer questions about your dependencies.

```yaml
agent:
  references:
    # Short form: just a URL (includes the README)
    - git@github.com:Effect-TS/effect.git

    # Long form: specify exactly what to include
    - url: git@github.com:Effect-TS/effect.git
      include:
        - docs/
        - packages/effect/README.md
        - packages/effect/src/index.ts
```

Without `include`, Boot pulls the README. With `include`, you control exactly what files and directories get included — docs, source, types, whatever is useful for your AI tools. Referenced repos are cloned to `~/.boot/references/` and auto-refreshed.

## Docs

See [DETAILED.md](DETAILED.md) for the full config reference, auto-detection list, and command details.

## License

[FSL-1.1-MIT](LICENSE)

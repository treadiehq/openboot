# OpenBoot

One tool for AI-assisted development. Keep your agents in sync, your sessions tracked, and your context intact, across projects, machines, and teammates.

```bash
npm install -g openboot
```

Requires Node 18+.

---

## Agent Sync

Every AI tool wants its own instruction file. Cursor wants `.cursorrules`. Claude wants `CLAUDE.md`. Copilot wants `copilot-instructions.md`. You copy-paste the same conventions between them, they drift, and new projects start from scratch.

Boot fixes that. One source, every target.

```bash
boot agent init
# ▶ Stack detected: Next.js, Prisma, TypeScript, Tailwind, Vitest
# ✓ .cursorrules
# ✓ AGENTS.md
# ✓ CLAUDE.md
# ✓ .github/copilot-instructions.md
```

No config required. Boot reads your `package.json` and project structure. Add a `boot.yaml` when you want control.

```bash
boot agent init               # auto-detect stack, write all targets
boot agent sync               # regenerate after editing boot.yaml
boot agent sync --overwrite   # replace existing files
boot agent check              # verify targets are in sync (CI-friendly)
boot agent remember "..."     # save a pattern that carries to every project
boot agent status             # see what Boot knows about your project
```

### Conventions that follow you

```bash
boot agent remember "Always validate API inputs with zod schemas"
boot agent remember "Prefer named exports over default exports"
boot agent save               # push project conventions to your global store
boot agent init --from ~/other-project   # import conventions from another project
```

### Team baseline

Share a company-wide baseline across every repo:

```bash
boot team set git@github.com:company/boot-standards.git
boot team sync       # pull latest
boot team check      # CI: verify it's applied
```

### `boot.yaml`

```yaml
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
    boundaries:
      - Never modify production configs directly
      - Always run tests before marking work complete
  skills:
    paths:
      - skills/
  references:
    - git@github.com:Effect-TS/effect.git
```

---

## Dev Orchestration

Start your whole stack with one command.

```bash
boot init          # detect stack, create boot.yaml
boot setup         # one-time: install deps, start DB, run migrations
boot dev           # start everything with live logs
boot up            # start everything in the background
boot down          # stop everything
boot status        # see what's running
boot logs api -f   # follow a service's logs
```

Every app gets a stable `.localhost` URL:

```
api  → http://api.localhost:1355
web  → http://web.localhost:1355
```

```yaml
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

---

## Session Tracking

Git tracks code. OpenBoot tracks the AI work behind it.

Every session, task, and decision is stored locally in `.openboot/` as plain JSON, no account, no cloud, no lock-in. When you switch branches or machines, OpenBoot picks up exactly where you left off.

```
.openboot/
  sessions/       ← your AI work history
  tasks/          ← units of work across sessions
  snapshots/      ← lightweight checkpoints
  context/        ← rebuilt context for AI tools
  bundles/        ← portable exports for sharing
```

### Start tracking

```bash
boot session start --task "Add rate limiting" --tool cursor
boot run claude                    # wrap any CLI tool — captures everything live
boot session import cursor         # import from local Cursor history files
boot session import claude         # import from local Claude transcript files
```

`boot run` is the most reliable method, it wraps the tool as a child process and records every prompt, response, and file change directly into the session.

### Resume where you left off

```bash
boot resume                        # auto-picks best session for this repo + branch
boot context build                 # rebuild context file for your AI tool
boot continue                      # pull latest sync + resume (cross-machine)
```

```
Resuming context

  Repo:   openboot
  Branch: feature/rate-limiting
  Task:   Add rate limiting middleware
  Last active: 45m ago
```

### Tasks and snapshots

```bash
boot task create --title "Add rate limiting"
boot task resume <id>              # marks active, links to current session
boot task close <id>

boot snapshot create               # checkpoint current git state + context
boot snapshot restore <id>         # prints restore plan — never mutates your repo
```

### Timeline and replay

```bash
boot timeline                      # chronological history for this repo
boot replay                        # replay a session message by message
boot replay --messages-only        # just prompts and responses
```

```
10:41  Started session — Add rate limiting
10:44  Created task
10:49  Ran: boot run claude
10:53  File changed: src/middleware/rateLimit.ts
11:02  Snapshot created on feature/rate-limiting
```

### Sync across machines

```bash
boot sync enable icloud            # or dropbox-folder, google-drive-folder, onedrive-folder
boot sync push
boot sync pull
boot daemon start                  # auto-sync every 60s in the background
```

Sync copies `.openboot/` to a folder you own. The cloud provider's app handles the transfer. No data goes through OpenBoot's servers, there are none.

### Share with teammates

```bash
boot share create                  # bundle sessions, tasks, snapshots
boot import bundle ./bundle.json   # merge on another machine
```

### AI summaries

```bash
boot summarize session             # summarize the active session
boot summarize task <id>
```

Set `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `GEMINI_API_KEY` to get AI-generated summaries. Without any key, deterministic summarization runs automatically, no network required.

---

## Limitations

- Imports read local files only, no cloud API access for Cursor, Claude, or OpenAI
- `boot run` captures CLI tools only, not IDE agents
- Snapshot restore prints a plan; it does not reset your working tree
- The background daemon stops when your machine sleeps (it's not a system service)
- The `git` sync provider uses folder copy, not native git push/pull

---

## License

[FSL-1.1-MIT](LICENSE)

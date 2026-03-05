# Security Best Practices Report — openboot

**Date:** 2026-03-04  
**Scope:** `/Users/dantelex/openboot` — TypeScript/Node.js CLI tool  
**Language/Runtime:** TypeScript compiled to Node.js CommonJS

---

## Executive Summary

`openboot` is a local developer CLI tool with a minimal attack surface. It has no authentication system, no web API, and no database of its own. The primary security concerns are around **shell injection** through unsafe command execution, **path traversal** in file-reading utilities, and **unsafe use of `execSync`** with user-controlled input. There are no hardcoded credentials or exposed secrets in the codebase. The local HTTP reverse proxy is correctly bound to `127.0.0.1` only. Overall, the project is in good shape, but a few medium-severity issues should be addressed.

---

## CRITICAL

*No critical findings.*

---

## HIGH

### H-1 — Shell Injection via `execSync` with interpolated user-controlled strings

**File:** `src/commands/up.ts`, `src/lib/process.ts`  
**Risk:** A malicious `boot.yaml` with a crafted `packageManager` value or app `command` containing shell metacharacters could execute arbitrary OS commands.

In `src/commands/up.ts`:
```
execSync(`${pm} install`, { stdio: "inherit" });   // pm is from config
```

In `src/lib/process.ts`:
```
const child = spawn(command, [], {
  ...
  shell: true,   // command is from boot.yaml, executed via /bin/sh
});
```

The `spawn(..., { shell: true })` call passes the entire `app.command` string directly to `/bin/sh -c`. A `boot.yaml` with:
```yaml
apps:
  - name: evil
    command: "node app.js; rm -rf ~"
```
would execute the injected command. While this is a CLI tool where the user controls their own `boot.yaml`, the risk escalates in two scenarios:
1. **Team profiles** — `boot.yaml` is cloned from a shared remote git repo (`boot team`). A compromised team repo could inject commands executed on every developer's machine.
2. **References repos** that trigger `boot init` re-runs with externally-supplied config values.

**Recommendation:** For `execSync` calls with a package manager name, validate `pm` against an allowlist (`["npm", "pnpm", "yarn", "bun"]`) before interpolation. For `spawn`, the `shell: true` option is by design (needed to run arbitrary dev server commands), but document this risk clearly; consider validating `app.command` against a basic shell-metacharacter denylist or warning users when team profiles contain `setup` or `command` values with shell operators.

---

### H-2 — Path Traversal in `collectFiles` / `readFileContent` (references)

**File:** `src/lib/references.ts`, lines 259–311  
**Risk:** The `collectFiles` function joins a user-supplied `includePath` from the `boot.yaml` `references[].include` array directly with the repo root via `path.join`. If the team profile or project config supplies an `include` path like `../../.ssh/id_rsa`, the tool would read and include the file in the AI agent context prompt, potentially leaking sensitive local files.

```typescript
// src/lib/references.ts:259
const fullPath = path.join(dir, includePath);
```

Because `dir` is a path inside `~/.boot/references/<hash>/repo/`, a `../../` traversal in `includePath` can escape the repo boundary.

**Recommendation:** Resolve both `dir` and `fullPath` with `path.resolve`, then assert that `fullPath` starts with `path.resolve(dir) + path.sep` before accessing any file:
```typescript
const safeDir = path.resolve(dir);
const fullPath = path.resolve(safeDir, includePath);
if (!fullPath.startsWith(safeDir + path.sep)) {
  log.warn(`Skipping unsafe include path: ${includePath}`);
  continue;
}
```

---

## MEDIUM

### M-1 — PID file integer parsing without bounds validation

**File:** `src/lib/proxy.ts` lines 379–380; `src/lib/process.ts` lines 58, 271  
**Risk:** PID files are written and read back, then passed directly to `process.kill()`. If a PID file is tampered with (e.g., replaced with `1` — the init process — or a very large number), the tool would attempt to kill arbitrary processes.

```typescript
// src/lib/proxy.ts:379
const pid = parseInt(fs.readFileSync(PID_FILE, "utf-8").trim(), 10);
if (!isNaN(pid)) {
  process.kill(pid, "SIGTERM");   // No bounds check
```

**Recommendation:** Add a reasonable PID sanity check before sending signals (PIDs on Linux/macOS are typically 1–4,194,304; PID 1 should never be targeted):
```typescript
function isSafePid(pid: number): boolean {
  return Number.isInteger(pid) && pid > 1 && pid < 4_194_305;
}
```

---

### M-2 — `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS` set to `.localhost` globally

**File:** `src/lib/process.ts` line 223  
**Risk:** The environment variable `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS` is set to `.localhost` for all apps, which bypasses Vite's host-header validation for all `*.localhost` subdomains. This is intentional for the proxy's subdomain routing, but it disables a security control in Vite 5+ that protects against DNS rebinding attacks in development.

```typescript
env.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS = ".localhost";
```

**Recommendation:** This is an intentional trade-off for the proxy feature to work. Add a comment documenting the reason and the accepted trade-off so future contributors understand why this override exists. Consider scoping it only to Vite-detected apps rather than setting it universally.

---

### M-3 — `boot init` writes hardcoded dev credentials into generated config

**File:** `src/commands/init.ts` lines 474–492  
**Risk:** When `boot init` detects a Postgres or MySQL container, it writes a hardcoded password (`boot_dev_password`) into the generated `boot.yaml`:

```typescript
// src/commands/init.ts:475-476
if (!ct.env.POSTGRES_PASSWORD) {
  ct.env.POSTGRES_PASSWORD = "boot_dev_password";
}
```

If a developer commits `boot.yaml` to git (which is a common workflow for team sharing), the password ends up in source control. Additionally, the password is the same across all projects using openboot, making it predictable.

**Recommendation:** Use a randomly generated password at init time (e.g., `crypto.randomBytes(16).toString("hex")`). Also emit a clear warning in the CLI output telling users not to use this value in production and to replace it with a real secret.

---

### M-4 — Routes file and PID files have no integrity checks

**File:** `src/lib/proxy.ts` lines 49–84  
**Risk:** The `routes.json` file at `.boot/proxy/routes.json` maps app names to ports and PIDs. This file is read on every proxied request to determine routing. There are no integrity checks; an attacker with local filesystem access (or a malicious npm package that runs during `boot up`) could modify this file to redirect proxy traffic to a different local port.

**Recommendation:** While this is a local-only dev tool and the threat model is limited, consider documenting that `.boot/` directory permissions should be restricted to the current user (`chmod 700 .boot`). You could also set this directory permission automatically when creating it.

---

## LOW

### L-1 — `escapeHtml` is correct but applied inconsistently in error responses

**File:** `src/lib/proxy.ts` lines 207–210  
The 502 error response for the main proxy server correctly escapes the host-derived app name:
```typescript
const name = escapeHtml(host.split(".")[0]);
res.writeHead(502, { "content-type": "text/plain" });
res.end(`No app registered for "${name}"`);
```
However, the content type is `text/plain`, so escaping is technically unnecessary for plain-text responses. This is fine and not a vulnerability, but there is slight confusion between the HTML-escaped value being used in a plain-text context. Consider either using `text/html` if you want to display HTML, or removing escaping for plain-text responses to keep intent clear.

---

### L-2 — `execSync` vs `execFileSync` inconsistency

**File:** `src/commands/up.ts` lines 49, 70; `src/lib/process.ts` line 75  
Most system command calls in `src/lib/ports.ts` correctly use `execFileSync` with separate argument arrays, which prevents shell metacharacter injection. However, `src/commands/up.ts` uses `execSync` with template-literal string interpolation for `pm install` calls.

`execFileSync` in `ports.ts` (correct pattern):
```typescript
execFileSync("lsof", ["-t", "-n", "-P", `-iTCP:${port}`, "-sTCP:LISTEN"], ...)
```

`execSync` in `up.ts` (inconsistent, riskier):
```typescript
execSync(`${pm} install`, { stdio: "inherit" });
```

**Recommendation:** Replace `execSync` calls with `execFileSync` or `spawnSync` passing arguments as arrays wherever possible to eliminate the shell expansion surface.

---

### L-3 — Spin-wait busy loops in process management

**File:** `src/lib/proxy.ts` lines 386–392; `src/lib/process.ts` lines 204–208  
The codebase uses synchronous busy-wait loops (`while (Date.now() < end) {}`) for process termination and port clearing. These are not security issues, but they hold the event loop and in edge cases can cause CPU spikes. They have no impact on security.

---

## Summary Table

| ID  | Severity | Title                                                          |
|-----|----------|----------------------------------------------------------------|
| H-1 | High     | Shell injection via `execSync` / `shell: true` with user config |
| H-2 | High     | Path traversal in references `collectFiles` include paths      |
| M-1 | Medium   | PID file values not bounds-validated before `process.kill()`   |
| M-2 | Medium   | Global Vite host-header bypass weakens DNS rebinding protection |
| M-3 | Medium   | Hardcoded dev DB password written to `boot.yaml` by `boot init` |
| M-4 | Medium   | No integrity check or restrictive permissions on `.boot/` dir  |
| L-1 | Low      | `escapeHtml` applied to `text/plain` response (no real impact) |
| L-2 | Low      | `execSync` with string interpolation vs. `execFileSync` arrays |
| L-3 | Low      | Synchronous busy-wait loops (non-security, operational concern) |

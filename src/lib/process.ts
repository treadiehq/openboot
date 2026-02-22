import { spawn, execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { AppConfig } from "../types";
import { log } from "./log";
import {
  isPortInUse,
  killPort,
  findFreePort,
  saveResolvedPort,
  getResolvedPort,
  clearResolvedPort,
} from "./ports";

const BOOT_DIR = ".boot";
const PIDS_DIR = path.join(BOOT_DIR, "pids");
const LOGS_DIR = path.join(BOOT_DIR, "logs");

function ensureDirs(): void {
  fs.mkdirSync(PIDS_DIR, { recursive: true });
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

/**
 * Check if a process is still running.
 */
export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the PID file path for an app.
 */
function pidFile(appName: string): string {
  return path.join(PIDS_DIR, `${appName}.pid`);
}

/**
 * Get the log file path for an app.
 */
export function logFile(appName: string): string {
  return path.join(LOGS_DIR, `${appName}.log`);
}

/**
 * Read the stored PID for an app (or null if not found / stale).
 */
export function getAppPid(appName: string): number | null {
  const pf = pidFile(appName);
  if (!fs.existsSync(pf)) return null;

  const pid = parseInt(fs.readFileSync(pf, "utf-8").trim(), 10);
  if (isNaN(pid)) return null;

  if (!isProcessRunning(pid)) {
    // Stale PID file
    fs.unlinkSync(pf);
    return null;
  }

  return pid;
}

/**
 * Get the PID actually using a given port (for mismatch detection).
 */
export function getPortPid(port: number): number | null {
  try {
    const result = execSync(`lsof -ti:${port}`, { stdio: "pipe" })
      .toString()
      .trim();
    const pid = parseInt(result.split("\n")[0], 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

// Frameworks that ignore the PORT env var and need explicit --port flags.
const FRAMEWORK_PORT_FLAGS: Record<string, { portFlag: string; hostFlag?: string }> = {
  vite: { portFlag: "--port", hostFlag: "--host" },
  astro: { portFlag: "--port", hostFlag: "--host" },
  "ng serve": { portFlag: "--port" },
  "webpack serve": { portFlag: "--port" },
  "webpack-dev-server": { portFlag: "--port" },
  "react-router dev": { portFlag: "--port" },
};

/**
 * Resolve a package-manager wrapper command (e.g. "pnpm dev") to the
 * underlying script content from package.json.
 */
function resolveScriptCommand(command: string, cwd: string): string | null {
  const match =
    command.match(/^pnpm\s+(?:run\s+)?(\S+)/) ||
    command.match(/^npm\s+run\s+(\S+)/) ||
    command.match(/^yarn\s+(?:run\s+)?(\S+)/);
  if (!match) return null;

  const pkgPath = path.join(cwd, "package.json");
  if (!fs.existsSync(pkgPath)) return null;

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    return pkg.scripts?.[match[1]] ?? null;
  } catch {
    return null;
  }
}

/**
 * Detect if a command (or its underlying script) uses a framework that
 * ignores the PORT env var.
 */
function detectFramework(
  command: string,
  cwd: string
): { portFlag: string; hostFlag?: string } | null {
  const candidates = [command, resolveScriptCommand(command, cwd) ?? ""];

  for (const cmd of candidates) {
    for (const [key, flags] of Object.entries(FRAMEWORK_PORT_FLAGS)) {
      if (cmd.includes(key)) return flags;
    }
  }

  return null;
}

/**
 * Append --port (and optionally --host) to a command if the framework
 * needs it.  Respects the correct arg-passing syntax per package manager.
 */
function injectPortFlags(command: string, port: number, cwd: string): string {
  const framework = detectFramework(command, cwd);
  if (!framework) return command;

  if (command.includes(framework.portFlag)) return command;

  let flags = `${framework.portFlag} ${port}`;
  if (framework.hostFlag && !command.includes(framework.hostFlag)) {
    flags += ` ${framework.hostFlag}`;
  }

  if (/^npm\s+run\b/.test(command)) {
    return `${command} -- ${flags}`;
  }

  return `${command} ${flags}`;
}

/**
 * Start an app process in the background.
 *
 * When `app.port` is `"auto"`, a free port in the 4000–4999 range is
 * assigned automatically.  The resolved port is persisted to
 * `.boot/ports/<name>.port` so that `boot status` and `boot down` can
 * reference it later.  `app.port` is mutated in-place to the resolved
 * number so callers can read it directly.
 */
export function startApp(app: AppConfig, projectRoot: string): void {
  ensureDirs();

  const cwd = app.path ? path.resolve(projectRoot, app.path) : projectRoot;
  const pf = pidFile(app.name);
  const lf = logFile(app.name);

  // Already running?
  const existingPid = getAppPid(app.name);
  if (existingPid !== null) {
    log.warn(`${app.name} is already running (PID: ${existingPid})`);
    return;
  }

  // --- Resolve port ---
  let resolvedPort: number | undefined;

  if (app.port === "auto") {
    resolvedPort = findFreePort();
    log.info(`${app.name}: auto-assigned port ${resolvedPort}`);
  } else if (typeof app.port === "number") {
    resolvedPort = app.port;
  }

  // Free port if occupied (only for explicit / resolved ports)
  if (resolvedPort !== undefined && isPortInUse(resolvedPort)) {
    log.warn(`Port ${resolvedPort} in use, freeing...`);
    killPort(resolvedPort);
    const end = Date.now() + 1000;
    while (Date.now() < end) {
      /* wait */
    }
  }

  // Persist resolved port for status/stop
  if (resolvedPort !== undefined) {
    saveResolvedPort(app.name, resolvedPort);
    (app as any).port = resolvedPort;
  }

  // Open log file
  const logFd = fs.openSync(lf, "a");

  const env: NodeJS.ProcessEnv = { ...process.env, ...(app.env || {}) };
  if (resolvedPort !== undefined) {
    env.PORT = String(resolvedPort);
  }

  // Inject --port/--host for frameworks that ignore PORT env var
  let command = app.command;
  if (resolvedPort !== undefined) {
    command = injectPortFlags(command, resolvedPort, cwd);
  }

  // Spawn detached process
  const child = spawn(command, [], {
    cwd,
    env,
    stdio: ["ignore", logFd, logFd],
    detached: true,
    shell: true,
  });

  child.unref();
  fs.closeSync(logFd);

  if (child.pid) {
    fs.writeFileSync(pf, String(child.pid));
    log.success(`${app.name} started (PID: ${child.pid})`);
  } else {
    log.error(`Failed to start ${app.name}`);
  }
}

/**
 * Stop an app by killing its process tree, with pkill fallback.
 */
export function stopApp(app: AppConfig | string): void {
  const appName = typeof app === "string" ? app : app.name;
  const appCommand = typeof app === "string" ? null : app.command;
  const configPort = typeof app === "string" ? null : app.port;
  const appPort =
    (typeof configPort === "number" ? configPort : null) ??
    getResolvedPort(appName);

  const pf = pidFile(appName);
  let stopped = false;

  // 1. Try PID file
  if (fs.existsSync(pf)) {
    const pid = parseInt(fs.readFileSync(pf, "utf-8").trim(), 10);

    if (!isNaN(pid) && isProcessRunning(pid)) {
      // Kill the process group (negative PID)
      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        try {
          process.kill(pid, "SIGTERM");
        } catch {
          // already dead
        }
      }

      // Wait up to 3s for graceful shutdown
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline && isProcessRunning(pid)) {
        const end = Date.now() + 200;
        while (Date.now() < end) {
          /* wait */
        }
      }

      // SIGKILL if still alive
      if (isProcessRunning(pid)) {
        try {
          process.kill(-pid, "SIGKILL");
        } catch {
          try {
            process.kill(pid, "SIGKILL");
          } catch {
            // ignore
          }
        }
      }

      stopped = true;
    }

    // Clean up PID file
    try {
      fs.unlinkSync(pf);
    } catch {
      // ignore
    }
  }

  // 2. Fallback: pkill by command pattern (like airatelimit's pkill -f "nest start")
  if (!stopped && appCommand) {
    // Extract the main command for pkill (e.g. "nest start" from "npm run dev")
    const patterns = extractPkillPatterns(appCommand);
    for (const pattern of patterns) {
      try {
        execSync(`pkill -f "${pattern}" 2>/dev/null`, { stdio: "pipe" });
        stopped = true;
      } catch {
        // no matching process
      }
    }
  }

  // 3. Last resort: force kill by port
  if (appPort && isPortInUse(appPort)) {
    log.step(`Force-killing process on port ${appPort}...`);
    killPort(appPort);
    stopped = true;
  }

  clearResolvedPort(appName);

  if (stopped) {
    log.success(`${appName} stopped`);
  } else {
    log.step(`${appName} is not running`);
  }
}

/**
 * Extract process name patterns for pkill from a command string.
 */
function extractPkillPatterns(command: string): string[] {
  const patterns: string[] = [];

  // "npm run dev" / "pnpm dev" → look for common dev server patterns
  if (command.includes("nest")) patterns.push("nest start");
  if (command.includes("nuxt")) patterns.push("nuxt dev");
  if (command.includes("next")) patterns.push("next dev");
  if (command.includes("vite")) patterns.push("vite");
  if (command.includes("tsx")) patterns.push("tsx watch");

  return patterns;
}

/**
 * Stop all apps. Accepts optional app configs for smarter stopping.
 * Always sweeps PID files to catch orphaned processes not in the current config.
 */
export function stopAllApps(apps?: AppConfig[]): void {
  const stoppedNames = new Set<string>();

  // If we have app configs, use them (enables pkill + port fallback)
  if (apps) {
    for (const app of apps) {
      stopApp(app);
      stoppedNames.add(app.name);
    }
  }

  // Always sweep PID files to clean up orphaned processes
  // (e.g. apps removed from config while still running)
  if (!fs.existsSync(PIDS_DIR)) return;

  const files = fs.readdirSync(PIDS_DIR).filter((f) => f.endsWith(".pid"));
  for (const f of files) {
    const name = f.replace(".pid", "");
    if (!stoppedNames.has(name)) {
      stopApp(name);
    }
  }
}

/**
 * Get status info for an app.
 */
export function getAppStatus(
  app: AppConfig
): { running: boolean; pid: number | null; portPid: number | null; resolvedPort: number | null } {
  const pid = getAppPid(app.name);
  const effectivePort =
    (typeof app.port === "number" ? app.port : null) ??
    getResolvedPort(app.name);
  const portPid = effectivePort ? getPortPid(effectivePort) : null;
  return { running: pid !== null, pid, portPid, resolvedPort: effectivePort };
}

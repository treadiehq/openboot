import { spawn, execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { AppConfig } from "../types";
import { log } from "./log";
import { isPortInUse, killPort } from "./ports";

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

/**
 * Start an app process in the background.
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

  // Free port if occupied
  if (app.port && isPortInUse(app.port)) {
    log.warn(`Port ${app.port} in use, freeing...`);
    killPort(app.port);
    const end = Date.now() + 1000;
    while (Date.now() < end) {
      /* wait */
    }
  }

  // Open log file
  const logFd = fs.openSync(lf, "a");

  // Ensure app listens on the port boot displays (many frameworks use PORT)
  const env: NodeJS.ProcessEnv = { ...process.env, ...(app.env || {}) };
  if (app.port !== undefined) {
    env.PORT = String(app.port);
    // Vite dev server
    env.VITE_PORT = String(app.port);
  }

  // Spawn detached process
  const child = spawn(app.command, [], {
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
  const appPort = typeof app === "string" ? null : app.port;

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
): { running: boolean; pid: number | null; portPid: number | null } {
  const pid = getAppPid(app.name);
  const portPid = app.port ? getPortPid(app.port) : null;
  return { running: pid !== null, pid, portPid };
}

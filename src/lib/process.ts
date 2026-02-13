import { spawn } from "child_process";
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
    // Brief pause to let the port release
    const end = Date.now() + 1000;
    while (Date.now() < end) {
      /* wait */
    }
  }

  // Open log file
  const logFd = fs.openSync(lf, "a");

  // Spawn detached process
  const child = spawn(app.command, [], {
    cwd,
    env: { ...process.env, ...(app.env || {}) },
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
 * Stop an app by killing its process tree.
 */
export function stopApp(appName: string): void {
  const pf = pidFile(appName);
  if (!fs.existsSync(pf)) {
    log.step(`${appName} is not running`);
    return;
  }

  const pid = parseInt(fs.readFileSync(pf, "utf-8").trim(), 10);

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

  // Wait up to 5s for the process to die, then SIGKILL
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && isProcessRunning(pid)) {
    const end = Date.now() + 200;
    while (Date.now() < end) {
      /* wait */
    }
  }

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

  // Clean up PID file
  try {
    fs.unlinkSync(pf);
  } catch {
    // ignore
  }

  log.success(`${appName} stopped`);
}

/**
 * Stop all apps whose PID files exist.
 */
export function stopAllApps(): void {
  if (!fs.existsSync(PIDS_DIR)) return;

  const files = fs.readdirSync(PIDS_DIR).filter((f) => f.endsWith(".pid"));
  for (const f of files) {
    const name = f.replace(".pid", "");
    stopApp(name);
  }
}

/**
 * Get status info for an app.
 */
export function getAppStatus(
  app: AppConfig
): { running: boolean; pid: number | null } {
  const pid = getAppPid(app.name);
  return { running: pid !== null, pid };
}

import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const PORTS_DIR = path.join(".boot", "ports");

let lsofAvailable: boolean | null = null;

function ensureLsof(): void {
  if (lsofAvailable === null) {
    try {
      execFileSync("lsof", ["-v"], { stdio: "pipe" });
      lsofAvailable = true;
    } catch {
      lsofAvailable = false;
    }
  }

  if (!lsofAvailable) {
    throw new Error(
      "lsof command not found. Please install lsof:\n" +
        "  macOS:         lsof is pre-installed\n" +
        "  Ubuntu/Debian: sudo apt-get install lsof\n" +
        "  Alpine:        apk add lsof\n" +
        "  RHEL/CentOS:   sudo yum install lsof"
    );
  }
}

/**
 * Check if a port is currently in use (local LISTEN only).
 * Uses -n (no DNS), -P (no service names), -sTCP:LISTEN to avoid
 * matching outgoing connections to remote servers on the same port.
 */
export function isPortInUse(port: number): boolean {
  ensureLsof();
  try {
    execFileSync(
      "lsof",
      ["-t", "-n", "-P", `-iTCP:${port}`, "-sTCP:LISTEN"],
      { stdio: "pipe" }
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Kill whatever process is listening on a port.
 * Only targets processes in LISTEN state to avoid killing unrelated
 * processes that happen to have outgoing connections on the same port.
 */
export function killPort(port: number): void {
  ensureLsof();
  try {
    const output = execFileSync(
      "lsof",
      ["-t", "-n", "-P", `-iTCP:${port}`, "-sTCP:LISTEN"],
      { stdio: "pipe" }
    )
      .toString()
      .trim();

    if (!output) return;

    const pids = output.split("\n").filter(Boolean);
    if (pids.length > 0) {
      execFileSync("kill", ["-9", ...pids], { stdio: "pipe" });
    }
  } catch {
    // nothing on that port, or already dead
  }
}

/**
 * Find an available port in a given range.
 * Tries random ports first for speed, then falls back to a sequential scan.
 */
export function findFreePort(min = 4000, max = 4999): number {
  const range = max - min + 1;
  const attempts = Math.min(50, range);

  for (let i = 0; i < attempts; i++) {
    const port = min + Math.floor(Math.random() * range);
    if (!isPortInUse(port)) return port;
  }

  for (let port = min; port <= max; port++) {
    if (!isPortInUse(port)) return port;
  }

  throw new Error(`No free port found in range ${min}–${max}`);
}

/**
 * Persist the resolved port for an app so status/stop can read it later.
 */
export function saveResolvedPort(appName: string, port: number): void {
  fs.mkdirSync(PORTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(PORTS_DIR, `${appName}.port`), String(port));
}

/**
 * Read the last resolved port for an app (or null if not found).
 */
export function getResolvedPort(appName: string): number | null {
  const portFile = path.join(PORTS_DIR, `${appName}.port`);
  if (!fs.existsSync(portFile)) return null;
  const val = parseInt(fs.readFileSync(portFile, "utf-8").trim(), 10);
  return isNaN(val) ? null : val;
}

/**
 * Remove the saved port file for an app (called on stop).
 */
export function clearResolvedPort(appName: string): void {
  try {
    fs.unlinkSync(path.join(PORTS_DIR, `${appName}.port`));
  } catch {
    // already gone
  }
}

/**
 * Get info about what's listening on a port.
 * Restricted to LISTEN state to avoid reporting unrelated connections.
 */
export function getPortProcess(port: number): string | null {
  ensureLsof();
  try {
    const result = execFileSync(
      "lsof",
      ["-n", "-P", `-iTCP:${port}`, "-sTCP:LISTEN"],
      { stdio: "pipe" }
    )
      .toString()
      .trim();
    const lines = result.split("\n");
    return lines.length > 1 ? lines.slice(1).join("\n") : null;
  } catch {
    return null;
  }
}

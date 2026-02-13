import { execSync } from "child_process";

/**
 * Check if a port is currently in use.
 */
export function isPortInUse(port: number): boolean {
  try {
    execSync(`lsof -ti:${port}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Kill whatever process is using a port.
 */
export function killPort(port: number): void {
  try {
    execSync(`lsof -ti:${port} | xargs kill -9`, { stdio: "pipe" });
  } catch {
    // nothing on that port, or already dead
  }
}

/**
 * Get info about what's using a port.
 */
export function getPortProcess(port: number): string | null {
  try {
    const result = execSync(`lsof -i:${port}`, { stdio: "pipe" })
      .toString()
      .trim();
    const lines = result.split("\n");
    return lines.length > 1 ? lines.slice(1).join("\n") : null;
  } catch {
    return null;
  }
}

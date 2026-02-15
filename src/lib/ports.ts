import { execFileSync } from "child_process";

/**
 * Check if a port is currently in use (local LISTEN only).
 * Uses -n (no DNS), -P (no service names), -sTCP:LISTEN to avoid
 * matching outgoing connections to remote servers on the same port.
 */
export function isPortInUse(port: number): boolean {
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
 * Get info about what's listening on a port.
 * Restricted to LISTEN state to avoid reporting unrelated connections.
 */
export function getPortProcess(port: number): string | null {
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

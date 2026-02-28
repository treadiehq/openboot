import { execSync } from "child_process";
import { log } from "./log";

/**
 * Check that required tools and versions are available.
 * Returns true if all checks pass.
 */
export function checkPrerequisites(options: {
  needsDocker?: boolean;
}): boolean {
  let ok = true;

  // Node.js — required, version >= 18
  const nodeVersion = getNodeVersion();
  if (!nodeVersion) {
    log.error("Node.js is not installed. Please install Node.js 18+");
    ok = false;
  } else if (nodeVersion < 18) {
    log.error(
      `Node.js ${nodeVersion} is too old. Please upgrade to Node.js 18+`
    );
    ok = false;
  }

  // Docker — only required if config uses it
  if (options.needsDocker) {
    if (!isCommandAvailable("docker")) {
      log.error(
        "Docker is not installed. Please install Docker to use container services"
      );
      ok = false;
    } else if (!isDockerRunning()) {
      log.error(
        "Docker daemon is not running. Please start Docker Desktop or the Docker service"
      );
      ok = false;
    }
  }

  if (ok) {
    log.success(
      `Prerequisites ok (Node ${nodeVersion}${options.needsDocker ? ", Docker" : ""})`
    );
  }

  return ok;
}

/**
 * Get the major version of Node.js, or null if not available.
 */
function getNodeVersion(): number | null {
  try {
    const version = execSync("node --version", { stdio: "pipe" })
      .toString()
      .trim();
    // "v20.11.0" → 20
    const match = version.match(/v?(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  } catch {
    return null;
  }
}

/**
 * Check if a command exists.
 */
function isCommandAvailable(cmd: string): boolean {
  try {
    const check = process.platform === "win32" ? "where" : "which";
    execSync(`${check} ${cmd}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if the Docker daemon is running.
 */
function isDockerRunning(): boolean {
  try {
    execSync("docker info", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

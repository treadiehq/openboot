import { execSync, spawnSync } from "child_process";
import { BootConfig } from "../types";
import { log } from "./log";

/**
 * Detect the compose command (docker compose v2 or docker-compose v1).
 */
function getComposeCmd(): string {
  try {
    execSync("docker compose version", { stdio: "pipe" });
    return "docker compose";
  } catch {
    return "docker-compose";
  }
}

/**
 * Check if Docker is available and running.
 */
export function isDockerAvailable(): boolean {
  try {
    execSync("docker info", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Start Docker services and wait for readiness.
 */
export function startDocker(config: BootConfig): void {
  if (!config.docker) return;

  if (!isDockerAvailable()) {
    log.warn("Docker is not running — skipping Docker services");
    return;
  }

  const compose = getComposeCmd();
  const file = config.docker.composeFile || "docker-compose.yml";

  log.info("Starting Docker services...");

  try {
    execSync(`${compose} -f ${file} up -d`, { stdio: "inherit" });
  } catch {
    log.error("Failed to start Docker services");
    return;
  }

  // Wait for each service that has a readyCheck
  if (config.docker.services) {
    for (const svc of config.docker.services) {
      if (svc.readyCheck) {
        const container = svc.container || svc.name;
        const timeout = svc.timeout || 30;
        waitForContainer(container, svc.readyCheck, timeout);
      }
    }
  }
}

/**
 * Wait for a container to pass its readiness check.
 */
function waitForContainer(
  container: string,
  check: string,
  timeout: number
): void {
  log.info(`Waiting for ${container}...`);

  for (let i = 0; i < timeout; i++) {
    try {
      execSync(`docker exec ${container} ${check}`, { stdio: "pipe" });
      log.success(`${container} is ready`);
      return;
    } catch {
      // not ready yet
    }
    spawnSync("sleep", ["1"]);
  }

  log.warn(`${container} may not be ready (timed out after ${timeout}s)`);
}

/**
 * Stop Docker services.
 */
export function stopDocker(config: BootConfig): void {
  if (!config.docker) return;

  if (!isDockerAvailable()) {
    log.warn("Docker is not running — skipping");
    return;
  }

  const compose = getComposeCmd();
  const file = config.docker.composeFile || "docker-compose.yml";

  log.info("Stopping Docker services...");

  try {
    execSync(`${compose} -f ${file} down`, { stdio: "inherit" });
    log.success("Docker services stopped");
  } catch {
    log.error("Failed to stop Docker services");
  }
}

/**
 * Get Docker container status for display.
 */
export function getDockerStatus(
  config: BootConfig
): Array<{ name: string; status: string; ports: string }> {
  if (!config.docker || !isDockerAvailable()) return [];

  const compose = getComposeCmd();
  const file = config.docker.composeFile || "docker-compose.yml";

  try {
    const output = execSync(
      `${compose} -f ${file} ps --format json 2>/dev/null || ${compose} -f ${file} ps`,
      { stdio: "pipe" }
    )
      .toString()
      .trim();

    // Try to parse JSON lines (docker compose v2)
    const results: Array<{ name: string; status: string; ports: string }> = [];
    for (const line of output.split("\n")) {
      try {
        const obj = JSON.parse(line);
        results.push({
          name: obj.Service || obj.Name || "unknown",
          status: obj.State || obj.Status || "unknown",
          ports: obj.Ports || obj.Publishers || "",
        });
      } catch {
        // Not JSON — skip
      }
    }

    // Fallback: if no JSON parsed, just report services from config
    if (results.length === 0 && config.docker.services) {
      for (const svc of config.docker.services) {
        const container = svc.container || svc.name;
        let status = "unknown";
        try {
          status = execSync(
            `docker inspect -f '{{.State.Status}}' ${container} 2>/dev/null`,
            { stdio: "pipe" }
          )
            .toString()
            .trim();
        } catch {
          status = "not found";
        }
        results.push({ name: svc.name, status, ports: "" });
      }
    }

    return results;
  } catch {
    return [];
  }
}

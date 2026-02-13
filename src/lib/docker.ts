import { execSync, spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "yaml";
import { BootConfig } from "../types";
import { log } from "./log";
import { isPortInUse } from "./ports";

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
 * Check if a container is already running.
 */
function isContainerRunning(container: string): boolean {
  try {
    const status = execSync(
      `docker inspect -f '{{.State.Status}}' ${container}`,
      { stdio: "pipe" }
    )
      .toString()
      .trim();
    return status === "running";
  } catch {
    return false;
  }
}

/**
 * Check if a container exists (running or stopped).
 */
function containerExists(container: string): boolean {
  try {
    execSync(`docker inspect ${container}`, { stdio: "pipe" });
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
  const services = config.docker.services || [];

  // 1. Check if all configured containers are already running
  const allRunning =
    services.length > 0 &&
    services.every((svc) => isContainerRunning(svc.container || svc.name));

  if (allRunning) {
    log.success("Docker services already running");
    waitForAllServices(services);
    return;
  }

  // 2. If containers exist but are stopped, start them directly
  const allExist =
    services.length > 0 &&
    services.every((svc) => containerExists(svc.container || svc.name));

  if (allExist) {
    log.info("Starting existing Docker containers...");
    for (const svc of services) {
      const container = svc.container || svc.name;
      if (!isContainerRunning(container)) {
        try {
          execSync(`docker start ${container}`, { stdio: "pipe" });
          log.success(`${container} started`);
        } catch {
          log.error(`Failed to start ${container}`);
        }
      }
    }
    waitForAllServices(services);
    return;
  }

  // 3. Fresh start — check for port conflicts BEFORE running compose
  const conflicts = getComposePortConflicts(file);

  if (conflicts.length > 0) {
    // Port is taken by another project — find a free one and run directly
    for (const conflict of conflicts) {
      const freePort = findFreePort(conflict.hostPort);
      if (!freePort) {
        log.error(
          `Port ${conflict.hostPort} is in use and no free port found (tried ${conflict.hostPort + 1}–${conflict.hostPort + 10})`
        );
        log.step("Check what's using it: docker ps");
        return;
      }

      log.warn(
        `Port ${conflict.hostPort} in use by another project — using ${freePort} instead`
      );

      // Find the image from the compose file for this service
      const image = getComposeServiceImage(file, conflict.service);
      const svc = services.find((s) => s.name === conflict.service);
      const container = svc?.container || conflict.service;

      // Get environment vars from compose for this service
      const envVars = getComposeServiceEnv(file, conflict.service);
      const envFlags = envVars.map((e) => `-e "${e}"`).join(" ");

      // Remove any leftover created-but-not-started container
      try {
        execSync(`docker rm -f ${container} 2>/dev/null`, { stdio: "pipe" });
      } catch {
        // ignore
      }

      try {
        execSync(
          `docker run -d --name ${container} -p ${freePort}:${conflict.containerPort} ${envFlags} ${image}`,
          { stdio: "pipe" }
        );
        log.success(
          `${conflict.service} started on port ${freePort} (mapped to container:${conflict.containerPort})`
        );
      } catch (err: any) {
        log.error(`Failed to start ${conflict.service}: ${err.message}`);
        return;
      }
    }

    waitForAllServices(services);
    return;
  }

  // 4. No conflicts — normal compose up
  log.info("Starting Docker services...");
  try {
    execSync(`${compose} -f ${file} up -d`, { stdio: "inherit" });
  } catch {
    log.error("Failed to start Docker services");
    return;
  }

  waitForAllServices(services);
}

/**
 * Wait for all services that have a readyCheck.
 */
function waitForAllServices(
  services: NonNullable<BootConfig["docker"]>["services"]
): void {
  if (!services) return;
  for (const svc of services) {
    if (svc.readyCheck) {
      waitForContainer(svc.container || svc.name, svc.readyCheck, svc.timeout || 30);
    }
  }
}

/**
 * Resolve a Docker Compose port string to a host port number.
 * Handles: "5433:5432", "${VAR:-5433}:5432", "127.0.0.1:5433:5432"
 */
function resolveHostPort(portStr: string): { host: number; container: number } | null {
  let str = String(portStr);

  // Resolve ${VAR:-default} patterns to their default value
  str = str.replace(/\$\{[^:}]+(:-([^}]+))?\}/g, (_match, _group1, defaultVal) => {
    // Check env first, fall back to default
    const varMatch = _match.match(/\$\{([^:}]+)/);
    const varName = varMatch ? varMatch[1] : "";
    return process.env[varName] || defaultVal || "";
  });

  // Match "host:container" or "ip:host:container"
  const match = str.match(/(?:\d+\.\d+\.\d+\.\d+:)?(\d+):(\d+)/);
  if (match) {
    return {
      host: parseInt(match[1], 10),
      container: parseInt(match[2], 10),
    };
  }

  return null;
}

/**
 * Parse compose file and return ports that are already in use.
 */
function getComposePortConflicts(
  composeFile: string
): Array<{ hostPort: number; containerPort: number; service: string }> {
  const conflicts: Array<{
    hostPort: number;
    containerPort: number;
    service: string;
  }> = [];

  try {
    const raw = fs.readFileSync(path.resolve(composeFile), "utf-8");
    const compose = yaml.parse(raw);

    if (compose?.services) {
      for (const [name, svc] of Object.entries<any>(compose.services)) {
        const ports: any[] = svc?.ports || [];
        for (const p of ports) {
          const resolved = resolveHostPort(String(p));
          if (resolved && isPortInUse(resolved.host)) {
            conflicts.push({
              hostPort: resolved.host,
              containerPort: resolved.container,
              service: name,
            });
          }
        }
      }
    }
  } catch {
    // Can't parse compose file
  }

  return conflicts;
}

/**
 * Get the image name for a service from the compose file.
 */
function getComposeServiceImage(
  composeFile: string,
  serviceName: string
): string {
  try {
    const raw = fs.readFileSync(path.resolve(composeFile), "utf-8");
    const compose = yaml.parse(raw);
    return compose?.services?.[serviceName]?.image || "postgres:15";
  } catch {
    return "postgres:15";
  }
}

/**
 * Get environment variables for a service from the compose file.
 */
function getComposeServiceEnv(
  composeFile: string,
  serviceName: string
): string[] {
  try {
    const raw = fs.readFileSync(path.resolve(composeFile), "utf-8");
    const compose = yaml.parse(raw);
    const env = compose?.services?.[serviceName]?.environment;
    if (!env) return [];
    if (Array.isArray(env)) return env;
    // Object form: { KEY: "value" }
    return Object.entries(env).map(([k, v]) => `${k}=${v}`);
  } catch {
    return [];
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
 * Parse the compose file to find host port mappings.
 */
function findPortConflicts(
  composeFile: string
): Array<{ hostPort: number; containerPort: number; service: string }> {
  const conflicts: Array<{
    hostPort: number;
    containerPort: number;
    service: string;
  }> = [];

  try {
    const raw = fs.readFileSync(path.resolve(composeFile), "utf-8");
    const compose = yaml.parse(raw);

    if (compose?.services) {
      for (const [name, svc] of Object.entries<any>(compose.services)) {
        const ports: string[] = svc?.ports || [];
        for (const p of ports) {
          const str = String(p);
          // Parse "5433:5432" or "5432"
          const match = str.match(/^(\d+):(\d+)$/);
          if (match) {
            const hostPort = parseInt(match[1], 10);
            const containerPort = parseInt(match[2], 10);
            if (isPortInUse(hostPort)) {
              conflicts.push({ hostPort, containerPort, service: name });
            }
          }
        }
      }
    }
  } catch {
    // Can't parse — return empty
  }

  return conflicts;
}

/**
 * Find the next free port starting from a given port.
 * Tries port+1 through port+10.
 */
function findFreePort(startPort: number): number | null {
  for (let p = startPort + 1; p <= startPort + 10; p++) {
    if (!isPortInUse(p)) return p;
  }
  return null;
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

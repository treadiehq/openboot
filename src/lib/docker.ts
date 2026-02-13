import { execSync, spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "yaml";
import { BootConfig, ContainerConfig } from "../types";
import { log } from "./log";
import { isPortInUse } from "./ports";

// ─── Helpers ────────────────────────────────────────────────

function getComposeCmd(): string {
  try {
    execSync("docker compose version", { stdio: "pipe" });
    return "docker compose";
  } catch {
    return "docker-compose";
  }
}

export function isDockerAvailable(): boolean {
  try {
    execSync("docker info", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

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

function containerExists(container: string): boolean {
  try {
    execSync(`docker inspect ${container}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

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

function findFreePort(startPort: number): number | null {
  for (let p = startPort + 1; p <= startPort + 10; p++) {
    if (!isPortInUse(p)) return p;
  }
  return null;
}

/**
 * Resolve ${VAR:-default} in a port string to its actual value.
 */
function resolveHostPort(
  portStr: string
): { host: number; container: number } | null {
  let str = String(portStr);

  str = str.replace(
    /\$\{[^:}]+(:-([^}]+))?\}/g,
    (_match, _group1, defaultVal) => {
      const varMatch = _match.match(/\$\{([^:}]+)/);
      const varName = varMatch ? varMatch[1] : "";
      return process.env[varName] || defaultVal || "";
    }
  );

  const match = str.match(/(?:\d+\.\d+\.\d+\.\d+:)?(\d+):(\d+)/);
  if (match) {
    return {
      host: parseInt(match[1], 10),
      container: parseInt(match[2], 10),
    };
  }
  return null;
}

// ─── Raw Containers (docker run / docker start) ─────────────

/**
 * Start standalone containers defined in config.docker.containers.
 */
function startContainers(containers: ContainerConfig[]): void {
  for (const ct of containers) {
    // Already running?
    if (isContainerRunning(ct.name)) {
      log.success(`${ct.name} already running`);
      if (ct.readyCheck) {
        waitForContainer(ct.name, ct.readyCheck, ct.timeout || 30);
      }
      continue;
    }

    // Exists but stopped?
    if (containerExists(ct.name)) {
      log.info(`Starting existing container ${ct.name}...`);
      try {
        execSync(`docker start ${ct.name}`, { stdio: "pipe" });
        log.success(`${ct.name} started`);
      } catch {
        log.error(`Failed to start ${ct.name}`);
        continue;
      }
      if (ct.readyCheck) {
        waitForContainer(ct.name, ct.readyCheck, ct.timeout || 30);
      }
      continue;
    }

    // Need to create — check port conflicts first
    let portFlags = "";
    if (ct.ports) {
      for (const p of ct.ports) {
        const resolved = resolveHostPort(p);
        if (resolved && isPortInUse(resolved.host)) {
          const freePort = findFreePort(resolved.host);
          if (freePort) {
            log.warn(
              `Port ${resolved.host} in use — using ${freePort} for ${ct.name}`
            );
            portFlags += ` -p ${freePort}:${resolved.container}`;
          } else {
            log.error(
              `Port ${resolved.host} in use and no free port found for ${ct.name}`
            );
            continue;
          }
        } else if (resolved) {
          portFlags += ` -p ${resolved.host}:${resolved.container}`;
        }
      }
    }

    // Build env flags
    let envFlags = "";
    if (ct.env) {
      for (const [k, v] of Object.entries(ct.env)) {
        envFlags += ` -e "${k}=${v}"`;
      }
    }

    // Build volume flags
    let volFlags = "";
    if (ct.volumes) {
      for (const v of ct.volumes) {
        volFlags += ` -v ${v}`;
      }
    }

    log.info(`Creating container ${ct.name}...`);
    try {
      execSync(
        `docker run -d --name ${ct.name}${portFlags}${envFlags}${volFlags} ${ct.image}`,
        { stdio: "pipe" }
      );
      log.success(`${ct.name} started`);
    } catch (err: any) {
      log.error(`Failed to create ${ct.name}: ${err.stderr?.toString().trim() || err.message}`);
      continue;
    }

    if (ct.readyCheck) {
      waitForContainer(ct.name, ct.readyCheck, ct.timeout || 30);
    }
  }
}

/**
 * Stop standalone containers.
 */
function stopContainers(containers: ContainerConfig[]): void {
  for (const ct of containers) {
    if (isContainerRunning(ct.name)) {
      log.info(`Stopping ${ct.name}...`);
      try {
        execSync(`docker stop ${ct.name}`, { stdio: "pipe" });
        log.success(`${ct.name} stopped`);
      } catch {
        log.error(`Failed to stop ${ct.name}`);
      }
    } else {
      log.step(`${ct.name} is not running`);
    }
  }
}

/**
 * Get status of standalone containers.
 */
function getContainersStatus(
  containers: ContainerConfig[]
): Array<{ name: string; status: string; ports: string }> {
  const results: Array<{ name: string; status: string; ports: string }> = [];

  for (const ct of containers) {
    let status = "not found";
    let ports = "";

    try {
      status = execSync(
        `docker inspect -f '{{.State.Status}}' ${ct.name}`,
        { stdio: "pipe" }
      )
        .toString()
        .trim();
    } catch {
      // not found
    }

    if (status === "running") {
      try {
        const portInfo = execSync(
          `docker port ${ct.name}`,
          { stdio: "pipe" }
        )
          .toString()
          .trim();
        ports = portInfo.split("\n").map((l) => l.split("->").pop()?.trim() || "").join(", ");
      } catch {
        // ignore
      }
    }

    results.push({ name: ct.name, status, ports });
  }

  return results;
}

// ─── Compose Services ───────────────────────────────────────

function startComposeServices(config: BootConfig): void {
  if (!config.docker?.composeFile && !config.docker?.services?.length) return;

  const compose = getComposeCmd();
  const file = config.docker!.composeFile || "docker-compose.yml";
  const services = config.docker!.services || [];

  // 1. All already running?
  const allRunning =
    services.length > 0 &&
    services.every((svc) => isContainerRunning(svc.container || svc.name));

  if (allRunning) {
    log.success("Docker services already running");
    waitForAllComposeServices(services);
    return;
  }

  // 2. Containers exist but stopped — start directly
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
    waitForAllComposeServices(services);
    return;
  }

  // 3. Check for port conflicts before compose
  const conflicts = getComposePortConflicts(file);

  if (conflicts.length > 0) {
    for (const conflict of conflicts) {
      const freePort = findFreePort(conflict.hostPort);
      if (!freePort) {
        log.error(
          `Port ${conflict.hostPort} in use and no free port found for ${conflict.service}`
        );
        log.step("Check what's using it: docker ps");
        return;
      }

      log.warn(
        `Port ${conflict.hostPort} in use — using ${freePort} for ${conflict.service}`
      );

      const image = getComposeServiceImage(file, conflict.service);
      const svc = services.find((s) => s.name === conflict.service);
      const container = svc?.container || conflict.service;
      const envVars = getComposeServiceEnv(file, conflict.service);
      const envFlags = envVars.map((e) => `-e "${e}"`).join(" ");

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

    waitForAllComposeServices(services);
    return;
  }

  // 4. Normal compose up
  log.info("Starting Docker services...");
  try {
    execSync(`${compose} -f ${file} up -d`, { stdio: "inherit" });
  } catch {
    log.error("Failed to start Docker services");
    return;
  }

  waitForAllComposeServices(services);
}

function stopComposeServices(config: BootConfig): void {
  if (!config.docker?.composeFile && !config.docker?.services?.length) return;

  const compose = getComposeCmd();
  const file = config.docker!.composeFile || "docker-compose.yml";

  log.info("Stopping Docker services...");
  try {
    execSync(`${compose} -f ${file} down`, { stdio: "inherit" });
    log.success("Docker services stopped");
  } catch {
    log.error("Failed to stop Docker services");
  }
}

function waitForAllComposeServices(
  services: NonNullable<BootConfig["docker"]>["services"]
): void {
  if (!services) return;
  for (const svc of services) {
    if (svc.readyCheck) {
      waitForContainer(
        svc.container || svc.name,
        svc.readyCheck,
        svc.timeout || 30
      );
    }
  }
}

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
    // Can't parse
  }

  return conflicts;
}

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
    return Object.entries(env).map(([k, v]) => `${k}=${v}`);
  } catch {
    return [];
  }
}

// ─── Public API ─────────────────────────────────────────────

/**
 * Start all Docker resources (compose services + standalone containers).
 */
export function startDocker(config: BootConfig): void {
  if (!config.docker) return;

  if (!isDockerAvailable()) {
    log.warn("Docker is not running — skipping Docker services");
    return;
  }

  // Compose-based services
  if (config.docker.composeFile || config.docker.services?.length) {
    startComposeServices(config);
  }

  // Standalone containers
  if (config.docker.containers?.length) {
    startContainers(config.docker.containers);
  }
}

/**
 * Stop all Docker resources.
 */
export function stopDocker(config: BootConfig): void {
  if (!config.docker) return;

  if (!isDockerAvailable()) {
    log.warn("Docker is not running — skipping");
    return;
  }

  // Stop standalone containers first
  if (config.docker.containers?.length) {
    stopContainers(config.docker.containers);
  }

  // Stop compose services
  if (config.docker.composeFile || config.docker.services?.length) {
    stopComposeServices(config);
  }
}

/**
 * Get status of all Docker resources.
 */
export function getDockerStatus(
  config: BootConfig
): Array<{ name: string; status: string; ports: string }> {
  if (!config.docker || !isDockerAvailable()) return [];

  const results: Array<{ name: string; status: string; ports: string }> = [];

  // Compose services
  if (config.docker.services) {
    for (const svc of config.docker.services) {
      const container = svc.container || svc.name;
      let status = "unknown";
      try {
        status = execSync(
          `docker inspect -f '{{.State.Status}}' ${container}`,
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

  // Standalone containers
  if (config.docker.containers) {
    results.push(...getContainersStatus(config.docker.containers));
  }

  return results;
}

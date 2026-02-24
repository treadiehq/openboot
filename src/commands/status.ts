import * as fs from "fs";
import { execFileSync } from "child_process";
import { loadConfig } from "../lib/config";
import { getDockerStatus } from "../lib/docker";
import { getAppStatus, logFile } from "../lib/process";
import { isPortInUse } from "../lib/ports";
import { log } from "../lib/log";
import { isProxyRunning, PROXY_PORT } from "../lib/proxy";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

export interface ServiceStatus {
  name: string;
  type: "docker" | "app";
  status: "running" | "stopped" | "port_in_use" | "not_found" | "unknown";
  port: number | null;
  url: string | null;
  pid: number | null;
  portPid: number | null;
  process: string | null;
  health: "ok" | "connected" | "failing" | "no_response" | null;
  logFile: string | null;
}

export interface StatusResult {
  project: string;
  proxy: boolean;
  services: ServiceStatus[];
}

/**
 * Collect structured status for all services (used by both human and JSON output).
 */
export function collectStatus(): StatusResult {
  const config = loadConfig();
  const proxyUp = isProxyRunning() || isPortInUse(PROXY_PORT);
  const services: ServiceStatus[] = [];

  if (config.docker) {
    const dockerStatuses = getDockerStatus(config);
    const readyChecks = new Map<string, { container: string; check: string }>();
    if (config.docker.services) {
      for (const svc of config.docker.services) {
        if (svc.readyCheck) {
          readyChecks.set(svc.name, {
            container: svc.container || svc.name,
            check: svc.readyCheck,
          });
        }
      }
    }
    if (config.docker.containers) {
      for (const ct of config.docker.containers) {
        if (ct.readyCheck) {
          readyChecks.set(ct.name, {
            container: ct.name,
            check: ct.readyCheck,
          });
        }
      }
    }

    for (const svc of dockerStatuses) {
      let health: ServiceStatus["health"] = null;
      if (svc.status === "running") {
        const checkInfo = readyChecks.get(svc.name);
        if (checkInfo) {
          health = testContainerHealth(checkInfo.container, checkInfo.check)
            ? "connected"
            : "failing";
        } else {
          health = "ok";
        }
      }

      services.push({
        name: svc.name,
        type: "docker",
        status: svc.status === "running" ? "running"
          : svc.status === "not found" ? "not_found"
          : "unknown",
        port: null,
        url: svc.ports || null,
        pid: null,
        portPid: null,
        process: "docker",
        health,
        logFile: null,
      });
    }

    if (dockerStatuses.length === 0 && config.docker.services) {
      for (const svc of config.docker.services) {
        services.push({
          name: svc.name,
          type: "docker",
          status: "unknown",
          port: null,
          url: null,
          pid: null,
          portPid: null,
          process: null,
          health: null,
          logFile: null,
        });
      }
    }
  }

  if (config.apps) {
    for (const app of config.apps) {
      const { running, pid, portPid, resolvedPort } = getAppStatus(app);
      const lf = logFile(app.name);
      const hasLog = fs.existsSync(lf);

      let appStatus: ServiceStatus["status"];
      if (running) {
        appStatus = "running";
      } else if (resolvedPort && isPortInUse(resolvedPort)) {
        appStatus = "port_in_use";
      } else {
        appStatus = "stopped";
      }

      let health: ServiceStatus["health"] = null;
      if (running && app.health) {
        health = checkHealth(app.health) ? "ok" : "failing";
      } else if (running && resolvedPort) {
        health = checkHealth(`http://localhost:${resolvedPort}`)
          ? "ok"
          : "no_response";
      }

      const activePid = portPid || pid;
      const processName = activePid ? getProcessName(activePid) : null;

      const url = resolvedPort
        ? proxyUp
          ? `${app.name}.localhost:${PROXY_PORT}`
          : `localhost:${resolvedPort}`
        : null;

      services.push({
        name: app.name,
        type: "app",
        status: appStatus,
        port: resolvedPort,
        url,
        pid: pid,
        portPid: pid && portPid && pid !== portPid ? portPid : null,
        process: processName,
        health,
        logFile: hasLog ? lf : null,
      });
    }
  }

  return { project: config.name, proxy: proxyUp, services };
}

/**
 * `boot status` — show what's running, with health checks and PID mismatch warnings.
 */
export async function status(opts?: { json?: boolean }): Promise<void> {
  const result = collectStatus();

  if (opts?.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  log.header(`${result.project} — status`);

  const rows: string[][] = [];
  rows.push(["SERVICE", "STATUS", "URL", "PID", "PROCESS", "HEALTH", "LOG"]);

  for (const svc of result.services) {
    const statusColor =
      svc.status === "running"
        ? `${GREEN}running${RESET}`
        : svc.status === "not_found"
          ? `${RED}not found${RESET}`
          : svc.status === "stopped"
            ? `${RED}stopped${RESET}`
            : svc.status === "port_in_use"
              ? `${YELLOW}port in use${RESET}`
              : `${YELLOW}${svc.status}${RESET}`;

    const healthStr = svc.health === "ok" ? `${GREEN}ok${RESET}`
      : svc.health === "connected" ? `${GREEN}connected${RESET}`
      : svc.health === "failing" ? `${RED}failing${RESET}`
      : svc.health === "no_response" ? `${YELLOW}no response${RESET}`
      : "—";

    let pidStr = svc.pid ? String(svc.pid) : "—";
    if (svc.portPid) {
      pidStr += ` ${YELLOW}(port PID: ${svc.portPid})${RESET}`;
    }

    rows.push([
      svc.name,
      statusColor,
      svc.url || "—",
      pidStr,
      svc.process || "—",
      healthStr,
      svc.logFile || "—",
    ]);
  }

  log.table(rows);
  log.blank();
}

/**
 * Test if a Docker container passes its health/ready check.
 */
function testContainerHealth(container: string, check: string): boolean {
  try {
    execFileSync("docker", ["exec", container, "sh", "-c", check], {
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the process name for a PID (e.g. "node", "nest", "nuxt").
 */
function getProcessName(pid: number): string {
  try {
    const name = execFileSync("ps", ["-p", String(pid), "-o", "comm="], {
      stdio: "pipe",
    })
      .toString()
      .trim();
    // Return just the binary name (strip path)
    return name.split("/").pop() || name || "—";
  } catch {
    return "—";
  }
}

/**
 * Quick curl-like health check — returns true if URL responds with non-5xx.
 */
function checkHealth(url: string): boolean {
  try {
    const result = execFileSync(
      "curl",
      ["-sf", "-o", "/dev/null", "-w", "%{http_code}", "--connect-timeout", "2", "--max-time", "3", url],
      { stdio: "pipe" }
    )
      .toString()
      .trim();
    const code = parseInt(result, 10);
    return code > 0 && code < 500;
  } catch {
    return false;
  }
}

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

/**
 * `boot status` — show what's running, with health checks and PID mismatch warnings.
 */
export async function status(): Promise<void> {
  const config = loadConfig();

  log.header(`${config.name} — status`);

  const proxyUp = isProxyRunning() || isPortInUse(PROXY_PORT);

  const rows: string[][] = [];
  rows.push(["SERVICE", "STATUS", "URL", "PID", "PROCESS", "HEALTH", "LOG"]);

  // Docker services / containers
  if (config.docker) {
    const dockerStatuses = getDockerStatus(config);
    // Collect readyCheck info for DB connection testing
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
      const statusColor =
        svc.status === "running"
          ? `${GREEN}running${RESET}`
          : svc.status === "not found"
            ? `${RED}not found${RESET}`
            : `${YELLOW}${svc.status}${RESET}`;

      // DB connection test for running containers with readyCheck
      let healthStr = "—";
      if (svc.status === "running") {
        const checkInfo = readyChecks.get(svc.name);
        if (checkInfo) {
          healthStr = testContainerHealth(checkInfo.container, checkInfo.check)
            ? `${GREEN}connected${RESET}`
            : `${RED}failing${RESET}`;
        } else {
          healthStr = `${GREEN}ok${RESET}`;
        }
      }

      rows.push([svc.name, statusColor, svc.ports || "—", "—", "docker", healthStr, "—"]);
    }

    if (dockerStatuses.length === 0 && config.docker.services) {
      for (const svc of config.docker.services) {
        rows.push([svc.name, `${YELLOW}unknown${RESET}`, "—", "—", "—", "—", "—"]);
      }
    }
  }

  // App processes
  if (config.apps) {
    for (const app of config.apps) {
      const { running, pid, portPid, resolvedPort } = getAppStatus(app);
      const portStr = resolvedPort
        ? proxyUp
          ? `${app.name}.localhost:${PROXY_PORT}`
          : String(resolvedPort)
        : "—";
      const lf = logFile(app.name);
      const hasLog = fs.existsSync(lf);

      // Status
      let statusStr: string;
      if (running) {
        statusStr = `${GREEN}running${RESET}`;
      } else if (resolvedPort && isPortInUse(resolvedPort)) {
        statusStr = `${YELLOW}port in use${RESET}`;
      } else {
        statusStr = `${RED}stopped${RESET}`;
      }

      // PID display + mismatch warning
      let pidStr = pid ? String(pid) : "—";
      if (pid && portPid && pid !== portPid) {
        pidStr += ` ${YELLOW}(port PID: ${portPid})${RESET}`;
      }

      // Health check (curl the health URL if app is running)
      let healthStr = "—";
      if (running && app.health) {
        healthStr = checkHealth(app.health)
          ? `${GREEN}ok${RESET}`
          : `${RED}failing${RESET}`;
      } else if (running && resolvedPort) {
        healthStr = checkHealth(`http://localhost:${resolvedPort}`)
          ? `${GREEN}ok${RESET}`
          : `${YELLOW}no response${RESET}`;
      }

      // Process name (what binary is actually running)
      const activePid = portPid || pid;
      const processName = activePid ? getProcessName(activePid) : "—";

      rows.push([
        app.name,
        statusStr,
        portStr,
        pidStr,
        processName,
        healthStr,
        hasLog ? lf : "—",
      ]);
    }
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

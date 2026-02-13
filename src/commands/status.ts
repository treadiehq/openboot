import * as fs from "fs";
import { execSync } from "child_process";
import { loadConfig } from "../lib/config";
import { getDockerStatus } from "../lib/docker";
import { getAppStatus, logFile } from "../lib/process";
import { isPortInUse } from "../lib/ports";
import { log } from "../lib/log";

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

  const rows: string[][] = [];
  rows.push(["SERVICE", "STATUS", "PORT", "PID", "HEALTH", "LOG"]);

  // Docker services / containers
  if (config.docker) {
    const dockerStatuses = getDockerStatus(config);
    for (const svc of dockerStatuses) {
      const statusColor =
        svc.status === "running"
          ? `${GREEN}running${RESET}`
          : svc.status === "not found"
            ? `${RED}not found${RESET}`
            : `${YELLOW}${svc.status}${RESET}`;
      rows.push([svc.name, statusColor, svc.ports || "—", "—", "—", "—"]);
    }

    if (dockerStatuses.length === 0 && config.docker.services) {
      for (const svc of config.docker.services) {
        rows.push([svc.name, `${YELLOW}unknown${RESET}`, "—", "—", "—", "—"]);
      }
    }
  }

  // App processes
  if (config.apps) {
    for (const app of config.apps) {
      const { running, pid, portPid } = getAppStatus(app);
      const portStr = app.port ? String(app.port) : "—";
      const lf = logFile(app.name);
      const hasLog = fs.existsSync(lf);

      // Status
      let statusStr: string;
      if (running) {
        statusStr = `${GREEN}running${RESET}`;
      } else if (app.port && isPortInUse(app.port)) {
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
      } else if (running && app.port) {
        // No explicit health URL — just check if port responds
        healthStr = checkHealth(`http://localhost:${app.port}`)
          ? `${GREEN}ok${RESET}`
          : `${YELLOW}no response${RESET}`;
      }

      rows.push([
        app.name,
        statusStr,
        portStr,
        pidStr,
        healthStr,
        hasLog ? lf : "—",
      ]);
    }
  }

  log.table(rows);
  log.blank();
}

/**
 * Quick curl-like health check — returns true if URL responds with non-5xx.
 */
function checkHealth(url: string): boolean {
  try {
    const result = execSync(
      `curl -sf -o /dev/null -w '%{http_code}' --connect-timeout 2 --max-time 3 "${url}"`,
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

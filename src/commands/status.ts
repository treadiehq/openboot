import * as fs from "fs";
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
 * `boot status` — show what's running.
 */
export async function status(): Promise<void> {
  const config = loadConfig();

  log.header(`${config.name} — status`);

  const rows: string[][] = [];
  rows.push(["SERVICE", "STATUS", "PORT", "PID", "LOG"]);

  // Docker services
  if (config.docker) {
    const dockerStatuses = getDockerStatus(config);
    for (const svc of dockerStatuses) {
      const statusColor =
        svc.status === "running"
          ? `${GREEN}running${RESET}`
          : `${RED}${svc.status}${RESET}`;
      rows.push([svc.name, statusColor, svc.ports || "—", "—", "—"]);
    }

    // If no status returned but services are configured, show them as unknown
    if (dockerStatuses.length === 0 && config.docker.services) {
      for (const svc of config.docker.services) {
        rows.push([svc.name, `${YELLOW}unknown${RESET}`, "—", "—", "—"]);
      }
    }
  }

  // App processes
  if (config.apps) {
    for (const app of config.apps) {
      const { running, pid } = getAppStatus(app);
      const portStr = app.port ? String(app.port) : "—";
      const lf = logFile(app.name);
      const hasLog = fs.existsSync(lf);

      let statusStr: string;
      if (running) {
        statusStr = `${GREEN}running${RESET}`;
      } else if (app.port && isPortInUse(app.port)) {
        statusStr = `${YELLOW}port in use${RESET}`;
      } else {
        statusStr = `${RED}stopped${RESET}`;
      }

      rows.push([
        app.name,
        statusStr,
        portStr,
        pid ? String(pid) : "—",
        hasLog ? lf : "—",
      ]);
    }
  }

  log.table(rows);
  log.blank();
}

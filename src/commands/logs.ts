import * as fs from "fs";
import * as path from "path";
import { execSync, spawn } from "child_process";
import { loadConfig } from "../lib/config";
import { log } from "../lib/log";

const LOGS_DIR = path.join(".boot", "logs");

/**
 * `boot logs` — view logs for services.
 *
 * boot logs                  → show recent logs for all services
 * boot logs api              → show logs for "api" service
 * boot logs api -f           → follow (tail -f) logs for "api"
 * boot logs api -n 50        → last 50 lines of "api" logs
 * boot logs --all            → show all docker + app logs
 */
export async function logs(
  service?: string,
  options: { follow?: boolean; lines?: string } = {}
): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch {
    config = null;
  }

  const lineCount = options.lines || "40";

  // If no service specified, list available logs or show all
  if (!service) {
    return showAllLogs(lineCount);
  }

  // Find the matching log file
  const logFile = findLogFile(service);
  if (!logFile) {
    // Check if it's a Docker service
    if (config?.docker) {
      const containers = [
        ...(config.docker.services || []).map((s) => ({
          name: s.name,
          container: s.container || s.name,
        })),
        ...(config.docker.containers || []).map((c) => ({
          name: c.name,
          container: c.name,
        })),
      ];

      const match = containers.find(
        (c) =>
          c.name.toLowerCase().includes(service.toLowerCase()) ||
          c.container.toLowerCase().includes(service.toLowerCase())
      );

      if (match) {
        return showDockerLogs(match.container, options.follow, lineCount);
      }
    }

    log.error(`No logs found for "${service}"`);
    log.step("Available services:");
    listAvailableLogs();
    return;
  }

  if (options.follow) {
    // Follow mode — use tail -f (blocks until Ctrl+C)
    log.info(`Following ${service} logs (Ctrl+C to stop)...`);
    log.blank();
    const child = spawn("tail", ["-f", "-n", lineCount, logFile], {
      stdio: "inherit",
    });
    await new Promise<void>((resolve) => {
      child.on("close", () => resolve());
    });
  } else {
    // Just show last N lines
    log.header(`${service} logs`);
    try {
      const output = execSync(`tail -n ${lineCount} "${logFile}"`, {
        stdio: "pipe",
      })
        .toString()
        .trim();
      if (output) {
        console.log(output);
      } else {
        log.step("(empty log file)");
      }
    } catch {
      log.step("(empty log file)");
    }
    log.blank();
    log.step(`Full log: ${logFile}`);
    log.step(`Follow:   boot logs ${service} -f`);
    log.blank();
  }
}

/**
 * Show recent logs for all services.
 */
function showAllLogs(lineCount: string): void {
  if (!fs.existsSync(LOGS_DIR)) {
    log.warn("No logs found. Run 'boot up' first.");
    return;
  }

  const files = fs
    .readdirSync(LOGS_DIR)
    .filter((f) => f.endsWith(".log"))
    .sort();

  if (files.length === 0) {
    log.warn("No log files found.");
    return;
  }

  for (const file of files) {
    const name = file.replace(".log", "");
    const fullPath = path.join(LOGS_DIR, file);
    const stat = fs.statSync(fullPath);
    const sizeKb = (stat.size / 1024).toFixed(1);
    const modified = stat.mtime.toLocaleTimeString();

    log.header(`${name}`);
    log.step(`${fullPath} (${sizeKb}KB, last modified: ${modified})`);
    log.blank();

    try {
      const output = execSync(`tail -n ${lineCount} "${fullPath}"`, {
        stdio: "pipe",
      })
        .toString()
        .trim();
      if (output) {
        console.log(output);
      } else {
        log.step("(empty)");
      }
    } catch {
      log.step("(empty)");
    }
    log.blank();
  }
}

/**
 * Show Docker container logs.
 */
function showDockerLogs(
  container: string,
  follow?: boolean,
  lineCount?: string
): void {
  const args = ["logs"];
  if (follow) args.push("-f");
  args.push("--tail", lineCount || "40", container);

  if (follow) {
    log.info(`Following ${container} Docker logs (Ctrl+C to stop)...`);
    log.blank();
    const child = spawn("docker", args, { stdio: "inherit" });
    child.on("close", () => {});
  } else {
    log.header(`${container} (Docker)`);
    try {
      execSync(`docker logs --tail ${lineCount || "40"} ${container}`, {
        stdio: "inherit",
      });
    } catch {
      log.step("(no logs available)");
    }
    log.blank();
  }
}

/**
 * Find a log file by service name (fuzzy match).
 */
function findLogFile(service: string): string | null {
  if (!fs.existsSync(LOGS_DIR)) return null;

  const files = fs.readdirSync(LOGS_DIR).filter((f) => f.endsWith(".log"));

  // Exact match
  const exact = files.find((f) => f === `${service}.log`);
  if (exact) return path.join(LOGS_DIR, exact);

  // Partial match
  const partial = files.find((f) =>
    f.toLowerCase().includes(service.toLowerCase())
  );
  if (partial) return path.join(LOGS_DIR, partial);

  return null;
}

/**
 * List available log files.
 */
function listAvailableLogs(): void {
  if (fs.existsSync(LOGS_DIR)) {
    const files = fs.readdirSync(LOGS_DIR).filter((f) => f.endsWith(".log"));
    for (const f of files) {
      log.step(`  ${f.replace(".log", "")}`);
    }
  }

  // Also mention Docker services
  try {
    const config = loadConfig();
    if (config.docker?.services) {
      for (const s of config.docker.services) {
        log.step(`  ${s.name} (docker)`);
      }
    }
    if (config.docker?.containers) {
      for (const c of config.docker.containers) {
        log.step(`  ${c.name} (docker)`);
      }
    }
  } catch {
    // no config
  }
}

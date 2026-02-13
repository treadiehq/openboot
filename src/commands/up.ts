import * as fs from "fs";
import { execSync } from "child_process";
import { loadConfig, getPackageManager } from "../lib/config";
import { startDocker } from "../lib/docker";
import { startApp } from "../lib/process";
import { waitForHealth } from "../lib/health";
import { log } from "../lib/log";

/**
 * `boot up` — start all services.
 */
export async function up(): Promise<void> {
  const config = loadConfig();
  const projectRoot = process.cwd();

  log.header(`Starting ${config.name}`);

  // Auto-install deps if node_modules is missing
  if (!fs.existsSync("node_modules") && fs.existsSync("package.json")) {
    const pm = getPackageManager(config);
    log.info("Dependencies not installed — running install...");
    try {
      execSync(`${pm} install`, { stdio: "inherit" });
      log.success("Dependencies installed");
    } catch {
      log.error("Failed to install dependencies");
      process.exit(1);
    }
  }

  // Start Docker services
  if (config.docker) {
    startDocker(config);
  }

  // Start app processes
  if (config.apps && config.apps.length > 0) {
    for (const app of config.apps) {
      startApp(app, projectRoot);

      // Health check
      if (app.health) {
        log.info(`Waiting for ${app.name} to be healthy...`);
        const healthy = await waitForHealth(app.health, 45);
        if (healthy) {
          log.success(`${app.name} is ready`);
        } else {
          log.warn(`${app.name} may not be ready (timed out)`);
        }
      }
    }
  }

  // Summary
  log.blank();
  log.header(`${config.name} is running`);

  if (config.apps) {
    for (const app of config.apps) {
      if (app.port) {
        log.step(`${app.name}: http://localhost:${app.port}`);
      } else {
        log.step(`${app.name}: started`);
      }
    }
  }

  log.blank();
  log.step("Logs:    .boot/logs/");
  log.step("Stop:    boot down");
  log.step("Restart: boot reboot");
  log.step("Status:  boot status");
  log.blank();
}

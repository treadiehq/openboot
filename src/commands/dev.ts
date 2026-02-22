import { loadConfig } from "../lib/config";
import { startDocker } from "../lib/docker";
import { startApp, stopAllApps } from "../lib/process";
import { stopDocker } from "../lib/docker";
import { waitForHealth } from "../lib/health";
import { log } from "../lib/log";
import { checkPrerequisites } from "../lib/prereqs";
import { tailAllLogs } from "../lib/tail";

/**
 * `boot dev` — interactive development mode.
 * Starts everything (docker + apps) and streams all logs in the foreground.
 * Ctrl+C gracefully stops all services.
 */
export async function dev(): Promise<void> {
  const config = loadConfig();
  if (!config) return;

  const needsDocker = !!(
    config.docker?.composeFile ||
    (config.docker?.containers && config.docker.containers.length > 0)
  );

  if (!checkPrerequisites({ needsDocker })) {
    return;
  }

  const projectRoot = process.cwd();

  // Register shutdown handlers early so Ctrl+C during startup still cleans up
  let logHandle: ReturnType<typeof tailAllLogs> | null = null;

  const shutdown = () => {
    if (logHandle) logHandle.stop();
    log.blank();
    log.header("Shutting down...");
    log.blank();

    // Stop apps
    if (config.apps) {
      stopAllApps(config.apps);
    }

    // Stop Docker
    if (config.docker) {
      stopDocker(config);
    }

    log.blank();
    log.success(`${config.name} stopped`);
    log.blank();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  log.header(`${config.name} — dev mode`);
  log.blank();

  // Start Docker services
  if (config.docker) {
    startDocker(config);
    log.blank();
  }

  // Start app processes
  if (config.apps) {
    for (const app of config.apps) {
      startApp(app, projectRoot);
    }

    // Wait for health checks
    for (const app of config.apps) {
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
      const port = typeof app.port === "number" ? app.port : null;
      if (port) {
        log.step(`${app.name}: http://localhost:${port}`);
      } else {
        log.step(`${app.name}: started`);
      }
    }
  }

  log.blank();

  // Stream logs — Ctrl+C stops everything via the shutdown handler above
  logHandle = tailAllLogs(config);

  await new Promise<void>(() => {
    // Keep the process alive; shutdown is handled by the signal handlers
  });
}

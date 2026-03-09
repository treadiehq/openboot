import { loadConfig } from "../lib/config";
import { startDocker } from "../lib/docker";
import { startApp, stopAllApps } from "../lib/process";
import { stopDocker } from "../lib/docker";
import { waitForHealth } from "../lib/health";
import { log } from "../lib/log";
import { checkPrerequisites } from "../lib/prereqs";
import { tailAllLogs } from "../lib/tail";
import { startProxy, stopProxy } from "../lib/proxy";
import { startTunnel, stopTunnel } from "../lib/tunnel";

/**
 * `boot dev` — interactive development mode.
 * Starts everything (docker + apps) and streams all logs in the foreground.
 * Ctrl+C gracefully stops all services.
 */
export async function dev(options: { tunnel?: boolean } = {}): Promise<void> {
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

    // Stop proxy
    stopProxy();

    // Stop tunnel if one was started
    stopTunnel();

    log.blank();
    log.success(`${config.name} stopped`);
    log.blank();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  log.header(`${config.name} — dev mode`);
  log.blank();

  // Start reverse proxy
  const proxyPort = startProxy();
  if (proxyPort) {
    log.success(`Proxy listening on http://localhost:${proxyPort}`);
  }

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

  // Optional: start Private Connect tunnel for shareable URL
  const useTunnel = options.tunnel ?? config.tunnel === true;
  let tunnelUrl: string | null = null;
  if (useTunnel && proxyPort) {
    try {
      const result = await startTunnel(proxyPort, { inProcess: true });
      tunnelUrl = result.url;
    } catch (err: any) {
      log.warn("Tunnel failed — ensure the private-connect package is available");
      log.warn(err?.message ?? String(err));
    }
  }

  // Summary
  log.blank();
  log.header(`${config.name} is running`);

  if (config.apps) {
    for (const app of config.apps) {
      const port = typeof app.port === "number" ? app.port : null;
      if (port && proxyPort) {
        log.step(`${app.name}: http://${app.name}.localhost:${proxyPort}`);
      } else if (port) {
        log.step(`${app.name}: http://localhost:${port}`);
      } else {
        log.step(`${app.name}: started`);
      }
    }
  }

  if (tunnelUrl) {
    log.step(`Tunnel:  ${tunnelUrl} (share with anyone)`);
  }

  log.blank();

  // Stream logs — Ctrl+C stops everything via the shutdown handler above
  logHandle = tailAllLogs(config);

  await new Promise<void>(() => {
    // Keep the process alive; shutdown is handled by the signal handlers
  });
}

import { loadConfig } from "../lib/config";
import { stopDocker } from "../lib/docker";
import { stopAllApps } from "../lib/process";
import { log } from "../lib/log";
import { stopProxyBackground } from "../lib/proxy";
import { stopTunnel } from "../lib/tunnel";

/**
 * `boot down` — stop all services.
 */
export async function down(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch {
    // Even without config, try to stop any running apps, proxy, and tunnel
    log.info("No boot.yaml found — stopping any tracked processes...");
    stopAllApps();
    stopProxyBackground();
    stopTunnel();
    return;
  }

  log.header(`Stopping ${config.name}`);

  // Stop app processes first (pass configs for pkill fallback + port cleanup)
  stopAllApps(config.apps);

  // Stop Docker services
  if (config.docker) {
    stopDocker(config);
  }

  // Stop proxy
  stopProxyBackground();

  // Stop tunnel if one was started (e.g. boot up --tunnel)
  stopTunnel();

  log.blank();
  log.success("All services stopped");
  log.blank();
}

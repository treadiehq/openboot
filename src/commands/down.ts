import { loadConfig } from "../lib/config";
import { stopDocker } from "../lib/docker";
import { stopAllApps } from "../lib/process";
import { log } from "../lib/log";
import { stopProxyBackground } from "../lib/proxy";

/**
 * `boot down` — stop all services.
 */
export async function down(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch {
    // Even without config, try to stop any running apps and proxy
    log.info("No boot.yaml found — stopping any tracked processes...");
    stopAllApps();
    stopProxyBackground();
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

  log.blank();
  log.success("All services stopped");
  log.blank();
}

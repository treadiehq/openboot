import { execSync } from "child_process";
import { loadConfig } from "../lib/config";
import { startDocker } from "../lib/docker";
import { log } from "../lib/log";

/**
 * `boot setup` — run one-time setup steps.
 */
export async function setup(): Promise<void> {
  const config = loadConfig();

  log.header(`Setting up ${config.name}`);

  // Start Docker first (DB needs to be up for migrations/seeds)
  if (config.docker) {
    startDocker(config);
  }

  // Run setup commands
  if (config.setup && config.setup.length > 0) {
    for (const cmd of config.setup) {
      log.info(`Running: ${cmd}`);
      try {
        execSync(cmd, { stdio: "inherit", cwd: process.cwd() });
        log.success(`Done: ${cmd}`);
      } catch {
        log.error(`Failed: ${cmd}`);
        process.exit(1);
      }
    }
  } else {
    log.step("No setup steps defined in boot.yaml");
  }

  log.blank();
  log.success("Setup complete!");
  log.blank();
  log.step("Next: boot up");
  log.blank();
}

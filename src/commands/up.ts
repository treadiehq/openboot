import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { loadConfig, getPackageManager } from "../lib/config";
import { startDocker } from "../lib/docker";
import { startApp } from "../lib/process";
import { waitForHealth } from "../lib/health";
import { log } from "../lib/log";
import { BootConfig } from "../types";

/**
 * `boot up` — start all services.
 */
export async function up(): Promise<void> {
  const config = loadConfig();
  const projectRoot = process.cwd();

  log.header(`Starting ${config.name}`);

  // Validate .env if configured
  if (config.env) {
    if (!validateEnv(config)) {
      process.exit(1);
    }
  }

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

/**
 * Validate environment variables from .env file.
 * Returns true if validation passes, false if it fails.
 */
function validateEnv(config: BootConfig): boolean {
  const envConfig = config.env;
  if (!envConfig) return true;

  const envFile = envConfig.file || ".env";
  const envPath = path.resolve(envFile);

  // Check if .env file exists
  if (!fs.existsSync(envPath)) {
    log.error(`Missing ${envFile} file`);
    log.step(`Copy the example and configure it:`);
    // Try to find an example file
    const examples = ["env.example", ".env.example", ".env.sample"];
    const example = examples.find((e) => fs.existsSync(path.resolve(e)));
    if (example) {
      log.step(`  cp ${example} ${envFile}`);
    } else {
      log.step(`  Create ${envFile} with the required variables`);
    }
    return false;
  }

  // Source the .env file into process.env for checks
  const raw = fs.readFileSync(envPath, "utf-8");
  const envVars: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.substring(0, eq).trim();
    let val = trimmed.substring(eq + 1).trim();
    // Strip surrounding quotes
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    envVars[key] = val;
    // Also set in process.env so apps inherit them
    process.env[key] = val;
  }

  let valid = true;

  // Check required vars
  if (envConfig.required) {
    for (const key of envConfig.required) {
      if (!envVars[key] && !process.env[key]) {
        log.error(`Missing required env var: ${key}`);
        valid = false;
      }
    }
  }

  // Check rejected values (e.g. default secrets)
  if (envConfig.reject) {
    for (const [key, badValues] of Object.entries(envConfig.reject)) {
      const val = envVars[key] || process.env[key] || "";
      if (badValues.includes(val)) {
        log.error(
          `${key} is set to a default/example value — please change it`
        );
        log.step(`Generate a real one: openssl rand -hex 32`);
        valid = false;
      }
    }
  }

  if (valid) {
    log.success("Environment validated");
  }

  return valid;
}

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { loadConfig, getPackageManager } from "../lib/config";
import { startDocker } from "../lib/docker";
import { startApp } from "../lib/process";
import { waitForHealth } from "../lib/health";
import { log } from "../lib/log";
import { BootConfig } from "../types";
import { checkPrerequisites } from "../lib/prereqs";

/**
 * `boot up` — start all services.
 */
export async function up(): Promise<void> {
  const config = loadConfig();
  const projectRoot = process.cwd();

  log.header(`Starting ${config.name}`);

  // Check prerequisites
  const needsDocker = !!(
    config.docker?.composeFile ||
    config.docker?.services?.length ||
    config.docker?.containers?.length
  );
  if (!checkPrerequisites({ needsDocker })) {
    process.exit(1);
  }

  // Validate .env if configured
  if (config.env) {
    if (!validateEnv(config)) {
      process.exit(1);
    }
  }

  const pm = getPackageManager(config);

  // Ensure package manager is available (corepack auto-setup)
  ensurePackageManager(pm);

  // Auto-install root deps if node_modules is missing
  if (!fs.existsSync("node_modules") && fs.existsSync("package.json")) {
    log.info("Dependencies not installed — running install...");
    try {
      execSync(`${pm} install`, { stdio: "inherit" });
      log.success("Dependencies installed");
    } catch {
      log.error("Failed to install dependencies");
      process.exit(1);
    }
  }

  // Auto-install per-app deps if missing (monorepo sub-apps)
  if (config.apps) {
    for (const app of config.apps) {
      if (app.path) {
        const appDir = path.resolve(projectRoot, app.path);
        const appNodeModules = path.join(appDir, "node_modules");
        const appPkgJson = path.join(appDir, "package.json");
        if (
          fs.existsSync(appPkgJson) &&
          !fs.existsSync(appNodeModules)
        ) {
          log.info(`Installing dependencies for ${app.name}...`);
          try {
            execSync(`${pm} install`, { cwd: appDir, stdio: "inherit" });
            log.success(`${app.name} dependencies installed`);
          } catch {
            log.warn(`Failed to install deps for ${app.name} — continuing`);
          }
        }
      }
    }
  }

  // Smart Prisma check — generate client if .prisma is missing
  smartPrismaCheck(config, pm, projectRoot);

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

  // Check if .env file exists — auto-create from template if possible
  if (!fs.existsSync(envPath)) {
    const templates = [
      "env.example",
      ".env.example",
      ".env.sample",
      "env.template",
    ];
    const template = templates.find((t) => fs.existsSync(path.resolve(t)));

    if (template) {
      log.info(`No ${envFile} found — creating from ${template}...`);
      fs.copyFileSync(path.resolve(template), envPath);
      log.success(`Created ${envFile} from ${template}`);
      log.warn("Review and update the values in .env before continuing");
    } else {
      log.error(`Missing ${envFile} file`);
      log.step(`Create ${envFile} with the required variables`);
      return false;
    }
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

/**
 * Ensure the detected package manager is actually available.
 * If pnpm is needed but not installed, try corepack or global install.
 */
function ensurePackageManager(pm: string): void {
  try {
    execSync(`${pm} --version`, { stdio: "pipe" });
    return; // Already available
  } catch {
    // Not found
  }

  if (pm === "pnpm") {
    log.info("pnpm not found — enabling via corepack...");
    try {
      execSync("corepack enable pnpm", { stdio: "pipe" });
      log.success("pnpm enabled via corepack");
      return;
    } catch {
      // corepack failed
    }

    log.info("Trying global install...");
    try {
      execSync("npm install -g pnpm", { stdio: "inherit" });
      log.success("pnpm installed globally");
      return;
    } catch {
      log.error("Failed to install pnpm. Please install it manually.");
      process.exit(1);
    }
  }

  if (pm === "yarn") {
    log.info("yarn not found — enabling via corepack...");
    try {
      execSync("corepack enable yarn", { stdio: "pipe" });
      log.success("yarn enabled via corepack");
      return;
    } catch {
      log.error("Failed to enable yarn. Please install it manually.");
      process.exit(1);
    }
  }

  log.error(`${pm} is not installed. Please install it first.`);
  process.exit(1);
}

/**
 * Check if Prisma client needs to be generated.
 * Scans known locations for prisma/ directories and checks if .prisma exists.
 */
function smartPrismaCheck(
  config: BootConfig,
  pm: string,
  projectRoot: string
): void {
  const prismaLocations = [
    "prisma",
    "apps/api/prisma",
    "apps/server/prisma",
    "apps/backend/prisma",
  ];

  for (const loc of prismaLocations) {
    const prismaDir = path.resolve(projectRoot, loc);
    if (!fs.existsSync(prismaDir)) continue;

    // Determine the app directory (parent of prisma/)
    const appDir = path.dirname(prismaDir);
    const prismaClient = path.join(appDir, "node_modules", ".prisma");

    if (!fs.existsSync(prismaClient)) {
      log.info(`Generating Prisma client (${loc})...`);
      const runCmd = pm === "npm" ? "npx" : pm;
      try {
        execSync(`${runCmd} prisma generate`, {
          cwd: appDir,
          stdio: "inherit",
        });
        log.success("Prisma client generated");
      } catch {
        log.warn("Failed to generate Prisma client — continuing");
      }
    }
  }
}

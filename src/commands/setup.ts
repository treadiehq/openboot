import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { loadConfig, getPackageManager } from "../lib/config";
import { startDocker } from "../lib/docker";
import { checkPrerequisites } from "../lib/prereqs";
import { log } from "../lib/log";

/**
 * `boot setup` — run one-time setup steps.
 */
export async function setup(): Promise<void> {
  const config = loadConfig();

  log.header(`Setting up ${config.name}`);

  // Check prerequisites
  const needsDocker = !!(
    config.docker?.composeFile ||
    config.docker?.services?.length ||
    config.docker?.containers?.length
  );
  if (!checkPrerequisites({ needsDocker })) {
    process.exit(1);
  }

  // Auto-create .env from template if missing
  autoCreateEnv();

  // Start Docker first (DB needs to be up for migrations/seeds)
  if (config.docker) {
    startDocker(config);
  }

  // Run setup commands with smart handling
  if (config.setup && config.setup.length > 0) {
    for (const cmd of config.setup) {
      log.info(`Running: ${cmd}`);
      try {
        execSync(cmd, { stdio: "inherit", cwd: process.cwd() });
        log.success(`Done: ${cmd}`);
      } catch {
        // Try fallback for known commands
        if (handleCommandFallback(cmd)) {
          continue;
        }
        log.error(`Failed: ${cmd}`);
        process.exit(1);
      }
    }
  } else {
    log.step("No setup steps defined in boot.yaml");
  }

  // Smart Prisma handling — generate + migrate with fallback
  smartPrismaSetup();

  log.blank();
  log.success("Setup complete!");
  log.blank();
  log.step("Next: boot up");
  log.blank();
}

/**
 * Auto-create .env from template if missing.
 */
function autoCreateEnv(): void {
  if (fs.existsSync(".env")) return;

  const templates = ["env.example", ".env.example", ".env.sample", "env.template"];
  const template = templates.find((t) => fs.existsSync(t));

  if (template) {
    fs.copyFileSync(template, ".env");
    log.success(`Created .env from ${template}`);
    log.warn("Review and update the values in .env");
  }
}

/**
 * Handle fallback for known commands that fail.
 */
function handleCommandFallback(cmd: string): boolean {
  // Prisma migrate deploy → db push fallback
  if (cmd.includes("migrate deploy") || cmd.includes("db:migrate")) {
    log.warn("Migration failed — falling back to db push...");
    try {
      const fallback = cmd
        .replace("migrate deploy", "db push --accept-data-loss")
        .replace("db:migrate", "db:push");
      execSync(fallback, { stdio: "inherit", cwd: process.cwd() });
      log.success("Database schema pushed (fallback)");
      return true;
    } catch {
      return false;
    }
  }

  // Prisma db:generate — try npx fallback
  if (cmd.includes("db:generate") || cmd.includes("prisma generate")) {
    log.warn("Prisma generate failed — trying npx fallback...");
    try {
      execSync("npx prisma generate", { stdio: "inherit", cwd: process.cwd() });
      log.success("Prisma client generated (fallback)");
      return true;
    } catch {
      return false;
    }
  }

  // Seed commands — non-fatal
  if (cmd.includes("seed") || cmd.includes("db:seed")) {
    log.warn("Seed failed — skipping (non-fatal)");
    return true;
  }

  return false;
}

/**
 * Smart Prisma setup — detect Prisma directories and run generate + migrate.
 * Uses fallback pattern: migrate deploy || db push --accept-data-loss
 */
function smartPrismaSetup(): void {
  const cwd = process.cwd();
  const prismaLocations = [
    "prisma",
    "apps/api/prisma",
    "apps/server/prisma",
    "apps/backend/prisma",
  ];

  for (const loc of prismaLocations) {
    const prismaDir = path.resolve(cwd, loc);
    if (!fs.existsSync(prismaDir)) continue;

    const appDir = path.dirname(prismaDir);
    const pm = getPackageManager();

    // Generate Prisma client
    const prismaClient = path.join(appDir, "node_modules", ".prisma");
    if (!fs.existsSync(prismaClient)) {
      log.info(`Generating Prisma client (${loc})...`);
      const runCmd = pm === "npm" ? "npx" : pm;
      try {
        execSync(`${runCmd} prisma generate`, { cwd: appDir, stdio: "inherit" });
        log.success("Prisma client generated");
      } catch {
        log.warn("Failed to generate Prisma client — continuing");
      }
    }

    // Run migrations with fallback
    log.info(`Running database migrations (${loc})...`);
    const runCmd = pm === "npm" ? "npx" : pm;
    try {
      execSync(`${runCmd} prisma migrate deploy`, {
        cwd: appDir,
        stdio: "inherit",
      });
      log.success("Migrations applied");
    } catch {
      log.warn("migrate deploy failed — trying db push...");
      try {
        execSync(`${runCmd} prisma db push`, {
          cwd: appDir,
          stdio: "inherit",
        });
        log.success("Database schema pushed (fallback)");
      } catch {
        log.warn("Database schema push also failed — continuing");
      }
    }
  }
}

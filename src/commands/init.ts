import * as fs from "fs";
import * as path from "path";
import * as yaml from "yaml";
import { log } from "../lib/log";
import { findConfig, detectPackageManager } from "../lib/config";
import { BootConfig, AppConfig, DockerService } from "../types";

/**
 * `boot init` — auto-detect project structure and create boot.yaml.
 */
export async function init(): Promise<void> {
  const cwd = process.cwd();

  if (findConfig(cwd)) {
    log.warn("boot.yaml already exists in this directory");
    return;
  }

  log.header("boot init");

  const projectName = path.basename(cwd);
  const pm = detectPackageManager(cwd);

  log.info(`Project: ${projectName}`);
  log.info(`Package manager: ${pm}`);

  const config: BootConfig = {
    name: projectName,
    setup: [],
    apps: [],
  };

  // --- Detect Docker Compose ---
  const composeFiles = [
    "docker-compose.yml",
    "docker-compose.yaml",
    "compose.yml",
    "compose.yaml",
  ];
  const composeFile = composeFiles.find((f) => fs.existsSync(path.join(cwd, f)));

  if (composeFile) {
    log.success(`Found ${composeFile}`);

    config.docker = {
      composeFile,
      services: detectDockerServices(cwd, composeFile),
    };
  }

  // --- Detect setup steps ---
  config.setup!.push(`${pm} install`);

  // Check for Prisma
  const prismaLocations = [
    "prisma",
    "apps/api/prisma",
    "apps/server/prisma",
    "apps/backend/prisma",
  ];
  const prismaDir = prismaLocations.find((d) =>
    fs.existsSync(path.join(cwd, d))
  );
  if (prismaDir) {
    log.success(`Found Prisma at ${prismaDir}`);
    config.setup!.push(`${pm} db:generate`);
    config.setup!.push(`${pm} db:push`);
  }

  // Check for TypeORM migrations
  if (fs.existsSync(path.join(cwd, "migrations"))) {
    log.success("Found migrations/");
  }

  // --- Detect apps (monorepo under apps/) ---
  const appsDir = path.join(cwd, "apps");
  if (fs.existsSync(appsDir) && fs.statSync(appsDir).isDirectory()) {
    const dirs = fs.readdirSync(appsDir).filter((d) => {
      const fullPath = path.join(appsDir, d);
      return (
        fs.statSync(fullPath).isDirectory() &&
        fs.existsSync(path.join(fullPath, "package.json"))
      );
    });

    for (const dir of dirs) {
      const pkgPath = path.join(appsDir, dir, "package.json");
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      const hasDevScript = !!pkg.scripts?.dev;

      const app: AppConfig = {
        name: dir,
        path: `apps/${dir}`,
        command: devCommand(pm, hasDevScript),
      };

      const port = guessPort(dir);
      if (port) app.port = port;

      config.apps!.push(app);
      log.success(`Found app: ${dir}`);
    }
  }

  // --- Detect apps in common sub-directories (dashboard/, frontend/, server/, etc.) ---
  const subDirs = [
    "dashboard",
    "frontend",
    "backend",
    "server",
    "client",
    "admin",
    "docs",
  ];
  for (const dir of subDirs) {
    const fullPath = path.join(cwd, dir);
    const pkgPath = path.join(fullPath, "package.json");
    // Skip if already detected under apps/
    const alreadyFound = config.apps!.some((a) => a.name === dir);
    if (
      !alreadyFound &&
      fs.existsSync(pkgPath) &&
      fs.statSync(fullPath).isDirectory()
    ) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      const hasDevScript = !!pkg.scripts?.dev;

      if (hasDevScript || pkg.scripts?.start) {
        const app: AppConfig = {
          name: dir,
          path: dir,
          command: devCommand(pm, hasDevScript),
        };

        const port = guessPort(dir);
        if (port) app.port = port;

        config.apps!.push(app);
        log.success(`Found app: ${dir}`);
      }
    }
  }

  // --- Detect root app (if root package.json has dev/start and it's not a monorepo launcher) ---
  if (fs.existsSync(path.join(cwd, "package.json"))) {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(cwd, "package.json"), "utf-8")
    );
    const hasDevScript = !!pkg.scripts?.dev;
    const hasStartScript = !!pkg.scripts?.start;

    // Check if this is a real app (has its own src/ or main entry) vs just a monorepo root
    const isRealApp =
      fs.existsSync(path.join(cwd, "src")) ||
      fs.existsSync(path.join(cwd, "index.ts")) ||
      fs.existsSync(path.join(cwd, "index.js")) ||
      pkg.main;

    if ((hasDevScript || hasStartScript) && isRealApp) {
      // Pick port: if sub-apps already claimed 3000, use 3001 for root (or vice versa)
      let rootPort = config.apps!.length === 0 ? 3000 : 3001;
      // If 3001 is taken by a sub-app, bump further
      while (config.apps!.some((a) => a.port === rootPort)) {
        rootPort++;
      }

      config.apps!.unshift({
        name: projectName,
        command: devCommand(pm, hasDevScript),
        port: rootPort,
      });
      log.success(`Found root app: ${projectName}`);
    } else if (config.apps!.length === 0 && (hasDevScript || hasStartScript)) {
      // Fallback: no sub-apps and no src/, but has scripts — still treat as single app
      config.apps!.push({
        name: projectName,
        command: devCommand(pm, hasDevScript),
        port: 3000,
      });
      log.success("Detected single-app project");
    }
  }

  // --- Write config ---
  const yamlStr = yaml.stringify(config, {
    indent: 2,
    lineWidth: 0,
  });

  fs.writeFileSync(path.join(cwd, "boot.yaml"), yamlStr);

  log.blank();
  log.success("Created boot.yaml");
  log.blank();
  log.step("Next steps:");
  log.step("  1. Review and edit boot.yaml");
  log.step("  2. Run: boot setup");
  log.step("  3. Run: boot up");
  log.blank();
}

/**
 * Try to detect Docker services from a compose file.
 */
function detectDockerServices(
  cwd: string,
  composeFile: string
): DockerService[] {
  const services: DockerService[] = [];

  try {
    const raw = fs.readFileSync(path.join(cwd, composeFile), "utf-8");
    const compose = yaml.parse(raw);

    if (compose?.services) {
      for (const [name, svc] of Object.entries<any>(compose.services)) {
        const image: string = svc?.image || "";

        // Detect Postgres
        if (image.includes("postgres")) {
          const containerName = svc?.container_name || name;
          services.push({
            name,
            container: containerName,
            readyCheck: "pg_isready -U postgres",
            timeout: 30,
          });
        }

        // Detect MySQL
        if (image.includes("mysql") || image.includes("mariadb")) {
          const containerName = svc?.container_name || name;
          services.push({
            name,
            container: containerName,
            readyCheck: "mysqladmin ping -h localhost",
            timeout: 30,
          });
        }

        // Detect Redis
        if (image.includes("redis")) {
          const containerName = svc?.container_name || name;
          services.push({
            name,
            container: containerName,
            readyCheck: "redis-cli ping",
            timeout: 10,
          });
        }
      }
    }
  } catch {
    // Can't parse compose file — that's fine
  }

  return services;
}

/**
 * Build the dev/start command for a given package manager.
 * npm requires "run" for custom scripts (npm run dev), pnpm/yarn don't.
 */
function devCommand(pm: string, hasDev: boolean): string {
  if (pm === "npm") {
    return hasDev ? "npm run dev" : "npm start";
  }
  return hasDev ? `${pm} dev` : `${pm} start`;
}

/**
 * Guess the port for common app names.
 */
function guessPort(name: string): number | undefined {
  const lower = name.toLowerCase();
  if (["web", "frontend", "dashboard", "client", "ui"].includes(lower))
    return 3000;
  if (["api", "server", "backend"].includes(lower)) return 3001;
  if (["admin"].includes(lower)) return 3002;
  if (["docs"].includes(lower)) return 3003;
  return undefined;
}

import * as fs from "fs";
import * as path from "path";
import * as yaml from "yaml";
import { log } from "../lib/log";
import { findConfig, detectPackageManager } from "../lib/config";
import {
  BootConfig,
  AppConfig,
  DockerService,
  ContainerConfig,
} from "../types";

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

  // --- Detect raw Docker containers (no compose file) ---
  if (!composeFile) {
    const containers = detectRawContainers(cwd);
    if (containers.length > 0) {
      if (!config.docker) config.docker = {};
      config.docker.containers = containers;
      for (const ct of containers) {
        log.success(`Found Docker container: ${ct.name} (${ct.image})`);
      }
    }
  }

  // --- Detect .env requirements ---
  const envConfig = detectEnvRequirements(cwd);
  if (envConfig) {
    config.env = envConfig;
    log.success(`Found ${envConfig.file || ".env"} with ${envConfig.required?.length || 0} required vars`);
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
      // Read PORT from .env if available — that's what the app actually uses
      let rootPort = readPortFromEnv(cwd) || 3000;

      // If a sub-app already claimed this port, bump the sub-app instead
      const conflictApp = config.apps!.find((a) => a.port === rootPort);
      if (conflictApp) {
        let altPort = rootPort + 1;
        while (config.apps!.some((a) => a.port === altPort)) {
          altPort++;
        }
        conflictApp.port = altPort;
      }

      config.apps!.unshift({
        name: projectName,
        command: devCommand(pm, hasDevScript),
        port: rootPort,
      });
      log.success(`Found root app: ${projectName}`);
    } else if (config.apps!.length === 0 && (hasDevScript || hasStartScript)) {
      // Fallback: no sub-apps and no src/, but has scripts — still treat as single app
      const rootPort = readPortFromEnv(cwd) || 3000;
      config.apps!.push({
        name: projectName,
        command: devCommand(pm, hasDevScript),
        port: rootPort,
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

/**
 * Detect raw Docker containers from scripts/ or Dockerfile.
 * Scans shell scripts for `docker start <name>` and `docker run --name <name>` patterns.
 */
function detectRawContainers(cwd: string): ContainerConfig[] {
  const containers: ContainerConfig[] = [];
  const seen = new Set<string>();

  const scriptsDir = path.join(cwd, "scripts");
  if (!fs.existsSync(scriptsDir)) return containers;

  // Collect all script contents
  const scripts = fs.readdirSync(scriptsDir).filter((f) => f.endsWith(".sh"));
  const allContent = scripts
    .map((f) => fs.readFileSync(path.join(scriptsDir, f), "utf-8"))
    .join("\n");

  // 1. Find container names from `docker start <name>` or `docker ps | grep <name>`
  const namePatterns = [
    /docker\s+start\s+([\w-]+)/g,
    /docker\s+ps\s*\|[^]*?grep\s+-?q?\s*([\w-]+)/g,
  ];

  for (const pattern of namePatterns) {
    for (const m of allContent.matchAll(pattern)) {
      const name = m[1];
      if (seen.has(name) || name.startsWith("$") || name.startsWith("-"))
        continue;
      seen.add(name);

      // Search all content for image, port, and env associated with this container
      const ct: ContainerConfig = {
        name,
        image: findImageForContainer(allContent, name),
      };

      const port = findPortForContainer(allContent, name);
      if (port) ct.ports = [port];

      const env = findEnvForContainer(allContent, name);
      if (Object.keys(env).length > 0) ct.env = env;

      // Detect readyCheck and ensure required env vars based on image
      if (ct.image.includes("postgres")) {
        ct.readyCheck = "pg_isready -U postgres";
        ct.timeout = 30;
        // Postgres requires POSTGRES_PASSWORD to start
        if (!ct.env) ct.env = {};
        if (!ct.env.POSTGRES_PASSWORD) {
          ct.env.POSTGRES_PASSWORD = "boot_dev_password";
        }
        if (!ct.env.POSTGRES_DB) {
          // Derive DB name from container name (e.g. "ai-proxy-db" → "ai_proxy")
          ct.env.POSTGRES_DB = ct.name
            .replace(/-db$/, "")
            .replace(/-postgres$/, "")
            .replace(/-/g, "_");
        }
      } else if (ct.image.includes("mysql") || ct.image.includes("mariadb")) {
        ct.readyCheck = "mysqladmin ping -h localhost";
        ct.timeout = 30;
        if (!ct.env) ct.env = {};
        if (!ct.env.MYSQL_ROOT_PASSWORD) {
          ct.env.MYSQL_ROOT_PASSWORD = "boot_dev_password";
        }
      } else if (ct.image.includes("redis")) {
        ct.readyCheck = "redis-cli ping";
        ct.timeout = 10;
      }

      containers.push(ct);
    }
  }

  return containers;
}

/**
 * Find the Docker image for a container name from script content.
 */
function findImageForContainer(content: string, name: string): string {
  // Look for "docker run ... --name <name> ... <image>"
  // Image is typically the last non-flag argument, like postgres:15
  const imagePatterns = [
    // "docker run ... --name ai-proxy-db ... postgres:15"
    new RegExp(
      `docker\\s+run\\s+[^\\n]*--name\\s+${escapeRegex(name)}[^\\n]*((?:postgres|mysql|mariadb|redis|mongo|alpine|ubuntu|node|nginx)[\\w/.:-]*)`,
      "i"
    ),
    // Also search for the image near the container name in any context
    new RegExp(
      `${escapeRegex(name)}[^\\n]*((?:postgres|mysql|mariadb|redis|mongo):[\\w.-]+)`,
      "i"
    ),
  ];

  for (const pattern of imagePatterns) {
    const m = content.match(pattern);
    if (m && m[1]) return m[1];
  }

  // Fallback: if the container name hints at the DB type
  if (name.includes("postgres") || name.includes("pg")) return "postgres:15";
  if (name.includes("mysql")) return "mysql:8";
  if (name.includes("redis")) return "redis:7";
  if (name.includes("mongo")) return "mongo:7";

  return "postgres:15";
}

/**
 * Find port mapping for a container from script content.
 */
function findPortForContainer(
  content: string,
  name: string
): string | null {
  // Look for "-p <port>:<port>" near the container name
  const pattern = new RegExp(
    `(?:${escapeRegex(name)}[^]*?|[^]*?${escapeRegex(name)}[^]*?)-p\\s+(\\d+:\\d+)`,
    "i"
  );
  const m = content.match(pattern);
  if (m) return m[1];

  // Simpler: just find any -p near the name on nearby lines
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(name)) {
      // Search nearby lines (within 5 lines)
      for (let j = Math.max(0, i - 5); j < Math.min(lines.length, i + 5); j++) {
        const portMatch = lines[j].match(/-p\s+(\d+:\d+)/);
        if (portMatch) return portMatch[1];
      }
    }
  }

  return null;
}

/**
 * Find environment variables for a container from script content.
 */
function findEnvForContainer(
  content: string,
  name: string
): Record<string, string> {
  const env: Record<string, string> = {};

  // Find lines near the container name with -e KEY=VALUE
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(name)) {
      for (
        let j = Math.max(0, i - 5);
        j < Math.min(lines.length, i + 10);
        j++
      ) {
        const envMatches = lines[j].matchAll(/-e\s+(\w+)=(\S+)/g);
        for (const em of envMatches) {
          const val = em[2].replace(/[\\'"]/g, "");
          // Skip shell variable references
          if (!val.startsWith("$")) {
            env[em[1]] = val;
          }
        }
      }
    }
  }

  return env;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Read the PORT value from the project's .env file.
 */
function readPortFromEnv(cwd: string): number | null {
  const envPath = path.join(cwd, ".env");
  if (!fs.existsSync(envPath)) return null;

  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^PORT\s*=\s*(\d+)/);
    if (match) return parseInt(match[1], 10);
  }
  return null;
}

/**
 * Detect .env requirements from env.example / .env.example files.
 */
function detectEnvRequirements(
  cwd: string
): BootConfig["env"] | null {
  const envExamples = ["env.example", ".env.example", ".env.sample"];
  const exampleFile = envExamples.find((f) =>
    fs.existsSync(path.join(cwd, f))
  );

  // Also check if .env itself exists
  const hasEnv = fs.existsSync(path.join(cwd, ".env"));

  if (!exampleFile && !hasEnv) return null;

  const result: BootConfig["env"] = { file: ".env" };

  // Parse example file for required vars
  if (exampleFile) {
    const content = fs.readFileSync(path.join(cwd, exampleFile), "utf-8");
    const lines = content.split("\n");
    const required: string[] = [];
    const reject: Record<string, string[]> = {};

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;

      const key = trimmed.substring(0, eq).trim();
      const val = trimmed.substring(eq + 1).trim();

      // Skip vars with empty values — they're optional
      if (!val) continue;

      // Check the comment above this line for "optional" / "if not set" hints
      const prevLine = i > 0 ? lines[i - 1].toLowerCase() : "";
      const prevPrevLine = i > 1 ? lines[i - 2].toLowerCase() : "";
      const contextAbove = prevLine + " " + prevPrevLine;
      if (
        contextAbove.includes("optional") ||
        contextAbove.includes("if not set") ||
        contextAbove.includes("uncomment")
      ) {
        continue;
      }

      // Only mark truly essential vars as required:
      // DATABASE_URL and JWT_SECRET are almost always needed
      const essentialVars = ["DATABASE_URL", "JWT_SECRET"];
      if (essentialVars.includes(key)) {
        required.push(key);

        // If the example value looks like a placeholder, add it to reject list
        if (
          val.includes("change") ||
          val.includes("your-") ||
          val.includes("xxx") ||
          val.includes("replace")
        ) {
          let cleanVal = val;
          if (
            (cleanVal.startsWith('"') && cleanVal.endsWith('"')) ||
            (cleanVal.startsWith("'") && cleanVal.endsWith("'"))
          ) {
            cleanVal = cleanVal.slice(1, -1);
          }
          reject[key] = [cleanVal];
        }
      }
    }

    if (required.length > 0) result.required = required;
    if (Object.keys(reject).length > 0) result.reject = reject;
  }

  return result;
}

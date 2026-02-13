import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { loadConfig } from "../lib/config";
import { log } from "../lib/log";

/**
 * Common cache and build output directories to clean.
 */
const CACHE_DIRS = [
  ".nuxt",
  ".next",
  ".output",
  ".turbo",
  ".parcel-cache",
  ".vite",
];

const BUILD_DIRS = ["dist", "build", ".output"];

const LOCKFILES = [
  "package-lock.json",
  "yarn.lock",
];

/**
 * `boot clean` — nuke dependencies, caches, and build outputs for a fresh start.
 */
export async function clean(options: { all?: boolean } = {}): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch {
    config = null;
  }

  const projectName = config?.name || path.basename(process.cwd());
  log.header(`Cleaning ${projectName}`);

  const cwd = process.cwd();
  let removed = 0;

  // 1. Collect all app directories
  const appDirs = [cwd];
  if (config?.apps) {
    for (const app of config.apps) {
      if (app.path) {
        const appDir = path.resolve(cwd, app.path);
        if (fs.existsSync(appDir)) {
          appDirs.push(appDir);
        }
      }
    }
  }

  // Also scan apps/ directory for monorepo sub-apps not in config
  const monorepoAppsDir = path.join(cwd, "apps");
  if (fs.existsSync(monorepoAppsDir) && fs.statSync(monorepoAppsDir).isDirectory()) {
    for (const dir of fs.readdirSync(monorepoAppsDir)) {
      const fullPath = path.join(monorepoAppsDir, dir);
      if (
        fs.statSync(fullPath).isDirectory() &&
        fs.existsSync(path.join(fullPath, "package.json"))
      ) {
        if (!appDirs.includes(fullPath)) {
          appDirs.push(fullPath);
        }
      }
    }
  }

  // 2. Remove node_modules in all app dirs
  log.info("Removing node_modules...");
  for (const dir of appDirs) {
    const nm = path.join(dir, "node_modules");
    if (fs.existsSync(nm)) {
      const label = path.relative(cwd, nm) || "node_modules";
      fs.rmSync(nm, { recursive: true, force: true });
      log.success(`Removed ${label}`);
      removed++;
    }
  }

  // 3. Remove lockfiles (except pnpm-lock.yaml unless --all)
  log.info("Removing lockfiles...");
  for (const dir of appDirs) {
    for (const lockfile of LOCKFILES) {
      const lf = path.join(dir, lockfile);
      if (fs.existsSync(lf)) {
        fs.rmSync(lf, { force: true });
        const label = path.relative(cwd, lf) || lockfile;
        log.success(`Removed ${label}`);
        removed++;
      }
    }
  }

  if (options.all) {
    // Also remove pnpm-lock.yaml
    const pnpmLock = path.join(cwd, "pnpm-lock.yaml");
    if (fs.existsSync(pnpmLock)) {
      fs.rmSync(pnpmLock, { force: true });
      log.success("Removed pnpm-lock.yaml");
      removed++;
    }
  }

  // 4. Remove caches
  log.info("Removing caches...");
  for (const dir of appDirs) {
    for (const cache of CACHE_DIRS) {
      const cd = path.join(dir, cache);
      if (fs.existsSync(cd)) {
        fs.rmSync(cd, { recursive: true, force: true });
        const label = path.relative(cwd, cd) || cache;
        log.success(`Removed ${label}`);
        removed++;
      }
    }
  }

  // 5. Remove build outputs
  log.info("Removing build outputs...");
  for (const dir of appDirs) {
    for (const build of BUILD_DIRS) {
      const bd = path.join(dir, build);
      if (fs.existsSync(bd)) {
        fs.rmSync(bd, { recursive: true, force: true });
        const label = path.relative(cwd, bd) || build;
        log.success(`Removed ${label}`);
        removed++;
      }
    }
  }

  // 6. Remove .boot runtime data
  const bootDir = path.join(cwd, ".boot");
  if (fs.existsSync(bootDir)) {
    fs.rmSync(bootDir, { recursive: true, force: true });
    log.success("Removed .boot/");
    removed++;
  }

  log.blank();
  if (removed === 0) {
    log.step("Nothing to clean");
  } else {
    log.success(`Cleaned ${removed} items`);
    log.step("Run 'boot setup' or 'boot up' to reinstall and start fresh.");
  }
  log.blank();
}

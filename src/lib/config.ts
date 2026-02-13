import * as fs from "fs";
import * as path from "path";
import * as yaml from "yaml";
import { BootConfig } from "../types";

const CONFIG_FILES = ["boot.yaml", "boot.yml", "boot.json"];

/**
 * Find the boot config file in a directory.
 */
export function findConfig(dir: string = process.cwd()): string | null {
  for (const file of CONFIG_FILES) {
    const p = path.join(dir, file);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * Load and parse the boot config.
 */
export function loadConfig(dir: string = process.cwd()): BootConfig {
  const configPath = findConfig(dir);
  if (!configPath) {
    throw new Error("No boot.yaml found. Run `boot init` to create one.");
  }

  const raw = fs.readFileSync(configPath, "utf-8");

  let config: BootConfig;
  if (configPath.endsWith(".json")) {
    config = JSON.parse(raw);
  } else {
    config = yaml.parse(raw);
  }

  if (!config.name) {
    config.name = path.basename(dir);
  }

  return config;
}

/**
 * Detect the package manager from lockfiles.
 */
export function detectPackageManager(
  dir: string = process.cwd()
): "pnpm" | "npm" | "yarn" {
  if (
    fs.existsSync(path.join(dir, "pnpm-lock.yaml")) ||
    fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))
  ) {
    return "pnpm";
  }
  if (fs.existsSync(path.join(dir, "yarn.lock"))) {
    return "yarn";
  }
  return "npm";
}

/**
 * Get the resolved package manager for a config (or detect from lockfiles).
 */
export function getPackageManager(config?: BootConfig): string {
  return config?.packageManager || detectPackageManager();
}

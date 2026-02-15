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

  // Guard against empty files (yaml.parse returns null) or primitive values
  if (!config || typeof config !== "object") {
    config = {} as BootConfig;
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

/**
 * Detect Python tooling: uv (preferred) or pip.
 */
export function detectPythonTool(
  dir: string = process.cwd()
): "uv" | "pip" | null {
  const hasUvLock = fs.existsSync(path.join(dir, "uv.lock"));
  const hasPyProject = fs.existsSync(path.join(dir, "pyproject.toml"));
  const hasRequirements = fs.existsSync(path.join(dir, "requirements.txt"));

  if (hasUvLock || hasPyProject) return "uv";
  if (hasRequirements) return "pip";
  return null;
}

export interface PyProjectInfo {
  /** Package name from [project] */
  name: string;
  /** First entry point from [project.scripts], or name if not set */
  scriptName: string;
}

/**
 * Parse pyproject.toml for project name and main script (minimal TOML parsing).
 */
export function getPyProjectInfo(
  dir: string = process.cwd()
): PyProjectInfo | null {
  const pyPath = path.join(dir, "pyproject.toml");
  if (!fs.existsSync(pyPath)) return null;

  const raw = fs.readFileSync(pyPath, "utf-8");
  let name: string | null = null;
  let scriptName: string | null = null;
  let inProject = false;
  let inScripts = false;

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) {
      inProject = trimmed === "[project]";
      inScripts = trimmed === "[project.scripts]";
      if (!inProject && !inScripts) inProject = inScripts = false;
      continue;
    }
    if (inProject && trimmed.startsWith("name")) {
      const match = trimmed.match(/name\s*=\s*["']([^"']+)["']/);
      if (match) name = match[1];
    }
    if (inScripts && trimmed.includes("=")) {
      const keyMatch = trimmed.match(/^([a-zA-Z0-9_-]+)\s*=/);
      if (keyMatch && !scriptName) scriptName = keyMatch[1];
    }
  }

  if (!name) return null;
  return {
    name,
    scriptName: scriptName || name.replace(/-/g, "_").replace(/\./g, "_"),
  };
}

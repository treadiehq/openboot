import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { execSync } from "child_process";
import * as yaml from "yaml";
import { BootConfig, TeamConfig, ReferenceEntry } from "../types";
import { refUrl } from "./references";
import { log } from "./log";

// ────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────

const BOOT_HOME = path.join(require("os").homedir(), ".boot");
const TEAMS_DIR = path.join(BOOT_HOME, "teams");

/** How often to auto-pull (in milliseconds). 10 minutes. */
const PULL_TTL_MS = 10 * 60 * 1000;

/** Config files to look for in the team repo */
const TEAM_CONFIG_FILES = ["boot.yaml", "boot.yml", "boot.json"];

// ────────────────────────────────────────────────
// Cache / Git Operations
// ────────────────────────────────────────────────

/**
 * Derive a stable directory name from a git URL.
 */
function cacheKey(url: string): string {
  return crypto.createHash("sha256").update(url).digest("hex").slice(0, 16);
}

/**
 * Get the local cache directory for a team profile.
 */
export function teamCacheDir(url: string): string {
  return path.join(TEAMS_DIR, cacheKey(url));
}

/**
 * Path to the repo clone inside the cache directory.
 */
function repoDir(url: string): string {
  return path.join(teamCacheDir(url), "repo");
}

/**
 * Path to the metadata file for a cached team profile.
 */
function metaPath(url: string): string {
  return path.join(teamCacheDir(url), "meta.json");
}

interface CacheMeta {
  url: string;
  branch: string;
  lastPull: number; // epoch ms
}

function readMeta(url: string): CacheMeta | null {
  const p = metaPath(url);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

function writeMeta(url: string, branch: string): void {
  const dir = teamCacheDir(url);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const meta: CacheMeta = { url, branch, lastPull: Date.now() };
  fs.writeFileSync(metaPath(url), JSON.stringify(meta, null, 2));
}

/**
 * Ensure git is available.
 */
function ensureGit(): void {
  try {
    execSync("git --version", { stdio: "pipe" });
  } catch {
    throw new Error(
      "git is not installed. Team profiles require git to clone the shared config repo."
    );
  }
}

/**
 * Clone the team profile repo (first time).
 */
function cloneRepo(url: string, branch: string): void {
  const dir = repoDir(url);
  const parent = teamCacheDir(url);

  if (!fs.existsSync(parent)) {
    fs.mkdirSync(parent, { recursive: true });
  }

  log.info(`Cloning team profile from ${url}...`);
  try {
    execSync(
      `git clone --depth 1 --branch ${branch} ${url} ${dir}`,
      { stdio: "pipe" }
    );
  } catch (err: any) {
    const stderr = err.stderr?.toString() || "";
    // Try without --branch in case the branch doesn't exist (defaults to HEAD)
    if (stderr.includes("not found") || stderr.includes("Could not find")) {
      try {
        execSync(`git clone --depth 1 ${url} ${dir}`, { stdio: "pipe" });
      } catch (err2: any) {
        const msg = err2.stderr?.toString() || err2.message;
        throw new Error(
          `Failed to clone team profile.\n\n` +
            `  URL: ${url}\n` +
            `  Error: ${msg.trim()}\n\n` +
            `  Check that:\n` +
            `  - The URL is correct\n` +
            `  - You have access (SSH keys or HTTPS credentials)\n` +
            `  - The repo exists`
        );
      }
    } else {
      throw new Error(
        `Failed to clone team profile.\n\n` +
          `  URL: ${url}\n` +
          `  Error: ${stderr.trim()}\n\n` +
          `  Check that:\n` +
          `  - The URL is correct\n` +
          `  - You have access (SSH keys or HTTPS credentials)\n` +
          `  - The repo exists`
      );
    }
  }
  writeMeta(url, branch);
}

/**
 * Pull latest changes (if TTL expired or forced).
 */
function pullRepo(url: string, branch: string, force: boolean = false): void {
  const dir = repoDir(url);

  if (!force) {
    const meta = readMeta(url);
    if (meta && Date.now() - meta.lastPull < PULL_TTL_MS) {
      return; // Cache is fresh
    }
  }

  log.info("Syncing team profile...");
  try {
    execSync(`git -C ${dir} fetch --depth 1 origin ${branch}`, {
      stdio: "pipe",
    });
    execSync(`git -C ${dir} reset --hard origin/${branch}`, {
      stdio: "pipe",
    });
  } catch {
    // Fetch failed (offline, auth, etc.) — use cached version
    if (force) {
      log.warn("Failed to sync team profile — check your network and credentials");
    }
    // If not force, silently use cached version
    return;
  }
  writeMeta(url, branch);
}

// ────────────────────────────────────────────────
// Load Team Config
// ────────────────────────────────────────────────

/**
 * Find the team config file in the cached repo.
 */
function findTeamConfig(url: string): string | null {
  const dir = repoDir(url);
  for (const file of TEAM_CONFIG_FILES) {
    const p = path.join(dir, file);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * Load the team's boot.yaml from the cached repo.
 */
export function loadTeamConfig(url: string): BootConfig | null {
  const configPath = findTeamConfig(url);
  if (!configPath) return null;

  const raw = fs.readFileSync(configPath, "utf-8");

  let config: BootConfig;
  if (configPath.endsWith(".json")) {
    config = JSON.parse(raw);
  } else {
    config = yaml.parse(raw);
  }

  if (!config || typeof config !== "object") {
    return null;
  }

  return config;
}

// ────────────────────────────────────────────────
// Resolve (clone/pull + load)
// ────────────────────────────────────────────────

export interface ResolvedTeam {
  /** The parsed team config */
  config: BootConfig;
  /** The team repo URL */
  url: string;
  /** Path to the cached repo */
  cacheDir: string;
}

/**
 * Resolve a team profile: ensure cloned, pull if stale, load config.
 * This is the main entry point — called from loadConfig.
 */
export function resolveTeamProfile(
  team: TeamConfig,
  options: { force?: boolean } = {}
): ResolvedTeam | null {
  ensureGit();

  const url = team.url;
  const branch = team.branch || "main";
  const dir = repoDir(url);

  // Clone if not cached yet
  if (!fs.existsSync(dir)) {
    cloneRepo(url, branch);
  } else {
    pullRepo(url, branch, options.force);
  }

  const config = loadTeamConfig(url);
  if (!config) {
    if (team.required) {
      throw new Error(
        `Team profile repo has no boot.yaml.\n\n` +
          `  URL: ${url}\n` +
          `  Cache: ${dir}\n\n` +
          `  The team profile repo must contain a boot.yaml (or boot.yml / boot.json).`
      );
    }
    log.warn("Team profile repo has no boot.yaml — skipping");
    return null;
  }

  return { config, url, cacheDir: dir };
}

/**
 * Force-sync a team profile (used by `boot team sync`).
 */
export function forceSync(team: TeamConfig): ResolvedTeam | null {
  return resolveTeamProfile(team, { force: true });
}

/**
 * Remove the cached team profile.
 */
export function clearCache(url: string): void {
  const dir = teamCacheDir(url);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ────────────────────────────────────────────────
// Merge Logic
// ────────────────────────────────────────────────

/**
 * Merge team config (base) with project config (overrides).
 *
 * Strategy:
 * - name:                  always project
 * - packageManager:        project if set, else team
 * - env.file:              project if set, else team
 * - env.required:          concatenate + deduplicate
 * - env.reject:            deep merge (both apply, project overrides per-key)
 * - setup:                 team first, then project (concatenate, deduplicate)
 * - docker:                project wins entirely (too project-specific)
 * - apps:                  project wins entirely (too project-specific)
 * - agent.description:     project if set, else team
 * - agent.conventions:     team first, then project (concatenate, deduplicate)
 * - agent.targets:         project if set, else team
 * - team:                  always project (don't inherit nested team refs)
 */
export function mergeConfigs(
  team: BootConfig,
  project: BootConfig
): BootConfig {
  const merged: BootConfig = {
    // name: always project
    name: project.name,

    // packageManager: project if set, else team
    packageManager: project.packageManager || team.packageManager,

    // docker: project wins entirely
    docker: project.docker || undefined,

    // apps: project wins entirely
    apps: project.apps || undefined,

    // team: always project
    team: project.team,
  };

  // ── setup: team first, then project ──
  const teamSetup = team.setup || [];
  const projectSetup = project.setup || [];
  const mergedSetup = dedup([...teamSetup, ...projectSetup]);
  if (mergedSetup.length > 0) {
    merged.setup = mergedSetup;
  }

  // ── env: merge ──
  if (team.env || project.env) {
    const teamEnv = team.env || {};
    const projEnv = project.env || {};

    merged.env = {
      file: projEnv.file || teamEnv.file,
      required: dedup([
        ...(teamEnv.required || []),
        ...(projEnv.required || []),
      ]),
      reject: {
        ...(teamEnv.reject || {}),
        ...(projEnv.reject || {}),
      },
    };

    // Clean up empty fields
    if (merged.env.required!.length === 0) delete merged.env.required;
    if (Object.keys(merged.env.reject!).length === 0) delete merged.env.reject;
    if (!merged.env.file) delete merged.env.file;
  }

  // ── agent: merge ──
  if (team.agent || project.agent) {
    const teamAgent = team.agent || {};
    const projAgent = project.agent || {};

    merged.agent = {
      description: projAgent.description || teamAgent.description,
      conventions: dedup([
        ...(teamAgent.conventions || []),
        ...(projAgent.conventions || []),
      ]),
      targets: projAgent.targets || teamAgent.targets,
      references: dedupRefs([
        ...(teamAgent.references || []),
        ...(projAgent.references || []),
      ]),
    };

    // Clean up
    if (!merged.agent.description) delete merged.agent.description;
    if (merged.agent.conventions!.length === 0) delete merged.agent.conventions;
    if (merged.agent.references!.length === 0) delete merged.agent.references;
    if (!merged.agent.targets) delete merged.agent.targets;
  }

  return merged;
}

/**
 * Deduplicate an array of strings, preserving order.
 */
function dedup(arr: string[]): string[] {
  return [...new Set(arr)];
}

/**
 * Deduplicate references by URL. Project entries override team entries for the same URL.
 */
function dedupRefs(arr: ReferenceEntry[]): ReferenceEntry[] {
  const seen = new Set<string>();
  const result: ReferenceEntry[] = [];
  // Iterate in reverse so later entries (project) win over earlier (team)
  for (let i = arr.length - 1; i >= 0; i--) {
    const url = refUrl(arr[i]);
    if (!seen.has(url)) {
      seen.add(url);
      result.unshift(arr[i]);
    }
  }
  return result;
}

// ────────────────────────────────────────────────
// Info / Status
// ────────────────────────────────────────────────

export interface TeamStatus {
  url: string;
  branch: string;
  cached: boolean;
  lastPull: Date | null;
  hasConfig: boolean;
}

/**
 * Get status info for a team profile.
 */
export function getTeamStatus(team: TeamConfig): TeamStatus {
  const url = team.url;
  const branch = team.branch || "main";
  const dir = repoDir(url);
  const cached = fs.existsSync(dir);
  const meta = readMeta(url);
  const hasConfig = cached && findTeamConfig(url) !== null;

  return {
    url,
    branch,
    cached,
    lastPull: meta ? new Date(meta.lastPull) : null,
    hasConfig,
  };
}

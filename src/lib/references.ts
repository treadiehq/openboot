import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { execSync } from "child_process";
import { log } from "./log";

// ────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────

const BOOT_HOME = path.join(require("os").homedir(), ".boot");
const REFS_DIR = path.join(BOOT_HOME, "references");

/** How often to auto-pull (in milliseconds). 10 minutes. */
const PULL_TTL_MS = 10 * 60 * 1000;

/** README filenames to look for (in priority order) */
const README_NAMES = [
  "README.md",
  "readme.md",
  "Readme.md",
  "README.rst",
  "README.txt",
  "README",
];

/** Max README size to include (characters). Keeps agent context reasonable. */
const MAX_README_SIZE = 15_000;

// ────────────────────────────────────────────────
// Cache / Git Operations
// ────────────────────────────────────────────────

function cacheKey(url: string): string {
  return crypto.createHash("sha256").update(url).digest("hex").slice(0, 16);
}

function refCacheDir(url: string): string {
  return path.join(REFS_DIR, cacheKey(url));
}

function repoDir(url: string): string {
  return path.join(refCacheDir(url), "repo");
}

function metaPath(url: string): string {
  return path.join(refCacheDir(url), "meta.json");
}

interface CacheMeta {
  url: string;
  lastPull: number;
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

function writeMeta(url: string): void {
  const dir = refCacheDir(url);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const meta: CacheMeta = { url, lastPull: Date.now() };
  fs.writeFileSync(metaPath(url), JSON.stringify(meta, null, 2));
}

function ensureGit(): void {
  try {
    execSync("git --version", { stdio: "pipe" });
  } catch {
    throw new Error(
      "git is not installed. References require git to clone repos."
    );
  }
}

function cloneRef(url: string): void {
  const dir = repoDir(url);
  const parent = refCacheDir(url);

  if (!fs.existsSync(parent)) {
    fs.mkdirSync(parent, { recursive: true });
  }

  try {
    execSync(`git clone --depth 1 ${url} ${dir}`, { stdio: "pipe" });
  } catch (err: any) {
    const stderr = err.stderr?.toString() || err.message;
    log.warn(`Failed to clone reference ${url}: ${stderr.trim()}`);
    return;
  }
  writeMeta(url);
}

function pullRef(url: string, force: boolean = false): void {
  const dir = repoDir(url);

  if (!force) {
    const meta = readMeta(url);
    if (meta && Date.now() - meta.lastPull < PULL_TTL_MS) {
      return; // Cache is fresh
    }
  }

  try {
    execSync(`git -C ${dir} fetch --depth 1 origin`, { stdio: "pipe" });
    execSync(`git -C ${dir} reset --hard origin/HEAD`, { stdio: "pipe" });
  } catch {
    // Silently use cached version
    return;
  }
  writeMeta(url);
}

// ────────────────────────────────────────────────
// Resolve + Extract
// ────────────────────────────────────────────────

/**
 * Derive a human-readable name from a git URL.
 * e.g. "git@github.com:Effect-TS/effect.git" → "Effect-TS/effect"
 * e.g. "https://github.com/drizzle-team/drizzle-orm.git" → "drizzle-team/drizzle-orm"
 */
export function repoNameFromUrl(url: string): string {
  // SSH: git@github.com:Org/Repo.git
  const sshMatch = url.match(/:([^/]+\/[^/]+?)(?:\.git)?$/);
  if (sshMatch) return sshMatch[1];

  // HTTPS: https://github.com/Org/Repo.git
  const httpsMatch = url.match(/\/([^/]+\/[^/]+?)(?:\.git)?$/);
  if (httpsMatch) return httpsMatch[1];

  // Fallback: last path segment
  return path.basename(url, ".git");
}

/**
 * Ensure a reference repo is cloned and up to date. Returns the repo path.
 */
export function resolveReference(url: string): string | null {
  ensureGit();

  const dir = repoDir(url);

  if (!fs.existsSync(dir)) {
    cloneRef(url);
  } else {
    pullRef(url);
  }

  if (!fs.existsSync(dir)) return null;
  return dir;
}

/**
 * Extract the README content from a cached reference repo.
 * Returns null if no README found.
 */
export function extractReadme(url: string): string | null {
  const dir = repoDir(url);
  if (!fs.existsSync(dir)) return null;

  for (const name of README_NAMES) {
    const readmePath = path.join(dir, name);
    if (fs.existsSync(readmePath) && fs.statSync(readmePath).isFile()) {
      try {
        let content = fs.readFileSync(readmePath, "utf-8").trim();
        if (content.length > MAX_README_SIZE) {
          content =
            content.slice(0, MAX_README_SIZE) +
            "\n\n<!-- Truncated — full content at " + url + " -->";
        }
        return content;
      } catch {
        return null;
      }
    }
  }

  return null;
}

/**
 * Get a brief summary of the repo structure (top-level files/dirs).
 */
export function extractStructure(url: string): string[] | null {
  const dir = repoDir(url);
  if (!fs.existsSync(dir)) return null;

  try {
    const entries = fs.readdirSync(dir).filter((e) => !e.startsWith("."));
    return entries.sort();
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────

export interface ResolvedReference {
  url: string;
  name: string;
  readme: string | null;
  structure: string[] | null;
}

/**
 * Resolve all references: clone/pull each, extract content.
 */
export function resolveAllReferences(urls: string[]): ResolvedReference[] {
  const results: ResolvedReference[] = [];

  for (const url of urls) {
    const dir = resolveReference(url);
    if (!dir) continue;

    results.push({
      url,
      name: repoNameFromUrl(url),
      readme: extractReadme(url),
      structure: extractStructure(url),
    });
  }

  return results;
}

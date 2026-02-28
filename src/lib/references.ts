import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { execSync, spawnSync } from "child_process";
import { log } from "./log";
import { ReferenceEntry, ReferenceConfig } from "../types";

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

/** Max size per file to include (characters). */
const MAX_FILE_SIZE = 15_000;

/** Max total size across all files in a single reference (characters). */
const MAX_TOTAL_SIZE = 50_000;

// ────────────────────────────────────────────────
// Normalize
// ────────────────────────────────────────────────

/** Normalize a ReferenceEntry to a ReferenceConfig. */
export function normalizeRef(entry: ReferenceEntry): ReferenceConfig {
  if (typeof entry === "string") {
    return { url: entry };
  }
  return entry;
}

/** Get the URL from any reference entry. */
export function refUrl(entry: ReferenceEntry): string {
  return typeof entry === "string" ? entry : entry.url;
}

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

  const result = spawnSync(
    "git",
    ["clone", "--depth", "1", url, dir],
    { stdio: "pipe" }
  );
  if (result.status !== 0) {
    const stderr = result.stderr?.toString() || "Clone failed";
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
      return;
    }
  }

  const fetchResult = spawnSync(
    "git",
    ["-C", dir, "fetch", "--depth", "1", "origin"],
    { stdio: "pipe" }
  );
  if (fetchResult.status !== 0) return;

  const resetResult = spawnSync(
    "git",
    ["-C", dir, "reset", "--hard", "origin/HEAD"],
    { stdio: "pipe" }
  );
  if (resetResult.status !== 0) return;
  writeMeta(url);
}

// ────────────────────────────────────────────────
// Name / Resolve
// ────────────────────────────────────────────────

/**
 * Derive a human-readable name from a git URL.
 */
export function repoNameFromUrl(url: string): string {
  const sshMatch = url.match(/:([^/]+\/[^/]+?)(?:\.git)?$/);
  if (sshMatch) return sshMatch[1];

  const httpsMatch = url.match(/\/([^/]+\/[^/]+?)(?:\.git)?$/);
  if (httpsMatch) return httpsMatch[1];

  return path.basename(url, ".git");
}

/**
 * Ensure a reference repo is cloned and up to date.
 */
function resolveReference(url: string): string | null {
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

// ────────────────────────────────────────────────
// Content Extraction
// ────────────────────────────────────────────────

/** A single file extracted from a reference repo. */
export interface ExtractedFile {
  /** Path relative to the repo root */
  path: string;
  /** File content (possibly truncated) */
  content: string;
}

/**
 * Extract the README from a repo.
 */
function extractReadme(dir: string, url: string): ExtractedFile | null {
  for (const name of README_NAMES) {
    const readmePath = path.join(dir, name);
    if (fs.existsSync(readmePath) && fs.statSync(readmePath).isFile()) {
      try {
        let content = fs.readFileSync(readmePath, "utf-8").trim();
        if (content.length > MAX_FILE_SIZE) {
          content =
            content.slice(0, MAX_FILE_SIZE) +
            "\n\n<!-- Truncated — full content at " + url + " -->";
        }
        return { path: name, content };
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * Check if a path looks like a text file we should include.
 */
function isTextFile(filePath: string): boolean {
  const textExtensions = [
    ".md", ".txt", ".rst", ".ts", ".tsx", ".js", ".jsx",
    ".py", ".go", ".rs", ".java", ".kt", ".swift", ".rb",
    ".yaml", ".yml", ".toml", ".json", ".cfg", ".ini",
    ".css", ".scss", ".html", ".xml", ".svg",
    ".sh", ".bash", ".zsh", ".fish",
    ".sql", ".graphql", ".gql", ".prisma",
    ".d.ts", ".mts", ".cts", ".mjs", ".cjs",
  ];
  const ext = path.extname(filePath).toLowerCase();
  const base = path.basename(filePath).toLowerCase();

  // Known text files without extensions
  if (["makefile", "dockerfile", "readme", "license", "changelog"].includes(base)) {
    return true;
  }

  return textExtensions.includes(ext);
}

/**
 * Collect files matching an include path.
 * - If it is a file, include it directly.
 * - If it is a directory, include all text files recursively.
 */
function collectFiles(
  dir: string,
  includePath: string,
  maxTotal: number
): ExtractedFile[] {
  const results: ExtractedFile[] = [];
  let totalSize = 0;

  const fullPath = path.join(dir, includePath);

  // Direct file
  if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
    const file = readFileContent(dir, includePath);
    if (file) results.push(file);
    return results;
  }

  // Directory — walk recursively
  if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
    const walkDir = (dirPath: string, relBase: string) => {
      if (totalSize >= maxTotal) return;

      let entries: string[];
      try {
        entries = fs.readdirSync(dirPath);
      } catch {
        return;
      }

      for (const entry of entries.sort()) {
        if (entry.startsWith(".")) continue;
        if (entry === "node_modules") continue;

        const entryPath = path.join(dirPath, entry);
        const relPath = path.join(relBase, entry);

        try {
          const stat = fs.statSync(entryPath);
          if (stat.isDirectory()) {
            walkDir(entryPath, relPath);
          } else if (stat.isFile() && isTextFile(entry)) {
            if (totalSize >= maxTotal) return;
            const file = readFileContent(dir, relPath);
            if (file) {
              totalSize += file.content.length;
              results.push(file);
            }
          }
        } catch {
          continue;
        }
      }
    };

    walkDir(fullPath, includePath);
    return results;
  }

  // Simple glob: *.ext or **/*.ext at the include path level
  // For now, if the path doesn't exist as a file or dir, skip it
  return results;
}

/**
 * Read a single file from the repo, with size cap.
 */
function readFileContent(repoRoot: string, relPath: string): ExtractedFile | null {
  const fullPath = path.join(repoRoot, relPath);
  if (!fs.existsSync(fullPath)) return null;

  try {
    const stat = fs.statSync(fullPath);
    if (!stat.isFile()) return null;

    // Skip binary / huge files
    if (stat.size > 500_000) return null;

    let content = fs.readFileSync(fullPath, "utf-8").trim();
    if (content.length > MAX_FILE_SIZE) {
      content = content.slice(0, MAX_FILE_SIZE) + "\n\n<!-- Truncated -->";
    }
    return { path: relPath, content };
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
  files: ExtractedFile[];
}

/**
 * Resolve all references: clone/pull each, extract content based on include paths.
 *
 * - No `include`: falls back to README
 * - With `include`: reads specified files/directories
 */
export function resolveAllReferences(entries: ReferenceEntry[]): ResolvedReference[] {
  const results: ResolvedReference[] = [];

  for (const entry of entries) {
    const ref = normalizeRef(entry);
    const dir = resolveReference(ref.url);
    if (!dir) continue;

    let files: ExtractedFile[] = [];

    if (ref.include && ref.include.length > 0) {
      // User specified what to include
      for (const inc of ref.include) {
        const collected = collectFiles(dir, inc, MAX_TOTAL_SIZE);
        files.push(...collected);
      }
    } else {
      // Default: just the README
      const readme = extractReadme(dir, ref.url);
      if (readme) files.push(readme);
    }

    results.push({
      url: ref.url,
      name: repoNameFromUrl(ref.url),
      files,
    });
  }

  return results;
}

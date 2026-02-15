import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as yaml from "yaml";
import { BootConfig, AgentConfig } from "../types";
import { detectPackageManager, findConfig, loadConfig, getTeamConfigSeparately } from "./config";

// ────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────

/** Global boot home directory */
export const BOOT_HOME = path.join(os.homedir(), ".boot");
export const AGENT_HOME = path.join(BOOT_HOME, "agent");
export const AGENT_STACK_DIR = path.join(AGENT_HOME, "stack");

/** Known AI agent instruction file paths */
export const KNOWN_AGENT_FILES = [
  ".cursorrules",
  ".cursor/rules",
  "AGENTS.md",
  "CLAUDE.md",
  ".github/copilot-instructions.md",
  ".windsurfrules",
  "soul.md",
  "skills.md",
  "agent.md",
];

/** Default sync targets (most common AI tools) */
export const DEFAULT_TARGETS = [
  ".cursorrules",
  "AGENTS.md",
  "CLAUDE.md",
  ".github/copilot-instructions.md",
];

// ────────────────────────────────────────────────
// Detection
// ────────────────────────────────────────────────

/**
 * Detect existing AI agent instruction files in a project directory.
 */
export function detectAgentFiles(cwd: string): string[] {
  const found: string[] = [];
  for (const file of KNOWN_AGENT_FILES) {
    const fullPath = path.join(cwd, file);
    if (fs.existsSync(fullPath)) {
      if (fs.statSync(fullPath).isDirectory()) {
        // For directories like .cursor/rules, check if they contain .md files
        const hasFiles = fs.readdirSync(fullPath).some((f) => f.endsWith(".md"));
        if (hasFiles) found.push(file);
      } else {
        found.push(file);
      }
    }
  }
  return found;
}

/**
 * Read content of existing agent files. Returns { path, content } for each file that exists and is readable.
 */
export function loadExistingAgentFiles(cwd: string): { path: string; content: string }[] {
  const files = detectAgentFiles(cwd);
  const result: { path: string; content: string }[] = [];
  for (const relPath of files) {
    const fullPath = path.join(cwd, relPath);
    if (!fs.statSync(fullPath).isFile()) continue;
    try {
      const content = fs.readFileSync(fullPath, "utf-8").trim();
      if (content.length > 0) {
        result.push({ path: relPath, content });
      }
    } catch {
      // Skip unreadable files
    }
  }
  return result;
}

/**
 * Detect the technology stack from the project.
 * Scans root and sub-app package.json files, plus language-specific config files.
 */
export function detectStack(cwd: string): string[] {
  const stack: string[] = [];
  const allDeps: Record<string, string> = {};

  // Collect deps from root package.json
  const rootPkg = readPackageJson(cwd);
  if (rootPkg) {
    Object.assign(allDeps, rootPkg.dependencies, rootPkg.devDependencies);
  }

  // Collect deps from monorepo sub-apps
  const appsDir = path.join(cwd, "apps");
  if (fs.existsSync(appsDir) && fs.statSync(appsDir).isDirectory()) {
    for (const dir of fs.readdirSync(appsDir)) {
      const subPkg = readPackageJson(path.join(appsDir, dir));
      if (subPkg) {
        Object.assign(allDeps, subPkg.dependencies, subPkg.devDependencies);
      }
    }
  }

  // Also check common sub-directories
  for (const sub of [
    "frontend",
    "backend",
    "server",
    "client",
    "web",
    "api",
    "dashboard",
  ]) {
    const subPkg = readPackageJson(path.join(cwd, sub));
    if (subPkg) {
      Object.assign(allDeps, subPkg.dependencies, subPkg.devDependencies);
    }
  }

  // Frameworks
  if (allDeps["next"]) stack.push("nextjs");
  if (allDeps["nuxt"] || allDeps["nuxt3"]) stack.push("nuxt");
  if (allDeps["react"] && !allDeps["next"]) stack.push("react");
  if (allDeps["vue"] && !allDeps["nuxt"]) stack.push("vue");
  if (allDeps["svelte"] || allDeps["@sveltejs/kit"]) stack.push("svelte");
  if (allDeps["solid-js"]) stack.push("solid");
  if (allDeps["express"]) stack.push("express");
  if (allDeps["fastify"]) stack.push("fastify");
  if (allDeps["hono"]) stack.push("hono");
  if (allDeps["@nestjs/core"]) stack.push("nestjs");
  if (allDeps["elysia"]) stack.push("elysia");

  // ORMs / DB
  if (allDeps["prisma"] || allDeps["@prisma/client"]) stack.push("prisma");
  if (allDeps["drizzle-orm"]) stack.push("drizzle");
  if (allDeps["typeorm"]) stack.push("typeorm");
  if (allDeps["mongoose"]) stack.push("mongoose");
  if (allDeps["@supabase/supabase-js"]) stack.push("supabase");

  // API
  if (allDeps["@trpc/server"]) stack.push("trpc");
  if (allDeps["graphql"]) stack.push("graphql");

  // Validation
  if (allDeps["zod"]) stack.push("zod");

  // Testing
  if (allDeps["vitest"]) stack.push("vitest");
  if (allDeps["jest"]) stack.push("jest");
  if (allDeps["playwright"] || allDeps["@playwright/test"])
    stack.push("playwright");
  if (allDeps["cypress"]) stack.push("cypress");

  // Languages / Type systems
  if (allDeps["typescript"]) stack.push("typescript");

  // CSS / UI
  if (allDeps["tailwindcss"]) stack.push("tailwindcss");

  // Monorepo
  if (allDeps["turbo"] || allDeps["turborepo"]) stack.push("turborepo");
  if (fs.existsSync(path.join(cwd, "nx.json"))) stack.push("nx");

  // Non-JS languages
  if (
    fs.existsSync(path.join(cwd, "requirements.txt")) ||
    fs.existsSync(path.join(cwd, "pyproject.toml")) ||
    fs.existsSync(path.join(cwd, "Pipfile"))
  ) {
    stack.push("python");
  }
  if (fs.existsSync(path.join(cwd, "go.mod"))) stack.push("go");
  if (fs.existsSync(path.join(cwd, "Cargo.toml"))) stack.push("rust");

  return stack;
}

// ────────────────────────────────────────────────
// Global Store (~/.boot/agent/)
// ────────────────────────────────────────────────

/**
 * Ensure the global agent directory structure exists.
 */
export function ensureGlobalDir(): void {
  for (const dir of [BOOT_HOME, AGENT_HOME, AGENT_STACK_DIR]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

/**
 * Load personal conventions from ~/.boot/agent/conventions.md
 */
export function loadGlobalConventions(): string[] {
  return loadBulletList(path.join(AGENT_HOME, "conventions.md"));
}

/**
 * Load global memory from ~/.boot/agent/memory.md
 */
export function loadGlobalMemory(): string[] {
  return loadBulletList(path.join(AGENT_HOME, "memory.md"));
}

/**
 * Load stack-specific conventions for a given technology.
 */
export function loadStackConventions(stackName: string): string[] {
  return loadBulletList(path.join(AGENT_STACK_DIR, `${stackName}.md`));
}

/**
 * Save personal conventions to the global store.
 * Merges with any existing conventions (deduplicates).
 */
export function saveGlobalConventions(conventions: string[]): void {
  ensureGlobalDir();
  const existing = loadGlobalConventions();
  const merged = [...new Set([...existing, ...conventions])];

  const content =
    "# Conventions\n\nPersonal coding conventions applied to all projects.\n\n" +
    merged.map((c) => `- ${c}`).join("\n") +
    "\n";
  fs.writeFileSync(path.join(AGENT_HOME, "conventions.md"), content);
}

/**
 * Add a single memory entry to the global store.
 */
export function addMemory(entry: string): void {
  ensureGlobalDir();
  const file = path.join(AGENT_HOME, "memory.md");

  let content = "";
  if (fs.existsSync(file)) {
    content = fs.readFileSync(file, "utf-8");
  }

  if (!content.includes("# Memory")) {
    content =
      "# Memory\n\nConventions and patterns remembered across projects.\n\n";
  }

  content = content.trimEnd() + "\n- " + entry + "\n";
  fs.writeFileSync(file, content);
}

/**
 * Save stack-specific conventions to the global store.
 */
export function saveStackConventions(
  stackName: string,
  conventions: string[]
): void {
  ensureGlobalDir();
  const content =
    `# ${formatStackName(stackName)} Conventions\n\n` +
    conventions.map((c) => `- ${c}`).join("\n") +
    "\n";
  fs.writeFileSync(path.join(AGENT_STACK_DIR, `${stackName}.md`), content);
}

// ────────────────────────────────────────────────
// Markdown Generation
// ────────────────────────────────────────────────

/** Options for markdown generation */
export interface GenerateOptions {
  /** Include global/personal conventions (default: true) */
  includeGlobal?: boolean;
  /** Include team conventions as a separate labeled section (default: true) */
  includeTeam?: boolean;
}

/**
 * Generate the canonical agent context markdown.
 * Merges project config, auto-detection, and global conventions into one document.
 */
export function generateAgentMarkdown(
  config: BootConfig,
  cwd: string,
  options: GenerateOptions = {}
): string {
  const includeGlobal = options.includeGlobal !== false;
  const stack = detectStack(cwd);
  const pm = config.packageManager || detectPackageManager(cwd);
  const lines: string[] = [];

  // ── Auto-generated header ──
  lines.push(
    "<!-- Generated by `boot agent` — do not edit directly. -->"
  );
  lines.push(
    "<!-- Update boot.yaml and run `boot agent sync` to regenerate. -->"
  );
  lines.push("");

  // ── Existing project rules (from .cursorrules, AGENTS.md, etc.) ──
  const existingFiles = loadExistingAgentFiles(cwd);
  if (existingFiles.length > 0) {
    lines.push("## Existing project rules");
    lines.push("");
    for (const { path: relPath, content } of existingFiles) {
      lines.push(`### From \`${relPath}\``);
      lines.push("");
      lines.push(content);
      lines.push("");
    }
  }

  // ── Project name ──
  lines.push(`# ${config.name}`);
  lines.push("");

  if (config.agent?.description) {
    lines.push(config.agent.description);
    lines.push("");
  }

  // ── Stack ──
  if (stack.length > 0) {
    lines.push("## Stack");
    lines.push("");
    lines.push(`- **Package manager**: ${pm}`);
    for (const s of stack) {
      if (s !== pm) {
        lines.push(`- ${formatStackName(s)}`);
      }
    }
    lines.push("");
  }

  // ── Project structure ──
  if (config.apps && config.apps.length > 0) {
    lines.push("## Project Structure");
    lines.push("");
    for (const app of config.apps) {
      const parts: string[] = [`**${app.name}**`];
      if (app.path) parts.push(`\`${app.path}\``);
      if (app.port) parts.push(`port ${app.port}`);
      lines.push(`- ${parts.join(" — ")}`);
    }
    lines.push("");
  }

  // ── Docker services ──
  if (config.docker) {
    const services = [
      ...(config.docker.services || []).map((s) => s.name),
      ...(config.docker.containers || []).map((c) => c.name),
    ];
    if (services.length > 0) {
      lines.push("## Services");
      lines.push("");
      for (const name of services) {
        lines.push(`- **${name}**`);
      }
      lines.push("");
    }
  }

  // ── Commands ──
  lines.push("## Commands");
  lines.push("");
  lines.push("```bash");
  lines.push(
    "boot setup    # one-time: install deps, start DB, run migrations"
  );
  lines.push(
    "boot dev      # start all services with live logs (Ctrl+C stops all)"
  );
  lines.push("boot up       # start all services in background");
  lines.push("boot down     # stop all services");
  lines.push("boot status   # show what's running");
  lines.push("boot logs     # view service logs");
  lines.push("```");
  lines.push("");

  // ── Environment ──
  if (config.env?.required && config.env.required.length > 0) {
    lines.push("## Environment");
    lines.push("");
    lines.push(`Environment file: \`${config.env.file || ".env"}\``);
    lines.push("");
    lines.push("Required variables:");
    for (const v of config.env.required) {
      lines.push(`- \`${v}\``);
    }
    lines.push("");
  }

  // ── Team conventions (from team profile, labeled separately) ──
  const includeTeam = options.includeTeam !== false;
  if (includeTeam) {
    const teamConfig = getTeamConfigSeparately(cwd);
    if (teamConfig?.agent?.conventions && teamConfig.agent.conventions.length > 0) {
      lines.push("## Team Conventions");
      lines.push("");
      for (const c of teamConfig.agent.conventions) {
        lines.push(`- ${c}`);
      }
      lines.push("");
    }
  }

  // ── Project conventions (from boot.yaml) ──
  // When a team profile is active, the merged config includes both team + project
  // conventions. Filter out team conventions so they aren't duplicated.
  if (config.agent?.conventions && config.agent.conventions.length > 0) {
    let projectConventions = config.agent.conventions;

    if (includeTeam) {
      const teamConfig = getTeamConfigSeparately(cwd);
      if (teamConfig?.agent?.conventions) {
        const teamSet = new Set(teamConfig.agent.conventions);
        projectConventions = projectConventions.filter((c) => !teamSet.has(c));
      }
    }

    if (projectConventions.length > 0) {
      lines.push("## Conventions");
      lines.push("");
      for (const c of projectConventions) {
        lines.push(`- ${c}`);
      }
      lines.push("");
    }
  }

  // ── Global sections ──
  if (includeGlobal) {
    // Personal conventions
    const globalConv = loadGlobalConventions();
    if (globalConv.length > 0) {
      lines.push("## Personal Conventions");
      lines.push("");
      for (const c of globalConv) {
        lines.push(`- ${c}`);
      }
      lines.push("");
    }

    // Stack-specific conventions from global store
    const allStackConvs: string[] = [];
    for (const s of stack) {
      const convs = loadStackConventions(s);
      allStackConvs.push(...convs);
    }
    if (allStackConvs.length > 0) {
      lines.push("## Stack Conventions");
      lines.push("");
      for (const c of allStackConvs) {
        lines.push(`- ${c}`);
      }
      lines.push("");
    }

    // Remembered patterns
    const memory = loadGlobalMemory();
    if (memory.length > 0) {
      lines.push("## Remembered Patterns");
      lines.push("");
      for (const m of memory) {
        lines.push(`- ${m}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n").trimEnd() + "\n";
}

// ────────────────────────────────────────────────
// Sync & Check
// ────────────────────────────────────────────────

export interface SyncTargetsResult {
  written: string[];
  skipped: string[];
}

/**
 * Write the agent markdown to all configured target files.
 * Creates parent directories as needed.
 * When overwrite is false (default), skips any target that already exists so existing project rules are preserved.
 */
export function syncTargets(
  config: BootConfig,
  markdown: string,
  cwd: string,
  options: { overwrite?: boolean } = {}
): SyncTargetsResult {
  const overwrite = options.overwrite === true;
  const targets = config.agent?.targets || DEFAULT_TARGETS;
  const written: string[] = [];
  const skipped: string[] = [];

  for (const target of targets) {
    const fullPath = path.join(cwd, target);

    if (fs.existsSync(fullPath) && !overwrite) {
      skipped.push(target);
      continue;
    }

    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(fullPath, markdown);
    written.push(target);
  }

  return { written, skipped };
}

/**
 * Check if target files are in sync with the current config.
 */
export function checkSync(
  config: BootConfig,
  cwd: string
): { missing: string[]; stale: string[]; ok: string[] } {
  const targets = config.agent?.targets || DEFAULT_TARGETS;
  const canonical = generateAgentMarkdown(config, cwd);
  const result = {
    missing: [] as string[],
    stale: [] as string[],
    ok: [] as string[],
  };

  for (const target of targets) {
    const fullPath = path.join(cwd, target);
    if (!fs.existsSync(fullPath)) {
      result.missing.push(target);
    } else {
      const existing = fs.readFileSync(fullPath, "utf-8");
      if (existing.trim() === canonical.trim()) {
        result.ok.push(target);
      } else {
        result.stale.push(target);
      }
    }
  }

  return result;
}

// ────────────────────────────────────────────────
// Config Helpers
// ────────────────────────────────────────────────

/**
 * Get the BootConfig if boot.yaml exists, or create a minimal one from auto-detection.
 * Allows `boot agent` commands to work even without boot.yaml.
 */
export function getOrDetectConfig(cwd: string): BootConfig {
  const configPath = findConfig(cwd);
  if (configPath) {
    return loadConfig(cwd);
  }

  return {
    name: path.basename(cwd),
    packageManager: detectPackageManager(cwd),
  };
}

/**
 * Add the agent section to an existing config file.
 * Handles both YAML and JSON formats, preserving existing content.
 */
export function addAgentSection(
  configPath: string,
  agentConfig: AgentConfig
): void {
  const content = fs.readFileSync(configPath, "utf-8");

  if (configPath.endsWith(".json")) {
    // JSON: parse, merge, and write back as formatted JSON
    const json = JSON.parse(content);
    if (json.agent) return;
    json.agent = agentConfig;
    fs.writeFileSync(configPath, JSON.stringify(json, null, 2) + "\n");
    return;
  }

  // YAML: append section at the end
  if (/^agent:/m.test(content)) return;

  const section = yaml.stringify(
    { agent: agentConfig },
    { indent: 2, lineWidth: 0 }
  );
  const newContent = content.trimEnd() + "\n\n" + section;
  fs.writeFileSync(configPath, newContent);
}

/**
 * Import conventions from another project.
 * Reads boot.yaml agent.conventions and/or parses existing agent files.
 */
export function importFromProject(sourcePath: string): string[] {
  const conventions: string[] = [];

  // Try boot.yaml first
  const bootYamlPath = path.join(sourcePath, "boot.yaml");
  if (fs.existsSync(bootYamlPath)) {
    try {
      const config = yaml.parse(
        fs.readFileSync(bootYamlPath, "utf-8")
      ) as BootConfig;
      if (config.agent?.conventions) {
        conventions.push(...config.agent.conventions);
      }
    } catch {
      // Ignore parse errors
    }
  }

  // Try known agent files — extract bullet points as conventions
  for (const file of KNOWN_AGENT_FILES) {
    const fullPath = path.join(sourcePath, file);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      const bullets = loadBulletList(fullPath);
      conventions.push(...bullets);
    }
  }

  // Deduplicate
  return [...new Set(conventions)];
}

// ────────────────────────────────────────────────
// Private Helpers
// ────────────────────────────────────────────────

/** Read a package.json from a directory, or null if not found. */
function readPackageJson(dir: string): any | null {
  const pkgPath = path.join(dir, "package.json");
  if (!fs.existsSync(pkgPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Extract bullet list items (lines starting with - or *) from a markdown file.
 */
function loadBulletList(filePath: string): string[] {
  if (!fs.existsSync(filePath)) return [];
  try {
    const content = fs.readFileSync(filePath, "utf-8").trim();
    if (!content) return [];
    return content
      .split("\n")
      .filter((line) => /^\s*[-*]\s/.test(line))
      .map((line) => line.replace(/^\s*[-*]\s+/, "").trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Map stack identifiers to human-readable names. */
const STACK_NAMES: Record<string, string> = {
  pnpm: "pnpm",
  npm: "npm",
  yarn: "Yarn",
  nextjs: "Next.js",
  nuxt: "Nuxt",
  react: "React",
  vue: "Vue",
  svelte: "SvelteKit",
  solid: "SolidJS",
  express: "Express",
  fastify: "Fastify",
  hono: "Hono",
  nestjs: "NestJS",
  elysia: "Elysia",
  prisma: "Prisma",
  drizzle: "Drizzle ORM",
  typeorm: "TypeORM",
  mongoose: "Mongoose",
  supabase: "Supabase",
  trpc: "tRPC",
  graphql: "GraphQL",
  zod: "Zod",
  vitest: "Vitest",
  jest: "Jest",
  playwright: "Playwright",
  cypress: "Cypress",
  typescript: "TypeScript",
  tailwindcss: "Tailwind CSS",
  turborepo: "Turborepo",
  nx: "Nx",
  python: "Python",
  go: "Go",
  rust: "Rust",
};

export function formatStackName(id: string): string {
  return STACK_NAMES[id] || id;
}

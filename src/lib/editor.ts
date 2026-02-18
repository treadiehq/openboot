import * as fs from "fs";
import * as path from "path";
import { BootConfig, EditorTask } from "../types";
import { detectPackageManager } from "./config";

export const DEFAULT_EDITOR_TARGETS = [".vscode", ".zed"];

const KNOWN_TASK_SCRIPTS = [
  "dev",
  "build",
  "test",
  "lint",
  "start",
  "format",
  "typecheck",
  "type-check",
  "check",
];

const SCRIPT_GROUPS: Record<string, "build" | "test"> = {
  dev: "build",
  build: "build",
  start: "build",
  test: "test",
  lint: "test",
  typecheck: "test",
  "type-check": "test",
  check: "test",
};

// ────────────────────────────────────────────────
// Detection
// ────────────────────────────────────────────────

/**
 * Detect editor tasks from package.json scripts and boot.yaml apps.
 */
export function detectEditorTasks(cwd: string, config?: BootConfig): EditorTask[] {
  const tasks: EditorTask[] = [];
  const seen = new Set<string>();
  const pm = config?.packageManager || detectPackageManager(cwd);

  const rootPkg = readPackageJson(cwd);
  if (rootPkg?.scripts) {
    for (const name of KNOWN_TASK_SCRIPTS) {
      if (rootPkg.scripts[name] && !seen.has(name)) {
        seen.add(name);
        tasks.push({
          name,
          command: pmRun(pm, name),
          group: SCRIPT_GROUPS[name],
        });
      }
    }
  }

  if (config?.apps) {
    for (const app of config.apps) {
      const label = `${app.name}:dev`;
      if (!seen.has(label)) {
        seen.add(label);
        tasks.push({
          name: label,
          command: app.command,
          cwd: app.path,
          group: "build",
        });
      }
    }
  }

  return tasks;
}

// ────────────────────────────────────────────────
// Generators
// ────────────────────────────────────────────────

/**
 * Generate VS Code tasks.json content.
 */
export function generateVSCodeTasks(tasks: EditorTask[]): string {
  const vscodeTasks = tasks.map((t) => {
    const task: Record<string, any> = {
      label: t.name,
      type: "shell",
      command: t.command,
    };
    if (t.cwd) {
      task.options = { cwd: `\${workspaceFolder}/${t.cwd}` };
    }
    if (t.group) {
      task.group = t.group;
    }
    task.problemMatcher = [];
    return task;
  });

  const doc = {
    version: "2.0.0",
    tasks: vscodeTasks,
  };

  return JSON.stringify(doc, null, 2) + "\n";
}

/**
 * Generate Zed tasks.json content.
 */
export function generateZedTasks(tasks: EditorTask[]): string {
  const zedTasks = tasks.map((t) => {
    const task: Record<string, any> = {
      label: t.name,
      command: t.command,
    };
    if (t.cwd) {
      task.cwd = t.cwd;
    }
    if (t.group) {
      task.tags = [t.group];
    }
    return task;
  });

  return JSON.stringify(zedTasks, null, 2) + "\n";
}

// ────────────────────────────────────────────────
// Sync & Check
// ────────────────────────────────────────────────

export interface EditorSyncResult {
  written: string[];
  skipped: string[];
}

/**
 * Write editor config to all configured targets.
 */
export function syncEditorTargets(
  config: BootConfig,
  cwd: string,
  options: { overwrite?: boolean } = {}
): EditorSyncResult {
  const overwrite = options.overwrite === true;
  const targets = config.editor?.targets || DEFAULT_EDITOR_TARGETS;
  const tasks = config.editor?.tasks || [];
  const written: string[] = [];
  const skipped: string[] = [];

  if (tasks.length === 0) {
    return { written, skipped };
  }

  for (const target of targets) {
    const file = getEditorTaskFile(target);
    if (!file) continue;

    const fullPath = path.join(cwd, file);

    if (fs.existsSync(fullPath) && !overwrite) {
      skipped.push(file);
      continue;
    }

    const content = generateForTarget(target, tasks);
    if (!content) continue;

    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(fullPath, content);
    written.push(file);
  }

  return { written, skipped };
}

/**
 * Check if editor target files are in sync with the current config.
 */
export function checkEditorSync(
  config: BootConfig,
  cwd: string
): { missing: string[]; stale: string[]; ok: string[] } {
  const targets = config.editor?.targets || DEFAULT_EDITOR_TARGETS;
  const tasks = config.editor?.tasks || [];
  const result = { missing: [] as string[], stale: [] as string[], ok: [] as string[] };

  if (tasks.length === 0) return result;

  for (const target of targets) {
    const file = getEditorTaskFile(target);
    if (!file) continue;

    const fullPath = path.join(cwd, file);
    const expected = generateForTarget(target, tasks);
    if (!expected) continue;

    if (!fs.existsSync(fullPath)) {
      result.missing.push(file);
    } else {
      const existing = fs.readFileSync(fullPath, "utf-8");
      if (existing.trim() === expected.trim()) {
        result.ok.push(file);
      } else {
        result.stale.push(file);
      }
    }
  }

  return result;
}

// ────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────

function getEditorTaskFile(target: string): string | null {
  if (target === ".vscode") return ".vscode/tasks.json";
  if (target === ".zed") return ".zed/tasks.json";
  return null;
}

function generateForTarget(target: string, tasks: EditorTask[]): string | null {
  if (target === ".vscode") return generateVSCodeTasks(tasks);
  if (target === ".zed") return generateZedTasks(tasks);
  return null;
}

function readPackageJson(dir: string): any | null {
  const pkgPath = path.join(dir, "package.json");
  if (!fs.existsSync(pkgPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  } catch {
    return null;
  }
}

function pmRun(pm: string, script: string): string {
  if (pm === "npm") return `npm run ${script}`;
  return `${pm} ${script}`;
}

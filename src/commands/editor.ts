import { Command } from "commander";
import * as path from "path";
import * as yaml from "yaml";
import * as fs from "fs";
import { log } from "../lib/log";
import { findConfig, loadConfig } from "../lib/config";
import { EditorConfig } from "../types";
import {
  detectEditorTasks,
  syncEditorTargets,
  checkEditorSync,
  DEFAULT_EDITOR_TARGETS,
} from "../lib/editor";
import { getOrDetectConfig } from "../lib/agent";

export function registerEditorCommands(program: Command): void {
  const editor = program
    .command("editor")
    .description("Manage editor config sync (.vscode, .zed)");

  // ─────────────────────────────────────────────
  // boot editor init
  // ─────────────────────────────────────────────
  editor
    .command("init")
    .description("Detect tasks and generate editor config files")
    .option("--overwrite", "Overwrite existing editor config files")
    .action(async (opts) => {
      try {
        const cwd = process.cwd();
        log.header("boot editor init");

        const config = getOrDetectConfig(cwd);
        const tasks = config.editor?.tasks || detectEditorTasks(cwd, config);

        if (tasks.length === 0) {
          log.warn("No tasks detected. Add tasks to boot.yaml editor section.");
          return;
        }

        log.info(`Detected ${tasks.length} task(s):`);
        for (const t of tasks) {
          const parts = [t.name, `\`${t.command}\``];
          if (t.cwd) parts.push(`(cwd: ${t.cwd})`);
          log.step(`  - ${parts.join(" — ")}`);
        }

        // Add editor section to config if missing
        const configPath = findConfig(cwd);
        if (configPath && !config.editor) {
          const editorConfig: EditorConfig = {
            tasks,
            targets: DEFAULT_EDITOR_TARGETS,
          };
          addEditorSection(configPath, editorConfig);
          config.editor = editorConfig;
          log.success(`Added editor section to ${path.basename(configPath)}`);
        }

        if (!config.editor) {
          config.editor = { tasks, targets: DEFAULT_EDITOR_TARGETS };
        }

        const { written, skipped } = syncEditorTargets(config, cwd, {
          overwrite: opts.overwrite,
        });

        log.blank();
        for (const file of written) {
          log.success(`Wrote ${file}`);
        }
        if (skipped.length > 0) {
          log.info(`Skipped existing (use --overwrite to replace): ${skipped.join(", ")}`);
        }

        log.blank();
        log.step("Editor config synced to all targets.");
        log.step("Run `boot editor sync` after editing boot.yaml.");
        log.blank();
      } catch (err: any) {
        log.error(err.message);
        process.exit(1);
      }
    });

  // ─────────────────────────────────────────────
  // boot editor sync
  // ─────────────────────────────────────────────
  editor
    .command("sync")
    .description("Regenerate editor config from boot.yaml")
    .option("--overwrite", "Overwrite existing editor config files")
    .action(async (opts) => {
      try {
        const cwd = process.cwd();
        const config = getOrDetectConfig(cwd);

        if (!config.editor?.tasks || config.editor.tasks.length === 0) {
          log.warn("No editor tasks in boot.yaml. Run `boot editor init` first.");
          return;
        }

        const { written, skipped } = syncEditorTargets(config, cwd, {
          overwrite: opts.overwrite,
        });

        for (const file of written) {
          log.success(`Synced ${file}`);
        }
        if (skipped.length > 0) {
          log.info(`Skipped existing (use --overwrite to replace): ${skipped.join(", ")}`);
        }
      } catch (err: any) {
        log.error(err.message);
        process.exit(1);
      }
    });

  // ─────────────────────────────────────────────
  // boot editor check
  // ─────────────────────────────────────────────
  editor
    .command("check")
    .description("Check if editor config files are in sync with boot.yaml")
    .action(async () => {
      try {
        const cwd = process.cwd();
        const config = getOrDetectConfig(cwd);
        const result = checkEditorSync(config, cwd);

        for (const file of result.ok) {
          log.success(`${file} — in sync`);
        }
        for (const file of result.stale) {
          log.warn(`${file} — out of date`);
        }
        for (const file of result.missing) {
          log.error(`${file} — missing`);
        }

        if (result.stale.length > 0 || result.missing.length > 0) {
          log.blank();
          log.step("Run `boot editor sync --overwrite` to update all targets.");
          process.exit(1);
        }
      } catch (err: any) {
        log.error(err.message);
        process.exit(1);
      }
    });
}

function addEditorSection(configPath: string, editorConfig: EditorConfig): void {
  const content = fs.readFileSync(configPath, "utf-8");

  if (configPath.endsWith(".json")) {
    const json = JSON.parse(content);
    if (json.editor) return;
    json.editor = editorConfig;
    fs.writeFileSync(configPath, JSON.stringify(json, null, 2) + "\n");
    return;
  }

  if (/^editor:/m.test(content)) return;

  const section = yaml.stringify({ editor: editorConfig }, { indent: 2, lineWidth: 0 });
  fs.writeFileSync(configPath, content.trimEnd() + "\n\n" + section);
}

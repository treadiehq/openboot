import { Command } from "commander";
import * as path from "path";
import * as yaml from "yaml";
import * as fs from "fs";
import { log } from "../lib/log";
import { findConfig, detectPackageManager } from "../lib/config";
import { HubConfig } from "../types";
import {
  detectCISteps,
  detectNodeVersion,
  syncHubTargets,
  checkHubSync,
  DEFAULT_HUB_TARGETS,
  DEFAULT_PR_TEMPLATE_SECTIONS,
} from "../lib/hub";
import { getOrDetectConfig } from "../lib/agent";

export function registerHubCommands(program: Command): void {
  const hub = program
    .command("hub")
    .description("Manage code hub config sync (.github, .forgejo)");

  // ─────────────────────────────────────────────
  // boot hub init
  // ─────────────────────────────────────────────
  hub
    .command("init")
    .description("Detect CI steps and generate hub workflow files")
    .option("--overwrite", "Overwrite existing workflow files")
    .action(async (opts) => {
      try {
        const cwd = process.cwd();
        log.header("boot hub init");

        const config = getOrDetectConfig(cwd);
        const steps = config.hub?.ci?.steps || detectCISteps(cwd, config);
        const nodeVersion = config.hub?.ci?.node || detectNodeVersion(cwd) || "18";

        if (steps.length === 0) {
          log.warn("No CI steps detected. Add steps to boot.yaml hub section.");
          return;
        }

        log.info(`Node version: ${nodeVersion}`);
        log.info(`Detected ${steps.length} CI step(s):`);
        for (const s of steps) {
          log.step(`  - ${s.name}: \`${s.run}\``);
        }

        // Add hub section to config if missing
        const configPath = findConfig(cwd);
        if (configPath && !config.hub) {
          const hubConfig: HubConfig = {
            ci: {
              on: ["push", "pull_request"],
              node: nodeVersion,
              steps,
            },
            prTemplate: { sections: DEFAULT_PR_TEMPLATE_SECTIONS },
            targets: DEFAULT_HUB_TARGETS,
          };
          addHubSection(configPath, hubConfig);
          config.hub = hubConfig;
          log.success(`Added hub section to ${path.basename(configPath)}`);
        } else if (!configPath && !config.hub) {
          const hubConfig: HubConfig = {
            ci: {
              on: ["push", "pull_request"],
              node: nodeVersion,
              steps,
            },
            prTemplate: { sections: DEFAULT_PR_TEMPLATE_SECTIONS },
            targets: DEFAULT_HUB_TARGETS,
          };
          const minimalConfig = {
            name: path.basename(cwd),
            packageManager: detectPackageManager(cwd),
            hub: hubConfig,
          };
          const yamlStr = yaml.stringify(minimalConfig, { indent: 2, lineWidth: 0 });
          fs.writeFileSync(path.join(cwd, "boot.yaml"), yamlStr);
          config.hub = hubConfig;
          log.success("Created boot.yaml with hub section");
        }

        if (!config.hub!.prTemplate) {
          config.hub!.prTemplate = { sections: DEFAULT_PR_TEMPLATE_SECTIONS };
        }

        const { written, skipped } = syncHubTargets(config, cwd, {
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
        log.step("Hub config synced to all targets.");
        log.step("Run `boot hub sync` after editing boot.yaml.");
        log.blank();
      } catch (err: any) {
        log.error(err.message);
        process.exit(1);
      }
    });

  // ─────────────────────────────────────────────
  // boot hub sync
  // ─────────────────────────────────────────────
  hub
    .command("sync")
    .description("Regenerate hub workflow files from boot.yaml")
    .option("--overwrite", "Overwrite existing workflow files")
    .action(async (opts) => {
      try {
        const cwd = process.cwd();
        const config = getOrDetectConfig(cwd);

        if (!config.hub?.ci?.steps || config.hub.ci.steps.length === 0) {
          log.warn("No hub CI steps in boot.yaml. Run `boot hub init` first.");
          return;
        }

        const { written, skipped } = syncHubTargets(config, cwd, {
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
  // boot hub check
  // ─────────────────────────────────────────────
  hub
    .command("check")
    .description("Check if hub workflow files are in sync with boot.yaml")
    .action(async () => {
      try {
        const cwd = process.cwd();
        const config = getOrDetectConfig(cwd);
        const result = checkHubSync(config, cwd);

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
          log.step("Run `boot hub sync --overwrite` to update all targets.");
          process.exit(1);
        }
      } catch (err: any) {
        log.error(err.message);
        process.exit(1);
      }
    });
}

function addHubSection(configPath: string, hubConfig: HubConfig): void {
  const content = fs.readFileSync(configPath, "utf-8");

  if (configPath.endsWith(".json")) {
    const json = JSON.parse(content);
    if (json.hub) return;
    json.hub = hubConfig;
    fs.writeFileSync(configPath, JSON.stringify(json, null, 2) + "\n");
    return;
  }

  if (/^hub:/m.test(content)) return;

  const section = yaml.stringify({ hub: hubConfig }, { indent: 2, lineWidth: 0 });
  fs.writeFileSync(configPath, content.trimEnd() + "\n\n" + section);
}

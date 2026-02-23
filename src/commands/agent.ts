import { Command } from "commander";
import * as path from "path";
import { log } from "../lib/log";
import { findConfig, loadConfig } from "../lib/config";
import { AgentConfig } from "../types";
import {
  detectAgentFiles,
  detectStack,
  detectSkills,
  formatStackName,
  generateAgentMarkdown,
  generateSoulMarkdown,
  syncTargets,
  checkSync,
  getOrDetectConfig,
  addAgentSection,
  importFromProject,
  saveGlobalConventions,
  addMemory,
  loadGlobalConventions,
  loadGlobalMemory,
  DEFAULT_TARGETS,
  AGENT_HOME,
} from "../lib/agent";
import { getTeamSkillsDir } from "../lib/team";

/**
 * Register all `boot agent` subcommands on the program.
 */
export function registerAgentCommands(program: Command): void {
  const agent = program
    .command("agent")
    .description("Manage AI agent context for your project");

  // ─────────────────────────────────────────────
  // boot agent init
  // ─────────────────────────────────────────────
  agent
    .command("init")
    .description("Generate AI agent context from your project stack")
    .option("--from <path>", "Import conventions from another project")
    .option("--no-global", "Exclude personal/global conventions from output")
    .option("--overwrite", "Overwrite existing agent files (default: skip existing)")
    .action(async (opts) => {
      try {
        const cwd = process.cwd();
        log.header("boot agent init");

        // Import from another project if --from specified
        if (opts.from) {
          const sourcePath = path.resolve(opts.from);
          log.info(`Importing conventions from ${sourcePath}`);
          const imported = importFromProject(sourcePath);
          if (imported.length > 0) {
            saveGlobalConventions(imported);
            log.success(
              `Imported ${imported.length} conventions to global store`
            );
          } else {
            log.warn("No conventions found in source project");
          }
        }

        // Get or detect config
        const config = getOrDetectConfig(cwd);

        // Show detected stack
        const stack = detectStack(cwd);
        if (stack.length > 0) {
          log.info(`Stack: ${stack.map(formatStackName).join(", ")}`);
        }

        // Show detected agent files
        const existingFiles = detectAgentFiles(cwd);
        if (existingFiles.length > 0) {
          log.info(`Existing agent files: ${existingFiles.join(", ")}`);
        }

        // Add agent section to config file if it exists but has no agent config
        const configPath = findConfig(cwd);
        if (configPath && !config.agent) {
          const defaultAgent: AgentConfig = {
            targets: DEFAULT_TARGETS,
          };
          addAgentSection(configPath, defaultAgent);
          config.agent = defaultAgent;
          log.success(`Added agent section to ${path.basename(configPath)}`);
        }

        // Show detected skills
        const skills = detectSkills(cwd, config.agent?.skills?.paths);
        if (skills.length > 0) {
          log.info(`Skills: ${skills.map((s) => s.name).join(", ")}`);
        }

        // Resolve team skills directory
        let teamSkillsDir: string | null = null;
        if (config.team?.url) {
          teamSkillsDir = getTeamSkillsDir(config.team.url);
        }

        // Generate context
        const markdown = generateAgentMarkdown(config, cwd, {
          includeGlobal: opts.global,
        });
        const soulMarkdown = generateSoulMarkdown(config, cwd);

        const { written, skipped } = syncTargets(config, markdown, cwd, {
          overwrite: opts.overwrite,
          soulMarkdown,
          teamSkillsDir,
        });

        log.blank();
        for (const file of written) {
          log.success(`Wrote ${file}`);
        }
        if (skipped.length > 0) {
          log.info(`Skipped existing (use --overwrite to replace): ${skipped.join(", ")}`);
        }

        log.blank();
        log.step("Agent context synced to all targets.");
        log.step(
          `Edit the agent section in ${configPath ? path.basename(configPath) : "boot.yaml"} to add conventions.`
        );
        log.step("Run `boot agent sync` after making changes.");
        log.blank();
      } catch (err: any) {
        log.error(err.message);
        process.exit(1);
      }
    });

  // ─────────────────────────────────────────────
  // boot agent sync
  // ─────────────────────────────────────────────
  agent
    .command("sync")
    .description("Regenerate and sync agent context to all target files")
    .option("--no-global", "Exclude personal/global conventions from output")
    .option("--overwrite", "Overwrite existing agent files (default: skip existing)")
    .action(async (opts) => {
      try {
        const cwd = process.cwd();
        const config = getOrDetectConfig(cwd);

        let teamSkillsDir: string | null = null;
        if (config.team?.url) {
          teamSkillsDir = getTeamSkillsDir(config.team.url);
        }

        const markdown = generateAgentMarkdown(config, cwd, {
          includeGlobal: opts.global,
        });
        const soulMarkdown = generateSoulMarkdown(config, cwd);

        const { written, skipped } = syncTargets(config, markdown, cwd, {
          overwrite: opts.overwrite,
          soulMarkdown,
          teamSkillsDir,
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
  // boot agent check
  // ─────────────────────────────────────────────
  agent
    .command("check")
    .description("Check if agent target files are in sync with config")
    .action(async () => {
      try {
        const cwd = process.cwd();
        const config = getOrDetectConfig(cwd);
        const result = checkSync(config, cwd);

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
          log.step("Run `boot agent sync` to update all targets.");
          process.exit(1);
        }
      } catch (err: any) {
        log.error(err.message);
        process.exit(1);
      }
    });

  // ─────────────────────────────────────────────
  // boot agent save
  // ─────────────────────────────────────────────
  agent
    .command("save")
    .description(
      "Save project conventions to your global store (~/.boot/agent/)"
    )
    .action(async () => {
      try {
        const cwd = process.cwd();
        const config = getOrDetectConfig(cwd);

        if (
          !config.agent?.conventions ||
          config.agent.conventions.length === 0
        ) {
          log.warn("No conventions defined in boot.yaml agent section.");
          log.blank();
          log.step("Add conventions to boot.yaml first:");
          log.step("");
          log.step("  agent:");
          log.step("    conventions:");
          log.step('      - "Your convention here"');
          return;
        }

        saveGlobalConventions(config.agent.conventions);
        log.success(
          `Saved ${config.agent.conventions.length} conventions to global store`
        );
        log.step(`Location: ${AGENT_HOME}/conventions.md`);
      } catch (err: any) {
        log.error(err.message);
        process.exit(1);
      }
    });

  // ─────────────────────────────────────────────
  // boot agent remember
  // ─────────────────────────────────────────────
  agent
    .command("remember <text...>")
    .description("Remember a convention or pattern across all projects")
    .action(async (textParts: string[]) => {
      try {
        const text = textParts.join(" ");
        addMemory(text);
        log.success(`Remembered: ${text}`);
        log.step(
          "This will be included in all future agent context generation."
        );
      } catch (err: any) {
        log.error(err.message);
        process.exit(1);
      }
    });

  // ─────────────────────────────────────────────
  // boot agent status
  // ─────────────────────────────────────────────
  agent
    .command("status")
    .description("Show agent context status for this project")
    .action(async () => {
      try {
        const cwd = process.cwd();
        log.header("boot agent status");

        // Stack
        const stack = detectStack(cwd);
        if (stack.length > 0) {
          log.info(`Stack: ${stack.map(formatStackName).join(", ")}`);
        } else {
          log.info("Stack: (none detected)");
        }

        // Existing agent files
        const files = detectAgentFiles(cwd);
        if (files.length > 0) {
          log.info(`Agent files: ${files.join(", ")}`);
        } else {
          log.info("Agent files: (none found)");
        }

        // Config status
        const configPath = findConfig(cwd);
        if (configPath) {
          const config = loadConfig(cwd);
          if (config.agent) {
            log.info("Config: boot.yaml has agent section");
            if (config.agent.conventions?.length) {
              log.step(
                `  ${config.agent.conventions.length} project conventions`
              );
            }
            if (config.agent.targets?.length) {
              log.step(
                `  Targets: ${config.agent.targets.join(", ")}`
              );
            }
            if (config.agent.soul) {
              const soulFields: string[] = [];
              if (config.agent.soul.identity) soulFields.push("identity");
              if (config.agent.soul.values?.length) soulFields.push(`${config.agent.soul.values.length} values`);
              if (config.agent.soul.boundaries?.length) soulFields.push(`${config.agent.soul.boundaries.length} boundaries`);
              if (config.agent.soul.voice?.length) soulFields.push(`${config.agent.soul.voice.length} voice guidelines`);
              log.step(`  Soul: ${soulFields.join(", ")}`);
            }
            const skills = detectSkills(cwd, config.agent.skills?.paths);
            if (skills.length > 0) {
              log.step(`  Skills: ${skills.length} detected (${skills.map((s) => s.name).join(", ")})`);
            }
          } else {
            log.info(
              "Config: boot.yaml exists but no agent section"
            );
          }
        } else {
          log.info("Config: no boot.yaml (run `boot init` first)");
        }

        // Global store
        const globalConv = loadGlobalConventions();
        const globalMem = loadGlobalMemory();
        log.info(
          `Global: ${globalConv.length} conventions, ${globalMem.length} remembered patterns`
        );
        if (globalConv.length > 0 || globalMem.length > 0) {
          log.step(`  Location: ${AGENT_HOME}`);
        }

        // Sync status
        if (configPath) {
          const config = loadConfig(cwd);
          const sync = checkSync(config, cwd);
          log.blank();
          if (sync.ok.length > 0) {
            log.success(`${sync.ok.length} target(s) in sync`);
          }
          if (sync.stale.length > 0) {
            log.warn(
              `${sync.stale.length} target(s) out of date — run \`boot agent sync\``
            );
          }
          if (sync.missing.length > 0) {
            log.warn(
              `${sync.missing.length} target(s) missing — run \`boot agent sync\``
            );
          }
        }
      } catch (err: any) {
        log.error(err.message);
        process.exit(1);
      }
    });
}

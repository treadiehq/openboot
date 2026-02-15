import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "yaml";
import { log } from "../lib/log";
import { findConfig, loadProjectConfig } from "../lib/config";
import {
  resolveTeamProfile,
  forceSync,
  getTeamStatus,
  clearCache,
  loadTeamConfig,
} from "../lib/team";
import { TeamConfig } from "../types";

/**
 * Register all `boot team` subcommands on the program.
 */
export function registerTeamCommands(program: Command): void {
  const team = program
    .command("team")
    .description("Manage team / company profile for shared config");

  // ─────────────────────────────────────────────
  // boot team set <url>
  // ─────────────────────────────────────────────
  team
    .command("set <url>")
    .description("Set the team profile git URL in boot.yaml")
    .option("--branch <branch>", "Branch to track (default: main)")
    .option("--required", "Enforce the team profile (fail if unavailable)")
    .action(async (url: string, opts) => {
      try {
        const cwd = process.cwd();
        log.header("boot team set");

        // Find or create boot.yaml
        let configPath = findConfig(cwd);
        if (!configPath) {
          configPath = path.join(cwd, "boot.yaml");
          fs.writeFileSync(
            configPath,
            yaml.stringify({ name: path.basename(cwd) }, { indent: 2 })
          );
          log.success("Created boot.yaml");
        }

        // Read existing content
        const raw = fs.readFileSync(configPath, "utf-8");

        // Build team config
        const teamConfig: TeamConfig = { url };
        if (opts.branch) teamConfig.branch = opts.branch;
        if (opts.required) teamConfig.required = true;

        // Update or append team section
        let newContent: string;
        if (/^team:/m.test(raw)) {
          // Replace existing team section
          const parsed = yaml.parse(raw) || {};
          parsed.team = teamConfig;
          newContent = yaml.stringify(parsed, { indent: 2, lineWidth: 0 });
        } else {
          // Append team section
          const section = yaml.stringify(
            { team: teamConfig },
            { indent: 2, lineWidth: 0 }
          );
          newContent = raw.trimEnd() + "\n\n" + section;
        }

        fs.writeFileSync(configPath, newContent);
        log.success(`Team profile set: ${url}`);

        // Immediately clone/resolve to verify it works
        log.blank();
        try {
          const resolved = resolveTeamProfile(teamConfig);
          if (resolved) {
            log.success("Team profile resolved and cached");
            if (resolved.config.agent?.conventions?.length) {
              log.step(
                `  ${resolved.config.agent.conventions.length} team conventions`
              );
            }
            if (resolved.config.setup?.length) {
              log.step(
                `  ${resolved.config.setup.length} team setup commands`
              );
            }
            if (resolved.config.env?.required?.length) {
              log.step(
                `  ${resolved.config.env.required.length} required env vars`
              );
            }
          }
        } catch (err: any) {
          log.warn(`Could not resolve team profile: ${err.message}`);
          log.step(
            "The URL has been saved. Fix the issue and run `boot team sync`."
          );
        }

        log.blank();
        log.step("Team profile will be merged into all boot commands.");
        log.step("Run `boot team sync` to force-pull the latest version.");
        log.step("Run `boot team status` to see what's applied.");
        log.blank();
      } catch (err: any) {
        log.error(err.message);
        process.exit(1);
      }
    });

  // ─────────────────────────────────────────────
  // boot team sync
  // ─────────────────────────────────────────────
  team
    .command("sync")
    .description("Force-pull the latest team profile")
    .action(async () => {
      try {
        const cwd = process.cwd();
        const config = loadProjectConfig(cwd);

        if (!config.team?.url) {
          log.error("No team profile configured.");
          log.step("Run `boot team set <url>` to configure one.");
          process.exit(1);
        }

        log.header("boot team sync");

        const resolved = forceSync(config.team);
        if (resolved) {
          log.success("Team profile synced");
          log.step(`  URL: ${resolved.url}`);
          log.step(`  Cache: ${resolved.cacheDir}`);
        } else {
          log.warn(
            "Team profile repo has no boot.yaml — nothing to merge"
          );
        }
      } catch (err: any) {
        log.error(err.message);
        process.exit(1);
      }
    });

  // ─────────────────────────────────────────────
  // boot team check
  // ─────────────────────────────────────────────
  team
    .command("check")
    .description(
      "Verify the team profile is applied and up to date (CI-friendly)"
    )
    .action(async () => {
      try {
        const cwd = process.cwd();
        const config = loadProjectConfig(cwd);

        if (!config.team?.url) {
          // No team profile configured — not an error for check
          log.info("No team profile configured — nothing to check.");
          return;
        }

        const status = getTeamStatus(config.team);

        if (!status.cached) {
          log.error("Team profile not cached — run `boot team sync`");
          process.exit(1);
        }

        if (!status.hasConfig) {
          log.error(
            "Team profile repo has no boot.yaml"
          );
          process.exit(1);
        }

        // Try a fetch to check if we're up to date
        try {
          const resolved = forceSync(config.team);
          if (resolved) {
            log.success("Team profile is applied and up to date");
            log.step(`  URL: ${status.url}`);
            log.step(`  Branch: ${status.branch}`);
          }
        } catch {
          if (config.team.required) {
            log.error(
              "Team profile is required but could not be synced"
            );
            process.exit(1);
          }
          log.warn(
            "Could not verify team profile is up to date (network issue?) — using cached version"
          );
        }
      } catch (err: any) {
        log.error(err.message);
        process.exit(1);
      }
    });

  // ─────────────────────────────────────────────
  // boot team status
  // ─────────────────────────────────────────────
  team
    .command("status")
    .description("Show team profile status")
    .action(async () => {
      try {
        const cwd = process.cwd();
        const config = loadProjectConfig(cwd);

        log.header("boot team status");

        if (!config.team?.url) {
          log.info("No team profile configured.");
          log.step("Run `boot team set <url>` to configure one.");
          return;
        }

        const status = getTeamStatus(config.team);

        log.info(`URL: ${status.url}`);
        log.info(`Branch: ${status.branch}`);
        log.info(`Required: ${config.team.required ? "yes" : "no"}`);
        log.info(`Cached: ${status.cached ? "yes" : "no"}`);

        if (status.lastPull) {
          const ago = timeSince(status.lastPull);
          log.info(`Last synced: ${ago}`);
        }

        if (status.cached && status.hasConfig) {
          const teamConfig = loadTeamConfig(config.team.url);
          if (teamConfig) {
            log.blank();
            log.info("Team profile includes:");
            if (teamConfig.setup?.length) {
              log.step(
                `  ${teamConfig.setup.length} setup command(s)`
              );
            }
            if (teamConfig.env?.required?.length) {
              log.step(
                `  ${teamConfig.env.required.length} required env var(s)`
              );
            }
            if (teamConfig.env?.reject) {
              log.step(
                `  ${Object.keys(teamConfig.env.reject).length} rejected value rule(s)`
              );
            }
            if (teamConfig.agent?.conventions?.length) {
              log.step(
                `  ${teamConfig.agent.conventions.length} agent convention(s)`
              );
            }
            if (teamConfig.agent?.targets?.length) {
              log.step(
                `  Targets: ${teamConfig.agent.targets.join(", ")}`
              );
            }
          }
        } else if (status.cached && !status.hasConfig) {
          log.warn(
            "Team repo is cached but has no boot.yaml — nothing to merge"
          );
        } else {
          log.warn(
            "Team profile not cached — run `boot team sync`"
          );
        }
      } catch (err: any) {
        log.error(err.message);
        process.exit(1);
      }
    });

  // ─────────────────────────────────────────────
  // boot team remove
  // ─────────────────────────────────────────────
  team
    .command("remove")
    .description("Remove the team profile from boot.yaml and clear the cache")
    .action(async () => {
      try {
        const cwd = process.cwd();
        const configPath = findConfig(cwd);

        if (!configPath) {
          log.error("No boot.yaml found.");
          process.exit(1);
        }

        const config = loadProjectConfig(cwd);

        if (!config.team?.url) {
          log.info("No team profile configured — nothing to remove.");
          return;
        }

        // Clear cache
        clearCache(config.team.url);

        // Remove team section from boot.yaml
        const raw = fs.readFileSync(configPath, "utf-8");
        const parsed = yaml.parse(raw) || {};
        delete parsed.team;
        fs.writeFileSync(
          configPath,
          yaml.stringify(parsed, { indent: 2, lineWidth: 0 })
        );

        log.success("Team profile removed from boot.yaml and cache cleared");
      } catch (err: any) {
        log.error(err.message);
        process.exit(1);
      }
    });
}

// ────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────

function timeSince(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minute(s) ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hour(s) ago`;
  return `${Math.floor(seconds / 86400)} day(s) ago`;
}

import { Command } from "commander";
import * as path from "path";
import * as readline from "readline";
import { log } from "../lib/log";
import {
  loadSyncConfig,
  saveSyncConfig,
  getDefaultTargetPath,
  SUPPORTED_PROVIDERS,
  SyncProvider,
} from "../sync/syncConfig";
import { pushToFolder, pullFromFolder } from "../sync/providers/folderProvider";

export function registerSyncCommands(program: Command): void {
  const sync = program
    .command("sync")
    .description("Sync .openboot state to a local-first folder provider (iCloud, Dropbox, etc.)");

  // ── boot sync enable <provider> ─────────────────────────────────────────────
  sync
    .command("enable <provider>")
    .description(`Enable sync. Providers: ${SUPPORTED_PROVIDERS.join(", ")}`)
    .option("--path <path>", "Target folder path (defaults to standard location for provider)")
    .action(async (provider: string, opts) => {
      try {
        if (!SUPPORTED_PROVIDERS.includes(provider as SyncProvider)) {
          log.error(`Unknown provider: ${provider}. Supported: ${SUPPORTED_PROVIDERS.join(", ")}`);
          process.exit(1);
        }

        let targetPath = opts.path ?? getDefaultTargetPath(provider as SyncProvider);

        // Interactive prompt if path not provided
        if (!opts.path) {
          const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
          const answer = await new Promise<string>((resolve) => {
            rl.question(`  Sync target path [${targetPath}]: `, (a) => { rl.close(); resolve(a.trim()); });
          });
          if (answer) targetPath = answer;
        }

        saveSyncConfig({
          enabled: true,
          provider: provider as SyncProvider,
          targetPath,
        });

        log.blank();
        log.success(`Sync enabled`);
        log.table([
          ["Provider:", provider],
          ["Target:  ", targetPath],
        ]);

        if (provider === "git") {
          log.warn("Note: the 'git' provider uses folder copy, not git push/pull.");
          log.step("For real git remote sync, point to a git-managed folder and commit/push manually.");
        }
        log.blank();
        log.step("Run `boot sync push` to sync your OpenBoot state now.");
        log.blank();
      } catch (err: any) {
        log.error(err.message);
        process.exit(1);
      }
    });

  // ── boot sync status ────────────────────────────────────────────────────────
  sync
    .command("status")
    .description("Show sync configuration and last sync result")
    .action(async () => {
      try {
        const config = loadSyncConfig();
        if (!config) {
          log.warn("Sync is not configured. Run `boot sync enable <provider>` to set it up.");
          return;
        }
        log.blank();
        log.table([
          ["Enabled:         ", String(config.enabled)],
          ["Provider:        ", config.provider],
          ["Target path:     ", config.targetPath],
          ["Last sync:       ", config.lastSyncAt ?? "never"],
          ["Last push result:", config.lastPushResult ?? "—"],
          ["Last pull result:", config.lastPullResult ?? "—"],
          ...(config.lastError ? [["Last error:", config.lastError]] : []),
        ]);
        log.blank();
      } catch (err: any) {
        log.error(err.message);
        process.exit(1);
      }
    });

  // ── boot sync disable ───────────────────────────────────────────────────────
  sync
    .command("disable")
    .description("Disable sync (keeps local data intact)")
    .action(async () => {
      try {
        const config = loadSyncConfig();
        if (!config) { log.warn("Sync is not configured."); return; }
        config.enabled = false;
        saveSyncConfig(config);
        log.success("Sync disabled. Local data is intact.");
      } catch (err: any) {
        log.error(err.message);
        process.exit(1);
      }
    });

  // ── boot sync push ──────────────────────────────────────────────────────────
  sync
    .command("push")
    .description("Copy .openboot state to the configured sync target")
    .action(async () => {
      try {
        const cwd = process.cwd();
        const config = loadSyncConfig(cwd);
        if (!config || !config.enabled) {
          log.error("Sync is not enabled. Run `boot sync enable <provider>` first.");
          process.exit(1);
        }

        log.blank();
        log.info(`Pushing to ${config.provider}: ${config.targetPath}`);

        const openbootDir = path.join(cwd, ".openboot");
        const result = pushToFolder(openbootDir, config.targetPath);

        config.lastSyncAt = new Date().toISOString();
        config.lastPushResult = result.errors.length > 0 ? "error" : "ok";
        if (result.errors.length > 0) config.lastError = result.errors[0];
        saveSyncConfig(config, cwd);

        log.blank();
        log.success(`Push complete`);
        log.table([
          ["Pushed:  ", String(result.pushed)],
          ["Skipped: ", String(result.skipped)],
          ["Errors:  ", String(result.errors.length)],
        ]);
        if (result.errors.length > 0) {
          for (const e of result.errors.slice(0, 5)) log.warn(`  ${e}`);
        }
        log.blank();
      } catch (err: any) {
        log.error(err.message);
        process.exit(1);
      }
    });

  // ── boot sync pull ──────────────────────────────────────────────────────────
  sync
    .command("pull")
    .description("Merge .openboot state from the configured sync target into local")
    .action(async () => {
      try {
        const cwd = process.cwd();
        const config = loadSyncConfig(cwd);
        if (!config || !config.enabled) {
          log.error("Sync is not enabled. Run `boot sync enable <provider>` first.");
          process.exit(1);
        }

        log.blank();
        log.info(`Pulling from ${config.provider}: ${config.targetPath}`);

        const openbootDir = path.join(cwd, ".openboot");
        const result = pullFromFolder(config.targetPath, openbootDir);

        config.lastSyncAt = new Date().toISOString();
        config.lastPullResult = result.conflicts > 0 ? "conflict" : result.errors.length > 0 ? "error" : "ok";
        if (result.errors.length > 0) config.lastError = result.errors[0];
        saveSyncConfig(config, cwd);

        log.blank();
        log.success("Pull complete");
        log.table([
          ["Pulled:    ", String(result.pulled)],
          ["Conflicts: ", String(result.conflicts)],
          ["Skipped:   ", String(result.skipped)],
          ["Errors:    ", String(result.errors.length)],
        ]);
        if (result.conflicts > 0) {
          log.blank();
          log.warn(`${result.conflicts} conflict(s) found — saved as .conflict.json files.`);
          log.step("Review conflict files and merge manually, then delete the .conflict.json copies.");
        }
        if (result.errors.length > 0) {
          for (const e of result.errors.slice(0, 5)) log.warn(`  ${e}`);
        }
        log.blank();
      } catch (err: any) {
        log.error(err.message);
        process.exit(1);
      }
    });
}

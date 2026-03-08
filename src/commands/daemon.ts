import { Command } from "commander";
import * as path from "path";
import * as fs from "fs";
import * as child_process from "child_process";
import { log } from "../lib/log";
import {
  loadDaemonConfig,
  saveDaemonConfig,
  loadDaemonState,
  clearDaemonState,
  isDaemonRunning,
  getDaemonStatePath,
} from "../daemon/daemonConfig";
import { loadSyncConfig } from "../sync/syncConfig";
import { pullFromFolder, pushToFolder } from "../sync/providers/folderProvider";
import { formatRelativeTime } from "../sessions/sessionStore";

export function registerDaemonCommands(program: Command): void {
  const daemon = program
    .command("daemon")
    .description("Manage background sync daemon (periodic sync pull/push and session monitoring)");

  // ── boot daemon start ───────────────────────────────────────────────────────
  daemon
    .command("start")
    .description("Start the background sync daemon")
    .option("--interval <seconds>", "Sync interval in seconds", "60")
    .action(async (opts) => {
      try {
        const cwd = process.cwd();

        if (isDaemonRunning()) {
          const state = loadDaemonState()!;
          log.warn(`Daemon already running (pid ${state.pid}, started ${formatRelativeTime(state.startedAt)})`);
          return;
        }

        const intervalSeconds = parseInt(opts.interval, 10);
        saveDaemonConfig({ enabled: true, intervalSeconds }, cwd);

        // Spawn daemon as a detached background process
        const daemonScript = path.join(__dirname, "../daemon/daemonRunner.js");

        // Write inline runner if the compiled version doesn't exist yet (dev mode)
        const scriptExists = fs.existsSync(daemonScript);
        if (!scriptExists) {
          log.warn("Daemon runner not found in dist/. Run `npm run build` first.");
          process.exit(1);
        }

        const child = child_process.spawn(process.execPath, [daemonScript, cwd, String(intervalSeconds)], {
          detached: true,
          stdio: "ignore",
        });
        child.unref();

        log.blank();
        log.success(`Daemon started (pid ${child.pid}, interval ${intervalSeconds}s)`);
        log.step("Run `boot daemon status` to check, `boot daemon stop` to stop.");
        log.blank();
      } catch (err: any) {
        log.error(err.message);
        process.exit(1);
      }
    });

  // ── boot daemon stop ────────────────────────────────────────────────────────
  daemon
    .command("stop")
    .description("Stop the background sync daemon")
    .action(async () => {
      try {
        if (!isDaemonRunning()) {
          log.warn("Daemon is not running.");
          return;
        }

        const state = loadDaemonState()!;
        try {
          process.kill(state.pid, "SIGTERM");
        } catch {
          // Process may have already exited
        }

        clearDaemonState();
        saveDaemonConfig({ enabled: false, intervalSeconds: state.intervalSeconds });

        log.blank();
        log.success(`Daemon stopped (was pid ${state.pid})`);
        log.blank();
      } catch (err: any) {
        log.error(err.message);
        process.exit(1);
      }
    });

  // ── boot daemon status ──────────────────────────────────────────────────────
  daemon
    .command("status")
    .description("Show daemon status")
    .action(async () => {
      try {
        const cwd = process.cwd();
        const config = loadDaemonConfig(cwd);
        const state = loadDaemonState();
        const running = isDaemonRunning();

        log.blank();
        log.table([
          ["Status:           ", running ? "running" : "stopped"],
          ["Configured:       ", config.enabled ? "yes" : "no"],
          ["Interval:         ", `${config.intervalSeconds}s`],
          ...(state
            ? [
                ["PID:              ", String(state.pid)],
                ["Started:          ", formatRelativeTime(state.startedAt)],
                ["Last run:         ", state.lastRunAt ? formatRelativeTime(state.lastRunAt) : "never"],
                ["Last result:      ", state.lastResult ?? "—"],
                ...(state.lastError ? [["Last error:       ", state.lastError]] : []),
              ]
            : []),
        ]);
        log.blank();

        if (!running && config.enabled) {
          log.warn("Daemon was configured but is not running. Run `boot daemon start` to restart.");
          log.blank();
        }
      } catch (err: any) {
        log.error(err.message);
        process.exit(1);
      }
    });
}

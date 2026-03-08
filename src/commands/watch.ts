import { Command } from "commander";
import { log } from "../lib/log";
import { buildWatchedPaths, startWatcher } from "../sessions/watch/watchSessions";
import { ensureDir, getActiveSessionsDir, getImportedSessionsDir } from "../sessions/sessionStore";

/**
 * Register `boot watch`
 *
 * Watches .openboot/sessions and any known adapter source paths that exist on
 * this machine. Logs file-change events into the active session and suggests
 * re-import when external sources are updated.
 */
export function registerWatchCommand(program: Command): void {
  program
    .command("watch")
    .description("Watch session files and external AI tool histories for activity")
    .action(async () => {
      const cwd = process.cwd();

      // Ensure dirs exist before watching
      ensureDir(getActiveSessionsDir(cwd));
      ensureDir(getImportedSessionsDir(cwd));

      log.blank();
      log.header("boot watch");

      const watched = await buildWatchedPaths(cwd);

      log.info("Watching OpenBoot session activity...");
      log.step("Watching:");
      for (const wp of watched) {
        log.step(`- ${wp.label}${wp.type === "external" ? " (if present)" : ""}`);
      }
      log.blank();
      log.step("Press Ctrl+C to stop.");
      log.blank();

      const stop = startWatcher(watched, cwd, (msg) => {
        const ts = new Date().toLocaleTimeString();
        console.log(`  \x1b[2m[${ts}]\x1b[0m ${msg}`);
      });

      const cleanup = () => {
        stop();
        log.blank();
        log.info("Watch stopped.");
        process.exit(0);
      };

      process.on("SIGINT", cleanup);
      process.on("SIGTERM", cleanup);

      // Keep the process alive
      await new Promise<void>(() => {/* intentionally never resolves */});
    });
}

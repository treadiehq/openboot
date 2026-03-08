/**
 * Background daemon runner — spawned as a detached child process by `boot daemon start`.
 * Periodically runs sync push/pull and updates the daemon state file.
 *
 * Usage (internal): node daemonRunner.js <cwd> <intervalSeconds>
 *
 * Safety:
 * - Disables itself automatically on repeated errors (3+ consecutive failures)
 * - Never crashes the parent process
 * - Low CPU: pure setInterval, no file watching in this process
 */

import * as path from "path";
import { saveDaemonState, saveDaemonConfig, loadDaemonConfig } from "./daemonConfig";
import { loadSyncConfig } from "../sync/syncConfig";
import { pushToFolder, pullFromFolder } from "../sync/providers/folderProvider";

const cwd = process.argv[2] ?? process.cwd();
const intervalSeconds = parseInt(process.argv[3] ?? "60", 10);

let consecutiveErrors = 0;
const MAX_ERRORS = 3;

// Write initial state
saveDaemonState({
  pid: process.pid,
  startedAt: new Date().toISOString(),
  intervalSeconds,
});

async function runSync(): Promise<void> {
  const syncConfig = loadSyncConfig(cwd);
  if (!syncConfig?.enabled) return;

  const openbootDir = path.join(cwd, ".openboot");

  try {
    await pullFromFolder(syncConfig.targetPath, openbootDir);
    await pushToFolder(openbootDir, syncConfig.targetPath);

    saveDaemonState({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      intervalSeconds,
      lastRunAt: new Date().toISOString(),
      lastResult: "ok",
    });

    consecutiveErrors = 0;
  } catch (err: any) {
    consecutiveErrors++;

    saveDaemonState({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      intervalSeconds,
      lastRunAt: new Date().toISOString(),
      lastResult: "error",
      lastError: err.message,
    });

    if (consecutiveErrors >= MAX_ERRORS) {
      saveDaemonConfig({ enabled: false, intervalSeconds }, cwd);
      process.exit(1);
    }
  }
}

// Run immediately then on interval
runSync();
setInterval(runSync, intervalSeconds * 1000);

// Keep alive
process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));

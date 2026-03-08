import { Command } from "commander";
import { log } from "../lib/log";
import { loadSyncConfig } from "../sync/syncConfig";
import { pullFromFolder } from "../sync/providers/folderProvider";
import { findBestResumeMatch } from "../sessions/resumeContext";
import { getRepoInfo } from "../git/getRepoInfo";
import { buildContext, renderContextMarkdown, saveContextFile } from "../context/buildContext";
import { buildSessionSummary } from "../summaries/buildSummary";
import { resumeTask } from "../tasks/taskStore";
import * as path from "path";
import * as os from "os";

/**
 * `boot continue` — One-command cross-machine continuation flow:
 * 1. Detect repo + branch
 * 2. Sync pull if enabled (fold in remote state)
 * 3. Find best matching task/session
 * 4. Reconstruct and print context
 * 5. Optionally build context file
 */
export function registerContinueCommand(program: Command): void {
  program
    .command("continue")
    .description("Continue work from another machine — sync, resume, and build context in one step")
    .option("--no-sync", "Skip sync pull even if configured")
    .option("--no-context", "Skip context file generation")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      try {
        const cwd = process.cwd();
        const info = getRepoInfo(cwd);

        if (opts.json) {
          const match = findBestResumeMatch(cwd);
          const ctx = buildContext(cwd);
          console.log(JSON.stringify({ repo: info, match, context: ctx }, null, 2));
          return;
        }

        log.blank();
        log.header("boot continue");
        log.blank();

        log.table([
          ["Repo:  ", info.repoName],
          ["Branch:", info.branch],
          ["Commit:", info.commit],
        ]);
        log.blank();

        // Step 1: Sync pull if enabled and not skipped
        if (opts.sync !== false) {
          const syncConfig = loadSyncConfig(cwd);
          if (syncConfig?.enabled) {
            log.info(`Pulling from ${syncConfig.provider}: ${syncConfig.targetPath}`);
            try {
              const openbootDir = path.join(cwd, ".openboot");
              const result = pullFromFolder(syncConfig.targetPath, openbootDir);
              if (result.pulled > 0) {
                log.success(`Sync: ${result.pulled} files pulled, ${result.conflicts} conflicts`);
              } else {
                log.step("Sync: already up to date");
              }
              if (result.conflicts > 0) {
                log.warn(`${result.conflicts} conflict(s) saved as .conflict.json — review manually`);
              }
            } catch (e: any) {
              log.warn(`Sync pull failed: ${e.message}`);
            }
          } else {
            log.step("Sync not configured — skipping (run `boot sync enable <provider>` to set up)");
          }
          log.blank();
        }

        // Step 2: Find best match
        const match = findBestResumeMatch(cwd);

        if (match.matchQuality === "none") {
          log.warn("No sessions or tasks found for this repo.");
          log.step("Run `boot session start` to begin, or `boot task create` to add a task.");
          log.blank();
          return;
        }

        log.step("Resuming from:");
        if (match.task) {
          log.step(`  Task: ${match.task.title} (${match.task.id.slice(0, 8)})`);
        }
        if (match.session) {
          log.step(`  Session: ${match.session.id.slice(0, 8)} — ${match.session.task}`);
        }
        log.blank();
        log.step("Reason: " + match.reason.join(" · "));
        log.blank();

        // Activate task
        if (match.task && match.task.status !== "active") {
          resumeTask(match.task.id, cwd);
        }

        // Step 3: Session summary
        if (match.session) {
          const summary = buildSessionSummary(match.session);
          if (summary && summary !== "No activity recorded") {
            log.step("Last session:");
            log.step(`  ${summary}`);
            log.blank();
          }
        }

        // Step 4: Build context file
        if (opts.context !== false) {
          const ctx = buildContext(cwd);
          const md = renderContextMarkdown(ctx);
          const saved = saveContextFile(md, cwd);
          log.success(`Context saved to ${saved.replace(cwd + "/", "")}`);
          log.blank();
          console.log(md);
        }
      } catch (err: any) {
        log.error(err.message);
        process.exit(1);
      }
    });
}

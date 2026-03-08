import { Command } from "commander";
import { log } from "../lib/log";
import { findBestResumeMatch } from "../sessions/resumeContext";
import { getRepoInfo } from "../git/getRepoInfo";
import { buildSessionSummary } from "../summaries/buildSummary";
import { resumeTask } from "../tasks/taskStore";
import { buildContext, renderContextMarkdown } from "../context/buildContext";

export function registerResumeCommand(program: Command): void {
  program
    .command("resume")
    .description("Resume work — branch-aware: finds the best matching session and task")
    .option("--context", "Also build and print the context summary")
    .option("--json", "Output resume match as JSON")
    .action(async (opts) => {
      try {
        const cwd = process.cwd();
        const info = getRepoInfo(cwd);
        const match = findBestResumeMatch(cwd);

        if (opts.json) {
          console.log(JSON.stringify({ repo: info, match }, null, 2));
          return;
        }

        log.blank();
        log.header(`Resuming OpenBoot context`);
        log.blank();
        log.table([
          ["Repo:  ", info.repoName],
          ["Branch:", info.branch],
          ["Commit:", info.commit],
        ]);
        log.blank();

        if (match.matchQuality === "none") {
          log.warn("No sessions or tasks found for this repo.");
          log.step("Run `boot session start` to begin, or `boot task create` to add a task.");
          log.blank();
          return;
        }

        log.step("Matched:");
        if (match.task) log.step(`- Task: ${match.task.title} (${match.task.id.slice(0, 8)})`);
        if (match.session) log.step(`- Session: ${match.session.id.slice(0, 8)} — ${match.session.task}`);
        log.blank();
        log.step("Reason:");
        for (const r of match.reason) log.step(`- ${r}`);
        log.blank();

        // Mark task as active if found
        if (match.task && match.task.status !== "active") {
          resumeTask(match.task.id, cwd);
        }

        // Print session summary
        if (match.session) {
          const summary = buildSessionSummary(match.session);
          if (summary) {
            log.step("Session summary:");
            log.step(summary);
            log.blank();
          }
        }

        // Optional: print full context
        if (opts.context) {
          const ctx = buildContext(cwd);
          const md = renderContextMarkdown(ctx);
          log.blank();
          console.log(md);
          log.blank();
        }
      } catch (err: any) {
        log.error(err.message);
        process.exit(1);
      }
    });
}

import { Command } from "commander";
import { log } from "../lib/log";
import { buildTimeline, renderTimeline } from "../timeline/buildTimeline";

export function registerTimelineCommand(program: Command): void {
  program
    .command("timeline")
    .description("Show a human-readable timeline of AI-assisted work for this repo")
    .option("--task <taskId>", "Filter to a specific task")
    .option("--branch <branch>", "Filter to a specific branch")
    .option("--limit <n>", "Max entries to show", "50")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      try {
        const cwd = process.cwd();
        const entries = buildTimeline(cwd, {
          taskId: opts.task,
          branch: opts.branch,
          limit: parseInt(opts.limit, 10),
        });

        if (opts.json) {
          console.log(JSON.stringify(entries, null, 2));
          return;
        }

        log.blank();
        log.header("OpenBoot Timeline");
        log.blank();
        console.log(renderTimeline(entries));
        log.blank();
      } catch (err: any) {
        log.error(err.message);
        process.exit(1);
      }
    });
}

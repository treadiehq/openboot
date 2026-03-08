import { Command } from "commander";
import { log } from "../lib/log";
import { buildContext, renderContextMarkdown, saveContextFile } from "../context/buildContext";

export function registerContextCommands(program: Command): void {
  const ctx = program
    .command("context")
    .description("Build and manage AI-ready context packages");

  ctx
    .command("build")
    .description("Build a context package from current repo, task, session, and snapshot state")
    .option("--json", "Output as JSON instead of markdown")
    .option("--no-save", "Print only, do not save to .openboot/context/latest-context.md")
    .action(async (opts) => {
      try {
        const cwd = process.cwd();
        const context = buildContext(cwd);

        if (opts.json) {
          console.log(JSON.stringify(context, null, 2));
          return;
        }

        const markdown = renderContextMarkdown(context);

        if (opts.save !== false) {
          const saved = saveContextFile(markdown, cwd);
          log.blank();
          log.success(`Context saved to ${saved.replace(cwd + "/", "")}`);
          log.blank();
        }

        console.log(markdown);
      } catch (err: any) {
        log.error(err.message);
        process.exit(1);
      }
    });
}

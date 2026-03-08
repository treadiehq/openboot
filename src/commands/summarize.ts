import { Command } from "commander";
import { log } from "../lib/log";
import { readSession, getLatestActiveSession, writeSession } from "../sessions/sessionStore";
import { readTask, writeTask } from "../tasks/taskStore";
import { summarizeSession, summarizeTask } from "../ai/summarize";

export function registerSummarizeCommands(program: Command): void {
  const cmd = program
    .command("summarize")
    .description(
      "Generate a summary for a session or task. " +
      "Uses the first configured AI provider (OPENAI_API_KEY, ANTHROPIC_API_KEY, or GEMINI_API_KEY), " +
      "otherwise falls back to fast deterministic summarization."
    );

  // ── boot summarize session <id> ─────────────────────────────────────────────
  cmd
    .command("session [id]")
    .description(
      "Summarize a session. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or GEMINI_API_KEY to use AI; " +
      "otherwise uses deterministic fallback"
    )
    .option("--json", "Output as JSON")
    .action(async (id: string | undefined, opts) => {
      try {
        const cwd = process.cwd();
        const session = id ? readSession(id, cwd) : getLatestActiveSession(cwd);
        if (!session) {
          log.error(id ? `Session not found: ${id}` : "No active session found.");
          process.exit(1);
        }

        log.blank();
        log.info(`Summarizing session ${session.id.slice(0, 8)}…`);

        const { output, usedProvider } = await summarizeSession(session);

        if (opts.json) {
          console.log(JSON.stringify(output, null, 2));
          return;
        }

        log.blank();
        log.table([
          ["Task:     ", output.task],
          ["Provider: ", usedProvider],
        ]);
        log.blank();

        if (output.summary) {
          log.step("Summary:");
          log.step(`  ${output.summary}`);
          log.blank();
        }
        if (output.filesChanged.length > 0) {
          log.step(`Files: ${output.filesChanged.slice(0, 5).join(", ")}`);
        }
        if (output.decisions.length > 0) {
          log.step("Decisions:");
          for (const d of output.decisions) log.step(`  - ${d}`);
        }
        if (output.nextSteps.length > 0) {
          log.step("Next steps:");
          for (const s of output.nextSteps) log.step(`  - ${s}`);
        }

        // Save summary back to session
        session.summary = output.summary;
        writeSession(session, undefined, cwd);
        log.blank();
        log.step("Summary saved to session.");
        log.blank();
      } catch (err: any) {
        log.error(err.message);
        process.exit(1);
      }
    });

  // ── boot summarize task <id> ────────────────────────────────────────────────
  cmd
    .command("task [id]")
    .description(
      "Summarize a task. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or GEMINI_API_KEY to use AI; " +
      "otherwise uses deterministic fallback"
    )
    .option("--json", "Output as JSON")
    .action(async (id: string | undefined, opts) => {
      try {
        const cwd = process.cwd();

        if (!id) {
          log.error("Task ID required. Run `boot task list` to find IDs.");
          process.exit(1);
        }

        const task = readTask(id, cwd);
        if (!task) {
          log.error(`Task not found: ${id}`);
          process.exit(1);
        }

        log.blank();
        log.info(`Summarizing task ${task.id.slice(0, 8)}…`);

        const { output, usedProvider } = await summarizeTask(task);

        if (opts.json) {
          console.log(JSON.stringify(output, null, 2));
          return;
        }

        log.blank();
        log.table([
          ["Task:     ", output.task],
          ["Provider: ", usedProvider],
        ]);
        log.blank();

        if (output.summary) {
          log.step("Summary:");
          log.step(`  ${output.summary}`);
          log.blank();
        }
        if (output.decisions.length > 0) {
          log.step("Decisions:");
          for (const d of output.decisions) log.step(`  - ${d}`);
        }
        if (output.nextSteps.length > 0) {
          log.step("Next steps:");
          for (const s of output.nextSteps) log.step(`  - ${s}`);
        }

        // Save summary back to task
        task.summary = output.summary;
        task.updatedAt = new Date().toISOString();
        writeTask(task, cwd);
        log.blank();
        log.step("Summary saved to task.");
        log.blank();
      } catch (err: any) {
        log.error(err.message);
        process.exit(1);
      }
    });
}

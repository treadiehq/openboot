import { Command } from "commander";
import * as readline from "readline";
import { log } from "../lib/log";
import {
  createTask,
  listTasks,
  resumeTask,
  closeTask,
  pauseTask,
  readTask,
} from "../tasks/taskStore";
import { formatRelativeTime, getLatestActiveSession, createSession } from "../sessions/sessionStore";
import { linkSessionToTask } from "../tasks/taskStore";

export function registerTaskCommands(program: Command): void {
  const task = program
    .command("task")
    .description("Manage AI development tasks (units of work spanning multiple sessions)");

  // ── boot task create ────────────────────────────────────────────────────────
  task
    .command("create")
    .description("Create a new task")
    .option("-t, --title <title>", "Task title")
    .option("-d, --description <desc>", "Task description")
    .option("--tags <tags>", "Comma-separated tags")
    .action(async (opts) => {
      try {
        let title = opts.title;

        if (!title) {
          const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
          title = await new Promise<string>((resolve) => {
            rl.question("  Task title: ", (ans) => { rl.close(); resolve(ans.trim()); });
          });
        }

        if (!title) { log.error("Title is required."); process.exit(1); }

        const tags = opts.tags ? opts.tags.split(",").map((t: string) => t.trim()) : [];
        const t = createTask(title, opts.description ?? "", tags);

        // Auto-link to active session if one exists
        const session = getLatestActiveSession();
        if (session) {
          linkSessionToTask(t.id, session.id);
          log.step(`Linked to active session ${session.id.slice(0, 8)}`);
        }

        log.blank();
        log.success("Task created");
        log.blank();
        log.table([
          ["Task ID:", t.id.slice(0, 8)],
          ["Title:  ", t.title],
          ["Branch: ", t.git.branch],
          ["Status: ", t.status],
        ]);
        log.blank();
      } catch (err: any) {
        log.error(err.message);
        process.exit(1);
      }
    });

  // ── boot task list ──────────────────────────────────────────────────────────
  task
    .command("list")
    .description("List all tasks")
    .option("--status <status>", "Filter by status: open | active | paused | completed")
    .action(async (opts) => {
      try {
        let tasks = listTasks();
        if (opts.status) tasks = tasks.filter((t) => t.status === opts.status);

        if (tasks.length === 0) {
          log.warn("No tasks found. Run `boot task create` to start one.");
          return;
        }

        log.blank();
        log.table([
          ["ID", "Status", "Title", "Branch", "Sessions", "Updated"],
          ...tasks.map((t) => [
            t.id.slice(0, 8),
            t.status,
            t.title.length > 36 ? t.title.slice(0, 33) + "..." : t.title,
            t.git.branch,
            String(t.sessionCount),
            formatRelativeTime(t.updatedAt),
          ]),
        ]);
        log.blank();
      } catch (err: any) {
        log.error(err.message);
        process.exit(1);
      }
    });

  // ── boot task resume <taskId> ───────────────────────────────────────────────
  task
    .command("resume <taskId>")
    .description("Mark a task as active and print its context")
    .action(async (taskId: string) => {
      try {
        const t = resumeTask(taskId);
        if (!t) { log.error(`Task not found: ${taskId}`); process.exit(1); }

        // Create a linked session if no active session exists
        let session = getLatestActiveSession();
        if (!session) {
          session = createSession(t.title, "other", process.cwd(), t.id);
          linkSessionToTask(t.id, session.id);
          log.step(`Created new session ${session.id.slice(0, 8)}`);
        } else if (session.taskId !== t.id) {
          linkSessionToTask(t.id, session.id);
        }

        log.blank();
        log.header(`Resuming: ${t.title}`);
        log.table([
          ["Task ID:    ", t.id.slice(0, 8)],
          ["Status:     ", t.status],
          ["Branch:     ", t.git.branch],
          ["Sessions:   ", String(t.sessionCount)],
          ["Last active:", t.lastResumedAt ? formatRelativeTime(t.lastResumedAt) : "never"],
        ]);
        if (t.summary) { log.blank(); log.step(t.summary); }
        log.blank();
      } catch (err: any) {
        log.error(err.message);
        process.exit(1);
      }
    });

  // ── boot task close <taskId> ────────────────────────────────────────────────
  task
    .command("close <taskId>")
    .description("Mark a task as completed")
    .action(async (taskId: string) => {
      try {
        const t = closeTask(taskId);
        if (!t) { log.error(`Task not found: ${taskId}`); process.exit(1); }
        log.blank();
        log.success(`Task closed: ${t.title}`);
        log.step(`Sessions: ${t.sessionCount} · Snapshots: ${t.linkedSnapshotIds.length}`);
        log.blank();
      } catch (err: any) {
        log.error(err.message);
        process.exit(1);
      }
    });

  // ── boot task pause <taskId> ────────────────────────────────────────────────
  task
    .command("pause <taskId>")
    .description("Pause a task")
    .action(async (taskId: string) => {
      try {
        const t = pauseTask(taskId);
        if (!t) { log.error(`Task not found: ${taskId}`); process.exit(1); }
        log.blank();
        log.success(`Task paused: ${t.title}`);
        log.blank();
      } catch (err: any) {
        log.error(err.message);
        process.exit(1);
      }
    });
}

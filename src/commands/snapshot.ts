import { Command } from "commander";
import { log } from "../lib/log";
import { createSnapshot, listSnapshots, buildRestorePlan } from "../snapshots/snapshotStore";
import { formatRelativeTime } from "../sessions/sessionStore";

export function registerSnapshotCommands(program: Command): void {
  const snap = program
    .command("snapshot")
    .description("Create and restore project continuity checkpoints");

  // ── boot snapshot create ────────────────────────────────────────────────────
  snap
    .command("create")
    .description("Create a snapshot of current git state + active session context")
    .option("--files <files>", "Comma-separated list of selected files to include")
    .option("--summary <summary>", "Optional context summary")
    .action(async (opts) => {
      try {
        const selectedFiles = opts.files
          ? opts.files.split(",").map((f: string) => f.trim()).filter(Boolean)
          : [];

        const s = createSnapshot(selectedFiles, opts.summary ?? "");

        log.blank();
        log.success("Snapshot created");
        log.blank();
        log.table([
          ["Snapshot ID:  ", s.id.slice(0, 8)],
          ["Branch:       ", s.git.branch],
          ["Commit:       ", s.git.commit],
          ["Session:      ", s.sessionId?.slice(0, 8) ?? "none"],
          ["Task:         ", s.taskId?.slice(0, 8) ?? "none"],
          ["Changed files:", String(s.git.changedFiles.length)],
        ]);
        if (s.contextSummary) {
          log.blank();
          log.step(s.contextSummary);
        }
        log.blank();
        log.step("Restore plan: run `boot snapshot restore " + s.id.slice(0, 8) + "`");
        log.blank();
      } catch (err: any) {
        log.error(err.message);
        process.exit(1);
      }
    });

  // ── boot snapshot list ──────────────────────────────────────────────────────
  snap
    .command("list")
    .description("List all snapshots")
    .action(async () => {
      try {
        const snaps = listSnapshots();

        if (snaps.length === 0) {
          log.warn("No snapshots found. Run `boot snapshot create` to save a checkpoint.");
          return;
        }

        log.blank();
        log.table([
          ["ID", "Branch", "Commit", "Session", "Task", "Created"],
          ...snaps.map((s) => [
            s.id.slice(0, 8),
            s.git.branch,
            s.git.commit,
            s.sessionId?.slice(0, 8) ?? "—",
            s.taskId?.slice(0, 8) ?? "—",
            formatRelativeTime(s.createdAt),
          ]),
        ]);
        log.blank();
      } catch (err: any) {
        log.error(err.message);
        process.exit(1);
      }
    });

  // ── boot snapshot restore <snapshotId> ─────────────────────────────────────
  snap
    .command("restore <snapshotId>")
    .description("Print a restore plan for the given snapshot (safe — does not mutate worktree)")
    .action(async (snapshotId: string) => {
      try {
        const plan = buildRestorePlan(snapshotId);
        if (!plan) { log.error(`Snapshot not found: ${snapshotId}`); process.exit(1); }

        log.blank();
        log.header("Snapshot Restore Plan");
        log.blank();
        log.table([
          ["Snapshot ID:", plan.snapshotId.slice(0, 8)],
          ["Target repo:", plan.targetRepo],
          ["Target branch:", plan.targetBranch],
          ["Target session:", plan.targetSession?.slice(0, 8) ?? "none"],
          ["Target task:", plan.targetTask?.slice(0, 8) ?? "none"],
          ["Changed files:", String(plan.changedFiles.length)],
        ]);

        if (plan.warnings.length > 0) {
          log.blank();
          log.warn("Warnings:");
          for (const w of plan.warnings) log.step(`⚠ ${w}`);
        }

        if (plan.changedFiles.length > 0) {
          log.blank();
          log.step("Files that were changed at snapshot time:");
          for (const f of plan.changedFiles.slice(0, 10)) log.step(`  ${f}`);
          if (plan.changedFiles.length > 10) log.step(`  ...and ${plan.changedFiles.length - 10} more`);
        }

        log.blank();
        log.step("Suggested commands to restore context:");
        for (const cmd of plan.suggestedCommands) log.step(`  $ ${cmd}`);
        log.blank();
        log.step("Note: OpenBoot restores continuity context, not repo state.");
        log.step("Use git directly to restore code to a specific commit.");
        log.blank();
      } catch (err: any) {
        log.error(err.message);
        process.exit(1);
      }
    });
}

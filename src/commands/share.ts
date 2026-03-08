import { Command } from "commander";
import * as path from "path";
import { log } from "../lib/log";
import { createBundle, importBundle, listBundles, getBundlesDir } from "../bundles/bundleStore";
import { formatRelativeTime } from "../sessions/sessionStore";

export function registerShareCommands(program: Command): void {
  const share = program
    .command("share")
    .description("Package and share OpenBoot sessions, tasks, and snapshots as portable bundles");

  // ── boot share <artifactId> ─────────────────────────────────────────────────
  share
    .command("create [artifactId]")
    .description("Create a shareable bundle from the current repo's sessions, tasks, and snapshots")
    .option("--sessions <ids>", "Comma-separated session IDs to include")
    .option("--tasks <ids>", "Comma-separated task IDs to include")
    .option("--snapshots <ids>", "Comma-separated snapshot IDs to include")
    .option("--all", "Include all artifacts for this repo (default)")
    .action(async (artifactId: string | undefined, opts) => {
      try {
        const cwd = process.cwd();
        const bundle = createBundle({
          artifactId,
          sessionIds: opts.sessions?.split(",").map((s: string) => s.trim()),
          taskIds: opts.tasks?.split(",").map((s: string) => s.trim()),
          snapshotIds: opts.snapshots?.split(",").map((s: string) => s.trim()),
          includeAll: !opts.sessions && !opts.tasks && !opts.snapshots,
        }, cwd);

        const bundleFile = path.join(getBundlesDir(cwd), `bundle-${bundle.id.slice(0, 8)}.json`);

        log.blank();
        log.success("Bundle created");
        log.blank();
        log.table([
          ["Bundle ID:  ", bundle.id.slice(0, 8)],
          ["Machine:    ", bundle.sourceMachine],
          ["Repo:       ", `${bundle.repo.name} @ ${bundle.repo.branch}`],
          ["Sessions:   ", String(bundle.sessions.length)],
          ["Tasks:      ", String(bundle.tasks.length)],
          ["Snapshots:  ", String(bundle.snapshots.length)],
          ["Location:   ", bundleFile.replace(cwd + "/", "")],
        ]);
        log.blank();
        log.step("Share this file with teammates or copy it to another machine.");
        log.step(`Then run: boot import bundle ${bundleFile.replace(cwd + "/", "")}`);
        log.blank();
      } catch (err: any) {
        log.error(err.message);
        process.exit(1);
      }
    });

  // ── boot share list ─────────────────────────────────────────────────────────
  share
    .command("list")
    .description("List all bundles in .openboot/bundles/")
    .action(async () => {
      try {
        const bundles = listBundles();
        if (bundles.length === 0) {
          log.warn("No bundles found. Run `boot share create` to create one.");
          return;
        }
        log.blank();
        log.table([
          ["ID", "Machine", "Repo", "Sessions", "Tasks", "Snapshots", "Created"],
          ...bundles.map((b) => [
            b.id.slice(0, 8),
            b.sourceMachine,
            `${b.repo.name}@${b.repo.branch}`,
            String(b.sessions),
            String(b.tasks),
            String(b.snapshots),
            formatRelativeTime(b.createdAt),
          ]),
        ]);
        log.blank();
      } catch (err: any) {
        log.error(err.message);
        process.exit(1);
      }
    });
}

export function registerImportCommand(program: Command): void {
  const importCmd = program
    .command("import")
    .description("Import artifacts into OpenBoot");

  // ── boot import bundle <path> ───────────────────────────────────────────────
  importCmd
    .command("bundle <bundlePath>")
    .description("Import a shared bundle file into the local OpenBoot store")
    .action(async (bundlePath: string) => {
      try {
        const cwd = process.cwd();
        const resolved = path.resolve(cwd, bundlePath);

        log.blank();
        log.info(`Importing bundle from: ${resolved}`);

        const result = importBundle(resolved, cwd);

        log.blank();
        log.success("Bundle imported");
        log.blank();
        log.table([
          ["Bundle ID:          ", result.bundleId.slice(0, 8)],
          ["Sessions imported:  ", String(result.sessionsImported)],
          ["Tasks imported:     ", String(result.tasksImported)],
          ["Snapshots imported: ", String(result.snapshotsImported)],
          ["Skipped (exist):    ", String(result.skipped)],
        ]);

        if (result.warnings.length > 0) {
          log.blank();
          for (const w of result.warnings) log.warn(w);
        }

        log.blank();
        log.step("Run `boot resume` to pick up where they left off.");
        log.blank();
      } catch (err: any) {
        log.error(err.message);
        process.exit(1);
      }
    });
}

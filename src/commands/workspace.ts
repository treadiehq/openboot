import { Command } from "commander";
import { log } from "../lib/log";
import {
  createWorkspace,
  addRepoToWorkspace,
  listWorkspaces,
  readWorkspace,
  getWorkspacesDir,
} from "../workspace/workspaceStore";
import * as path from "path";

export function registerWorkspaceCommands(program: Command): void {
  const ws = program
    .command("workspace")
    .description("Link multiple repositories into a named workspace for cross-repo AI workflows");

  // ── boot workspace create <name> ────────────────────────────────────────────
  ws
    .command("create <name>")
    .description("Create a new workspace")
    .option("--repo <path>", "Add a repository path to this workspace (can repeat)", (v, acc: string[]) => { acc.push(v); return acc; }, [] as string[])
    .action(async (name: string, opts) => {
      try {
        const repos = opts.repo.length > 0 ? opts.repo : [process.cwd()];
        const workspace = createWorkspace(name, repos);

        log.blank();
        log.success(`Workspace "${name}" created`);
        log.blank();
        log.table([
          ["ID:    ", workspace.id.slice(0, 8)],
          ["Name:  ", workspace.name],
          ["Repos: ", workspace.repos.join(", ")],
        ]);
        log.blank();
        log.step(`Stored at: ${getWorkspacesDir()}`);
        log.blank();
      } catch (err: any) {
        log.error(err.message);
        process.exit(1);
      }
    });

  // ── boot workspace add-repo <workspaceId> <repoPath> ───────────────────────
  ws
    .command("add-repo <workspaceId> [repoPath]")
    .description("Add a repository to an existing workspace")
    .action(async (workspaceId: string, repoPath: string | undefined) => {
      try {
        const resolved = path.resolve(repoPath ?? process.cwd());
        const updated = addRepoToWorkspace(workspaceId, resolved);
        if (!updated) {
          log.error(`Workspace not found: ${workspaceId}`);
          process.exit(1);
        }

        log.blank();
        log.success(`Repository added to workspace "${updated.name}"`);
        log.blank();
        for (const r of updated.repos) {
          log.step(`  ${r}`);
        }
        log.blank();
      } catch (err: any) {
        log.error(err.message);
        process.exit(1);
      }
    });

  // ── boot workspace list ─────────────────────────────────────────────────────
  ws
    .command("list")
    .description("List all workspaces")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      try {
        const workspaces = listWorkspaces();

        if (opts.json) {
          console.log(JSON.stringify(workspaces, null, 2));
          return;
        }

        if (workspaces.length === 0) {
          log.warn("No workspaces found. Run `boot workspace create <name>` to create one.");
          return;
        }

        log.blank();
        log.table([
          ["ID", "Name", "Repos", "Created"],
          ...workspaces.map((w) => [
            w.id.slice(0, 8),
            w.name,
            String(w.repos.length),
            new Date(w.createdAt).toLocaleDateString(),
          ]),
        ]);
        log.blank();
      } catch (err: any) {
        log.error(err.message);
        process.exit(1);
      }
    });

  // ── boot workspace show <id> ────────────────────────────────────────────────
  ws
    .command("show <workspaceId>")
    .description("Show details for a workspace")
    .action(async (workspaceId: string) => {
      try {
        const workspace = readWorkspace(workspaceId);
        if (!workspace) {
          log.error(`Workspace not found: ${workspaceId}`);
          process.exit(1);
        }

        log.blank();
        log.table([
          ["ID:      ", workspace.id.slice(0, 8)],
          ["Name:    ", workspace.name],
          ["Created: ", new Date(workspace.createdAt).toLocaleDateString()],
          ["Updated: ", new Date(workspace.updatedAt).toLocaleDateString()],
        ]);
        log.blank();
        log.step("Repositories:");
        for (const r of workspace.repos) {
          log.step(`  ${r}`);
        }
        log.blank();
      } catch (err: any) {
        log.error(err.message);
        process.exit(1);
      }
    });
}

import { Command } from "commander";
import { log } from "../lib/log";
import {
  createSession,
  getLatestActiveSession,
  listSessions,
  exportSession,
  appendMessage,
  formatRelativeTime,
  resolveSessionId,
  Session,
} from "../sessions/sessionStore";
import { importSessions, ADAPTERS } from "../sessions/importSessions";

const VALID_TOOLS = ["cursor", "claude", "cli", "other"] as const;

function isValidTool(t: string): t is Session["tool"] {
  return (VALID_TOOLS as readonly string[]).includes(t);
}

/**
 * Register all `boot session` subcommands on the program.
 */
export function registerSessionCommands(program: Command): void {
  const session = program
    .command("session")
    .description("Persist, resume, and export AI coding sessions");

  // ─────────────────────────────────────────────
  // boot session start
  // ─────────────────────────────────────────────
  session
    .command("start")
    .description("Start a new AI coding session")
    .option("-t, --task <description>", "Short task description", "New session")
    .option(
      "--tool <tool>",
      "AI tool in use: cursor | claude | cli | other",
      "other"
    )
    .action(async (opts) => {
      try {
        const tool = isValidTool(opts.tool) ? opts.tool : "other";
        const s = createSession(opts.task, tool);

        log.blank();
        log.success("Session started");
        log.blank();
        log.table([
          ["Session ID:", s.id.slice(0, 8)],
          ["Full ID:   ", s.id],
          ["Project:   ", s.project],
          ["Branch:    ", s.branch],
          ["Tool:      ", s.tool],
          ["Task:      ", s.task],
        ]);
        log.blank();
      } catch (err: any) {
        log.error(err.message);
        process.exit(1);
      }
    });

  // ─────────────────────────────────────────────
  // boot session resume
  // ─────────────────────────────────────────────
  session
    .command("resume")
    .description("Resume the most recent active AI coding session")
    .option("--json", "Output full session JSON")
    .action(async (opts) => {
      try {
        const s = getLatestActiveSession();
        if (!s) {
          log.warn("No active sessions found. Run `boot session start` to begin.");
          return;
        }

        log.blank();
        log.header("Resuming session");
        log.table([
          ["Session ID:", s.id.slice(0, 8)],
          ["Task:      ", s.task],
          ["Tool:      ", s.tool],
          ["Project:   ", s.project],
          ["Branch:    ", s.branch],
          ["Messages:  ", String(s.messages.length)],
          ["Events:    ", String(s.events?.length ?? 0)],
          ["Status:    ", s.status ?? "active"],
          ["Last updated:", formatRelativeTime(s.updatedAt)],
        ]);
        log.blank();

        if (s.metadata.filesTouched?.length > 0) {
          log.info(`Files touched: ${s.metadata.filesTouched.join(", ")}`);
          log.blank();
        }

        if (opts.json) {
          console.log(JSON.stringify(s, null, 2));
        }
      } catch (err: any) {
        log.error(err.message);
        process.exit(1);
      }
    });

  // ─────────────────────────────────────────────
  // boot session list
  // ─────────────────────────────────────────────
  session
    .command("list")
    .description("List all saved sessions (active + imported)")
    .action(async () => {
      try {
        const sessions = listSessions();
        if (sessions.length === 0) {
          log.warn("No sessions found. Run `boot session start` to begin.");
          return;
        }

        log.blank();
        log.table([
          ["ID", "Source", "Tool", "Task", "Branch", "Updated"],
          ...sessions.map((s) => [
            s.id.slice(0, 8),
            s.source?.type ?? "openboot",
            s.tool,
            s.task.length > 36 ? s.task.slice(0, 33) + "..." : s.task,
            s.branch,
            formatRelativeTime(s.updatedAt),
          ]),
        ]);
        log.blank();
      } catch (err: any) {
        log.error(err.message);
        process.exit(1);
      }
    });

  // ─────────────────────────────────────────────
  // boot session export <id>
  // ─────────────────────────────────────────────
  session
    .command("export <id>")
    .description("Export a session to .openboot/exports/<id>.json")
    .action(async (id: string) => {
      try {
        const resolvedId = resolveSessionId(id);
        if (!resolvedId) {
          log.error(`No session found matching ID prefix: ${id}`);
          process.exit(1);
        }
        const dest = exportSession(resolvedId);
        log.blank();
        log.success("Session exported");
        log.step(`Path: ${dest}`);
        log.blank();
      } catch (err: any) {
        log.error(err.message);
        process.exit(1);
      }
    });

  // ─────────────────────────────────────────────
  // boot session attach
  // ─────────────────────────────────────────────
  session
    .command("attach")
    .description("Append a message to the latest session")
    .option("-r, --role <role>", "Message role: user | assistant | system", "assistant")
    .requiredOption("-m, --message <text>", "Message content to append")
    .action(async (opts) => {
      try {
        const latest = getLatestActiveSession();
        if (!latest) {
          log.error("No active sessions found. Run `boot session start` first.");
          process.exit(1);
        }

        const validRoles = ["user", "assistant", "system"];
        const role = validRoles.includes(opts.role) ? opts.role : "assistant";
        appendMessage(latest.id, role as "user" | "assistant" | "system", opts.message);

        log.blank();
        log.success(`Message attached to session ${latest.id.slice(0, 8)}`);
        log.step(`Role: ${role}`);
        log.blank();
      } catch (err: any) {
        log.error(err.message);
        process.exit(1);
      }
    });

  // ─────────────────────────────────────────────
  // boot session import <source>
  // ─────────────────────────────────────────────
  session
    .command("import <source>")
    .description(
      `Import sessions from a local tool history. Sources: ${Object.keys(ADAPTERS).join(", ")}`
    )
    .action(async (source: string) => {
      try {
        const adapter = ADAPTERS[source.toLowerCase()];
        if (!adapter) {
          log.error(
            `Unsupported source: "${source}". Supported: ${Object.keys(ADAPTERS).join(", ")}`
          );
          process.exit(1);
        }

        log.blank();
        log.info(`Searching for local ${adapter.displayName} session files...`);

        const result = await importSessions(source.toLowerCase());

        if (result.checkedPaths.length === 0) {
          log.blank();
          log.warn(`No local ${adapter.displayName} session files were found on this machine.`);
          log.step("Checked:");
          const defaultPaths = getAdapterDefaultPaths(source.toLowerCase());
          for (const p of defaultPaths) log.step(`- ${p}`);
          log.blank();
          return;
        }

        log.blank();
        log.success(`${adapter.displayName} import complete`);
        log.blank();
        log.table([
          ["Candidate files:", String(result.candidateFiles)],
          ["Imported:       ", String(result.imported)],
          ["Skipped (dup):  ", String(result.skipped)],
          ["Saved to:       ", result.savedTo],
        ]);
        log.blank();
      } catch (err: any) {
        log.error(err.message);
        process.exit(1);
      }
    });
}

function getAdapterDefaultPaths(source: string): string[] {
  const os = require("os");
  const path = require("path");
  const home = os.homedir();
  const map: Record<string, string[]> = {
    cursor: ["~/.cursor", "~/Library/Application Support/Cursor"],
    claude: ["~/.claude", "~/.config/claude"],
    opencode: ["~/.opencode", "~/.config/opencode"],
    openai: ["~/.openai", "~/.codex"],
  };
  return (map[source] || []).map((p) =>
    p.replace("~", home)
  );
}

import { Command } from "commander";
import { log } from "../lib/log";
import { readSession, listSessions, getLatestActiveSession } from "../sessions/sessionStore";
import { buildReplayEntries, renderReplay } from "../replay/renderReplay";

export function registerReplayCommand(program: Command): void {
  program
    .command("replay [sessionId]")
    .description("Replay an AI coding session — show prompts, responses, files, and commands chronologically")
    .option("--json", "Output replay as JSON")
    .option("--messages-only", "Show only prompts and responses")
    .option("--events-only", "Show only file changes and commands")
    .action(async (sessionId: string | undefined, opts) => {
      try {
        const cwd = process.cwd();

        let session = sessionId
          ? readSession(sessionId, cwd)
          : getLatestActiveSession(cwd);

        if (!session && !sessionId) {
          // Fall back to most recent of any status
          const all = listSessions(cwd);
          session = all[0] ?? null;
        }

        if (!session) {
          log.error(sessionId ? `Session not found: ${sessionId}` : "No sessions found.");
          log.step("Run `boot session list` to see available sessions.");
          process.exit(1);
        }

        let entries = buildReplayEntries(session);

        if (opts.messagesOnly) {
          entries = entries.filter((e) => e.kind === "message" || e.kind === "meta");
        } else if (opts.eventsOnly) {
          entries = entries.filter((e) => e.kind === "event");
        }

        if (opts.json) {
          console.log(JSON.stringify({ session: { id: session.id, task: session.task }, entries }, null, 2));
          return;
        }

        process.stdout.write(renderReplay(session, entries));
      } catch (err: any) {
        log.error(err.message);
        process.exit(1);
      }
    });
}

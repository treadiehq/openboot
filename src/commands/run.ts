import { Command } from "commander";
import { log } from "../lib/log";
import { runTool, isSupportedTool, getSupportedTools } from "../sessions/wrappers/runTool";

/**
 * Register `boot run <tool> [...args]`
 *
 * Launches a supported CLI tool as a child process, streams its output live,
 * and captures command + output events into the active OpenBoot session.
 */
export function registerRunCommand(program: Command): void {
  program
    .command("run <tool> [args...]")
    .description(
      `Run a CLI tool and capture its activity into the active session. Supported: ${getSupportedTools().join(", ")}`
    )
    .allowUnknownOption(true)
    .action(async (tool: string, args: string[]) => {
      if (!isSupportedTool(tool)) {
        log.error(
          `Unsupported tool: "${tool}". Supported: ${getSupportedTools().join(", ")}`
        );
        process.exit(1);
      }

      log.blank();
      log.info(`Starting ${tool}${args.length ? " " + args.join(" ") : ""}...`);
      log.step("Session capture active — activity will be logged to the current OpenBoot session.");
      log.blank();

      try {
        const result = await runTool({ tool, args });

        log.blank();
        if (result.exitCode === 0) {
          log.success(
            `${tool} exited cleanly (${(result.durationMs / 1000).toFixed(1)}s) — events saved to session ${result.session.id.slice(0, 8)}`
          );
        } else {
          log.warn(
            `${tool} exited with code ${result.exitCode} (${(result.durationMs / 1000).toFixed(1)}s)`
          );
        }
        log.blank();

        process.exit(result.exitCode);
      } catch (err: any) {
        log.error(err.message);
        process.exit(1);
      }
    });
}

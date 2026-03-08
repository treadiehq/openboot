import { spawn } from "child_process";
import {
  Session,
  createSession,
  appendEvent,
  getLatestActiveSession,
  writeSession,
  getActiveSessionsDir,
} from "../sessionStore";
import {
  buildCommandEvent,
  buildStdoutEvent,
  buildStderrEvent,
  redactEnvValues,
} from "./processCapture";

export interface RunToolOptions {
  tool: string;
  args: string[];
  cwd?: string;
}

export interface RunToolResult {
  session: Session;
  exitCode: number;
  durationMs: number;
}

const SUPPORTED_TOOLS = ["claude", "opencode", "openai"];

export function isSupportedTool(tool: string): boolean {
  return SUPPORTED_TOOLS.includes(tool);
}

export function getSupportedTools(): string[] {
  return [...SUPPORTED_TOOLS];
}

/**
 * Launch a CLI tool as a child process, stream its output live to the terminal,
 * and capture events into an active OpenBoot session.
 *
 * Security: never stores environment variable values — only key names.
 */
export async function runTool(opts: RunToolOptions): Promise<RunToolResult> {
  const { tool, args, cwd = process.cwd() } = opts;

  // Use or create an active session
  let session = getLatestActiveSession(cwd);
  if (!session) {
    const task = args.find((a) => !a.startsWith("-")) || `${tool} session`;
    session = createSession(task, tool as Session["tool"], cwd);
  }

  const envKeys = redactEnvValues(process.env);
  const startedAt = new Date().toISOString();
  const commandEvent = buildCommandEvent(tool, args, cwd, envKeys, startedAt);

  session.events = [...(session.events ?? []), commandEvent];
  session.updatedAt = startedAt;
  writeSession(session, getActiveSessionsDir(cwd), cwd);

  const startMs = Date.now();

  return new Promise((resolve) => {
    const child = spawn(tool, args, {
      stdio: ["inherit", "pipe", "pipe"],
      cwd,
      env: process.env,
      shell: false,
    });

    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      process.stdout.write(text);
      stdoutChunks.push(text);
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      process.stderr.write(text);
      stderrChunks.push(text);
    });

    child.on("close", (code) => {
      const exitCode = code ?? 1;
      const durationMs = Date.now() - startMs;
      const endedAt = new Date().toISOString();

      const stdout = stdoutChunks.join("").trim();
      const stderr = stderrChunks.join("").trim();

      const s = session!;

      if (stdout) {
        s.events.push(buildStdoutEvent(stdout, exitCode, durationMs, endedAt));
      }

      if (stderr && exitCode !== 0) {
        s.events.push(buildStderrEvent(stderr, exitCode, endedAt));
      }

      s.status = "idle";
      s.updatedAt = endedAt;
      s.metadata.commandsRun = [
        ...(s.metadata.commandsRun || []),
        `${tool} ${args.join(" ")}`.trim(),
      ];
      writeSession(s, getActiveSessionsDir(cwd), cwd);

      resolve({ session: s, exitCode, durationMs });
    });

    child.on("error", (err) => {
      const durationMs = Date.now() - startMs;
      const s = session!;
      s.events.push(buildStderrEvent(err.message, 1, new Date().toISOString()));
      s.updatedAt = new Date().toISOString();
      writeSession(s, getActiveSessionsDir(cwd), cwd);
      resolve({ session: s, exitCode: 1, durationMs });
    });
  });
}

import { SessionEvent } from "../sessionStore";
import { randomUUID } from "crypto";

/**
 * Helpers for building structured session events from child process data.
 * Used by runTool.ts — extracted here so future wrappers can reuse them.
 */

export function buildCommandEvent(
  tool: string,
  args: string[],
  cwd: string,
  envKeys: string[],
  startedAt: string
): SessionEvent {
  return {
    id: randomUUID(),
    type: "command",
    timestamp: startedAt,
    data: { tool, args, cwd, envKeysPresent: envKeys, startedAt },
  };
}

export function buildStdoutEvent(
  chunk: string,
  exitCode: number,
  durationMs: number,
  endedAt: string
): SessionEvent {
  return {
    id: randomUUID(),
    type: "stdout",
    timestamp: endedAt,
    data: { chunk, exitCode, durationMs, endedAt },
  };
}

export function buildStderrEvent(chunk: string, exitCode: number, endedAt: string): SessionEvent {
  return {
    id: randomUUID(),
    type: "stderr",
    timestamp: endedAt,
    data: { chunk, exitCode },
  };
}

export function buildImportEvent(
  source: string,
  sourcePath: string,
  sessionId: string
): SessionEvent {
  return {
    id: randomUUID(),
    type: "import",
    timestamp: new Date().toISOString(),
    data: { source, sourcePath, sessionId },
  };
}

export function buildNoteEvent(content: string): SessionEvent {
  return {
    id: randomUUID(),
    type: "note",
    timestamp: new Date().toISOString(),
    data: { content },
  };
}

/**
 * Redact environment variable values, keeping only key names.
 * Never call this with already-filtered objects.
 */
export function redactEnvValues(env: NodeJS.ProcessEnv): string[] {
  return Object.keys(env).filter(
    (k) =>
      k.toUpperCase().includes("API") ||
      k.toUpperCase().includes("KEY") ||
      k.toUpperCase().includes("TOKEN") ||
      k.toUpperCase().includes("SECRET")
  );
}

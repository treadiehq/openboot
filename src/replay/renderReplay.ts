import { Session, SessionMessage, SessionEvent } from "../sessions/sessionStore";

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const BOLD = "\x1b[1m";

export interface ReplayEntry {
  timestamp: string;
  kind: "message" | "event" | "meta";
  label: string;
  detail?: string;
}

/**
 * Flatten session messages and events into a chronological replay.
 */
export function buildReplayEntries(session: Session): ReplayEntry[] {
  const entries: ReplayEntry[] = [];

  entries.push({
    timestamp: session.createdAt,
    kind: "meta",
    label: `Session started — ${session.task || "unnamed"}`,
    detail: `branch: ${session.git?.branch ?? session.branch} · project: ${session.project}`,
  });

  const messages: ReplayEntry[] = (session.messages ?? []).map((m) => ({
    timestamp: m.timestamp,
    kind: "message" as const,
    label: `[${m.role}] ${m.content.slice(0, 120).replace(/\n/g, " ")}${m.content.length > 120 ? "…" : ""}`,
  }));

  const events: ReplayEntry[] = (session.events ?? []).map((e) => ({
    timestamp: e.timestamp,
    kind: "event" as const,
    label: eventLabel(e),
  }));

  entries.push(...messages, ...events);

  if (session.metadata.filesTouched?.length) {
    entries.push({
      timestamp: session.updatedAt,
      kind: "meta",
      label: `Files touched: ${session.metadata.filesTouched.slice(0, 5).join(", ")}${session.metadata.filesTouched.length > 5 ? ` (+${session.metadata.filesTouched.length - 5} more)` : ""}`,
    });
  }

  if (session.metadata.commandsRun?.length) {
    entries.push({
      timestamp: session.updatedAt,
      kind: "meta",
      label: `Commands run: ${session.metadata.commandsRun.slice(0, 3).join(", ")}`,
    });
  }

  entries.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  return entries;
}

/**
 * Render replay entries as coloured terminal output.
 */
export function renderReplay(session: Session, entries: ReplayEntry[]): string {
  const lines: string[] = [];

  lines.push(`${CYAN}${BOLD}Session Replay${RESET}`);
  lines.push(`${DIM}ID: ${session.id.slice(0, 8)} · ${session.task || "unnamed"}${RESET}`);
  lines.push("");

  for (const e of entries) {
    const t = new Date(e.timestamp);
    const time = `${t.getHours().toString().padStart(2, "0")}:${t.getMinutes().toString().padStart(2, "0")}`;
    const prefix = `${DIM}[${time}]${RESET}`;

    if (e.kind === "message") {
      const isUser = e.label.startsWith("[user]");
      const color = isUser ? GREEN : BLUE;
      lines.push(`  ${prefix} ${color}${e.label}${RESET}`);
    } else if (e.kind === "event") {
      lines.push(`  ${prefix} ${YELLOW}${e.label}${RESET}`);
    } else {
      lines.push(`  ${prefix} ${DIM}${e.label}${RESET}`);
    }

    if (e.detail) {
      lines.push(`         ${DIM}${e.detail}${RESET}`);
    }
  }

  if (entries.length === 0) {
    lines.push(`  ${DIM}No activity recorded in this session.${RESET}`);
  }

  lines.push("");
  return lines.join("\n");
}

function eventLabel(e: SessionEvent): string {
  switch (e.type) {
    case "command":
      return `file modified: ${e.data.tool} ${((e.data.args as string[]) ?? []).join(" ")}`.trim();
    case "file-change":
      return `file modified: ${e.data.filePath ?? "unknown"}`;
    case "note":
      return `note: ${String(e.data.content ?? "").slice(0, 80)}`;
    case "import":
      return `imported from: ${e.data.source}`;
    case "stdout":
      return `output captured (${e.data.exitCode !== undefined ? `exit ${e.data.exitCode}` : "running"})`;
    default:
      return `${e.type} event`;
  }
}

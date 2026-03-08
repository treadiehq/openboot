import { Session, SessionEvent } from "../sessions/sessionStore";

/**
 * Deterministic local summarizer — no external AI APIs.
 * Infers a concise summary from session data: files touched, commands run,
 * key event types, task title, and recent message excerpts.
 */
export function buildSessionSummary(session: Session): string {
  const parts: string[] = [];

  if (session.task && session.task !== "New session") {
    parts.push(`Task: ${session.task}`);
  }

  if (session.metadata.commandsRun?.length > 0) {
    parts.push(`Commands: ${session.metadata.commandsRun.slice(0, 3).join(", ")}`);
  }

  if (session.metadata.filesTouched?.length > 0) {
    parts.push(`Files: ${session.metadata.filesTouched.slice(0, 5).join(", ")}`);
  }

  const eventTypes = [...new Set((session.events ?? []).map((e) => e.type))];
  if (eventTypes.length > 0) {
    parts.push(`Events: ${eventTypes.join(", ")}`);
  }

  const lastUserMsg = [...(session.messages ?? [])]
    .reverse()
    .find((m) => m.role === "user");
  if (lastUserMsg) {
    const excerpt = lastUserMsg.content.slice(0, 60).replace(/\n/g, " ").trim();
    parts.push(`Last prompt: ${excerpt}${lastUserMsg.content.length > 60 ? "…" : ""}`);
  }

  return parts.join(" · ") || "No activity recorded";
}

export interface TimelineEntry {
  timestamp: string;
  type: "session-start" | "task" | "snapshot" | "event" | "file-change" | "command";
  label: string;
  ref?: string;
}

/**
 * Flatten session events into timeline-ready entries.
 */
export function sessionToTimelineEntries(session: Session): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  entries.push({
    timestamp: session.createdAt,
    type: "session-start",
    label: `Started session — ${session.task || "unnamed"}`,
    ref: session.id.slice(0, 8),
  });

  for (const ev of session.events ?? []) {
    entries.push(eventToEntry(ev, session.id));
  }

  return entries;
}

function eventToEntry(ev: SessionEvent, sessionId: string): TimelineEntry {
  switch (ev.type) {
    case "command":
      return {
        timestamp: ev.timestamp,
        type: "command",
        label: `Ran wrapped command: ${ev.data.tool} ${((ev.data.args as string[]) ?? []).join(" ")}`.trim(),
        ref: sessionId.slice(0, 8),
      };
    case "file-change":
      return {
        timestamp: ev.timestamp,
        type: "file-change",
        label: `File changed: ${ev.data.filePath ?? "unknown"}`,
        ref: sessionId.slice(0, 8),
      };
    case "note":
      return {
        timestamp: ev.timestamp,
        type: "event",
        label: `Note: ${String(ev.data.content ?? "").slice(0, 60)}`,
        ref: sessionId.slice(0, 8),
      };
    default:
      return {
        timestamp: ev.timestamp,
        type: "event",
        label: `${ev.type} event`,
        ref: sessionId.slice(0, 8),
      };
  }
}

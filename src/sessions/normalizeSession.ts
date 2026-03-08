import { randomUUID } from "crypto";
import { Session, SessionMessage, SessionEvent, SessionSource } from "./sessionStore";

/**
 * Normalize a raw partial session (from an adapter) into a full OpenBoot Session.
 * This is the canonical normalization step — all adapters feed through here.
 *
 * Rules:
 * - Always assigns a new UUID (never reuses external IDs as the primary key)
 * - Preserves messages array if present
 * - Initializes events to [] if missing
 * - Sets status to "imported"
 * - Keeps backward compat: if older files lack source/events/status, fills defaults
 */
export function normalizeSession(
  partial: Omit<Session, "id" | "createdAt" | "updatedAt">
): Session {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    tool: partial.tool ?? "other",
    project: partial.project ?? "unknown",
    branch: partial.branch ?? "unknown",
    task: partial.task ?? "Imported session",
    status: partial.status ?? "imported",
    source: partial.source ?? { type: "imported", name: "manual" },
    taskId: (partial as any).taskId,
    snapshotIds: (partial as any).snapshotIds ?? [],
    summary: (partial as any).summary ?? "",
    git: (partial as any).git,
    messages: normalizeMessages(partial.messages),
    events: normalizeEvents(partial.events),
    metadata: {
      filesTouched: partial.metadata?.filesTouched ?? [],
      commandsRun: partial.metadata?.commandsRun ?? [],
      rawSource: partial.metadata?.rawSource,
    },
  };
}

/**
 * Apply backward compatibility to a session loaded from disk.
 * Older session files may lack source, events, and status — this fills safe defaults.
 */
export function backfillSession(raw: Record<string, unknown>): Session {
  return {
    id: (raw.id as string) ?? randomUUID(),
    createdAt: (raw.createdAt as string) ?? new Date().toISOString(),
    updatedAt: (raw.updatedAt as string) ?? new Date().toISOString(),
    tool: (raw.tool as string) ?? "other",
    project: (raw.project as string) ?? "unknown",
    branch: (raw.branch as string) ?? "unknown",
    task: (raw.task as string) ?? "",
    status: (raw.status as Session["status"]) ?? "active",
    source: (raw.source as SessionSource) ?? {
      type: "openboot",
      name: (raw.tool as string) ?? "manual",
    },
    taskId: raw.taskId as string | undefined,
    snapshotIds: Array.isArray(raw.snapshotIds) ? (raw.snapshotIds as string[]) : [],
    summary: (raw.summary as string) ?? "",
    git: raw.git as any,
    messages: normalizeMessages(raw.messages as SessionMessage[] | undefined),
    events: normalizeEvents(raw.events as SessionEvent[] | undefined),
    metadata: {
      filesTouched: ((raw.metadata as any)?.filesTouched as string[]) ?? [],
      commandsRun: ((raw.metadata as any)?.commandsRun as string[]) ?? [],
      rawSource: (raw.metadata as any)?.rawSource,
    },
  };
}

function normalizeMessages(messages: SessionMessage[] | undefined): SessionMessage[] {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((m) => m && typeof m === "object" && typeof m.content === "string" && m.content.trim().length > 0)
    .map((m) => ({
      role: (["user", "assistant", "system"].includes(m.role) ? m.role : "assistant") as SessionMessage["role"],
      content: m.content,
      timestamp: m.timestamp ?? new Date().toISOString(),
    }));
}

function normalizeEvents(events: SessionEvent[] | undefined): SessionEvent[] {
  if (!Array.isArray(events)) return [];
  return events.filter(
    (e) => e && typeof e === "object" && typeof e.type === "string"
  );
}

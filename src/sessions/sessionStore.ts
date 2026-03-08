import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { randomUUID, createHash } from "crypto";

// Inline backfill to avoid circular import with normalizeSession.ts
function backfill(raw: Record<string, unknown>): Session {
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
    git: raw.git as Session["git"] | undefined,
    messages: Array.isArray(raw.messages) ? (raw.messages as SessionMessage[]) : [],
    events: Array.isArray(raw.events) ? (raw.events as SessionEvent[]) : [],
    metadata: {
      filesTouched: ((raw.metadata as any)?.filesTouched as string[]) ?? [],
      commandsRun: ((raw.metadata as any)?.commandsRun as string[]) ?? [],
      rawSource: (raw.metadata as any)?.rawSource,
    },
  };
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SessionMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
}

export interface SessionEvent {
  id: string;
  type: "command" | "stdout" | "stderr" | "file-change" | "import" | "note";
  timestamp: string;
  data: Record<string, unknown>;
}

export interface SessionSource {
  /** "openboot" = created via boot session start; "imported" = pulled from tool history; "wrapped" = captured via boot run */
  type: "openboot" | "imported" | "wrapped";
  name: "cursor" | "claude" | "opencode" | "openai" | "manual" | string;
  /** External session ID from the originating tool, if known */
  sourceSessionId?: string;
}

export interface SessionGitInfo {
  repoRoot: string | null;
  repoName: string;
  branch: string;
  commit: string;
  isDirty: boolean;
  changedFiles: string[];
  stagedFiles: string[];
}

export interface SessionMetadata {
  filesTouched: string[];
  commandsRun: string[];
  /** raw source metadata from an external import — never mutated, only appended */
  rawSource?: Record<string, unknown>;
}

export interface Session {
  id: string;
  createdAt: string;
  updatedAt: string;
  /** @deprecated use source.name instead — kept for backward compat with older session files */
  tool: "cursor" | "claude" | "cli" | "other" | string;
  project: string;
  branch: string;
  task: string;
  status: "active" | "idle" | "imported" | "completed";
  source: SessionSource;
  /** Linked task ID — set when session is created from a task or via task resume */
  taskId?: string;
  /** Snapshot IDs created during this session */
  snapshotIds: string[];
  /** Deterministic local summary (no AI) */
  summary: string;
  /** Git state captured at session creation/update */
  git?: SessionGitInfo;
  /** Structured conversation messages */
  messages: SessionMessage[];
  /** Wrapper/import/watch activity events */
  events: SessionEvent[];
  metadata: SessionMetadata;
}

// ─── Directory helpers ────────────────────────────────────────────────────────

export function getOpenbootDir(cwd: string = process.cwd()): string {
  return path.join(cwd, ".openboot");
}

/** Active sessions — created by the user with `boot session start` */
export function getActiveSessionsDir(cwd: string = process.cwd()): string {
  return path.join(getOpenbootDir(cwd), "sessions", "active");
}

/** Sessions imported from external tool histories */
export function getImportedSessionsDir(cwd: string = process.cwd()): string {
  return path.join(getOpenbootDir(cwd), "sessions", "imported");
}

/** Exports — written by `boot session export` */
export function getExportsDir(cwd: string = process.cwd()): string {
  return path.join(getOpenbootDir(cwd), "exports");
}

/** Deduplication manifest for imported sessions */
export function getManifestPath(cwd: string = process.cwd()): string {
  return path.join(getOpenbootDir(cwd), "sessions", "imported", ".manifest.json");
}

export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ─── Git helpers ─────────────────────────────────────────────────────────────

export function getCurrentBranch(): string {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", { stdio: "pipe" })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

export function getProjectName(cwd: string = process.cwd()): string {
  return path.basename(cwd);
}

// ─── Session I/O ─────────────────────────────────────────────────────────────

function sessionFilePath(dir: string, id: string): string {
  return path.join(dir, `${id}.json`);
}

export function writeSession(session: Session, dir?: string, cwd: string = process.cwd()): void {
  const targetDir = dir ?? getActiveSessionsDir(cwd);
  ensureDir(targetDir);
  fs.writeFileSync(
    sessionFilePath(targetDir, session.id),
    JSON.stringify(session, null, 2),
    "utf8"
  );
}

/** Read a session from a specific directory (or search active then imported). */
export function readSession(id: string, cwd: string = process.cwd()): Session | null {
  for (const dir of [getActiveSessionsDir(cwd), getImportedSessionsDir(cwd)]) {
    const fp = sessionFilePath(dir, id);
    if (fs.existsSync(fp)) {
      try {
        return backfill(JSON.parse(fs.readFileSync(fp, "utf8")));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function readSessionsFromDir(dir: string): Session[] {
  if (!fs.existsSync(dir)) return [];
  const sessions: Session[] = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json") || f.startsWith(".")) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      sessions.push(backfill(raw));
    } catch {
      // never crash on malformed files
    }
  }
  return sessions;
}

export function listSessions(cwd: string = process.cwd()): Session[] {
  const active = readSessionsFromDir(getActiveSessionsDir(cwd));
  const imported = readSessionsFromDir(getImportedSessionsDir(cwd));
  return [...active, ...imported].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

export function getLatestActiveSession(cwd: string = process.cwd()): Session | null {
  const sessions = readSessionsFromDir(getActiveSessionsDir(cwd)).sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
  return sessions[0] ?? null;
}

// ─── Session creation ─────────────────────────────────────────────────────────

export function createSession(
  task: string,
  tool: string = "other",
  cwd: string = process.cwd(),
  taskId?: string
): Session {
  // Import git info lazily to avoid startup cost when git not available
  let gitInfo: Session["git"] | undefined;
  try {
    const { getRepoInfo } = require("../git/getRepoInfo");
    const info = getRepoInfo(cwd);
    gitInfo = {
      repoRoot: info.repoRoot,
      repoName: info.repoName,
      branch: info.branch,
      commit: info.commit,
      isDirty: info.isDirty,
      changedFiles: info.changedFiles,
      stagedFiles: info.stagedFiles,
    };
  } catch {
    // git not available — gracefully skip
  }

  const now = new Date().toISOString();
  const session: Session = {
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    tool,
    project: getProjectName(cwd),
    branch: getCurrentBranch(),
    task,
    status: "active",
    source: { type: "openboot", name: tool as SessionSource["name"] },
    taskId,
    snapshotIds: [],
    summary: "",
    git: gitInfo,
    messages: [],
    events: [],
    metadata: { filesTouched: [], commandsRun: [] },
  };
  writeSession(session, undefined, cwd);
  return session;
}

// ─── Session mutation ─────────────────────────────────────────────────────────

export function appendMessage(
  id: string,
  role: SessionMessage["role"],
  content: string,
  cwd: string = process.cwd()
): Session {
  const session = readSession(id, cwd);
  if (!session) throw new Error(`Session not found: ${id}`);
  session.messages.push({ role, content, timestamp: new Date().toISOString() });
  session.updatedAt = new Date().toISOString();
  writeSession(session, getActiveSessionsDir(cwd), cwd);
  return session;
}

export function appendEvent(
  id: string,
  type: SessionEvent["type"],
  data: Record<string, unknown>,
  cwd: string = process.cwd()
): Session {
  const session = readSession(id, cwd);
  if (!session) throw new Error(`Session not found: ${id}`);
  session.events.push({ id: randomUUID(), type, timestamp: new Date().toISOString(), data });
  session.updatedAt = new Date().toISOString();
  writeSession(session, getActiveSessionsDir(cwd), cwd);
  return session;
}

// ─── Export ──────────────────────────────────────────────────────────────────

export function exportSession(id: string, cwd: string = process.cwd()): string {
  const session = readSession(id, cwd);
  if (!session) throw new Error(`Session not found: ${id}`);
  const exportsDir = getExportsDir(cwd);
  ensureDir(exportsDir);
  const dest = path.join(exportsDir, `${session.id}.json`);
  fs.writeFileSync(dest, JSON.stringify(session, null, 2), "utf8");
  return dest;
}

// ─── Dedup manifest ──────────────────────────────────────────────────────────

export interface ManifestEntry {
  source: string;
  sourcePath: string;
  hash: string;
  sessionId: string;
  importedAt: string;
}

export function loadManifest(cwd: string = process.cwd()): ManifestEntry[] {
  const mp = getManifestPath(cwd);
  if (!fs.existsSync(mp)) return [];
  try {
    return JSON.parse(fs.readFileSync(mp, "utf8")) as ManifestEntry[];
  } catch {
    return [];
  }
}

export function saveManifest(entries: ManifestEntry[], cwd: string = process.cwd()): void {
  const mp = getManifestPath(cwd);
  ensureDir(path.dirname(mp));
  fs.writeFileSync(mp, JSON.stringify(entries, null, 2), "utf8");
}

export function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

export function isAlreadyImported(
  source: string,
  sourcePath: string,
  hash: string,
  manifest: ManifestEntry[]
): boolean {
  return manifest.some(
    (e) => e.source === source && e.sourcePath === sourcePath && e.hash === hash
  );
}

// ─── Resolve short IDs ───────────────────────────────────────────────────────

export function resolveSessionId(prefix: string, cwd: string = process.cwd()): string | null {
  if (prefix.length === 36) return prefix;
  const all = listSessions(cwd);
  return all.find((s) => s.id.startsWith(prefix))?.id ?? null;
}

// ─── Formatting ──────────────────────────────────────────────────────────────

export function formatRelativeTime(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  return `${Math.floor(diffHrs / 24)}d ago`;
}

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { randomUUID } from "crypto";
import {
  Session,
  listSessions,
  readSession,
  writeSession,
  getActiveSessionsDir,
} from "../sessions/sessionStore";
import { Task, listTasks, readTask, getTasksDir } from "../tasks/taskStore";
import { Snapshot, listSnapshots, readSnapshot, getSnapshotsDir } from "../snapshots/snapshotStore";
import { getRepoInfo } from "../git/getRepoInfo";

export interface BundleMeta {
  id: string;
  createdAt: string;
  sourceMachine: string;
  repo: { name: string; branch: string };
  artifactId?: string;
  sessions: number;
  tasks: number;
  snapshots: number;
}

export interface Bundle {
  id: string;
  createdAt: string;
  sourceMachine: string;
  repo: { name: string; branch: string };
  artifactId?: string;
  tasks: Task[];
  sessions: Session[];
  snapshots: Snapshot[];
  context: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

// ─── Paths ────────────────────────────────────────────────────────────────────

export function getBundlesDir(cwd: string = process.cwd()): string {
  return path.join(cwd, ".openboot", "bundles");
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function bundlePath(dir: string, id: string): string {
  return path.join(dir, `bundle-${id.slice(0, 8)}.json`);
}

// ─── Safety ───────────────────────────────────────────────────────────────────

const BLOCKED = [/\.env($|\.)/, /\.pem$/, /\.key$/, /id_rsa/, /id_ed25519/, /credentials/, /secrets/, /api[_-]?token/i];

function isSafe(content: string): boolean {
  return !BLOCKED.some((re) => re.test(content));
}

function sanitizeSession(s: Session): Session {
  return {
    ...s,
    events: (s.events ?? []).map((e) => ({
      ...e,
      data: sanitizeData(e.data),
    })),
    metadata: {
      ...s.metadata,
      rawSource: undefined,
    },
  };
}

function sanitizeData(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === "string" && !isSafe(v)) {
      out[k] = "[REDACTED]";
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ─── Create bundle ────────────────────────────────────────────────────────────

export interface CreateBundleOptions {
  artifactId?: string;
  sessionIds?: string[];
  taskIds?: string[];
  snapshotIds?: string[];
  includeAll?: boolean;
}

export function createBundle(
  opts: CreateBundleOptions = {},
  cwd: string = process.cwd()
): Bundle {
  const info = getRepoInfo(cwd);

  let sessions: Session[] = [];
  let tasks: Task[] = [];
  let snapshots: Snapshot[] = [];

  if (opts.includeAll || (!opts.sessionIds && !opts.taskIds && !opts.snapshotIds)) {
    // Package latest active session + active task + recent snapshots
    const allSessions = listSessions(cwd).filter((s) => s.project === info.repoName);
    sessions = allSessions.slice(0, 5);
    tasks = listTasks(cwd).filter((t) => t.repo.name === info.repoName).slice(0, 10);
    snapshots = listSnapshots(cwd).slice(0, 5);
  } else {
    if (opts.sessionIds) {
      for (const id of opts.sessionIds) {
        const s = readSession(id, cwd);
        if (s) sessions.push(s);
      }
    }
    if (opts.taskIds) {
      for (const id of opts.taskIds) {
        const t = readTask(id, cwd);
        if (t) tasks.push(t);
      }
    }
    if (opts.snapshotIds) {
      for (const id of opts.snapshotIds) {
        const s = readSnapshot(id, cwd);
        if (s) snapshots.push(s);
      }
    }
  }

  // Read latest context file if it exists
  const contextPath = path.join(cwd, ".openboot", "context", "latest-context.md");
  const contextContent = fs.existsSync(contextPath) ? fs.readFileSync(contextPath, "utf8") : "";

  const bundle: Bundle = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    sourceMachine: os.hostname(),
    repo: { name: info.repoName, branch: info.branch },
    artifactId: opts.artifactId,
    tasks,
    sessions: sessions.map(sanitizeSession),
    snapshots,
    context: { markdown: contextContent },
    metadata: {
      openbootVersion: "1.0",
      sessionCount: sessions.length,
      taskCount: tasks.length,
      snapshotCount: snapshots.length,
    },
  };

  const dir = getBundlesDir(cwd);
  ensureDir(dir);
  fs.writeFileSync(bundlePath(dir, bundle.id), JSON.stringify(bundle, null, 2), "utf8");

  return bundle;
}

// ─── Import bundle ────────────────────────────────────────────────────────────

export interface ImportResult {
  bundleId: string;
  sessionsImported: number;
  tasksImported: number;
  snapshotsImported: number;
  skipped: number;
  warnings: string[];
}

export function importBundle(bundleFilePath: string, cwd: string = process.cwd()): ImportResult {
  if (!fs.existsSync(bundleFilePath)) {
    throw new Error(`Bundle file not found: ${bundleFilePath}`);
  }

  let bundle: Bundle;
  try {
    bundle = JSON.parse(fs.readFileSync(bundleFilePath, "utf8")) as Bundle;
  } catch {
    throw new Error(`Invalid bundle file: could not parse JSON`);
  }

  if (!bundle.id || !bundle.sessions || !bundle.tasks) {
    throw new Error(`Invalid bundle: missing required fields`);
  }

  const result: ImportResult = {
    bundleId: bundle.id,
    sessionsImported: 0,
    tasksImported: 0,
    snapshotsImported: 0,
    skipped: 0,
    warnings: [],
  };

  // Import sessions
  const sessionsDir = getActiveSessionsDir(cwd);
  ensureDir(sessionsDir);

  for (const session of bundle.sessions ?? []) {
    const dest = path.join(sessionsDir, `${session.id}.json`);
    if (fs.existsSync(dest)) {
      result.skipped++;
      continue;
    }
    try {
      writeSession({
        ...session,
        metadata: {
          ...session.metadata,
          rawSource: {
            ...(session.metadata.rawSource ?? {}),
            importedFromMachine: bundle.sourceMachine,
            bundleId: bundle.id,
          },
        },
      }, undefined, cwd);
      result.sessionsImported++;
    } catch (e: any) {
      result.warnings.push(`session ${session.id.slice(0, 8)}: ${e.message}`);
    }
  }

  // Import tasks
  const tasksDir = getTasksDir(cwd);
  ensureDir(tasksDir);

  for (const task of bundle.tasks ?? []) {
    const dest = path.join(tasksDir, `${task.id}.json`);
    if (fs.existsSync(dest)) {
      result.skipped++;
      continue;
    }
    try {
      fs.writeFileSync(dest, JSON.stringify(task, null, 2), "utf8");
      result.tasksImported++;
    } catch (e: any) {
      result.warnings.push(`task ${task.id.slice(0, 8)}: ${e.message}`);
    }
  }

  // Import snapshots
  const snapshotsDir = getSnapshotsDir(cwd);
  ensureDir(snapshotsDir);

  for (const snap of bundle.snapshots ?? []) {
    const dest = path.join(snapshotsDir, `${snap.id}.json`);
    if (fs.existsSync(dest)) {
      result.skipped++;
      continue;
    }
    try {
      fs.writeFileSync(dest, JSON.stringify(snap, null, 2), "utf8");
      result.snapshotsImported++;
    } catch (e: any) {
      result.warnings.push(`snapshot ${snap.id.slice(0, 8)}: ${e.message}`);
    }
  }

  // Write bundle context if present
  if (bundle.context?.markdown) {
    const ctxDir = path.join(cwd, ".openboot", "context");
    ensureDir(ctxDir);
    const ctxDest = path.join(ctxDir, `imported-${bundle.id.slice(0, 8)}-context.md`);
    fs.writeFileSync(ctxDest, bundle.context.markdown as string, "utf8");
  }

  return result;
}

// ─── List bundles ─────────────────────────────────────────────────────────────

export function listBundles(cwd: string = process.cwd()): BundleMeta[] {
  const dir = getBundlesDir(cwd);
  if (!fs.existsSync(dir)) return [];

  const results: BundleMeta[] = [];

  for (const f of fs.readdirSync(dir)) {
    if (!f.startsWith("bundle-") || !f.endsWith(".json")) continue;
    try {
      const b = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Bundle;
      results.push({
        id: b.id,
        createdAt: b.createdAt,
        sourceMachine: b.sourceMachine,
        repo: b.repo,
        artifactId: b.artifactId,
        sessions: b.sessions?.length ?? 0,
        tasks: b.tasks?.length ?? 0,
        snapshots: b.snapshots?.length ?? 0,
      });
    } catch {
      // Skip malformed bundles
    }
  }

  return results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { getRepoInfo } from "../git/getRepoInfo";
import { getLatestActiveSession } from "../sessions/sessionStore";
import { getActiveTask } from "../tasks/taskStore";
import { buildSessionSummary } from "../summaries/buildSummary";

export interface SnapshotGitInfo {
  branch: string;
  commit: string;
  isDirty: boolean;
  changedFiles: string[];
  stagedFiles: string[];
}

export interface SnapshotRepo {
  root: string;
  name: string;
}

export interface RestoreHints {
  branchExists: boolean;
  suggestedCommands: string[];
}

export interface Snapshot {
  id: string;
  createdAt: string;
  sessionId: string | null;
  taskId: string | null;
  repo: SnapshotRepo;
  git: SnapshotGitInfo;
  contextSummary: string;
  sessionSummary: string;
  selectedFiles: string[];
  restoreHints: RestoreHints;
  metadata: Record<string, unknown>;
}

// ─── Paths ────────────────────────────────────────────────────────────────────

export function getSnapshotsDir(cwd: string = process.cwd()): string {
  return path.join(cwd, ".openboot", "snapshots");
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function snapshotPath(dir: string, id: string): string {
  return path.join(dir, `${id}.json`);
}

// ─── I/O ─────────────────────────────────────────────────────────────────────

export function writeSnapshot(snap: Snapshot, cwd: string = process.cwd()): void {
  const dir = getSnapshotsDir(cwd);
  ensureDir(dir);
  fs.writeFileSync(snapshotPath(dir, snap.id), JSON.stringify(snap, null, 2), "utf8");
}

export function readSnapshot(id: string, cwd: string = process.cwd()): Snapshot | null {
  const dir = getSnapshotsDir(cwd);
  if (id.length < 36) {
    const all = listSnapshots(cwd);
    return all.find((s) => s.id.startsWith(id)) ?? null;
  }
  const fp = snapshotPath(dir, id);
  if (!fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, "utf8")) as Snapshot;
  } catch {
    return null;
  }
}

export function listSnapshots(cwd: string = process.cwd()): Snapshot[] {
  const dir = getSnapshotsDir(cwd);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Snapshot;
      } catch {
        return null;
      }
    })
    .filter((s): s is Snapshot => s !== null)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

// ─── Create ───────────────────────────────────────────────────────────────────

export function createSnapshot(
  selectedFiles: string[] = [],
  contextSummary: string = "",
  cwd: string = process.cwd()
): Snapshot {
  const info = getRepoInfo(cwd);
  const session = getLatestActiveSession(cwd);
  const task = getActiveTask(cwd);

  const sessionSummary = session ? buildSessionSummary(session) : "";

  // Build restore hints
  const branchExists = info.branch !== "unknown";
  const suggestedCommands: string[] = [];
  if (branchExists) suggestedCommands.push(`git checkout ${info.branch}`);
  if (info.commit !== "unknown") suggestedCommands.push(`git checkout ${info.commit}`);
  if (task) suggestedCommands.push(`boot task resume ${task.id.slice(0, 8)}`);
  if (session) suggestedCommands.push(`boot resume`);

  const snap: Snapshot = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    sessionId: session?.id ?? null,
    taskId: task?.id ?? null,
    repo: { root: info.repoRoot ?? cwd, name: info.repoName },
    git: {
      branch: info.branch,
      commit: info.commit,
      isDirty: info.isDirty,
      changedFiles: info.changedFiles,
      stagedFiles: info.stagedFiles,
    },
    contextSummary: contextSummary || sessionSummary,
    sessionSummary,
    selectedFiles,
    restoreHints: { branchExists, suggestedCommands },
    metadata: {},
  };

  writeSnapshot(snap, cwd);
  return snap;
}

// ─── Restore (print restore plan only — never destructively mutate worktree) ──

export interface RestorePlan {
  snapshotId: string;
  targetRepo: string;
  targetBranch: string;
  targetSession: string | null;
  targetTask: string | null;
  changedFiles: string[];
  suggestedCommands: string[];
  warnings: string[];
}

export function buildRestorePlan(snapshotId: string, cwd: string = process.cwd()): RestorePlan | null {
  const snap = readSnapshot(snapshotId, cwd);
  if (!snap) return null;

  const currentInfo = getRepoInfo(cwd);
  const warnings: string[] = [];

  if (currentInfo.isDirty) {
    warnings.push("Working tree has uncommitted changes — stash or commit before restoring.");
  }
  if (currentInfo.branch !== snap.git.branch) {
    warnings.push(`Current branch (${currentInfo.branch}) differs from snapshot branch (${snap.git.branch}).`);
  }

  return {
    snapshotId: snap.id,
    targetRepo: snap.repo.name,
    targetBranch: snap.git.branch,
    targetSession: snap.sessionId,
    targetTask: snap.taskId,
    changedFiles: snap.git.changedFiles,
    suggestedCommands: snap.restoreHints.suggestedCommands,
    warnings,
  };
}

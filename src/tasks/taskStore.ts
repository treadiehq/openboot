import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { getRepoInfo } from "../git/getRepoInfo";

export interface TaskGitInfo {
  branch: string;
  commit: string;
}

export interface TaskRepo {
  name: string;
  root: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: "open" | "active" | "paused" | "completed";
  createdAt: string;
  updatedAt: string;
  lastResumedAt?: string;
  linkedSessionIds: string[];
  linkedSnapshotIds: string[];
  repo: TaskRepo;
  git: TaskGitInfo;
  summary: string;
  tags: string[];
  sessionCount: number;
}

// ─── Paths ────────────────────────────────────────────────────────────────────

export function getTasksDir(cwd: string = process.cwd()): string {
  return path.join(cwd, ".openboot", "tasks");
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function taskPath(dir: string, id: string): string {
  return path.join(dir, `${id}.json`);
}

// ─── I/O ─────────────────────────────────────────────────────────────────────

export function writeTask(task: Task, cwd: string = process.cwd()): void {
  const dir = getTasksDir(cwd);
  ensureDir(dir);
  fs.writeFileSync(taskPath(dir, task.id), JSON.stringify(task, null, 2), "utf8");
}

export function readTask(id: string, cwd: string = process.cwd()): Task | null {
  const dir = getTasksDir(cwd);
  // Support short prefix
  if (id.length < 36) {
    const all = listTasks(cwd);
    return all.find((t) => t.id.startsWith(id)) ?? null;
  }
  const fp = taskPath(dir, id);
  if (!fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, "utf8")) as Task;
  } catch {
    return null;
  }
}

export function listTasks(cwd: string = process.cwd()): Task[] {
  const dir = getTasksDir(cwd);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Task;
      } catch {
        return null;
      }
    })
    .filter((t): t is Task => t !== null)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export function getActiveTask(cwd: string = process.cwd()): Task | null {
  return listTasks(cwd).find((t) => t.status === "active") ?? null;
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export function createTask(
  title: string,
  description: string = "",
  tags: string[] = [],
  cwd: string = process.cwd()
): Task {
  const info = getRepoInfo(cwd);
  const now = new Date().toISOString();
  const task: Task = {
    id: randomUUID(),
    title,
    description,
    status: "open",
    createdAt: now,
    updatedAt: now,
    linkedSessionIds: [],
    linkedSnapshotIds: [],
    repo: { name: info.repoName, root: info.repoRoot ?? cwd },
    git: { branch: info.branch, commit: info.commit },
    summary: "",
    tags,
    sessionCount: 0,
  };
  writeTask(task, cwd);
  return task;
}

export function resumeTask(id: string, cwd: string = process.cwd()): Task | null {
  const task = readTask(id, cwd);
  if (!task) return null;

  // Pause any other active task first
  const current = getActiveTask(cwd);
  if (current && current.id !== task.id) {
    current.status = "paused";
    current.updatedAt = new Date().toISOString();
    writeTask(current, cwd);
  }

  task.status = "active";
  task.lastResumedAt = new Date().toISOString();
  task.updatedAt = task.lastResumedAt;
  writeTask(task, cwd);
  return task;
}

export function closeTask(id: string, cwd: string = process.cwd()): Task | null {
  const task = readTask(id, cwd);
  if (!task) return null;
  task.status = "completed";
  task.updatedAt = new Date().toISOString();
  writeTask(task, cwd);
  return task;
}

export function pauseTask(id: string, cwd: string = process.cwd()): Task | null {
  const task = readTask(id, cwd);
  if (!task) return null;
  task.status = "paused";
  task.updatedAt = new Date().toISOString();
  writeTask(task, cwd);
  return task;
}

export function linkSessionToTask(taskId: string, sessionId: string, cwd: string = process.cwd()): void {
  const task = readTask(taskId, cwd);
  if (!task) return;
  if (!task.linkedSessionIds.includes(sessionId)) {
    task.linkedSessionIds.push(sessionId);
    task.sessionCount = task.linkedSessionIds.length;
    task.updatedAt = new Date().toISOString();
    writeTask(task, cwd);
  }
}

export function linkSnapshotToTask(taskId: string, snapshotId: string, cwd: string = process.cwd()): void {
  const task = readTask(taskId, cwd);
  if (!task) return;
  if (!task.linkedSnapshotIds.includes(snapshotId)) {
    task.linkedSnapshotIds.push(snapshotId);
    task.updatedAt = new Date().toISOString();
    writeTask(task, cwd);
  }
}

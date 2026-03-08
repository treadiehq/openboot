import { Session, listSessions } from "./sessionStore";
import { Task, listTasks, getActiveTask } from "../tasks/taskStore";
import { getRepoInfo } from "../git/getRepoInfo";
import { buildSessionSummary } from "../summaries/buildSummary";

export interface ResumeMatch {
  session: Session | null;
  task: Task | null;
  reason: string[];
  matchQuality: "exact" | "branch" | "task" | "recent" | "none";
}

/**
 * Branch-aware resume: finds the best session + task to resume by:
 * 1. Exact repo + branch match
 * 2. Active task on same branch
 * 3. Most recently active task
 * 4. Most recently active session
 */
export function findBestResumeMatch(cwd: string = process.cwd()): ResumeMatch {
  const info = getRepoInfo(cwd);
  const sessions = listSessions(cwd);
  const tasks = listTasks(cwd);
  const reason: string[] = [];

  // Filter to this repo
  const repoSessions = sessions.filter((s) => s.project === info.repoName || s.git?.repoName === info.repoName);
  const repoTasks = tasks.filter((t) => t.repo.name === info.repoName);

  // 1. Exact branch + repo match
  const exactBranch = repoSessions
    .filter((s) => (s.git?.branch ?? s.branch) === info.branch && s.status === "active")
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];

  const exactTaskBranch = repoTasks
    .filter((t) => t.git.branch === info.branch && (t.status === "active" || t.status === "open"))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];

  if (exactBranch || exactTaskBranch) {
    reason.push(`same repo (${info.repoName})`);
    reason.push(`same branch (${info.branch})`);
    if (exactBranch) reason.push(`last updated ${relTime(exactBranch.updatedAt)}`);
    return {
      session: exactBranch ?? null,
      task: exactTaskBranch ?? null,
      reason,
      matchQuality: "exact",
    };
  }

  // 2. Active task (any branch in this repo)
  const activeTask = getActiveTask(cwd) ?? repoTasks.find((t) => t.status === "active");
  if (activeTask) {
    const linkedSession = repoSessions.find((s) => activeTask.linkedSessionIds.includes(s.id));
    reason.push(`same repo (${info.repoName})`);
    reason.push(`active task on branch ${activeTask.git.branch}`);
    return {
      session: linkedSession ?? repoSessions[0] ?? null,
      task: activeTask,
      reason,
      matchQuality: "task",
    };
  }

  // 3. Most recent task for this repo
  if (repoTasks.length > 0) {
    const latestTask = repoTasks[0];
    reason.push(`same repo (${info.repoName})`);
    reason.push(`most recent task`);
    const linkedSession = repoSessions.find((s) => latestTask.linkedSessionIds.includes(s.id));
    return {
      session: linkedSession ?? repoSessions[0] ?? null,
      task: latestTask,
      reason,
      matchQuality: "branch",
    };
  }

  // 4. Most recent session
  if (repoSessions.length > 0) {
    reason.push(`most recently active session for ${info.repoName}`);
    return { session: repoSessions[0], task: null, reason, matchQuality: "recent" };
  }

  return { session: null, task: null, reason: ["no sessions or tasks found for this repo"], matchQuality: "none" };
}

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

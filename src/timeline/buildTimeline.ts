import { listSessions } from "../sessions/sessionStore";
import { listTasks } from "../tasks/taskStore";
import { listSnapshots } from "../snapshots/snapshotStore";
import { sessionToTimelineEntries, TimelineEntry } from "../summaries/buildSummary";

export interface TimelineOptions {
  taskId?: string;
  branch?: string;
  limit?: number;
}

export function buildTimeline(
  cwd: string = process.cwd(),
  opts: TimelineOptions = {}
): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  const project = require("path").basename(cwd);

  // Sessions
  let sessions = listSessions(cwd).filter((s) => s.project === project);
  if (opts.branch) sessions = sessions.filter((s) => s.branch === opts.branch || s.git?.branch === opts.branch);
  if (opts.taskId) sessions = sessions.filter((s) => s.taskId === opts.taskId || s.taskId?.startsWith(opts.taskId!));

  for (const s of sessions) {
    entries.push(...sessionToTimelineEntries(s));
  }

  // Tasks
  let tasks = listTasks(cwd).filter((t) => t.repo.name === project);
  if (opts.branch) tasks = tasks.filter((t) => t.git.branch === opts.branch);
  if (opts.taskId) tasks = tasks.filter((t) => t.id === opts.taskId || t.id.startsWith(opts.taskId!));

  for (const t of tasks) {
    entries.push({
      timestamp: t.createdAt,
      type: "task",
      label: `Created task "${t.title}"`,
      ref: t.id.slice(0, 8),
    });
    if (t.lastResumedAt) {
      entries.push({
        timestamp: t.lastResumedAt,
        type: "task",
        label: `Marked task active: "${t.title}"`,
        ref: t.id.slice(0, 8),
      });
    }
  }

  // Snapshots
  for (const snap of listSnapshots(cwd)) {
    entries.push({
      timestamp: snap.createdAt,
      type: "snapshot",
      label: `Created snapshot ${snap.id.slice(0, 8)} on ${snap.git.branch}`,
      ref: snap.id.slice(0, 8),
    });
  }

  // Sort by timestamp ascending
  entries.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  return opts.limit ? entries.slice(-opts.limit) : entries;
}

export function renderTimeline(entries: TimelineEntry[]): string {
  if (entries.length === 0) return "  No timeline entries found for this repo.";

  return entries
    .map((e) => {
      const t = new Date(e.timestamp);
      const time = `${t.getHours().toString().padStart(2, "0")}:${t.getMinutes().toString().padStart(2, "0")}`;
      const date = t.toLocaleDateString();
      return `  ${date} ${time}  ${e.label}`;
    })
    .join("\n");
}

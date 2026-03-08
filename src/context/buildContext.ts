import * as fs from "fs";
import * as path from "path";
import { getRepoInfo } from "../git/getRepoInfo";
import { getLatestActiveSession, listSessions } from "../sessions/sessionStore";
import { getActiveTask, listTasks } from "../tasks/taskStore";
import { listSnapshots } from "../snapshots/snapshotStore";
import { buildSessionSummary } from "../summaries/buildSummary";

export interface ContextData {
  generatedAt: string;
  repo: {
    name: string;
    branch: string;
    commit: string;
    root: string | null;
    isDirty: boolean;
    changedFiles: string[];
  };
  activeTask: {
    id: string;
    title: string;
    status: string;
    summary: string;
    branch: string;
  } | null;
  recentSessions: Array<{
    id: string;
    task: string;
    updatedAt: string;
    messageCount: number;
    summary: string;
  }>;
  latestSnapshot: {
    id: string;
    createdAt: string;
    branch: string;
    commit: string;
    sessionSummary: string;
  } | null;
  filesTouched: string[];
  recentMessages: Array<{ role: string; content: string; timestamp: string }>;
  recentEvents: Array<{ type: string; label: string; timestamp: string }>;
}

export function buildContext(cwd: string = process.cwd()): ContextData {
  const info = getRepoInfo(cwd);
  const session = getLatestActiveSession(cwd);
  const activeTask = getActiveTask(cwd);
  const allSessions = listSessions(cwd).slice(0, 5);
  const snapshots = listSnapshots(cwd);
  const latestSnap = snapshots[0] ?? null;

  const filesTouched = [
    ...(session?.metadata.filesTouched ?? []),
    ...(info.changedFiles),
  ];
  const uniqueFiles = [...new Set(filesTouched)].slice(0, 20);

  const recentMessages = (session?.messages ?? []).slice(-5).map((m) => ({
    role: m.role,
    content: m.content.slice(0, 200),
    timestamp: m.timestamp,
  }));

  const recentEvents = (session?.events ?? []).slice(-10).map((e) => ({
    type: e.type,
    label: eventLabel(e),
    timestamp: e.timestamp,
  }));

  return {
    generatedAt: new Date().toISOString(),
    repo: {
      name: info.repoName,
      branch: info.branch,
      commit: info.commit,
      root: info.repoRoot,
      isDirty: info.isDirty,
      changedFiles: info.changedFiles.slice(0, 20),
    },
    activeTask: activeTask
      ? {
          id: activeTask.id,
          title: activeTask.title,
          status: activeTask.status,
          summary: activeTask.summary || activeTask.description,
          branch: activeTask.git.branch,
        }
      : null,
    recentSessions: allSessions.map((s) => ({
      id: s.id,
      task: s.task,
      updatedAt: s.updatedAt,
      messageCount: s.messages.length,
      summary: buildSessionSummary(s),
    })),
    latestSnapshot: latestSnap
      ? {
          id: latestSnap.id,
          createdAt: latestSnap.createdAt,
          branch: latestSnap.git.branch,
          commit: latestSnap.git.commit,
          sessionSummary: latestSnap.sessionSummary,
        }
      : null,
    filesTouched: uniqueFiles,
    recentMessages,
    recentEvents,
  };
}

function eventLabel(e: { type: string; data: Record<string, unknown> }): string {
  switch (e.type) {
    case "command": return `Ran: ${e.data.tool} ${((e.data.args as string[]) ?? []).join(" ")}`.trim();
    case "file-change": return `File changed: ${e.data.filePath ?? "unknown"}`;
    case "note": return `Note: ${String(e.data.content ?? "").slice(0, 60)}`;
    default: return `${e.type} event`;
  }
}

export function renderContextMarkdown(ctx: ContextData): string {
  const lines: string[] = [];

  lines.push("# OpenBoot Context");
  lines.push("");
  lines.push("## Repository");
  lines.push(`- Name: ${ctx.repo.name}`);
  lines.push(`- Branch: ${ctx.repo.branch}`);
  lines.push(`- Commit: ${ctx.repo.commit}`);
  if (ctx.repo.isDirty) lines.push(`- Status: dirty (${ctx.repo.changedFiles.length} changed files)`);
  lines.push("");

  if (ctx.activeTask) {
    lines.push("## Active Task");
    lines.push(`- Title: ${ctx.activeTask.title}`);
    lines.push(`- Status: ${ctx.activeTask.status}`);
    if (ctx.activeTask.summary) lines.push(`- Summary: ${ctx.activeTask.summary}`);
    lines.push(`- Branch: ${ctx.activeTask.branch}`);
    lines.push("");
  }

  if (ctx.recentSessions.length > 0) {
    lines.push("## Recent Sessions");
    for (const s of ctx.recentSessions.slice(0, 3)) {
      lines.push(`- ${s.id.slice(0, 8)}: ${s.task} (${new Date(s.updatedAt).toLocaleDateString()})`);
      if (s.summary) lines.push(`  ${s.summary}`);
    }
    lines.push("");
  }

  if (ctx.filesTouched.length > 0) {
    lines.push("## Files Touched");
    for (const f of ctx.filesTouched) lines.push(`- ${f}`);
    lines.push("");
  }

  if (ctx.recentMessages.length > 0) {
    lines.push("## Relevant Messages/Events");
    for (const m of ctx.recentMessages) {
      lines.push(`- [${m.role}] ${m.content.slice(0, 100).replace(/\n/g, " ")}`);
    }
    lines.push("");
  }

  if (ctx.latestSnapshot) {
    lines.push("## Latest Snapshot");
    lines.push(`- ID: ${ctx.latestSnapshot.id.slice(0, 8)}`);
    lines.push(`- Branch: ${ctx.latestSnapshot.branch} @ ${ctx.latestSnapshot.commit}`);
    if (ctx.latestSnapshot.sessionSummary) lines.push(`- Summary: ${ctx.latestSnapshot.sessionSummary}`);
    lines.push("");
  }

  lines.push(`---`);
  lines.push(`_Generated by OpenBoot at ${ctx.generatedAt}_`);

  return lines.join("\n");
}

export function saveContextFile(markdown: string, cwd: string = process.cwd()): string {
  const dir = path.join(cwd, ".openboot", "context");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, "latest-context.md");
  fs.writeFileSync(dest, markdown, "utf8");
  return dest;
}

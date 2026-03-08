import { execSync } from "child_process";
import * as path from "path";

export interface RepoInfo {
  repoRoot: string | null;
  repoName: string;
  branch: string;
  commit: string;
  isDirty: boolean;
  changedFiles: string[];
  stagedFiles: string[];
  recentCommits: string[];
}

function git(cmd: string, cwd: string): string {
  try {
    return execSync(`git ${cmd}`, { stdio: "pipe", cwd }).toString().trim();
  } catch {
    return "";
  }
}

function isGitRepo(cwd: string): boolean {
  return git("rev-parse --git-dir", cwd) !== "";
}

export function getRepoRoot(cwd: string = process.cwd()): string | null {
  try {
    const root = execSync("git rev-parse --show-toplevel", { stdio: "pipe", cwd })
      .toString()
      .trim();
    return root || null;
  } catch {
    return null;
  }
}

export function getBranch(cwd: string = process.cwd()): string {
  return git("rev-parse --abbrev-ref HEAD", cwd) || "unknown";
}

export function getCommit(cwd: string = process.cwd()): string {
  return git("rev-parse --short HEAD", cwd) || "unknown";
}

export function getStatus(cwd: string = process.cwd()): { isDirty: boolean; changedFiles: string[]; stagedFiles: string[] } {
  if (!isGitRepo(cwd)) return { isDirty: false, changedFiles: [], stagedFiles: [] };

  const changedRaw = git("diff --name-only", cwd);
  const stagedRaw = git("diff --name-only --cached", cwd);
  const changedFiles = changedRaw ? changedRaw.split("\n").filter(Boolean) : [];
  const stagedFiles = stagedRaw ? stagedRaw.split("\n").filter(Boolean) : [];

  return {
    isDirty: changedFiles.length > 0 || stagedFiles.length > 0,
    changedFiles,
    stagedFiles,
  };
}

export function getChangedFiles(cwd: string = process.cwd()): string[] {
  return getStatus(cwd).changedFiles;
}

export function getRecentCommits(cwd: string = process.cwd(), n = 5): string[] {
  const raw = git(`log --oneline -${n}`, cwd);
  return raw ? raw.split("\n").filter(Boolean) : [];
}

export function getRepoInfo(cwd: string = process.cwd()): RepoInfo {
  const repoRoot = getRepoRoot(cwd);
  const repoName = repoRoot ? path.basename(repoRoot) : path.basename(cwd);
  const branch = getBranch(cwd);
  const commit = getCommit(cwd);
  const { isDirty, changedFiles, stagedFiles } = getStatus(cwd);
  const recentCommits = getRecentCommits(cwd);

  return { repoRoot, repoName, branch, commit, isDirty, changedFiles, stagedFiles, recentCommits };
}

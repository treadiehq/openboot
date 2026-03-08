import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { randomUUID } from "crypto";

export interface Workspace {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  repos: string[];
}

/**
 * Workspaces are stored globally (not per-repo) so they can span multiple repos.
 * Default: ~/.openboot/workspaces/
 * Override with OPENBOOT_WORKSPACES_DIR env variable (for testing).
 */
export function getWorkspacesDir(): string {
  return process.env.OPENBOOT_WORKSPACES_DIR ?? path.join(os.homedir(), ".openboot", "workspaces");
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function workspacePath(dir: string, id: string): string {
  return path.join(dir, `${id}.json`);
}

export function writeWorkspace(ws: Workspace): void {
  const dir = getWorkspacesDir();
  ensureDir(dir);
  fs.writeFileSync(workspacePath(dir, ws.id), JSON.stringify(ws, null, 2), "utf8");
}

export function readWorkspace(id: string): Workspace | null {
  const dir = getWorkspacesDir();
  if (id.length < 36) {
    const all = listWorkspaces();
    return all.find((w) => w.id.startsWith(id) || w.name === id) ?? null;
  }
  const fp = workspacePath(dir, id);
  if (!fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, "utf8")) as Workspace;
  } catch {
    return null;
  }
}

export function listWorkspaces(): Workspace[] {
  const dir = getWorkspacesDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Workspace;
      } catch {
        return null;
      }
    })
    .filter((w): w is Workspace => w !== null)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export function createWorkspace(name: string, repos: string[] = []): Workspace {
  const now = new Date().toISOString();
  const ws: Workspace = {
    id: randomUUID(),
    name,
    createdAt: now,
    updatedAt: now,
    repos: repos.map((r) => path.resolve(r)),
  };
  writeWorkspace(ws);
  return ws;
}

export function addRepoToWorkspace(id: string, repoPath: string): Workspace | null {
  const ws = readWorkspace(id);
  if (!ws) return null;
  const resolved = path.resolve(repoPath);
  if (!ws.repos.includes(resolved)) {
    ws.repos.push(resolved);
    ws.updatedAt = new Date().toISOString();
    writeWorkspace(ws);
  }
  return ws;
}

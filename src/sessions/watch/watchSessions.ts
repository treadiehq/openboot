import * as fs from "fs";
import * as path from "path";
import { ADAPTERS } from "../importSessions";
import {
  getActiveSessionsDir,
  getImportedSessionsDir,
  getOpenbootDir,
  getLatestActiveSession,
  appendEvent,
} from "../sessionStore";

export interface WatchedPath {
  path: string;
  label: string;
  type: "openboot" | "external";
  source?: string;
}

/**
 * Collect paths to watch:
 * - .openboot/sessions/active/ (always)
 * - adapter source paths that exist on disk (external)
 */
export async function buildWatchedPaths(cwd: string = process.cwd()): Promise<WatchedPath[]> {
  const watched: WatchedPath[] = [];

  const activeDir = getActiveSessionsDir(cwd);
  const importedDir = getImportedSessionsDir(cwd);

  watched.push({ path: activeDir, label: ".openboot/sessions/active", type: "openboot" });
  watched.push({ path: importedDir, label: ".openboot/sessions/imported", type: "openboot" });

  for (const adapter of Object.values(ADAPTERS)) {
    const paths = await adapter.detectPaths();
    for (const p of paths) {
      watched.push({
        path: p,
        label: `~/${path.relative(require("os").homedir(), p)}`,
        type: "external",
        source: adapter.name,
      });
    }
  }

  return watched;
}

/**
 * Debounce helper — prevents rapid change floods from firing too often.
 */
function debounce(fn: (filePath: string, source?: string) => void, ms: number) {
  const timers: Map<string, NodeJS.Timeout> = new Map();
  return (filePath: string, source?: string) => {
    const key = `${filePath}:${source}`;
    const existing = timers.get(key);
    if (existing) clearTimeout(existing);
    timers.set(key, setTimeout(() => { timers.delete(key); fn(filePath, source); }, ms));
  };
}

/**
 * Start watching. Returns a cleanup function.
 * Watch mode is intentionally lightweight: it logs events and suggests re-import
 * for external paths. It does not attempt to live-parse or auto-import.
 */
export function startWatcher(
  watched: WatchedPath[],
  cwd: string = process.cwd(),
  onEvent: (msg: string) => void
): () => void {
  const watchers: fs.FSWatcher[] = [];

  const handleChange = debounce((filePath: string, source?: string) => {
    const ts = new Date().toISOString();

    if (source) {
      // External source changed — suggest re-import
      onEvent(`Detected changes in ${capitalize(source)} local history.\nRun: boot session import ${source}`);
    } else {
      // Internal session file changed — log a file-change event
      const session = getLatestActiveSession(cwd);
      if (session) {
        try {
          appendEvent(session.id, "file-change", { filePath, timestamp: ts }, cwd);
        } catch {
          // ignore — session may have been deleted
        }
      }
      onEvent(`Session file updated: ${path.basename(filePath)}`);
    }
  }, 800);

  for (const wp of watched) {
    if (!fs.existsSync(wp.path)) {
      // Directory doesn't exist yet — skip but don't error
      continue;
    }
    try {
      const watcher = fs.watch(wp.path, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        const fp = path.join(wp.path, filename);
        if (filename.endsWith(".json") || filename.endsWith(".jsonl")) {
          handleChange(fp, wp.source);
        }
      });
      watchers.push(watcher);
    } catch {
      // Some platforms restrict recursive watch — silently skip
    }
  }

  return () => {
    for (const w of watchers) {
      try { w.close(); } catch { /* ignore */ }
    }
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

import * as fs from "fs";
import * as path from "path";
import { SessionAdapter } from "./adapters/baseAdapter";
import { CursorAdapter } from "./adapters/cursorAdapter";
import { ClaudeAdapter } from "./adapters/claudeAdapter";
import { OpenCodeAdapter } from "./adapters/opencodeAdapter";
import { OpenAIAdapter } from "./adapters/openaiAdapter";
import {
  Session,
  getImportedSessionsDir,
  ensureDir,
  loadManifest,
  saveManifest,
  contentHash,
  isAlreadyImported,
  ManifestEntry,
} from "./sessionStore";
import { normalizeSession } from "./normalizeSession";

export const ADAPTERS: Record<string, SessionAdapter> = {
  cursor: new CursorAdapter(),
  claude: new ClaudeAdapter(),
  opencode: new OpenCodeAdapter(),
  openai: new OpenAIAdapter(),
};

export interface ImportResult {
  source: string;
  candidateFiles: number;
  imported: number;
  skipped: number;
  checkedPaths: string[];
  savedTo: string;
}

export async function importSessions(
  sourceName: string,
  cwd: string = process.cwd()
): Promise<ImportResult> {
  const adapter = ADAPTERS[sourceName];
  if (!adapter) {
    throw new Error(
      `Unsupported source: "${sourceName}". Supported: ${Object.keys(ADAPTERS).join(", ")}`
    );
  }

  const checkedPaths = await adapter.detectPaths();
  const importedDir = getImportedSessionsDir(cwd);
  ensureDir(importedDir);

  if (checkedPaths.length === 0) {
    return {
      source: sourceName,
      candidateFiles: 0,
      imported: 0,
      skipped: 0,
      checkedPaths: getDefaultSearchPaths(adapter),
      savedTo: importedDir,
    };
  }

  const discovered = await adapter.discoverSessions(checkedPaths);
  const manifest = loadManifest(cwd);
  const newEntries: ManifestEntry[] = [];
  let imported = 0;
  let skipped = 0;

  for (const item of discovered) {
    const rawStr = JSON.stringify(item.raw);
    const hash = contentHash(rawStr);

    if (isAlreadyImported(sourceName, item.sourcePath, hash, manifest)) {
      skipped++;
      continue;
    }

    let normalized: Omit<Session, "id" | "createdAt" | "updatedAt"> | null = null;
    try {
      normalized = await adapter.importSession(item);
    } catch {
      skipped++;
      continue;
    }

    if (!normalized) {
      skipped++;
      continue;
    }

    const session = normalizeSession(normalized);

    const filePath = path.join(importedDir, `${session.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(session, null, 2), "utf8");

    newEntries.push({
      source: sourceName,
      sourcePath: item.sourcePath,
      hash,
      sessionId: session.id,
      importedAt: session.createdAt,
    });

    imported++;
  }

  saveManifest([...manifest, ...newEntries], cwd);

  return {
    source: sourceName,
    candidateFiles: discovered.length,
    imported,
    skipped,
    checkedPaths,
    savedTo: importedDir,
  };
}

function getDefaultSearchPaths(adapter: SessionAdapter): string[] {
  // Return the paths that *would* be checked but don't exist — for helpful output
  const os = require("os");
  const path = require("path");
  const home = os.homedir();
  const map: Record<string, string[]> = {
    cursor: [
      path.join(home, "~/.cursor"),
      path.join(home, "~/Library/Application Support/Cursor"),
    ],
    claude: [path.join(home, "~/.claude"), path.join(home, "~/.config/claude")],
    opencode: [path.join(home, "~/.opencode"), path.join(home, "~/.config/opencode")],
    openai: [path.join(home, "~/.openai"), path.join(home, "~/.codex")],
  };
  return map[adapter.name] || [];
}

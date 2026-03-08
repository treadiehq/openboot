import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { SessionAdapter, DiscoveredSession } from "./baseAdapter";
import { Session, SessionMessage } from "../sessionStore";

/**
 * Cursor stores conversation history as JSONL or JSON files under a few
 * well-known paths. The exact internal format varies across versions, so
 * this adapter is conservative: it extracts what it can and stores
 * everything else under metadata.rawSource.
 */
export class CursorAdapter implements SessionAdapter {
  name = "cursor";
  displayName = "Cursor";

  async detectPaths(): Promise<string[]> {
    const home = os.homedir();
    const candidates = [
      path.join(home, ".cursor"),
      path.join(home, "Library", "Application Support", "Cursor"),
      path.join(home, "AppData", "Roaming", "Cursor"),
      path.join(home, ".config", "Cursor"),
    ];
    return candidates.filter((p) => fs.existsSync(p));
  }

  async discoverSessions(paths: string[]): Promise<DiscoveredSession[]> {
    const discovered: DiscoveredSession[] = [];

    for (const basePath of paths) {
      const files = this.findCandidateFiles(basePath);
      for (const filePath of files) {
        const parsed = this.tryParseFile(filePath);
        if (parsed) {
          discovered.push({
            label: path.relative(os.homedir(), filePath),
            sourcePath: filePath,
            raw: parsed,
          });
        }
      }
    }

    return discovered;
  }

  async importSession(
    input: DiscoveredSession
  ): Promise<Omit<Session, "id" | "createdAt" | "updatedAt"> | null> {
    const raw = input.raw as Record<string, unknown>;
    const messages = this.extractMessages(raw);
    const task = this.inferTask(raw, messages, input.sourcePath);

    return {
      tool: "cursor",
      project: this.inferProject(raw, input.sourcePath),
      branch: "unknown",
      task,
      status: "imported",
      source: {
        type: "imported",
        name: "cursor",
        sourceSessionId: this.extractId(raw),
      },
      snapshotIds: [],
      summary: "",
      messages,
      events: [],
      metadata: {
        filesTouched: [],
        commandsRun: [],
        rawSource: raw,
      },
    };
  }

  private findCandidateFiles(basePath: string): string[] {
    const results: string[] = [];
    const extensions = [".json", ".jsonl"];
    const skipDirs = new Set(["node_modules", "logs", "CachedExtensions", "CachedData"]);

    const walk = (dir: string, depth: number) => {
      if (depth > 5) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (!skipDirs.has(entry.name)) walk(path.join(dir, entry.name), depth + 1);
        } else if (entry.isFile() && extensions.some((e) => entry.name.endsWith(e))) {
          const fp = path.join(dir, entry.name);
          // Size guard: skip files > 10MB
          try {
            if (fs.statSync(fp).size < 10 * 1024 * 1024) results.push(fp);
          } catch {
            // ignore
          }
        }
      }
    };

    walk(basePath, 0);
    return results;
  }

  private tryParseFile(filePath: string): Record<string, unknown> | null {
    try {
      const content = fs.readFileSync(filePath, "utf8").trim();
      if (!content) return null;

      // Try JSON first
      if (content.startsWith("{") || content.startsWith("[")) {
        return JSON.parse(content) as Record<string, unknown>;
      }

      // Try JSONL — collect all valid lines
      const lines = content.split("\n");
      const parsed = lines
        .map((l) => {
          try {
            return JSON.parse(l.trim());
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      if (parsed.length === 0) return null;
      return { _jsonl: true, entries: parsed } as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private extractMessages(raw: Record<string, unknown>): SessionMessage[] {
    const messages: SessionMessage[] = [];
    const now = new Date().toISOString();

    // Handle JSONL format
    if (raw._jsonl && Array.isArray(raw.entries)) {
      for (const entry of raw.entries as Record<string, unknown>[]) {
        const msg = this.tryExtractMessage(entry, now);
        if (msg) messages.push(msg);
      }
      return messages;
    }

    // Handle common Cursor conversation shapes
    const candidates = [
      raw.conversation,
      raw.messages,
      raw.history,
      raw.chat,
      raw.turns,
    ].find(Array.isArray);

    if (candidates) {
      for (const entry of candidates as Record<string, unknown>[]) {
        const msg = this.tryExtractMessage(entry, now);
        if (msg) messages.push(msg);
      }
    }

    return messages;
  }

  private tryExtractMessage(
    entry: Record<string, unknown>,
    fallbackTs: string
  ): SessionMessage | null {
    if (!entry || typeof entry !== "object") return null;

    const content =
      (entry.content as string) ||
      (entry.text as string) ||
      (entry.message as string) ||
      (entry.body as string);

    if (!content || typeof content !== "string" || content.trim().length === 0) return null;

    const rawRole = (entry.role as string) || (entry.type as string) || "";
    const role: SessionMessage["role"] = rawRole.toLowerCase().includes("user")
      ? "user"
      : rawRole.toLowerCase().includes("assistant") || rawRole.toLowerCase().includes("bot")
      ? "assistant"
      : rawRole.toLowerCase().includes("system")
      ? "system"
      : "assistant";

    const timestamp =
      (entry.timestamp as string) ||
      (entry.createdAt as string) ||
      (entry.ts as string) ||
      fallbackTs;

    return { role, content: content.trim(), timestamp };
  }

  private inferTask(
    raw: Record<string, unknown>,
    messages: SessionMessage[],
    sourcePath: string
  ): string {
    // Try known task/title fields
    const title =
      (raw.title as string) ||
      (raw.name as string) ||
      (raw.task as string) ||
      (raw.description as string);
    if (title && typeof title === "string") return title.trim();

    // Use first user message as task description
    const firstUser = messages.find((m) => m.role === "user");
    if (firstUser) {
      return firstUser.content.slice(0, 80).replace(/\n/g, " ").trim();
    }

    return `Imported from ${path.basename(sourcePath)}`;
  }

  private inferProject(raw: Record<string, unknown>, sourcePath: string): string {
    return (
      (raw.project as string) ||
      (raw.workspace as string) ||
      path.basename(path.dirname(sourcePath))
    );
  }

  private extractId(raw: Record<string, unknown>): string | undefined {
    return (raw.id as string) || (raw.sessionId as string) || (raw.uuid as string) || undefined;
  }
}

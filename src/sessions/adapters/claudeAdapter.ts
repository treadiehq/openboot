import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { SessionAdapter, DiscoveredSession } from "./baseAdapter";
import { Session, SessionMessage } from "../sessionStore";

/**
 * Claude Code (the CLI tool) stores project state and conversation artifacts
 * under ~/.config/claude and sometimes ~/.claude.
 *
 * If no structured session data is accessible, this adapter falls back to
 * importing any readable transcript or log files and reports cleanly when
 * nothing importable is found.
 */
export class ClaudeAdapter implements SessionAdapter {
  name = "claude";
  displayName = "Claude Code";

  async detectPaths(): Promise<string[]> {
    const home = os.homedir();
    const candidates = [
      path.join(home, ".claude"),
      path.join(home, ".config", "claude"),
      path.join(home, "Library", "Application Support", "claude"),
      path.join(home, "AppData", "Roaming", "claude"),
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
    if (messages.length === 0) return null;

    const task = this.inferTask(raw, messages, input.sourcePath);

    return {
      tool: "claude",
      project: (raw.project as string) || path.basename(path.dirname(input.sourcePath)),
      branch: "unknown",
      task,
      status: "imported",
      source: {
        type: "imported",
        name: "claude",
        sourceSessionId:
          (raw.id as string) || (raw.sessionId as string) || undefined,
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
    const skipDirs = new Set(["node_modules"]);

    const walk = (dir: string, depth: number) => {
      if (depth > 4) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (!skipDirs.has(entry.name)) walk(path.join(dir, entry.name), depth + 1);
        } else if (entry.isFile()) {
          const name = entry.name.toLowerCase();
          if (name.endsWith(".json") || name.endsWith(".jsonl") || name.includes("transcript")) {
            const fp = path.join(dir, entry.name);
            try {
              if (fs.statSync(fp).size < 10 * 1024 * 1024) results.push(fp);
            } catch {
              // ignore
            }
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

      if (content.startsWith("{") || content.startsWith("[")) {
        return JSON.parse(content) as Record<string, unknown>;
      }

      // JSONL
      const parsed = content
        .split("\n")
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
    const now = new Date().toISOString();
    const messages: SessionMessage[] = [];

    if (raw._jsonl && Array.isArray(raw.entries)) {
      for (const entry of raw.entries as Record<string, unknown>[]) {
        const msg = this.tryExtractMessage(entry, now);
        if (msg) messages.push(msg);
      }
      return messages;
    }

    const candidates = [
      raw.messages,
      raw.conversation,
      raw.transcript,
      raw.history,
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
      (entry.message as string);
    if (!content || content.trim().length === 0) return null;

    const rawRole = ((entry.role as string) || (entry.type as string) || "").toLowerCase();
    const role: SessionMessage["role"] = rawRole.includes("user")
      ? "user"
      : rawRole.includes("assistant") || rawRole.includes("bot")
      ? "assistant"
      : "assistant";

    return {
      role,
      content: content.trim(),
      timestamp: (entry.timestamp as string) || (entry.createdAt as string) || fallbackTs,
    };
  }

  private inferTask(
    raw: Record<string, unknown>,
    messages: SessionMessage[],
    sourcePath: string
  ): string {
    const title = (raw.title as string) || (raw.name as string);
    if (title) return title.trim();
    const firstUser = messages.find((m) => m.role === "user");
    if (firstUser) return firstUser.content.slice(0, 80).replace(/\n/g, " ").trim();
    return `Imported from ${path.basename(sourcePath)}`;
  }
}

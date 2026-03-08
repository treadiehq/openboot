import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { SessionAdapter, DiscoveredSession } from "./baseAdapter";
import { Session, SessionMessage } from "../sessionStore";

/**
 * OpenCode stores data under ~/.opencode. This adapter searches known paths
 * and normalizes whatever is found into OpenBoot session format.
 */
export class OpenCodeAdapter implements SessionAdapter {
  name = "opencode";
  displayName = "OpenCode";

  async detectPaths(): Promise<string[]> {
    const home = os.homedir();
    const candidates = [
      path.join(home, ".opencode"),
      path.join(home, ".config", "opencode"),
      path.join(home, "Library", "Application Support", "opencode"),
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

    const firstUser = messages.find((m) => m.role === "user");
    const task =
      (raw.title as string) ||
      (firstUser?.content.slice(0, 80).replace(/\n/g, " ")) ||
      `Imported from ${path.basename(input.sourcePath)}`;

    return {
      tool: "opencode",
      project: (raw.project as string) || path.basename(path.dirname(input.sourcePath)),
      branch: "unknown",
      task,
      status: "imported",
      source: {
        type: "imported",
        name: "opencode",
        sourceSessionId: (raw.id as string) || undefined,
      },
      snapshotIds: [],
      summary: "",
      messages,
      events: [],
      metadata: { filesTouched: [], commandsRun: [], rawSource: raw },
    };
  }

  private findCandidateFiles(basePath: string): string[] {
    const results: string[] = [];
    const walk = (dir: string, depth: number) => {
      if (depth > 4) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.isDirectory()) walk(path.join(dir, entry.name), depth + 1);
        else if (entry.isFile() && entry.name.endsWith(".json")) {
          const fp = path.join(dir, entry.name);
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
      if (!content || (!content.startsWith("{") && !content.startsWith("["))) return null;
      return JSON.parse(content) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private extractMessages(raw: Record<string, unknown>): SessionMessage[] {
    const now = new Date().toISOString();
    const candidates = [raw.messages, raw.conversation, raw.history].find(Array.isArray);
    if (!candidates) return [];

    const out: SessionMessage[] = [];
    for (const entry of candidates as Record<string, unknown>[]) {
      const content =
        (entry.content as string) || (entry.text as string) || (entry.message as string);
      if (!content?.trim()) continue;
      const rawRole = ((entry.role as string) || "").toLowerCase();
      const role: SessionMessage["role"] = rawRole.includes("user")
        ? "user"
        : rawRole.includes("system")
        ? "system"
        : "assistant";
      out.push({ role, content: content.trim(), timestamp: (entry.timestamp as string) || now });
    }
    return out;
  }
}

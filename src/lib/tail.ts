import * as fs from "fs";
import * as path from "path";
import { BootConfig } from "../types";

const LOGS_DIR = path.join(".boot", "logs");

/**
 * ANSI color codes for service labels.
 */
const COLORS = [
  "\x1b[36m", // cyan
  "\x1b[33m", // yellow
  "\x1b[35m", // magenta
  "\x1b[32m", // green
  "\x1b[34m", // blue
  "\x1b[91m", // bright red
  "\x1b[93m", // bright yellow
  "\x1b[95m", // bright magenta
];
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";

interface TailHandle {
  /** Stop all watchers and clean up. */
  stop: () => void;
}

/**
 * Stream all app logs to stdout, interleaved and color-coded by service name.
 * Returns a handle to stop tailing.
 */
export function tailAllLogs(config: BootConfig): TailHandle {
  const watchers: fs.FSWatcher[] = [];
  const positions = new Map<string, number>();

  const apps = config.apps || [];
  const maxNameLen = Math.max(...apps.map((a) => a.name.length), 5);

  // Print initial message
  console.log(
    `${DIM}Streaming logs for ${apps.length} service${apps.length !== 1 ? "s" : ""}... (Ctrl+C to detach)${RESET}\n`
  );

  for (let i = 0; i < apps.length; i++) {
    const app = apps[i];
    const color = COLORS[i % COLORS.length];
    const logPath = path.join(LOGS_DIR, `${app.name}.log`);
    const label = app.name.padEnd(maxNameLen);

    // Read existing content from the end (last 5 lines for context)
    if (fs.existsSync(logPath)) {
      const content = fs.readFileSync(logPath, "utf-8");
      const lines = content.split("\n");
      const startLine = Math.max(0, lines.length - 6);
      const tail = lines.slice(startLine).join("\n").trim();
      if (tail) {
        for (const line of tail.split("\n")) {
          console.log(`${color}${label}${RESET} ${DIM}│${RESET} ${line}`);
        }
      }
      positions.set(app.name, content.length);
    } else {
      positions.set(app.name, 0);
    }

    // Watch for changes
    try {
      // Ensure the log file exists
      if (!fs.existsSync(logPath)) {
        fs.mkdirSync(path.dirname(logPath), { recursive: true });
        fs.writeFileSync(logPath, "");
      }

      const watcher = fs.watch(logPath, () => {
        try {
          const stat = fs.statSync(logPath);
          const prevPos = positions.get(app.name) || 0;

          if (stat.size > prevPos) {
            // Read new content
            const fd = fs.openSync(logPath, "r");
            const buf = Buffer.alloc(stat.size - prevPos);
            fs.readSync(fd, buf, 0, buf.length, prevPos);
            fs.closeSync(fd);

            const newContent = buf.toString("utf-8");
            const newLines = newContent.split("\n");

            for (const line of newLines) {
              if (line.trim()) {
                console.log(
                  `${color}${label}${RESET} ${DIM}│${RESET} ${line}`
                );
              }
            }

            positions.set(app.name, stat.size);
          } else if (stat.size < prevPos) {
            // File was truncated (e.g. after clean)
            positions.set(app.name, 0);
          }
        } catch {
          // File might have been deleted
        }
      });

      watchers.push(watcher);
    } catch {
      // Can't watch this file
    }
  }

  return {
    stop: () => {
      for (const w of watchers) {
        w.close();
      }
    },
  };
}

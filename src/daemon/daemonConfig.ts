import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface DaemonConfig {
  enabled: boolean;
  intervalSeconds: number;
}

export interface DaemonState {
  pid: number;
  startedAt: string;
  lastRunAt?: string;
  lastResult?: "ok" | "error";
  lastError?: string;
  intervalSeconds: number;
}

export function getDaemonConfigPath(cwd: string = process.cwd()): string {
  return path.join(cwd, ".openboot", "sync", "daemon.json");
}

export function getDaemonStatePath(): string {
  return process.env.OPENBOOT_DAEMON_STATE_PATH ?? path.join(os.homedir(), ".openboot-daemon.json");
}

export function loadDaemonConfig(cwd: string = process.cwd()): DaemonConfig {
  const fp = getDaemonConfigPath(cwd);
  if (!fs.existsSync(fp)) return { enabled: false, intervalSeconds: 60 };
  try {
    return JSON.parse(fs.readFileSync(fp, "utf8")) as DaemonConfig;
  } catch {
    return { enabled: false, intervalSeconds: 60 };
  }
}

export function saveDaemonConfig(config: DaemonConfig, cwd: string = process.cwd()): void {
  const fp = getDaemonConfigPath(cwd);
  const dir = path.dirname(fp);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(config, null, 2), "utf8");
}

export function loadDaemonState(): DaemonState | null {
  const fp = getDaemonStatePath();
  if (!fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, "utf8")) as DaemonState;
  } catch {
    return null;
  }
}

export function saveDaemonState(state: DaemonState): void {
  fs.writeFileSync(getDaemonStatePath(), JSON.stringify(state, null, 2), "utf8");
}

export function clearDaemonState(): void {
  const fp = getDaemonStatePath();
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
}

export function isDaemonRunning(): boolean {
  const state = loadDaemonState();
  if (!state) return false;
  try {
    // Check if the PID is still alive (works on macOS/Linux)
    process.kill(state.pid, 0);
    return true;
  } catch {
    return false;
  }
}

import * as fs from "fs";
import * as path from "path";

export type SyncProvider = "icloud" | "dropbox-folder" | "google-drive-folder" | "onedrive-folder" | "git" | "folder";

export interface SyncConfig {
  enabled: boolean;
  provider: SyncProvider;
  targetPath: string;
  lastSyncAt?: string;
  lastPushResult?: "ok" | "error";
  lastPullResult?: "ok" | "conflict" | "error";
  lastError?: string;
}

export function getSyncConfigPath(cwd: string = process.cwd()): string {
  return path.join(cwd, ".openboot", "sync", "config.json");
}

export function loadSyncConfig(cwd: string = process.cwd()): SyncConfig | null {
  const fp = getSyncConfigPath(cwd);
  if (!fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, "utf8")) as SyncConfig;
  } catch {
    return null;
  }
}

export function saveSyncConfig(config: SyncConfig, cwd: string = process.cwd()): void {
  const fp = getSyncConfigPath(cwd);
  const dir = path.dirname(fp);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(config, null, 2), "utf8");
}

export function getDefaultTargetPath(provider: SyncProvider): string {
  const home = require("os").homedir();
  const map: Record<SyncProvider, string> = {
    icloud: path.join(home, "Library", "Mobile Documents", "com~apple~CloudDocs", "OpenBoot"),
    "dropbox-folder": path.join(home, "Dropbox", "OpenBoot"),
    "google-drive-folder": path.join(home, "Google Drive", "OpenBoot"),
    "onedrive-folder": path.join(home, "OneDrive", "OpenBoot"),
    git: path.join(home, ".openboot-remote"),
    folder: path.join(home, "OpenBoot"),
  };
  return map[provider] ?? path.join(home, "OpenBoot");
}

export const SUPPORTED_PROVIDERS: SyncProvider[] = [
  "icloud",
  "dropbox-folder",
  "google-drive-folder",
  "onedrive-folder",
  "git",
  "folder",
];

/** Files and patterns that must never be synced */
export const SYNC_BLOCKLIST = [
  ".env",
  ".env.*",
  "*.pem",
  "*.key",
  "id_rsa",
  "id_ed25519",
  ".openai",
  "credentials.json",
  "secrets.*",
];

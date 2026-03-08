import * as fs from "fs";
import * as path from "path";

/**
 * Generic folder-based sync provider.
 * All cloud providers (iCloud, Dropbox, Google Drive, OneDrive) are treated
 * as folder targets — their sync daemon handles the actual cloud transfer.
 * OpenBoot only reads and writes local filesystem paths.
 *
 * Security: never syncs anything outside .openboot/, never copies .env or keys.
 */

const OPENBOOT_SYNC_DIRS = ["sessions", "tasks", "snapshots", "context"];
const BLOCKED_PATTERNS = [/\.env($|\.)/, /\.pem$/, /\.key$/, /id_rsa/, /id_ed25519/, /credentials/, /secrets/];

function isSafe(filename: string): boolean {
  return !BLOCKED_PATTERNS.some((re) => re.test(filename));
}

export function pushToFolder(
  sourceOpenbootDir: string,
  targetPath: string
): { pushed: number; skipped: number; errors: string[] } {
  let pushed = 0;
  let skipped = 0;
  const errors: string[] = [];

  if (!fs.existsSync(targetPath)) {
    try {
      fs.mkdirSync(targetPath, { recursive: true });
    } catch (e: any) {
      return { pushed: 0, skipped: 0, errors: [`Cannot create target: ${e.message}`] };
    }
  }

  for (const subdir of OPENBOOT_SYNC_DIRS) {
    const srcDir = path.join(sourceOpenbootDir, subdir);
    if (!fs.existsSync(srcDir)) continue;

    const destDir = path.join(targetPath, subdir);
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

    for (const file of walkFiles(srcDir)) {
      const rel = path.relative(srcDir, file);
      if (!isSafe(rel)) { skipped++; continue; }
      const dest = path.join(destDir, rel);
      try {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(file, dest);
        pushed++;
      } catch (e: any) {
        errors.push(`${rel}: ${e.message}`);
      }
    }
  }

  return { pushed, skipped, errors };
}

export function pullFromFolder(
  targetPath: string,
  destOpenbootDir: string
): { pulled: number; conflicts: number; skipped: number; errors: string[] } {
  let pulled = 0;
  let conflicts = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const subdir of OPENBOOT_SYNC_DIRS) {
    const srcDir = path.join(targetPath, subdir);
    if (!fs.existsSync(srcDir)) continue;

    const destDir = path.join(destOpenbootDir, subdir);

    for (const file of walkFiles(srcDir)) {
      const rel = path.relative(srcDir, file);
      if (!isSafe(rel)) { skipped++; continue; }
      const dest = path.join(destDir, rel);

      try {
        fs.mkdirSync(path.dirname(dest), { recursive: true });

        if (fs.existsSync(dest)) {
          const srcContent = fs.readFileSync(file, "utf8");
          const destContent = fs.readFileSync(dest, "utf8");

          if (srcContent === destContent) {
            skipped++;
            continue;
          }

          // Conflict: keep both — write incoming with .conflict suffix
          const conflictPath = dest.replace(/\.json$/, ".conflict.json");
          fs.writeFileSync(conflictPath, srcContent, "utf8");
          conflicts++;
        } else {
          fs.copyFileSync(file, dest);
          pulled++;
        }
      } catch (e: any) {
        errors.push(`${rel}: ${e.message}`);
      }
    }
  }

  return { pulled, conflicts, skipped, errors };
}

function walkFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walkFiles(fp));
    else if (entry.isFile() && entry.name.endsWith(".json")) results.push(fp);
  }
  return results;
}

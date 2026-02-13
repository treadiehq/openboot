import { execSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import { log } from "../lib/log";

const PKG_NAME = "openboot";

/**
 * Get the currently installed version from our own package.json.
 */
export function getCurrentVersion(): string {
  // From dist/commands/update.js, package.json is two levels up
  const pkgPath = path.join(__dirname, "..", "..", "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      return pkg.version;
    } catch {
      // fall through
    }
  }
  return "unknown";
}

/**
 * Get the latest published version from the npm registry.
 */
function getLatestVersion(): string | null {
  try {
    return execSync(`npm view ${PKG_NAME} version`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * `boot version` — show current version and check for updates.
 */
export async function version(): Promise<void> {
  const current = getCurrentVersion();
  console.log(`openboot v${current}`);

  const latest = getLatestVersion();
  if (latest && latest !== current) {
    log.blank();
    log.info(`Update available: ${current} → ${latest}`);
    log.step("Run `boot update` to install the latest version.");
  }
}

/**
 * `boot update` — update openboot to the latest version.
 */
export async function update(): Promise<void> {
  const current = getCurrentVersion();
  log.info(`Current version: ${current}`);
  log.info("Checking for updates...");

  const latest = getLatestVersion();

  if (!latest) {
    log.error("Could not check for updates. Are you online?");
    process.exit(1);
  }

  if (current === latest) {
    log.success(`Already on the latest version (${current})`);
    return;
  }

  log.info(`New version available: ${current} → ${latest}`);
  log.info("Updating...");

  try {
    execSync(`npm install -g ${PKG_NAME}@latest`, { stdio: "inherit" });
    log.blank();
    log.success(`Updated to ${latest}`);
  } catch {
    log.error("Update failed. Try running manually:");
    log.step(`  npm install -g ${PKG_NAME}@latest`);
    process.exit(1);
  }
}

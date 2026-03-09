import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";
import { createTunnel } from "private-connect";
import type { TunnelHandle } from "private-connect";

const BOOT_DIR = ".boot";
const PROXY_DIR = path.join(BOOT_DIR, "proxy");
const TUNNEL_PID_FILE = path.join(PROXY_DIR, "tunnel.pid");
const TUNNEL_URL_FILE = path.join(PROXY_DIR, "tunnel.url");

function isSafePid(pid: number): boolean {
  return Number.isInteger(pid) && pid > 1 && pid <= 4_194_304;
}

function ensureProxyDir(): void {
  try {
    fs.mkdirSync(PROXY_DIR, { recursive: true });
  } catch {
    // ignore
  }
}

/** In-process tunnel handle (used by boot dev --tunnel); closed on stopTunnel() */
let inProcessHandle: TunnelHandle | null = null;

export interface TunnelResult {
  url: string;
  stop: () => void;
}

export interface StartTunnelOptions {
  /** If true, tunnel runs in this process (boot dev). If false, spawns a child (boot up). */
  inProcess?: boolean;
}

/**
 * Start a Private Connect tunnel using the programmatic API.
 * - inProcess: true  → createTunnel() in this process; stop() closes the handle.
 * - inProcess: false → spawn a child that runs the API and writes pid+url; stop() kills the child.
 */
export function startTunnel(
  port: number,
  options: StartTunnelOptions = {}
): Promise<TunnelResult> {
  const inProcess = options.inProcess === true;
  ensureProxyDir();

  if (inProcess) {
    return createTunnel({ port }).then((handle) => {
      inProcessHandle = handle;
      try {
        fs.writeFileSync(TUNNEL_URL_FILE, handle.url, "utf-8");
      } catch {
        // non-fatal
      }
      return {
        url: handle.url,
        stop: () => {
          stopTunnel();
        },
      };
    });
  }

  // Background: spawn a child that uses the API and stays alive.
  // Require only the tunnel submodule to avoid running private-connect's CLI (index.js runs CLI on load).
  const mainPath = require.resolve("private-connect");
  const tunnelPath = path.join(path.dirname(mainPath), "tunnel.js");
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      BOOT_TUNNEL_PORT: String(port),
      BOOT_TUNNEL_PID_FILE: TUNNEL_PID_FILE,
      BOOT_TUNNEL_URL_FILE: TUNNEL_URL_FILE,
      PRIVATE_CONNECT_MODULE: tunnelPath,
    };
    const script = `
const { createTunnel } = require(process.env.PRIVATE_CONNECT_MODULE);
const port = parseInt(process.env.BOOT_TUNNEL_PORT, 10);
const pidFile = process.env.BOOT_TUNNEL_PID_FILE;
const urlFile = process.env.BOOT_TUNNEL_URL_FILE;
createTunnel({ port })
  .then(t => {
    require('fs').writeFileSync(pidFile, String(process.pid));
    require('fs').writeFileSync(urlFile, t.url);
    process.on('SIGTERM', () => t.close().then(() => process.exit(0)));
  })
  .catch(err => { console.error(err); process.exit(1); });
`;
    const child = spawn(process.execPath, ["-e", script], {
      env,
      stdio: "ignore",
      detached: true,
      windowsHide: true,
    });
    child.unref();

    const timeout = setTimeout(() => {
      if (urlReceived) return;
      stopTunnel();
      reject(new Error("Tunnel URL not received within 15s"));
    }, 15000);

    let urlReceived = false;
    const pollMs = 200;
    const maxAttempts = (15000 / pollMs) | 0;

    const poll = (attempt: number) => {
      if (urlReceived || attempt >= maxAttempts) return;
      try {
        if (fs.existsSync(TUNNEL_URL_FILE)) {
          const url = fs.readFileSync(TUNNEL_URL_FILE, "utf-8").trim();
          if (url) {
            urlReceived = true;
            clearTimeout(timeout);
            resolve({
              url,
              stop: () => stopTunnel(),
            });
            return;
          }
        }
      } catch {
        // ignore
      }
      setTimeout(() => poll(attempt + 1), pollMs);
    };
    setTimeout(() => poll(0), 100);
  });
}

/**
 * Stop the tunnel: close in-process handle if any, or kill the background process.
 */
export function stopTunnel(): void {
  if (inProcessHandle) {
    inProcessHandle.close().catch(() => {});
    inProcessHandle = null;
  }
  try {
    if (!fs.existsSync(TUNNEL_PID_FILE)) return;
    const pid = parseInt(fs.readFileSync(TUNNEL_PID_FILE, "utf-8").trim(), 10);
    if (!isSafePid(pid)) {
      fs.unlinkSync(TUNNEL_PID_FILE);
      if (fs.existsSync(TUNNEL_URL_FILE)) fs.unlinkSync(TUNNEL_URL_FILE);
      return;
    }
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // already dead
    }
    fs.unlinkSync(TUNNEL_PID_FILE);
    if (fs.existsSync(TUNNEL_URL_FILE)) fs.unlinkSync(TUNNEL_URL_FILE);
  } catch {
    // no pid file or unlink failed
  }
}

/**
 * Return true if a tunnel is active (in-process handle or background process alive).
 */
export function isTunnelRunning(): boolean {
  if (inProcessHandle) return true;
  try {
    if (!fs.existsSync(TUNNEL_PID_FILE)) return false;
    const pid = parseInt(fs.readFileSync(TUNNEL_PID_FILE, "utf-8").trim(), 10);
    if (!isSafePid(pid)) return false;
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the last known tunnel URL from .boot/proxy/tunnel.url (if present).
 */
export function getTunnelUrl(): string | null {
  if (inProcessHandle) return inProcessHandle.url;
  try {
    if (fs.existsSync(TUNNEL_URL_FILE)) {
      return fs.readFileSync(TUNNEL_URL_FILE, "utf-8").trim() || null;
    }
  } catch {
    // ignore
  }
  return null;
}

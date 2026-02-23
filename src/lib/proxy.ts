import * as http from "http";
import * as net from "net";
import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";
import { log } from "./log";
import { isPortInUse } from "./ports";

const PROXY_DIR = path.join(".boot", "proxy");
const ROUTES_FILE = path.join(PROXY_DIR, "routes.json");
const PID_FILE = path.join(PROXY_DIR, "proxy.pid");
const LOG_FILE = path.join(PROXY_DIR, "proxy.log");

export const PROXY_PORT = 1355;
const MAX_PORT_ATTEMPTS = 10;

let proxyServer: http.Server | null = null;

function findAvailablePort(startPort: number): number {
  for (let i = 0; i < MAX_PORT_ATTEMPTS; i++) {
    const port = startPort + i;
    if (!isPortInUse(port)) return port;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Route persistence — shared by in-process and background proxy
// ---------------------------------------------------------------------------

interface RouteEntry {
  port: number;
  pid: number;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read routes from disk, filtering out stale entries whose owning
 * process is no longer alive.
 */
function readRoutesRaw(): Record<string, RouteEntry> {
  try {
    const parsed = JSON.parse(fs.readFileSync(ROUTES_FILE, "utf-8"));
    if (!parsed || typeof parsed !== "object") return {};

    // Support both old format { name: port } and new { name: { port, pid } }
    const result: Record<string, RouteEntry> = {};
    let changed = false;
    for (const [name, val] of Object.entries(parsed)) {
      if (typeof val === "number") {
        // Legacy format — keep it (no PID to check)
        result[name] = { port: val, pid: 0 };
      } else if (val && typeof val === "object" && typeof (val as any).port === "number") {
        const entry = val as RouteEntry;
        if (entry.pid && !isProcessAlive(entry.pid)) {
          changed = true;
          continue; // stale — skip
        }
        result[name] = entry;
      }
    }

    // Persist cleanup so stale entries don't accumulate
    if (changed) {
      try {
        fs.writeFileSync(ROUTES_FILE, JSON.stringify(result, null, 2));
      } catch {
        // write may fail; non-fatal
      }
    }

    return result;
  } catch {
    return {};
  }
}

export function readRoutes(): Record<string, number> {
  const raw = readRoutesRaw();
  const result: Record<string, number> = {};
  for (const [name, entry] of Object.entries(raw)) {
    result[name] = entry.port;
  }
  return result;
}

export function writeRoute(name: string, port: number, pid?: number): void {
  fs.mkdirSync(PROXY_DIR, { recursive: true });
  const raw = readRoutesRaw();
  raw[name] = { port, pid: pid ?? process.pid };
  fs.writeFileSync(ROUTES_FILE, JSON.stringify(raw, null, 2));
}

export function removeRoute(name: string): void {
  const raw = readRoutesRaw();
  delete raw[name];
  try {
    fs.writeFileSync(ROUTES_FILE, JSON.stringify(raw, null, 2));
  } catch {
    // dir may not exist yet
  }
}

export function clearAllRoutes(): void {
  try {
    fs.unlinkSync(ROUTES_FILE);
  } catch {
    // already gone
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildForwardedHeaders(req: http.IncomingMessage): Record<string, string> {
  const remote = req.socket.remoteAddress || "127.0.0.1";
  const host = req.headers.host || "";
  return {
    "x-forwarded-for": req.headers["x-forwarded-for"]
      ? `${req.headers["x-forwarded-for"]}, ${remote}`
      : remote,
    "x-forwarded-proto": (req.headers["x-forwarded-proto"] as string) || "http",
    "x-forwarded-host": (req.headers["x-forwarded-host"] as string) || host,
    "x-forwarded-port": (req.headers["x-forwarded-port"] as string) || host.split(":")[1] || "80",
  };
}

// ---------------------------------------------------------------------------
// Proxy server core
// ---------------------------------------------------------------------------

function resolveTarget(host: string): { name: string; port: number } | null {
  const name = (host || "").split(".")[0];
  if (!name) return null;
  const routes = readRoutes();
  const port = routes[name];
  return port ? { name, port } : null;
}

function isRootRequest(host: string): boolean {
  if (!host) return true;
  const withoutPort = host.split(":")[0];
  return withoutPort === "localhost" || withoutPort === "127.0.0.1";
}

function statusPage(proxyPort: number): string {
  const routes = readRoutes();
  const entries = Object.entries(routes);

  if (entries.length === 0) {
    return [
      '<html><body style="font-family:system-ui;max-width:480px;margin:60px auto">',
      "<h2>boot proxy</h2>",
      '<p style="color:#888">No apps registered.</p>',
      "</body></html>",
    ].join("");
  }

  const rows = entries
    .map(([n, p]) => {
      const safe = escapeHtml(n);
      return (
        `<li style="margin:6px 0"><a href="http://${safe}.localhost:${proxyPort}">${safe}.localhost:${proxyPort}</a>` +
        ` <span style="color:#888">→ :${p}</span></li>`
      );
    })
    .join("");

  return [
    '<html><body style="font-family:system-ui;max-width:480px;margin:60px auto">',
    "<h2>boot proxy</h2>",
    `<ul style="list-style:none;padding:0">${rows}</ul>`,
    "</body></html>",
  ].join("");
}

function createProxyServer(proxyPort: number): http.Server {
  const server = http.createServer((req, res) => {
    const host = req.headers.host || "";

    if (isRootRequest(host)) {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(statusPage(proxyPort));
      return;
    }

    const target = resolveTarget(host);
    if (!target) {
      const name = escapeHtml(host.split(".")[0]);
      res.writeHead(502, { "content-type": "text/plain" });
      res.end(`No app registered for "${name}"`);
      return;
    }

    const forwarded = buildForwardedHeaders(req);
    const proxyReq = http.request(
      {
        hostname: "127.0.0.1",
        port: target.port,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, ...forwarded },
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode!, proxyRes.headers);
        proxyRes.pipe(res);
      }
    );

    proxyReq.on("error", () => {
      if (!res.headersSent) {
        res.writeHead(502, { "content-type": "text/plain" });
        res.end(`App "${target.name}" is not responding on port ${target.port}`);
      }
    });

    // Abort outgoing request if the client disconnects
    res.on("close", () => {
      if (!proxyReq.destroyed) proxyReq.destroy();
    });
    req.on("error", () => {
      if (!proxyReq.destroyed) proxyReq.destroy();
    });

    req.pipe(proxyReq);
  });

  // WebSocket / HTTP upgrade (HMR, live-reload, etc.)
  // Uses http.request upgrade path to preserve the exact 101 handshake
  // from the backend, including Sec-WebSocket-Accept and extensions.
  server.on("upgrade", (req, socket, head) => {
    const host = req.headers.host || "";
    const target = resolveTarget(host);

    if (!target) {
      socket.destroy();
      return;
    }

    const forwarded = buildForwardedHeaders(req);
    const proxyReq = http.request({
      hostname: "127.0.0.1",
      port: target.port,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, ...forwarded },
    });

    proxyReq.on("upgrade", (_proxyRes, proxySocket, proxyHead) => {
      // Forward the backend's raw 101 response (preserves header casing)
      let response = `HTTP/1.1 101 Switching Protocols\r\n`;
      for (let i = 0; i < _proxyRes.rawHeaders.length; i += 2) {
        response += `${_proxyRes.rawHeaders[i]}: ${_proxyRes.rawHeaders[i + 1]}\r\n`;
      }
      response += "\r\n";
      socket.write(response);

      if (proxyHead.length > 0) socket.write(proxyHead);
      proxySocket.pipe(socket);
      socket.pipe(proxySocket);

      proxySocket.on("error", () => socket.destroy());
      socket.on("error", () => proxySocket.destroy());
    });

    proxyReq.on("response", (proxyRes) => {
      // Backend rejected the upgrade with a normal HTTP response
      if (!socket.destroyed) {
        let response = `HTTP/1.1 ${proxyRes.statusCode} ${proxyRes.statusMessage}\r\n`;
        for (let i = 0; i < proxyRes.rawHeaders.length; i += 2) {
          response += `${proxyRes.rawHeaders[i]}: ${proxyRes.rawHeaders[i + 1]}\r\n`;
        }
        response += "\r\n";
        socket.write(response);
        proxyRes.pipe(socket);
      }
    });

    proxyReq.on("error", () => socket.destroy());
    socket.on("error", () => {
      if (!proxyReq.destroyed) proxyReq.destroy();
    });

    if (head.length > 0) proxyReq.write(head);
    proxyReq.end();
  });

  return server;
}

// ---------------------------------------------------------------------------
// In-process lifecycle (boot dev)
// ---------------------------------------------------------------------------

export function startProxy(port = PROXY_PORT): number {
  const actualPort = findAvailablePort(port);
  if (actualPort === 0) {
    log.warn("No available port for proxy — falling back to direct ports");
    return 0;
  }

  try {
    proxyServer = createProxyServer(actualPort);
    proxyServer.listen(actualPort, "127.0.0.1");
    return actualPort;
  } catch {
    log.warn("Failed to start proxy — falling back to direct ports");
    return 0;
  }
}

export function stopProxy(): void {
  if (proxyServer) {
    proxyServer.close();
    proxyServer = null;
  }
  clearAllRoutes();
}

// ---------------------------------------------------------------------------
// Background lifecycle (boot up)
// ---------------------------------------------------------------------------

export function startProxyBackground(port = PROXY_PORT): number {
  const actualPort = findAvailablePort(port);
  if (actualPort === 0) {
    log.warn("No available port for proxy — falling back to direct ports");
    return 0;
  }

  fs.mkdirSync(PROXY_DIR, { recursive: true });

  const logFd = fs.openSync(LOG_FILE, "a");
  const modulePath = path.resolve(__dirname, "proxy.js");
  const routesPath = path.resolve(ROUTES_FILE);

  const child = spawn(
    process.execPath,
    [
      "-e",
      `require(${JSON.stringify(modulePath)}).runStandalone(${actualPort}, ${JSON.stringify(routesPath)})`,
    ],
    {
      detached: true,
      stdio: ["ignore", logFd, logFd],
    }
  );

  child.unref();
  fs.closeSync(logFd);

  if (child.pid) {
    fs.writeFileSync(PID_FILE, String(child.pid));
    return actualPort;
  }
  return 0;
}

export function stopProxyBackground(): void {
  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, "utf-8").trim(), 10);
    if (!isNaN(pid)) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // already dead
      }
    }
    fs.unlinkSync(PID_FILE);
  } catch {
    // no pid file
  }
  clearAllRoutes();
}

export function isProxyRunning(): boolean {
  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, "utf-8").trim(), 10);
    if (isNaN(pid)) return false;
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Standalone entry point — called by the background process
// ---------------------------------------------------------------------------

export function runStandalone(port: number, routesFile: string): void {
  function loadRoutes(): Record<string, number> {
    try {
      const parsed = JSON.parse(fs.readFileSync(routesFile, "utf-8"));
      if (!parsed || typeof parsed !== "object") return {};
      const result: Record<string, number> = {};
      for (const [name, val] of Object.entries(parsed)) {
        if (typeof val === "number") {
          result[name] = val;
        } else if (val && typeof val === "object" && typeof (val as any).port === "number") {
          const entry = val as { port: number; pid: number };
          if (entry.pid && !isProcessAlive(entry.pid)) continue;
          result[name] = entry.port;
        }
      }
      return result;
    } catch {
      return {};
    }
  }

  function resolveStandalone(host: string): { name: string; port: number } | null {
    const name = (host || "").split(".")[0];
    if (!name) return null;
    const routes = loadRoutes();
    const p = routes[name];
    return p ? { name, port: p } : null;
  }

  function standaloneStatusPage(): string {
    const routes = loadRoutes();
    const entries = Object.entries(routes);
    if (entries.length === 0) {
      return (
        '<html><body style="font-family:system-ui;max-width:480px;margin:60px auto">' +
        '<h2>boot proxy</h2><p style="color:#888">No apps registered.</p></body></html>'
      );
    }
    const rows = entries
      .map(([n, p]) => {
        const safe = escapeHtml(n);
        return (
          `<li style="margin:6px 0"><a href="http://${safe}.localhost:${port}">${safe}.localhost:${port}</a>` +
          ` <span style="color:#888">→ :${p}</span></li>`
        );
      })
      .join("");
    return (
      '<html><body style="font-family:system-ui;max-width:480px;margin:60px auto">' +
      `<h2>boot proxy</h2><ul style="list-style:none;padding:0">${rows}</ul></body></html>`
    );
  }

  const server = http.createServer((req, res) => {
    const host = req.headers.host || "";

    if (isRootRequest(host)) {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(standaloneStatusPage());
      return;
    }

    const target = resolveStandalone(host);
    if (!target) {
      const name = escapeHtml(host.split(".")[0]);
      res.writeHead(502, { "content-type": "text/plain" });
      res.end(`No app registered for "${name}"`);
      return;
    }

    const forwarded = buildForwardedHeaders(req);
    const proxyReq = http.request(
      {
        hostname: "127.0.0.1",
        port: target.port,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, ...forwarded },
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode!, proxyRes.headers);
        proxyRes.pipe(res);
      }
    );

    proxyReq.on("error", () => {
      if (!res.headersSent) {
        res.writeHead(502, { "content-type": "text/plain" });
        res.end(`App "${target.name}" is not responding on port ${target.port}`);
      }
    });

    res.on("close", () => {
      if (!proxyReq.destroyed) proxyReq.destroy();
    });
    req.on("error", () => {
      if (!proxyReq.destroyed) proxyReq.destroy();
    });

    req.pipe(proxyReq);
  });

  server.on("upgrade", (req, socket, head) => {
    const host = req.headers.host || "";
    const target = resolveStandalone(host);

    if (!target) {
      socket.destroy();
      return;
    }

    const forwarded = buildForwardedHeaders(req);
    const proxyReq = http.request({
      hostname: "127.0.0.1",
      port: target.port,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, ...forwarded },
    });

    proxyReq.on("upgrade", (_proxyRes, proxySocket, proxyHead) => {
      let response = `HTTP/1.1 101 Switching Protocols\r\n`;
      for (let i = 0; i < _proxyRes.rawHeaders.length; i += 2) {
        response += `${_proxyRes.rawHeaders[i]}: ${_proxyRes.rawHeaders[i + 1]}\r\n`;
      }
      response += "\r\n";
      socket.write(response);

      if (proxyHead.length > 0) socket.write(proxyHead);
      proxySocket.pipe(socket);
      socket.pipe(proxySocket);

      proxySocket.on("error", () => socket.destroy());
      socket.on("error", () => proxySocket.destroy());
    });

    proxyReq.on("response", (proxyRes) => {
      if (!socket.destroyed) {
        let response = `HTTP/1.1 ${proxyRes.statusCode} ${proxyRes.statusMessage}\r\n`;
        for (let i = 0; i < proxyRes.rawHeaders.length; i += 2) {
          response += `${proxyRes.rawHeaders[i]}: ${proxyRes.rawHeaders[i + 1]}\r\n`;
        }
        response += "\r\n";
        socket.write(response);
        proxyRes.pipe(socket);
      }
    });

    proxyReq.on("error", () => socket.destroy());
    socket.on("error", () => {
      if (!proxyReq.destroyed) proxyReq.destroy();
    });

    if (head.length > 0) proxyReq.write(head);
    proxyReq.end();
  });

  server.listen(port, "127.0.0.1");
}

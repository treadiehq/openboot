import * as http from "http";
import * as https from "https";

/**
 * Wait for a URL to return a non-5xx response.
 */
export async function waitForHealth(
  url: string,
  timeout: number = 30
): Promise<boolean> {
  const start = Date.now();

  while (Date.now() - start < timeout * 1000) {
    try {
      await checkUrl(url);
      return true;
    } catch {
      await sleep(1000);
    }
  }

  return false;
}

/**
 * Check a URL — resolves if response is not 5xx, rejects otherwise.
 */
function checkUrl(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;

    const req = mod.get(url, (res) => {
      if (res.statusCode && res.statusCode < 500) {
        resolve();
      } else {
        reject(new Error(`HTTP ${res.statusCode}`));
      }
      res.resume();
    });

    req.on("error", reject);
    req.setTimeout(3000, () => {
      req.destroy();
      reject(new Error("timeout"));
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

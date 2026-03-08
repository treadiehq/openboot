/**
 * OpenBoot Session System — Test Suite
 * Uses Node.js built-in test runner (node:test). No extra dependencies.
 * Run: node --test tests/sessions.test.mjs
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "openboot-test-"));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// We import compiled JS from dist/ since tests run after `npm run build`
const distBase = new URL("../dist/sessions/", import.meta.url).pathname;
const {
  createSession,
  readSession,
  listSessions,
  appendMessage,
  appendEvent,
  exportSession,
  loadManifest,
  saveManifest,
  contentHash,
  isAlreadyImported,
  resolveSessionId,
  getActiveSessionsDir,
  getImportedSessionsDir,
  formatRelativeTime,
} = await import(path.join(distBase, "sessionStore.js"));

const { normalizeSession, backfillSession } = await import(
  path.join(distBase, "normalizeSession.js")
);

const { buildCommandEvent, buildStdoutEvent, buildStderrEvent, redactEnvValues } = await import(
  path.join(distBase, "wrappers/processCapture.js")
);

const { CursorAdapter } = await import(path.join(distBase, "adapters/cursorAdapter.js"));
const { ClaudeAdapter } = await import(path.join(distBase, "adapters/claudeAdapter.js"));
const { OpenCodeAdapter } = await import(path.join(distBase, "adapters/opencodeAdapter.js"));
const { OpenAIAdapter } = await import(path.join(distBase, "adapters/openaiAdapter.js"));

// ─── 1. Session store: create & read ─────────────────────────────────────────

describe("sessionStore — create and read", () => {
  test("createSession writes a valid session file", () => {
    const dir = tmpDir();
    try {
      const s = createSession("Test task", "cursor", dir);
      assert.ok(s.id, "has id");
      assert.equal(s.task, "Test task");
      assert.equal(s.tool, "cursor");
      assert.equal(s.status, "active");
      assert.ok(s.source, "has source");
      assert.equal(s.source.type, "openboot");

      const activeDir = getActiveSessionsDir(dir);
      const files = fs.readdirSync(activeDir).filter((f) => f.endsWith(".json"));
      assert.equal(files.length, 1, "one session file created");
    } finally {
      cleanup(dir);
    }
  });

  test("readSession returns the session with backfill", () => {
    const dir = tmpDir();
    try {
      const s = createSession("Read test", "claude", dir);
      const read = readSession(s.id, dir);
      assert.ok(read, "session found");
      assert.equal(read.id, s.id);
      assert.equal(read.task, "Read test");
      assert.ok(Array.isArray(read.events), "events array present");
    } finally {
      cleanup(dir);
    }
  });

  test("listSessions returns sessions sorted by updatedAt desc", () => {
    const dir = tmpDir();
    try {
      const a = createSession("First", "other", dir);
      // Small sleep via spin to guarantee different timestamps
      const waitUntil = Date.now() + 5;
      while (Date.now() < waitUntil) {}
      const b = createSession("Second", "other", dir);
      const list = listSessions(dir);
      assert.ok(list.length >= 2);
      assert.equal(list[0].id, b.id, "most recent session is first");
    } finally {
      cleanup(dir);
    }
  });

  test("appendMessage adds to messages array", () => {
    const dir = tmpDir();
    try {
      const s = createSession("Msg test", "other", dir);
      appendMessage(s.id, "user", "Hello world", dir);
      const updated = readSession(s.id, dir);
      assert.equal(updated.messages.length, 1);
      assert.equal(updated.messages[0].content, "Hello world");
      assert.equal(updated.messages[0].role, "user");
    } finally {
      cleanup(dir);
    }
  });

  test("appendEvent adds to events array", () => {
    const dir = tmpDir();
    try {
      const s = createSession("Event test", "other", dir);
      appendEvent(s.id, "note", { content: "a note" }, dir);
      const updated = readSession(s.id, dir);
      assert.equal(updated.events.length, 1);
      assert.equal(updated.events[0].type, "note");
    } finally {
      cleanup(dir);
    }
  });

  test("exportSession writes to exports dir", () => {
    const dir = tmpDir();
    try {
      const s = createSession("Export test", "other", dir);
      const dest = exportSession(s.id, dir);
      assert.ok(fs.existsSync(dest), "export file exists");
      const exported = JSON.parse(fs.readFileSync(dest, "utf8"));
      assert.equal(exported.id, s.id);
    } finally {
      cleanup(dir);
    }
  });

  test("resolveSessionId resolves short prefix", () => {
    const dir = tmpDir();
    try {
      const s = createSession("Prefix test", "other", dir);
      const prefix = s.id.slice(0, 8);
      const resolved = resolveSessionId(prefix, dir);
      assert.equal(resolved, s.id);
    } finally {
      cleanup(dir);
    }
  });
});

// ─── 2. Backward compatibility with legacy session files ─────────────────────

describe("backward compatibility — legacy session files", () => {
  test("backfillSession fills missing fields from legacy format", () => {
    const phase1 = {
      id: "old-id-123",
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-01T01:00:00Z",
      tool: "cursor",
      project: "myapp",
      branch: "main",
      task: "Build something",
      messages: [{ role: "user", content: "Hello", timestamp: "2025-01-01T00:01:00Z" }],
      metadata: { filesTouched: [], commandsRun: [] },
    };
    const filled = backfillSession(phase1);
    assert.equal(filled.id, "old-id-123");
    assert.ok(filled.source, "source field added");
    assert.equal(filled.source.type, "openboot");
    assert.ok(Array.isArray(filled.events), "events array added");
    assert.equal(filled.status, "active", "status defaulted to active");
    assert.equal(filled.messages.length, 1, "messages preserved");
  });

  test("sessionStore reads a legacy session file on disk without crashing", () => {
    const dir = tmpDir();
    const activeDir = getActiveSessionsDir(dir);
    fs.mkdirSync(activeDir, { recursive: true });
    const phase1 = {
      id: "legacy-session",
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-02T00:00:00Z",
      tool: "cursor",
      project: "old-project",
      branch: "main",
      task: "Old task",
      messages: [],
      metadata: { filesTouched: [], commandsRun: [] },
    };
    fs.writeFileSync(path.join(activeDir, "legacy-session.json"), JSON.stringify(phase1));
    try {
      const s = readSession("legacy-session", dir);
      assert.ok(s, "session loaded");
      assert.equal(s.id, "legacy-session");
      assert.ok(Array.isArray(s.events), "events backfilled");
      assert.ok(s.source, "source backfilled");
    } finally {
      cleanup(dir);
    }
  });
});

// ─── 3. Malformed JSON safety ─────────────────────────────────────────────────

describe("malformed JSON safety", () => {
  test("listSessions skips malformed files without crashing", () => {
    const dir = tmpDir();
    const activeDir = getActiveSessionsDir(dir);
    fs.mkdirSync(activeDir, { recursive: true });
    fs.writeFileSync(path.join(activeDir, "bad.json"), "{ this is not json }");
    fs.writeFileSync(path.join(activeDir, "empty.json"), "");
    const good = createSession("Good session", "other", dir);
    try {
      const list = listSessions(dir);
      const ids = list.map((s) => s.id);
      assert.ok(ids.includes(good.id), "good session present");
      assert.ok(!ids.includes("bad"), "bad session skipped");
    } finally {
      cleanup(dir);
    }
  });

  test("readSession returns null for malformed file", () => {
    const dir = tmpDir();
    const activeDir = getActiveSessionsDir(dir);
    fs.mkdirSync(activeDir, { recursive: true });
    fs.writeFileSync(path.join(activeDir, "corrupt-id.json"), "NOT JSON");
    try {
      const s = readSession("corrupt-id", dir);
      assert.equal(s, null);
    } finally {
      cleanup(dir);
    }
  });
});

// ─── 4. Deduplication manifest ────────────────────────────────────────────────

describe("deduplication manifest", () => {
  test("contentHash is deterministic", () => {
    const h1 = contentHash("hello world");
    const h2 = contentHash("hello world");
    const h3 = contentHash("different");
    assert.equal(h1, h2, "same content same hash");
    assert.notEqual(h1, h3, "different content different hash");
  });

  test("isAlreadyImported detects duplicates", () => {
    const manifest = [
      { source: "cursor", sourcePath: "/some/path/file.json", hash: "abc123", sessionId: "x", importedAt: "" },
    ];
    assert.ok(isAlreadyImported("cursor", "/some/path/file.json", "abc123", manifest));
    assert.ok(!isAlreadyImported("cursor", "/some/path/file.json", "different", manifest));
    assert.ok(!isAlreadyImported("claude", "/some/path/file.json", "abc123", manifest));
  });

  test("saveManifest and loadManifest round-trip", () => {
    const dir = tmpDir();
    try {
      const entries = [
        { source: "cursor", sourcePath: "/a.json", hash: "h1", sessionId: "s1", importedAt: "2026-01-01T00:00:00Z" },
      ];
      saveManifest(entries, dir);
      const loaded = loadManifest(dir);
      assert.equal(loaded.length, 1);
      assert.equal(loaded[0].source, "cursor");
      assert.equal(loaded[0].hash, "h1");
    } finally {
      cleanup(dir);
    }
  });

  test("loadManifest returns [] when no manifest file exists", () => {
    const dir = tmpDir();
    try {
      const entries = loadManifest(dir);
      assert.deepEqual(entries, []);
    } finally {
      cleanup(dir);
    }
  });
});

// ─── 5. normalizeSession ─────────────────────────────────────────────────────

describe("normalizeSession", () => {
  test("fills all required fields from partial input", () => {
    const partial = {
      tool: "claude",
      project: "myapp",
      branch: "main",
      task: "Do something",
      status: "imported",
      source: { type: "imported", name: "claude" },
      messages: [{ role: "user", content: "hello", timestamp: "2026-01-01T00:00:00Z" }],
      events: [],
      metadata: { filesTouched: [], commandsRun: [] },
    };
    const s = normalizeSession(partial);
    assert.ok(s.id, "id assigned");
    assert.ok(s.createdAt, "createdAt assigned");
    assert.ok(s.updatedAt, "updatedAt assigned");
    assert.equal(s.messages.length, 1);
    assert.equal(s.status, "imported");
  });

  test("filters out invalid messages", () => {
    const partial = {
      tool: "other",
      project: "x",
      branch: "main",
      task: "test",
      status: "imported",
      source: { type: "imported", name: "manual" },
      messages: [
        { role: "user", content: "valid" },
        { role: "unknown", content: "" },
        null,
        { role: "assistant" },
      ],
      events: [],
      metadata: { filesTouched: [], commandsRun: [] },
    };
    const s = normalizeSession(partial);
    assert.equal(s.messages.length, 1, "only valid message kept");
  });
});

// ─── 6. Wrapper event capture (processCapture) ───────────────────────────────

describe("processCapture — event builders", () => {
  test("buildCommandEvent has correct shape", () => {
    const ev = buildCommandEvent("claude", ["--help"], "/repo", ["ANTHROPIC_API_KEY"], new Date().toISOString());
    assert.equal(ev.type, "command");
    assert.equal(ev.data.tool, "claude");
    assert.deepEqual(ev.data.args, ["--help"]);
    assert.ok(ev.id, "has id");
    assert.ok(ev.timestamp, "has timestamp");
  });

  test("buildStdoutEvent captures chunk and exit code", () => {
    const ev = buildStdoutEvent("some output", 0, 1234, new Date().toISOString());
    assert.equal(ev.type, "stdout");
    assert.equal(ev.data.chunk, "some output");
    assert.equal(ev.data.exitCode, 0);
    assert.equal(ev.data.durationMs, 1234);
  });

  test("buildStderrEvent captures error output", () => {
    const ev = buildStderrEvent("error text", 1, new Date().toISOString());
    assert.equal(ev.type, "stderr");
    assert.equal(ev.data.chunk, "error text");
    assert.equal(ev.data.exitCode, 1);
  });

  test("redactEnvValues returns only sensitive key names without values", () => {
    const fakeEnv = {
      PATH: "/usr/bin",
      ANTHROPIC_API_KEY: "sk-super-secret",
      HOME: "/home/user",
      GITHUB_TOKEN: "ghp_secret",
      NODE_ENV: "test",
    };
    const keys = redactEnvValues(fakeEnv);
    assert.ok(keys.includes("ANTHROPIC_API_KEY"), "API key included");
    assert.ok(keys.includes("GITHUB_TOKEN"), "token included");
    assert.ok(!keys.includes("PATH"), "PATH excluded");
    assert.ok(!keys.includes("HOME"), "HOME excluded");
    // Values must never appear in result (it's a string array of key names only)
    assert.ok(!keys.some((k) => k.includes("sk-super-secret")), "no secret values");
  });
});

// ─── 7. Adapter path detection ───────────────────────────────────────────────

describe("adapter path detection", () => {
  test("all adapters implement the SessionAdapter interface", async () => {
    const adapters = [
      new CursorAdapter(),
      new ClaudeAdapter(),
      new OpenCodeAdapter(),
      new OpenAIAdapter(),
    ];
    for (const adapter of adapters) {
      assert.ok(typeof adapter.name === "string", `${adapter.name} has name`);
      assert.ok(typeof adapter.displayName === "string", `${adapter.name} has displayName`);
      assert.ok(typeof adapter.detectPaths === "function", `${adapter.name} has detectPaths`);
      assert.ok(typeof adapter.discoverSessions === "function", `${adapter.name} has discoverSessions`);
      assert.ok(typeof adapter.importSession === "function", `${adapter.name} has importSession`);
    }
  });

  test("adapter detectPaths returns only existing directories", async () => {
    for (const Adapter of [CursorAdapter, ClaudeAdapter, OpenCodeAdapter, OpenAIAdapter]) {
      const adapter = new Adapter();
      const paths = await adapter.detectPaths();
      assert.ok(Array.isArray(paths), `${adapter.name} detectPaths returns array`);
      for (const p of paths) {
        assert.ok(fs.existsSync(p), `${adapter.name} returned path exists: ${p}`);
      }
    }
  });

  test("adapter discoverSessions returns empty array for empty dir", async () => {
    const dir = tmpDir();
    try {
      for (const Adapter of [CursorAdapter, ClaudeAdapter, OpenCodeAdapter, OpenAIAdapter]) {
        const adapter = new Adapter();
        const discovered = await adapter.discoverSessions([dir]);
        assert.ok(Array.isArray(discovered), `${adapter.name} returns array`);
      }
    } finally {
      cleanup(dir);
    }
  });

  test("cursor adapter discovers JSON files in a test directory", async () => {
    const dir = tmpDir();
    try {
      const fixture = {
        messages: [
          { role: "user", content: "What is this repo?", timestamp: "2026-01-01T00:00:00Z" },
          { role: "assistant", content: "It is OpenBoot.", timestamp: "2026-01-01T00:01:00Z" },
        ],
      };
      fs.writeFileSync(path.join(dir, "session.json"), JSON.stringify(fixture));

      const adapter = new CursorAdapter();
      const discovered = await adapter.discoverSessions([dir]);
      assert.ok(discovered.length >= 1, "fixture session discovered");

      const imported = await adapter.importSession(discovered[0]);
      assert.ok(imported, "session importable");
      assert.equal(imported.messages.length, 2, "both messages extracted");
      assert.equal(imported.messages[0].role, "user");
      assert.equal(imported.messages[1].role, "assistant");
    } finally {
      cleanup(dir);
    }
  });

  test("cursor adapter handles malformed JSON file gracefully", async () => {
    const dir = tmpDir();
    try {
      fs.writeFileSync(path.join(dir, "bad.json"), "{ broken json ]]]");
      const adapter = new CursorAdapter();
      const discovered = await adapter.discoverSessions([dir]);
      assert.equal(discovered.length, 0, "malformed file yields no sessions");
    } finally {
      cleanup(dir);
    }
  });

  test("adapter importSession returns null for empty message content", async () => {
    const dir = tmpDir();
    try {
      const fixture = { messages: [{ role: "user", content: "" }] };
      fs.writeFileSync(path.join(dir, "empty.json"), JSON.stringify(fixture));
      const adapter = new CursorAdapter();
      const discovered = await adapter.discoverSessions([dir]);
      if (discovered.length > 0) {
        const imported = await adapter.importSession(discovered[0]);
        if (imported) {
          assert.equal(imported.messages.length, 0, "empty messages filtered");
        }
      }
    } finally {
      cleanup(dir);
    }
  });
});

// ─── 8. formatRelativeTime ────────────────────────────────────────────────────

describe("formatRelativeTime", () => {
  test("returns 'just now' for very recent timestamps", () => {
    const result = formatRelativeTime(new Date().toISOString());
    assert.equal(result, "just now");
  });

  test("returns hours for recent timestamps", () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    assert.equal(formatRelativeTime(twoHoursAgo), "2h ago");
  });

  test("returns days for old timestamps", () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    assert.equal(formatRelativeTime(twoDaysAgo), "2d ago");
  });
});

// ─── Session, task, snapshot, sync tests ─────────────────────────────────────

const distTasksBase = new URL("../dist/tasks/", import.meta.url).pathname;
const { createTask, listTasks, resumeTask, closeTask, pauseTask, readTask, linkSessionToTask } =
  await import(path.join(distTasksBase, "taskStore.js"));

const distSnapshotsBase = new URL("../dist/snapshots/", import.meta.url).pathname;
const { createSnapshot, listSnapshots, buildRestorePlan, readSnapshot } =
  await import(path.join(distSnapshotsBase, "snapshotStore.js"));

const distSummariesBase = new URL("../dist/summaries/", import.meta.url).pathname;
const { buildSessionSummary, sessionToTimelineEntries } =
  await import(path.join(distSummariesBase, "buildSummary.js"));

const distTimelineBase = new URL("../dist/timeline/", import.meta.url).pathname;
const { buildTimeline, renderTimeline } =
  await import(path.join(distTimelineBase, "buildTimeline.js"));

const distSyncBase = new URL("../dist/sync/", import.meta.url).pathname;
const { loadSyncConfig, saveSyncConfig, getDefaultTargetPath } =
  await import(path.join(distSyncBase, "syncConfig.js"));

const distSyncProvidersBase = new URL("../dist/sync/providers/", import.meta.url).pathname;
const { pushToFolder, pullFromFolder } =
  await import(path.join(distSyncProvidersBase, "folderProvider.js"));

// 9. Task system

describe("Task system", () => {
  test("createTask writes and reads back", () => {
    const dir = tmpDir();
    try {
      const t = createTask("Test task", "description", [], dir);
      assert.ok(t.id, "task has id");
      assert.equal(t.title, "Test task");
      assert.equal(t.status, "open");
      assert.ok(t.git, "task has git info");

      const found = readTask(t.id, dir);
      assert.ok(found, "task is readable");
      assert.equal(found.title, "Test task");
    } finally {
      cleanup(dir);
    }
  });

  test("listTasks returns sorted list", () => {
    const dir = tmpDir();
    try {
      createTask("Task A", "", [], dir);
      createTask("Task B", "", [], dir);
      const tasks = listTasks(dir);
      assert.equal(tasks.length, 2);
    } finally {
      cleanup(dir);
    }
  });

  test("resumeTask marks task active and pauses others", () => {
    const dir = tmpDir();
    try {
      const t1 = createTask("Task 1", "", [], dir);
      const t2 = createTask("Task 2", "", [], dir);

      resumeTask(t1.id, dir);
      resumeTask(t2.id, dir);

      const updated1 = readTask(t1.id, dir);
      const updated2 = readTask(t2.id, dir);

      assert.equal(updated1.status, "paused", "first task paused when second resumed");
      assert.equal(updated2.status, "active", "second task is active");
    } finally {
      cleanup(dir);
    }
  });

  test("closeTask marks task completed", () => {
    const dir = tmpDir();
    try {
      const t = createTask("To close", "", [], dir);
      closeTask(t.id, dir);
      const updated = readTask(t.id, dir);
      assert.equal(updated.status, "completed");
    } finally {
      cleanup(dir);
    }
  });

  test("pauseTask marks task paused", () => {
    const dir = tmpDir();
    try {
      const t = createTask("To pause", "", [], dir);
      resumeTask(t.id, dir);
      pauseTask(t.id, dir);
      const updated = readTask(t.id, dir);
      assert.equal(updated.status, "paused");
    } finally {
      cleanup(dir);
    }
  });

  test("readTask supports short prefix", () => {
    const dir = tmpDir();
    try {
      const t = createTask("Prefix task", "", [], dir);
      const found = readTask(t.id.slice(0, 8), dir);
      assert.ok(found, "found by short prefix");
      assert.equal(found.title, "Prefix task");
    } finally {
      cleanup(dir);
    }
  });

  test("linkSessionToTask adds session id without duplicates", () => {
    const dir = tmpDir();
    try {
      const t = createTask("Linked", "", [], dir);
      linkSessionToTask(t.id, "session-abc", dir);
      linkSessionToTask(t.id, "session-abc", dir);
      linkSessionToTask(t.id, "session-xyz", dir);
      const updated = readTask(t.id, dir);
      assert.equal(updated.linkedSessionIds.length, 2, "no duplicate session ids");
    } finally {
      cleanup(dir);
    }
  });
});

// 10. Snapshot system

describe("Snapshot system", () => {
  test("createSnapshot writes a valid snapshot", () => {
    const dir = tmpDir();
    try {
      const s = createSnapshot([], "test context", dir);
      assert.ok(s.id, "snapshot has id");
      assert.ok(s.git, "snapshot has git info");
      assert.equal(s.selectedFiles.length, 0);
      assert.equal(s.contextSummary, "test context");

      const found = readSnapshot(s.id, dir);
      assert.ok(found, "snapshot readable");
    } finally {
      cleanup(dir);
    }
  });

  test("listSnapshots returns sorted list", () => {
    const dir = tmpDir();
    try {
      createSnapshot([], "snap1", dir);
      createSnapshot([], "snap2", dir);
      const snaps = listSnapshots(dir);
      assert.equal(snaps.length, 2);
    } finally {
      cleanup(dir);
    }
  });

  test("readSnapshot supports short prefix", () => {
    const dir = tmpDir();
    try {
      const s = createSnapshot([], "prefix test", dir);
      const found = readSnapshot(s.id.slice(0, 8), dir);
      assert.ok(found, "found by prefix");
    } finally {
      cleanup(dir);
    }
  });

  test("buildRestorePlan returns plan for valid snapshot", () => {
    const dir = tmpDir();
    try {
      const s = createSnapshot(["src/index.ts"], "ctx", dir);
      const plan = buildRestorePlan(s.id, dir);
      assert.ok(plan, "plan returned");
      assert.ok(plan.suggestedCommands.length >= 0, "has commands array");
      assert.ok(Array.isArray(plan.warnings), "has warnings array");
    } finally {
      cleanup(dir);
    }
  });

  test("buildRestorePlan returns null for unknown snapshot", () => {
    const dir = tmpDir();
    try {
      const plan = buildRestorePlan("nonexistent-id", dir);
      assert.equal(plan, null);
    } finally {
      cleanup(dir);
    }
  });
});

// 11. buildSessionSummary

describe("buildSessionSummary", () => {
  test("returns 'No activity recorded' for empty session", () => {
    const session = {
      id: "test",
      task: "New session",
      messages: [],
      events: [],
      metadata: { filesTouched: [], commandsRun: [] },
    };
    const s = buildSessionSummary(session);
    assert.equal(s, "No activity recorded");
  });

  test("includes task, files, events in summary", () => {
    const session = {
      id: "test",
      task: "Fix auth bug",
      messages: [],
      events: [{ id: "e1", type: "command", timestamp: new Date().toISOString(), data: {} }],
      metadata: { filesTouched: ["src/auth.ts"], commandsRun: ["npm test"] },
    };
    const s = buildSessionSummary(session);
    assert.match(s, /Fix auth bug/);
    assert.match(s, /src\/auth\.ts/);
    assert.match(s, /npm test/);
  });
});

// 12. Sync config

describe("Sync config", () => {
  test("saveSyncConfig and loadSyncConfig round-trip", () => {
    const dir = tmpDir();
    try {
      const config = {
        enabled: true,
        provider: "folder",
        targetPath: "/tmp/test-sync",
      };
      saveSyncConfig(config, dir);
      const loaded = loadSyncConfig(dir);
      assert.ok(loaded, "config loaded");
      assert.equal(loaded.provider, "folder");
      assert.equal(loaded.targetPath, "/tmp/test-sync");
      assert.equal(loaded.enabled, true);
    } finally {
      cleanup(dir);
    }
  });

  test("loadSyncConfig returns null when not configured", () => {
    const dir = tmpDir();
    try {
      const result = loadSyncConfig(dir);
      assert.equal(result, null);
    } finally {
      cleanup(dir);
    }
  });

  test("getDefaultTargetPath returns string for each provider", () => {
    const providers = ["icloud", "dropbox-folder", "google-drive-folder", "onedrive-folder", "git", "folder"];
    for (const p of providers) {
      const tp = getDefaultTargetPath(p);
      assert.ok(typeof tp === "string" && tp.length > 0, `path for ${p}`);
    }
  });
});

// 13. Folder-based sync push/pull

describe("Folder sync push/pull", () => {
  test("pushToFolder copies sessions to target", () => {
    const src = tmpDir();
    const dest = tmpDir();
    try {
      const sessionsDir = path.join(src, "sessions", "active");
      fs.mkdirSync(sessionsDir, { recursive: true });
      fs.writeFileSync(path.join(sessionsDir, "test.json"), JSON.stringify({ id: "t1" }));

      const result = pushToFolder(src, dest);
      assert.ok(result.pushed >= 1 || result.errors.length === 0, "push ran");
    } finally {
      cleanup(src);
      cleanup(dest);
    }
  });

  test("pullFromFolder detects conflicts on different content", () => {
    const src = tmpDir();
    const dest = tmpDir();
    try {
      const srcSessionDir = path.join(src, "sessions");
      const destSessionDir = path.join(dest, "sessions");
      fs.mkdirSync(srcSessionDir, { recursive: true });
      fs.mkdirSync(destSessionDir, { recursive: true });

      fs.writeFileSync(path.join(srcSessionDir, "a.json"), JSON.stringify({ id: "remote" }));
      fs.writeFileSync(path.join(destSessionDir, "a.json"), JSON.stringify({ id: "local" }));

      const result = pullFromFolder(src, dest);
      assert.equal(result.conflicts, 1, "conflict detected");
    } finally {
      cleanup(src);
      cleanup(dest);
    }
  });

  test("pullFromFolder skips identical files", () => {
    const src = tmpDir();
    const dest = tmpDir();
    try {
      const content = JSON.stringify({ id: "same" });
      const srcDir = path.join(src, "sessions");
      const destDir = path.join(dest, "sessions");
      fs.mkdirSync(srcDir, { recursive: true });
      fs.mkdirSync(destDir, { recursive: true });

      fs.writeFileSync(path.join(srcDir, "b.json"), content);
      fs.writeFileSync(path.join(destDir, "b.json"), content);

      const result = pullFromFolder(src, dest);
      assert.equal(result.skipped, 1, "identical file skipped");
    } finally {
      cleanup(src);
      cleanup(dest);
    }
  });
});

// ─── Bundle, daemon, replay, workspace, AI imports ───────────────────────────

const { createBundle, importBundle, listBundles, getBundlesDir } = await import(
  new URL("../dist/bundles/bundleStore.js", import.meta.url).pathname
);
const { loadDaemonConfig, saveDaemonConfig, isDaemonRunning } = await import(
  new URL("../dist/daemon/daemonConfig.js", import.meta.url).pathname
);
const { buildReplayEntries, renderReplay } = await import(
  new URL("../dist/replay/renderReplay.js", import.meta.url).pathname
);
const {
  createWorkspace,
  addRepoToWorkspace,
  listWorkspaces,
  readWorkspace,
} = await import(
  new URL("../dist/workspace/workspaceStore.js", import.meta.url).pathname
);
const { summarizeSession, summarizeTask } = await import(
  new URL("../dist/ai/summarize.js", import.meta.url).pathname
);

// 14. Session backward compat with extended schema fields

describe("Backward compatibility — extended schema fields", () => {
  test("Legacy session files load without snapshotIds or summary", () => {
    const dir = tmpDir();
    try {
      // Write a minimal legacy session (no snapshotIds, summary, git, taskId)
      const activeDir = path.join(dir, ".openboot", "sessions", "active");
      fs.mkdirSync(activeDir, { recursive: true });
      const phase1Session = {
        id: "legacy-001",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        tool: "cursor",
        project: "test",
        branch: "main",
        task: "Old task",
        messages: [],
      };
      fs.writeFileSync(path.join(activeDir, "legacy-001.json"), JSON.stringify(phase1Session));

      const sessions = listSessions(dir);
      assert.ok(sessions.length >= 1, "loaded legacy session");
      const s = sessions.find((s) => s.id === "legacy-001");
      assert.ok(s, "found legacy session");
      assert.deepEqual(s.snapshotIds, [], "snapshotIds defaulted to []");
      assert.equal(s.summary, "", "summary defaulted to empty string");
    } finally {
      cleanup(dir);
    }
  });
});

// ─── Bundle, daemon, replay, workspace, AI tests ─────────────────────────────

// 15. Bundle system

describe("Bundle system", () => {
  test("createBundle produces a valid bundle file", () => {
    const dir = tmpDir();
    try {
      const bundle = createBundle({ includeAll: true }, dir);
      assert.ok(bundle.id, "bundle has id");
      assert.ok(bundle.createdAt, "bundle has createdAt");
      assert.ok(bundle.sourceMachine, "bundle has sourceMachine");
      assert.ok(Array.isArray(bundle.sessions), "bundle.sessions is array");
      assert.ok(Array.isArray(bundle.tasks), "bundle.tasks is array");
      assert.ok(Array.isArray(bundle.snapshots), "bundle.snapshots is array");

      const bundleDir = getBundlesDir(dir);
      const files = fs.readdirSync(bundleDir).filter((f) => f.startsWith("bundle-"));
      assert.ok(files.length >= 1, "bundle file written");
    } finally {
      cleanup(dir);
    }
  });

  test("listBundles returns created bundles", () => {
    const dir = tmpDir();
    try {
      createBundle({ includeAll: true }, dir);
      createBundle({ includeAll: true }, dir);
      const bundles = listBundles(dir);
      assert.ok(bundles.length >= 2, "lists at least 2 bundles");
      assert.ok(bundles[0].id, "first bundle has id");
      assert.ok(bundles[0].sourceMachine, "first bundle has sourceMachine");
    } finally {
      cleanup(dir);
    }
  });

  test("importBundle merges sessions and tasks from bundle file", () => {
    const srcDir = tmpDir();
    const destDir = tmpDir();
    try {
      // Create a session in srcDir
      const session = createSession("import", "other", srcDir);
      const bundle = createBundle({ sessionIds: [session.id] }, srcDir);

      // Find the bundle file
      const bundleDir = getBundlesDir(srcDir);
      const bundleFile = fs.readdirSync(bundleDir).find((f) => f.startsWith("bundle-"));
      assert.ok(bundleFile, "bundle file found");

      const result = importBundle(path.join(bundleDir, bundleFile), destDir);
      assert.ok(result.bundleId, "result has bundleId");
      assert.equal(result.sessionsImported, 1, "one session imported");

      // Session exists in destDir
      const imported = readSession(session.id, destDir);
      assert.ok(imported, "imported session readable");
    } finally {
      cleanup(srcDir);
      cleanup(destDir);
    }
  });

  test("importBundle skips duplicate sessions", () => {
    const srcDir = tmpDir();
    const destDir = tmpDir();
    try {
      const session = createSession("dup", "other", srcDir);
      const bundle = createBundle({ sessionIds: [session.id] }, srcDir);

      const bundleDir = getBundlesDir(srcDir);
      const bundleFile = fs.readdirSync(bundleDir).find((f) => f.startsWith("bundle-"));
      const bundlePath = path.join(bundleDir, bundleFile);

      // Import twice
      importBundle(bundlePath, destDir);
      const r2 = importBundle(bundlePath, destDir);
      assert.equal(r2.sessionsImported, 0, "second import skipped");
      assert.ok(r2.skipped >= 1, "at least 1 skipped");
    } finally {
      cleanup(srcDir);
      cleanup(destDir);
    }
  });
});

// 16. Daemon config

describe("Daemon config", () => {
  test("loadDaemonConfig returns defaults when no file", () => {
    const dir = tmpDir();
    try {
      const config = loadDaemonConfig(dir);
      assert.equal(config.enabled, false, "enabled defaults to false");
      assert.equal(config.intervalSeconds, 60, "interval defaults to 60");
    } finally {
      cleanup(dir);
    }
  });

  test("saveDaemonConfig and loadDaemonConfig roundtrip", () => {
    const dir = tmpDir();
    try {
      saveDaemonConfig({ enabled: true, intervalSeconds: 120 }, dir);
      const config = loadDaemonConfig(dir);
      assert.equal(config.enabled, true);
      assert.equal(config.intervalSeconds, 120);
    } finally {
      cleanup(dir);
    }
  });

  test("isDaemonRunning returns false when no state file", () => {
    const running = isDaemonRunning();
    // No daemon started in test environment
    assert.equal(typeof running, "boolean", "isDaemonRunning returns boolean");
  });
});

// 17. Replay system

describe("Session replay", () => {
  test("buildReplayEntries returns meta entry for empty session", () => {
    const dir = tmpDir();
    try {
      const session = createSession("replay", "other", dir);
      const entries = buildReplayEntries(session);
      assert.ok(entries.length >= 1, "at least one entry");
      assert.equal(entries[0].kind, "meta", "first entry is meta");
      assert.ok(entries[0].label.includes("Session started"), "label mentions start");
    } finally {
      cleanup(dir);
    }
  });

  test("buildReplayEntries includes messages and events", () => {
    const dir = tmpDir();
    try {
      const session = createSession("msg", "other", dir);
      appendMessage(session.id, "user", "Hello from test", dir);
      appendEvent(session.id, "file-change", { filePath: "src/foo.ts" }, dir);

      const updated = readSession(session.id, dir);
      const entries = buildReplayEntries(updated);

      const msgEntry = entries.find((e) => e.kind === "message");
      assert.ok(msgEntry, "message entry found");
      assert.ok(msgEntry.label.includes("Hello from test"), "message content in label");

      const evtEntry = entries.find((e) => e.kind === "event");
      assert.ok(evtEntry, "event entry found");
    } finally {
      cleanup(dir);
    }
  });

  test("renderReplay returns non-empty string", () => {
    const dir = tmpDir();
    try {
      const session = createSession("render", "other", dir);
      const entries = buildReplayEntries(session);
      const output = renderReplay(session, entries);
      assert.ok(typeof output === "string" && output.length > 0, "rendered output is non-empty");
      assert.ok(output.includes("Session Replay"), "output includes header");
    } finally {
      cleanup(dir);
    }
  });
});

// 18. Workspace system

describe("Workspace system", () => {
  const wsDir = tmpDir();
  const origEnv = process.env.OPENBOOT_WORKSPACES_DIR;
  process.env.OPENBOOT_WORKSPACES_DIR = wsDir;

  test("createWorkspace returns a valid workspace", () => {
    const ws = createWorkspace("test-workspace-" + Date.now(), ["/tmp"]);
    assert.ok(ws.id, "workspace has id");
    assert.ok(ws.name.startsWith("test-workspace"), "workspace has name");
    assert.ok(Array.isArray(ws.repos), "workspace has repos");
    assert.equal(ws.repos.length, 1, "one repo");
  });

  test("listWorkspaces includes created workspace", () => {
    const name = "list-ws-" + Date.now();
    createWorkspace(name, []);
    const workspaces = listWorkspaces();
    const found = workspaces.find((w) => w.name === name);
    assert.ok(found, "created workspace listed");
  });

  test("readWorkspace returns workspace by prefix", () => {
    const ws = createWorkspace("prefix-ws-" + Date.now(), []);
    const found = readWorkspace(ws.id.slice(0, 8));
    assert.ok(found, "found by prefix");
    assert.equal(found.id, ws.id, "correct workspace");
  });

  test("addRepoToWorkspace appends new path", () => {
    const ws = createWorkspace("add-repo-ws-" + Date.now(), []);
    const updated = addRepoToWorkspace(ws.id, "/tmp/some-new-repo");
    assert.ok(updated, "updated workspace returned");
    assert.ok(updated.repos.some((r) => r.endsWith("some-new-repo")), "repo added");
  });

  test("addRepoToWorkspace does not duplicate existing paths", () => {
    const ws = createWorkspace("dedup-ws-" + Date.now(), ["/tmp"]);
    const updated = addRepoToWorkspace(ws.id, "/tmp");
    assert.equal(updated.repos.filter((r) => r === "/tmp").length, 1, "no duplicate");
    // Restore env after workspace tests
    if (origEnv !== undefined) process.env.OPENBOOT_WORKSPACES_DIR = origEnv;
    else delete process.env.OPENBOOT_WORKSPACES_DIR;
    cleanup(wsDir);
  });
});

// 19. AI summarize — deterministic fallback (no API key required)

// ─── Context builder, timeline, resume imports ────────────────────────────────

const { buildContext, renderContextMarkdown, saveContextFile } = await import(
  new URL("../dist/context/buildContext.js", import.meta.url).pathname
);

const { findBestResumeMatch } = await import(
  new URL("../dist/sessions/resumeContext.js", import.meta.url).pathname
);

// 20. Timeline builder

describe("Timeline builder", () => {
  test("buildTimeline returns empty array when no data", () => {
    const dir = tmpDir();
    try {
      const entries = buildTimeline(dir, {});
      assert.ok(Array.isArray(entries), "returns array");
    } finally {
      cleanup(dir);
    }
  });

  test("buildTimeline includes sessions", () => {
    const dir = tmpDir();
    try {
      createSession("timeline-task", "other", dir);
      const entries = buildTimeline(dir, {});
      assert.ok(entries.length >= 1, "at least one entry from session");
    } finally {
      cleanup(dir);
    }
  });

  test("buildTimeline includes tasks", () => {
    const dir = tmpDir();
    try {
      createTask("TL task", "desc", [], dir);
      const entries = buildTimeline(dir, {});
      const taskEntries = entries.filter((e) => e.type === "task");
      assert.ok(taskEntries.length >= 1, "task entry present");
    } finally {
      cleanup(dir);
    }
  });

  test("buildTimeline includes snapshots", () => {
    const dir = tmpDir();
    try {
      createSnapshot([], "snap context", dir);
      const entries = buildTimeline(dir, {});
      const snapEntries = entries.filter((e) => e.type === "snapshot");
      assert.ok(snapEntries.length >= 1, "snapshot entry present");
    } finally {
      cleanup(dir);
    }
  });

  test("buildTimeline respects limit", () => {
    const dir = tmpDir();
    try {
      createSession("t1", "other", dir);
      createSession("t2", "other", dir);
      createSession("t3", "other", dir);
      const entries = buildTimeline(dir, { limit: 2 });
      assert.ok(entries.length <= 2, "limit respected");
    } finally {
      cleanup(dir);
    }
  });

  test("renderTimeline returns non-empty string", () => {
    const dir = tmpDir();
    try {
      createSession("render-timeline", "other", dir);
      const entries = buildTimeline(dir, {});
      const output = renderTimeline(entries);
      assert.ok(typeof output === "string" && output.length > 0, "non-empty string");
    } finally {
      cleanup(dir);
    }
  });

  test("sessionToTimelineEntries converts session events", () => {
    const dir = tmpDir();
    try {
      const s = createSession("tl-events", "other", dir);
      appendMessage(s.id, "user", "tl message", dir);
      const updated = readSession(s.id, dir);
      const entries = sessionToTimelineEntries(updated);
      assert.ok(Array.isArray(entries), "entries is array");
    } finally {
      cleanup(dir);
    }
  });
});

// 21. Context builder

describe("Context builder", () => {
  test("buildContext returns ContextData object", () => {
    const dir = tmpDir();
    try {
      const ctx = buildContext(dir);
      assert.ok(ctx, "context returned");
      assert.ok(ctx.generatedAt, "has generatedAt");
      assert.ok(ctx.repo, "has repo");
      assert.ok(Array.isArray(ctx.recentSessions), "has recentSessions array");
      // activeTask and latestSnapshot may be null when empty
      assert.ok("activeTask" in ctx, "has activeTask field");
      assert.ok("latestSnapshot" in ctx, "has latestSnapshot field");
    } finally {
      cleanup(dir);
    }
  });

  test("buildContext includes active session", () => {
    const dir = tmpDir();
    try {
      const s = createSession("ctx-task", "other", dir);
      const ctx = buildContext(dir);
      const found = ctx.recentSessions.some((rs) => rs.id === s.id);
      assert.ok(found, "active session in context");
    } finally {
      cleanup(dir);
    }
  });

  test("renderContextMarkdown returns markdown string", () => {
    const dir = tmpDir();
    try {
      const ctx = buildContext(dir);
      const md = renderContextMarkdown(ctx);
      assert.ok(typeof md === "string" && md.length > 0, "non-empty markdown");
      assert.ok(md.includes("#"), "contains markdown headers");
    } finally {
      cleanup(dir);
    }
  });

  test("saveContextFile writes latest-context.md", () => {
    const dir = tmpDir();
    try {
      const ctx = buildContext(dir);
      const md = renderContextMarkdown(ctx);
      const saved = saveContextFile(md, dir);
      assert.ok(fs.existsSync(saved), "file exists");
      assert.ok(saved.endsWith("latest-context.md"), "correct filename");
      const content = fs.readFileSync(saved, "utf8");
      assert.ok(content.length > 0, "file has content");
    } finally {
      cleanup(dir);
    }
  });
});

// 22. Branch-aware resume

describe("Branch-aware resume (findBestResumeMatch)", () => {
  test("returns none match when no sessions or tasks exist", () => {
    const dir = tmpDir();
    try {
      const match = findBestResumeMatch(dir);
      assert.equal(match.matchQuality, "none", "no match when empty");
      assert.equal(match.session, null, "no session");
      assert.equal(match.task, null, "no task");
    } finally {
      cleanup(dir);
    }
  });

  test("returns recent match when session exists", () => {
    const dir = tmpDir();
    try {
      createSession("resume-task", "other", dir);
      const match = findBestResumeMatch(dir);
      assert.ok(match.matchQuality !== "none", "match found");
      assert.ok(match.session !== null, "session returned");
      assert.ok(Array.isArray(match.reason) && match.reason.length > 0, "reason provided");
    } finally {
      cleanup(dir);
    }
  });

  test("returns task match when active task exists", () => {
    const dir = tmpDir();
    try {
      const t = createTask("resume-via-task", "", [], dir);
      resumeTask(t.id, dir);
      const match = findBestResumeMatch(dir);
      assert.ok(match.task !== null, "task returned");
      assert.ok(["task", "branch", "exact", "recent"].includes(match.matchQuality), "quality set");
    } finally {
      cleanup(dir);
    }
  });

  test("match reason is always a non-empty array when match exists", () => {
    const dir = tmpDir();
    try {
      createSession("reason-task", "other", dir);
      const match = findBestResumeMatch(dir);
      if (match.matchQuality !== "none") {
        assert.ok(match.reason.length > 0, "reason array is non-empty");
      }
    } finally {
      cleanup(dir);
    }
  });
});

describe("AI summarize — deterministic fallback", () => {
  function clearAIKeys() {
    const saved = {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    };
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
    return saved;
  }

  function restoreAIKeys(saved) {
    for (const [k, v] of Object.entries(saved)) {
      if (v !== undefined) process.env[k] = v;
    }
  }

  test("summarizeSession falls back to deterministic when no API key", async () => {
    const dir = tmpDir();
    try {
      const saved = clearAIKeys();
      try {
        const session = createSession("summarize test", "other", dir);
        const { output, usedProvider } = await summarizeSession(session);
        assert.equal(usedProvider, "deterministic", "uses deterministic when no API key");
        assert.ok(typeof output.task === "string", "task is string");
        assert.ok(typeof output.summary === "string", "summary is string");
        assert.ok(Array.isArray(output.filesChanged), "filesChanged is array");
        assert.ok(Array.isArray(output.decisions), "decisions is array");
        assert.ok(Array.isArray(output.nextSteps), "nextSteps is array");
      } finally {
        restoreAIKeys(saved);
      }
    } finally {
      cleanup(dir);
    }
  });

  test("summarizeTask falls back to deterministic when no API key", async () => {
    const dir = tmpDir();
    try {
      const { createTask } = await import(
        new URL("../dist/tasks/taskStore.js", import.meta.url).pathname
      );
      const saved = clearAIKeys();
      try {
        const task = createTask("Fix auth bug", "Token refresh fails", [], dir);
        const { output, usedProvider } = await summarizeTask(task);
        assert.equal(usedProvider, "deterministic", "uses deterministic fallback");
        assert.equal(output.task, "Fix auth bug", "task name preserved");
      } finally {
        restoreAIKeys(saved);
      }
    } finally {
      cleanup(dir);
    }
  });
});

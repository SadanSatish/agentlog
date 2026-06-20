// db.js — storage layer for AgentLog.
//
// Uses Node's built-in `node:sqlite` (stable from Node 22.5+, no native
// compilation, no extra dependency). Swapping to Postgres later only means
// rewriting this file — every other module talks to the functions exported
// here, never to SQL directly. See docs/ARCHITECTURE.md for the migration
// notes.

import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isVercel = process.env.VERCEL === "1" || !!process.env.VERCEL;
const DATA_DIR = path.join(__dirname, "..", "data");
const DB_PATH = isVercel ? ":memory:" : (process.env.AGENTLOG_DB_PATH || path.join(DATA_DIR, "agentlog.db"));

if (!isVercel) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS entries (
    id          TEXT PRIMARY KEY,
    repo        TEXT NOT NULL,
    type        TEXT NOT NULL DEFAULT 'note',
    scope       TEXT NOT NULL DEFAULT '',
    title       TEXT NOT NULL,
    body        TEXT NOT NULL DEFAULT '',
    author      TEXT NOT NULL DEFAULT '',
    agent       TEXT NOT NULL DEFAULT '',
    session_id  TEXT NOT NULL DEFAULT '',
    pr_ref      TEXT NOT NULL DEFAULT '',
    commit_sha  TEXT NOT NULL DEFAULT '',
    tags        TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'active',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_entries_repo ON entries(repo);
  CREATE INDEX IF NOT EXISTS idx_entries_scope ON entries(scope);
  CREATE INDEX IF NOT EXISTS idx_entries_status ON entries(status);
  CREATE INDEX IF NOT EXISTS idx_entries_type ON entries(type);

  CREATE TABLE IF NOT EXISTS custom_tools (
    id          TEXT PRIMARY KEY,
    name        TEXT UNIQUE NOT NULL,
    description TEXT NOT NULL,
    schema_json TEXT NOT NULL,
    code        TEXT NOT NULL,
    created_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS telemetry (
    id            TEXT PRIMARY KEY,
    repo          TEXT NOT NULL,
    commit_sha    TEXT DEFAULT '',
    session_id    TEXT DEFAULT '',
    tokens_input  INTEGER DEFAULT 0,
    tokens_output INTEGER DEFAULT 0,
    tokens_wasted INTEGER DEFAULT 0,
    created_at    TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_telemetry_repo ON telemetry(repo);
`);

const VALID_TYPES = new Set(["decision", "failed_approach", "gotcha", "note"]);
const VALID_STATUS = new Set(["active", "stale", "superseded"]);

function nowIso() {
  return new Date().toISOString();
}

function rowToEntry(row) {
  if (!row) return null;
  return {
    ...row,
    tags: row.tags ? row.tags.split(",").filter(Boolean) : [],
  };
}

export function insertEntry(data) {
  const id = crypto.randomUUID();
  const ts = nowIso();
  const type = VALID_TYPES.has(data.type) ? data.type : "note";
  const tags = Array.isArray(data.tags) ? data.tags.join(",") : (data.tags || "");

  const stmt = db.prepare(`
    INSERT INTO entries
      (id, repo, type, scope, title, body, author, agent, session_id, pr_ref, commit_sha, tags, status, created_at, updated_at)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    data.repo || "default",
    type,
    data.scope || "",
    data.title || "(untitled)",
    data.body || "",
    data.author || "",
    data.agent || "",
    data.session_id || "",
    data.pr_ref || "",
    data.commit_sha || "",
    tags,
    "active",
    ts,
    ts
  );

  return getEntry(id);
}

export function getEntry(id) {
  const row = db.prepare("SELECT * FROM entries WHERE id = ?").get(id);
  return rowToEntry(row);
}

export function listEntries(filters = {}) {
  const clauses = [];
  const params = [];

  if (filters.repo) {
    clauses.push("repo = ?");
    params.push(filters.repo);
  }
  if (filters.type) {
    clauses.push("type = ?");
    params.push(filters.type);
  }
  if (filters.status) {
    clauses.push("status = ?");
    params.push(filters.status);
  }
  if (filters.scope) {
    clauses.push("scope LIKE ?");
    params.push(`%${filters.scope}%`);
  }
  if (filters.q) {
    clauses.push("(title LIKE ? OR body LIKE ?)");
    params.push(`%${filters.q}%`, `%${filters.q}%`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = Math.min(Number(filters.limit) || 200, 1000);

  const rows = db
    .prepare(`SELECT * FROM entries ${where} ORDER BY created_at DESC LIMIT ?`)
    .all(...params, limit);

  return rows.map(rowToEntry);
}

// The core "shared memory" query: given a repo + a file path or module name,
// return every active note whose scope is relevant — repo-wide notes
// (empty scope) plus any note whose scope is a prefix-relative match against
// the requested path/module in either direction.
export function queryContext(repo, fileOrModule) {
  const target = (fileOrModule || "").trim();

  const rows = db
    .prepare(
      `SELECT * FROM entries
       WHERE repo = ? AND status = 'active'
       ORDER BY created_at DESC`
    )
    .all(repo || "default");

  const matches = rows.filter((r) => {
    if (!r.scope) return true; // repo-wide note always applies
    if (!target) return true; // no target given -> return everything active
    return target.startsWith(r.scope) || r.scope.startsWith(target);
  });

  return matches.map(rowToEntry);
}

export function updateEntry(id, patch) {
  const existing = getEntry(id);
  if (!existing) return null;

  const next = {
    ...existing,
    ...patch,
    tags: Array.isArray(patch.tags) ? patch.tags.join(",") : existing.tags.join(","),
  };

  if (patch.status && !VALID_STATUS.has(patch.status)) {
    throw new Error(`invalid status: ${patch.status}`);
  }

  const stmt = db.prepare(`
    UPDATE entries SET
      title = ?, body = ?, scope = ?, status = ?, pr_ref = ?, commit_sha = ?, tags = ?, updated_at = ?
    WHERE id = ?
  `);

  stmt.run(
    next.title,
    next.body,
    next.scope,
    next.status,
    next.pr_ref,
    next.commit_sha,
    next.tags,
    nowIso(),
    id
  );

  return getEntry(id);
}

export function deleteEntry(id) {
  db.prepare("DELETE FROM entries WHERE id = ?").run(id);
  return { id, deleted: true };
}

export function listRepos() {
  return db
    .prepare("SELECT DISTINCT repo FROM entries ORDER BY repo")
    .all()
    .map((r) => r.repo);
}

export function stats(repo) {
  const row = db
    .prepare(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
         SUM(CASE WHEN type = 'decision' THEN 1 ELSE 0 END) as decisions,
         SUM(CASE WHEN type = 'failed_approach' THEN 1 ELSE 0 END) as failed_approaches,
         SUM(CASE WHEN type = 'gotcha' THEN 1 ELSE 0 END) as gotchas
       FROM entries WHERE repo = ?`
    )
    .get(repo || "default");
  return row;
}

export function listCustomTools() {
  return db.prepare("SELECT * FROM custom_tools ORDER BY name").all();
}

export function insertCustomTool(data) {
  const id = crypto.randomUUID();
  const ts = nowIso();
  const stmt = db.prepare(`
    INSERT INTO custom_tools (id, name, description, schema_json, code, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(id, data.name, data.description, data.schema_json, data.code, ts);
  return db.prepare("SELECT * FROM custom_tools WHERE id = ?").get(id);
}

export function deleteCustomTool(id) {
  db.prepare("DELETE FROM custom_tools WHERE id = ?").run(id);
  return { id, deleted: true };
}

export function insertTelemetry(data) {
  const id = crypto.randomUUID();
  const ts = nowIso();
  const stmt = db.prepare(`
    INSERT INTO telemetry (id, repo, commit_sha, session_id, tokens_input, tokens_output, tokens_wasted, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    id,
    data.repo || "default",
    data.commit_sha || "",
    data.session_id || "",
    Number(data.tokens_input || 0),
    Number(data.tokens_output || 0),
    Number(data.tokens_wasted || 0),
    ts
  );
  return db.prepare("SELECT * FROM telemetry WHERE id = ?").get(id);
}

export function listTelemetry(repo) {
  return db.prepare("SELECT * FROM telemetry WHERE repo = ? ORDER BY created_at DESC").all(repo || "default");
}

export function getTelemetryStats(repo) {
  const row = db.prepare(`
    SELECT 
      SUM(tokens_input) as total_input,
      SUM(tokens_output) as total_output,
      SUM(tokens_wasted) as total_wasted
    FROM telemetry WHERE repo = ?
  `).get(repo || "default");

  const total_input = row.total_input || 0;
  const total_output = row.total_output || 0;
  const total_wasted = row.total_wasted || 0;
  const total_tokens = total_input + total_output;
  const total_effective = Math.max(0, total_tokens - total_wasted);
  const efficiency = total_tokens > 0 ? Math.round((total_effective / total_tokens) * 100) : 100;

  return {
    total_input,
    total_output,
    total_wasted,
    total_effective,
    efficiency
  };
}



import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'agent.db');
const agentDb = new DatabaseSync(dbPath);

agentDb.exec('PRAGMA journal_mode = WAL;');

// Initialize agent local schema
agentDb.exec(`
  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS local_jobs (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    action_type TEXT NOT NULL,
    action_payload TEXT NOT NULL,
    schedule_type TEXT NOT NULL,
    cron_expression TEXT,
    timezone TEXT DEFAULT 'Asia/Kolkata',
    start_date TEXT,
    start_time TEXT,
    next_run_at TEXT,
    status TEXT DEFAULT 'Scheduled',
    missed_policy TEXT DEFAULT 'run_once',
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS local_executions (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    action_type TEXT NOT NULL,
    scheduled_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    status TEXT NOT NULL,
    exit_code INTEGER,
    output_log TEXT,
    error_log TEXT,
    created_at TEXT NOT NULL
  );
`);

export function getConfig(key, defaultValue = null) {
  const stmt = agentDb.prepare('SELECT value FROM config WHERE key = ?');
  const row = stmt.get(key);
  return row ? row.value : defaultValue;
}

export function setConfig(key, value) {
  const stmt = agentDb.prepare(`
    INSERT INTO config (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  stmt.run(key, String(value));
}

export default agentDb;

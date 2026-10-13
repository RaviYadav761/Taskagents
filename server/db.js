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

const dbPath = path.join(dataDir, 'taskly.db');
const db = new DatabaseSync(dbPath);

// Enable WAL mode for high concurrency
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT DEFAULT 'Personal Workspace',
    avatar TEXT DEFAULT '/assets/avatar.jpg',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    category TEXT DEFAULT 'Work & Projects',
    priority TEXT DEFAULT 'Medium Priority',
    action_type TEXT NOT NULL, -- 'standard' | 'run_script' | 'open_app' | 'restart_app' | 'open_url' | 'delete_file' | 'restrict_website' | 'send_message' | 'notification'
    action_payload TEXT NOT NULL, -- JSON string with specific action configuration
    schedule_type TEXT NOT NULL, -- 'once' | 'interval' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'cron'
    cron_expression TEXT,
    timezone TEXT DEFAULT 'Asia/Kolkata',
    start_date TEXT,
    start_time TEXT,
    next_run_at TEXT,
    status TEXT DEFAULT 'Scheduled', -- 'Scheduled' | 'Running' | 'Paused' | 'Completed' | 'Failed' | 'Cancelled'
    missed_policy TEXT DEFAULT 'run_once', -- 'run_once' | 'skip' | 'require_confirmation'
    repeat TEXT DEFAULT 'Once',
    goal TEXT,
    notes TEXT,
    notes_header TEXT,
    bullet_points TEXT, -- JSON array
    image TEXT DEFAULT '/assets/laptop.jpg',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS executions (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    action_type TEXT NOT NULL,
    scheduled_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    status TEXT NOT NULL, -- 'Scheduled' | 'Running' | 'Successful' | 'Failed' | 'Missed' | 'Cancelled' | 'Awaiting Device'
    exit_code INTEGER,
    output_log TEXT,
    error_log TEXT,
    attempt_count INTEGER DEFAULT 1,
    trigger_type TEXT DEFAULT 'schedule', -- 'schedule' | 'manual_retry' | 'agent_recovery'
    created_at TEXT NOT NULL,
    FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    device_name TEXT NOT NULL,
    platform TEXT NOT NULL,
    pairing_token_hash TEXT NOT NULL,
    auth_token TEXT,
    status TEXT DEFAULT 'offline', -- 'online' | 'offline' | 'pending_pair'
    last_seen_at TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS site_limits (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    domain TEXT NOT NULL, -- normalized hostname
    url TEXT,
    display_name TEXT,
    scope TEXT DEFAULT 'entire_domain', -- 'entire_domain' | 'hostname_only'
    restriction_type TEXT DEFAULT 'cycle', -- 'cycle' | 'today_only' | 'schedule' | 'daily_limit' | 'date_range'
    daily_allowance_seconds INTEGER DEFAULT 10800, -- 3 hours default
    used_today_seconds INTEGER DEFAULT 0,
    active_interval_seconds INTEGER DEFAULT 600, -- 10 mins default
    break_seconds INTEGER DEFAULT 600, -- 10 mins break
    schedule_start_time TEXT,
    schedule_end_time TEXT,
    active_days TEXT DEFAULT '[0,1,2,3,4,5,6]',
    start_date TEXT,
    end_date TEXT,
    timezone TEXT DEFAULT 'Asia/Kolkata',
    reset_time TEXT DEFAULT '00:00',
    breaks_count_today INTEGER DEFAULT 0,
    blocked_seconds_today INTEGER DEFAULT 0,
    has_extension_permission INTEGER DEFAULT 0,
    last_synced_at TEXT,
    in_break_until TEXT,
    blocked_until TEXT,
    last_reset_date TEXT NOT NULL,
    is_enabled INTEGER DEFAULT 1,
    emergency_override INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, domain)
  );

  CREATE TABLE IF NOT EXISTS site_usage_history (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    rule_id TEXT NOT NULL,
    domain TEXT NOT NULL,
    usage_date TEXT NOT NULL, -- 'YYYY-MM-DD'
    active_used_seconds INTEGER DEFAULT 0,
    breaks_taken INTEGER DEFAULT 0,
    blocked_seconds INTEGER DEFAULT 0,
    daily_allowance_seconds INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, rule_id, usage_date)
  );

  CREATE TABLE IF NOT EXISTS site_usage_events (
    id TEXT PRIMARY KEY, -- Idempotency UUID from extension
    user_id TEXT NOT NULL,
    rule_id TEXT NOT NULL,
    domain TEXT NOT NULL,
    device_id TEXT,
    delta_seconds INTEGER NOT NULL,
    event_timestamp TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_jobs_user ON jobs(user_id);
  CREATE INDEX IF NOT EXISTS idx_jobs_next_run ON jobs(next_run_at);
  CREATE INDEX IF NOT EXISTS idx_executions_job ON executions(job_id);
  CREATE INDEX IF NOT EXISTS idx_executions_user ON executions(user_id);
  CREATE INDEX IF NOT EXISTS idx_site_limits_user ON site_limits(user_id);
  CREATE INDEX IF NOT EXISTS idx_site_usage_history_user ON site_usage_history(user_id, usage_date);
  CREATE INDEX IF NOT EXISTS idx_site_usage_events_rule ON site_usage_events(rule_id);
`);

// Safe column migrations for existing SQLite databases
try {
  const tableInfo = db.prepare('PRAGMA table_info(site_limits);').all();
  const existingCols = new Set(tableInfo.map((col) => col.name));

  const columnsToAdd = [
    { name: 'url', def: 'TEXT' },
    { name: 'display_name', def: 'TEXT' },
    { name: 'job_id', def: 'TEXT' },
    { name: 'scope', def: "TEXT DEFAULT 'entire_domain'" },
    { name: 'restriction_type', def: "TEXT DEFAULT 'cycle'" },
    { name: 'schedule_window_enabled', def: 'INTEGER DEFAULT 0' },
    { name: 'schedule_start_time', def: 'TEXT' },
    { name: 'schedule_end_time', def: 'TEXT' },
    { name: 'outside_window_policy', def: "TEXT DEFAULT 'block_outside'" },
    { name: 'daily_quota_enabled', def: 'INTEGER DEFAULT 1' },
    { name: 'cycle_breaks_enabled', def: 'INTEGER DEFAULT 0' },
    { name: 'blocked_reason', def: 'TEXT' },
    { name: 'active_days', def: "TEXT DEFAULT '[0,1,2,3,4,5,6]'" },
    { name: 'start_date', def: 'TEXT' },
    { name: 'end_date', def: 'TEXT' },
    { name: 'timezone', def: "TEXT DEFAULT 'Asia/Kolkata'" },
    { name: 'reset_time', def: "TEXT DEFAULT '00:00'" },
    { name: 'breaks_count_today', def: 'INTEGER DEFAULT 0' },
    { name: 'blocked_seconds_today', def: 'INTEGER DEFAULT 0' },
    { name: 'has_extension_permission', def: 'INTEGER DEFAULT 0' },
    { name: 'last_synced_at', def: 'TEXT' },
    { name: 'created_at', def: "TEXT DEFAULT ''" },
  ];

  for (const col of columnsToAdd) {
    if (!existingCols.has(col.name)) {
      db.exec(`ALTER TABLE site_limits ADD COLUMN ${col.name} ${col.def};`);
    }
  }
} catch (migErr) {
  console.warn('Migration note for site_limits:', migErr.message);
}

export default db;

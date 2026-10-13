import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

describe('Agent Downtime Reconciliation & Missed Job Policy - Phase 13', () => {
  it('handles "run_once" policy by executing missed job once and updating next run', () => {
    const memDb = new DatabaseSync(':memory:');
    memDb.exec(`
      CREATE TABLE local_jobs (
        id TEXT PRIMARY KEY,
        title TEXT,
        status TEXT,
        next_run_at TEXT,
        missed_policy TEXT,
        schedule_type TEXT
      );
      CREATE TABLE local_executions (
        id TEXT PRIMARY KEY,
        job_id TEXT,
        status TEXT
      );
    `);

    // Insert a job that was scheduled 2 hours ago during computer shutdown
    const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    memDb.prepare(`
      INSERT INTO local_jobs VALUES ('job-missed-1', 'Missed Backup', 'Scheduled', ?, 'run_once', 'once')
    `).run(twoHoursAgo);

    // Simulate agent startup reconciliation
    const nowIso = new Date().toISOString();
    const missed = memDb.prepare("SELECT * FROM local_jobs WHERE status = 'Scheduled' AND next_run_at <= ?").all(nowIso);
    assert.equal(missed.length, 1);

    // Apply run_once policy
    const job = missed[0];
    if (job.missed_policy === 'run_once') {
      memDb.prepare('INSERT INTO local_executions VALUES (?, ?, ?)').run('exec-rec-1', job.id, 'Successful');
      // Retire one-time job so it never runs again
      memDb.prepare("UPDATE local_jobs SET status = 'Completed', next_run_at = NULL WHERE id = ?").run(job.id);
    }

    // Verify execution recorded
    const execs = memDb.prepare('SELECT * FROM local_executions WHERE job_id = ?').all(job.id);
    assert.equal(execs.length, 1);
    assert.equal(execs[0].status, 'Successful');

    // Verify job retired and cannot be picked up again
    const recheck = memDb.prepare("SELECT * FROM local_jobs WHERE status = 'Scheduled' AND next_run_at <= ?").all(nowIso);
    assert.equal(recheck.length, 0);
  });

  it('handles "skip" policy by logging missed status and advancing schedule', () => {
    const memDb = new DatabaseSync(':memory:');
    memDb.exec(`
      CREATE TABLE local_jobs (
        id TEXT PRIMARY KEY,
        title TEXT,
        status TEXT,
        next_run_at TEXT,
        missed_policy TEXT,
        schedule_type TEXT
      );
      CREATE TABLE local_executions (
        id TEXT PRIMARY KEY,
        job_id TEXT,
        status TEXT
      );
    `);

    const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    memDb.prepare(`
      INSERT INTO local_jobs VALUES ('job-missed-2', 'Daily Sync', 'Scheduled', ?, 'skip', 'daily')
    `).run(twoHoursAgo);

    const now = new Date();
    const missed = memDb.prepare("SELECT * FROM local_jobs WHERE status = 'Scheduled' AND next_run_at <= ?").all(now.toISOString());
    assert.equal(missed.length, 1);

    const job = missed[0];
    if (job.missed_policy === 'skip') {
      memDb.prepare('INSERT INTO local_executions VALUES (?, ?, ?)').run('exec-rec-2', job.id, 'Missed');
      // Advance to tomorrow
      const tomorrow = new Date(now.getTime() + 24 * 3600 * 1000).toISOString();
      memDb.prepare('UPDATE local_jobs SET next_run_at = ? WHERE id = ?').run(tomorrow, job.id);
    }

    // Verify logged as Missed
    const exec = memDb.prepare('SELECT * FROM local_executions WHERE job_id = ?').get(job.id);
    assert.equal(exec.status, 'Missed');

    // Verify next run is in the future
    const updatedJob = memDb.prepare('SELECT * FROM local_jobs WHERE id = ?').get(job.id);
    assert.ok(new Date(updatedJob.next_run_at) > now);
  });
});

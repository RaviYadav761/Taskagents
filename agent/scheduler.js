import cron from 'node-cron';
import agentDb, { getConfig } from './db.js';
import { executeLocalAction } from './executor.js';
import { getNextRunDate, validateCronExpression } from '../server/cronHelper.js';

// Map of active cron tasks: jobId -> cronTask
const activeCronTasks = new Map();
// Map of active one-time timeouts: jobId -> timer
const activeTimeouts = new Map();

/**
 * Initializes agent scheduler: reconciles missed jobs on startup & registers active schedules
 */
export async function initializeScheduler(onExecutionCallback = null) {
  console.log('[Agent Scheduler] Initializing persistent local scheduler...');
  await reconcileMissedJobs(onExecutionCallback);
  await reloadAllSchedules(onExecutionCallback);
}

/**
 * Reconciles missed jobs that were scheduled while agent or computer was off
 */
export async function reconcileMissedJobs(onExecutionCallback) {
  const now = new Date();
  const nowIso = now.toISOString();

  const stmt = agentDb.prepare(`
    SELECT * FROM local_jobs
    WHERE status = 'Scheduled' AND next_run_at IS NOT NULL AND next_run_at <= ?
  `);
  const missedJobs = stmt.all(nowIso);

  if (missedJobs.length === 0) {
    console.log('[Agent Scheduler] No missed jobs found during downtime.');
    return;
  }

  console.log(`[Agent Scheduler] Found ${missedJobs.length} jobs due or missed during downtime.`);

  for (const job of missedJobs) {
    const policy = job.missed_policy || 'run_once';
    let actionPayload = {};
    try { actionPayload = JSON.parse(job.action_payload || '{}'); } catch (e) {}

    const execId = `exec-reconcile-${Date.now()}-${job.id}`;

    if (policy === 'run_once') {
      console.log(`[Agent Scheduler] Missed policy is 'run_once'. Executing: ${job.title}`);
      const result = await executeLocalAction(job.action_type, actionPayload);

      // Record local execution
      agentDb.prepare(`
        INSERT INTO local_executions (
          id, job_id, action_type, scheduled_at, started_at, finished_at,
          status, exit_code, output_log, error_log, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        execId,
        job.id,
        job.action_type,
        job.next_run_at,
        nowIso,
        new Date().toISOString(),
        result.success ? 'Successful' : 'Failed',
        result.exitCode,
        result.outputLog,
        result.errorLog,
        nowIso
      );

      if (onExecutionCallback) {
        onExecutionCallback({
          executionId: execId,
          jobId: job.id,
          status: result.success ? 'Successful' : 'Failed',
          exitCode: result.exitCode,
          outputLog: result.outputLog,
          errorLog: result.errorLog,
          startedAt: nowIso,
          finishedAt: new Date().toISOString(),
        });
      }
    } else if (policy === 'skip') {
      console.log(`[Agent Scheduler] Missed policy is 'skip'. Skipping missed occurrence for: ${job.title}`);
      agentDb.prepare(`
        INSERT INTO local_executions (
          id, job_id, action_type, scheduled_at, started_at, finished_at,
          status, exit_code, output_log, error_log, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'Missed', 0, 'Skipped due to offline downtime policy.', '', ?)
      `).run(execId, job.id, job.action_type, job.next_run_at, nowIso, nowIso, nowIso);

      if (onExecutionCallback) {
        onExecutionCallback({
          executionId: execId,
          jobId: job.id,
          status: 'Missed',
          outputLog: 'Execution was missed during downtime and skipped per user policy.',
          startedAt: nowIso,
          finishedAt: nowIso,
        });
      }
    } else {
      console.log(`[Agent Scheduler] Missed policy is 'require_confirmation' for: ${job.title}`);
      agentDb.prepare('UPDATE local_jobs SET status = "Paused", updated_at = ? WHERE id = ?')
        .run(nowIso, job.id);
      continue;
    }

    // For one-time jobs, mark Completed and retire
    if (job.schedule_type === 'once') {
      agentDb.prepare('UPDATE local_jobs SET status = "Completed", next_run_at = NULL, updated_at = ? WHERE id = ?')
        .run(nowIso, job.id);
    } else {
      // For recurring jobs, calculate next valid future run
      const nextRun = getNextRunDate({
        scheduleType: job.schedule_type,
        cronExpression: job.cron_expression,
        startDate: job.start_date,
        startTime: job.start_time,
        timezone: job.timezone || 'Asia/Kolkata',
        fromDate: now,
      });

      agentDb.prepare('UPDATE local_jobs SET next_run_at = ?, updated_at = ? WHERE id = ?')
        .run(nextRun, nowIso, job.id);
    }
  }
}

/**
 * Registers all active jobs in scheduler
 */
export async function reloadAllSchedules(onExecutionCallback) {
  // Clear existing in-memory timers
  for (const [id, task] of activeCronTasks.entries()) {
    task.stop();
  }
  activeCronTasks.clear();

  for (const [id, timer] of activeTimeouts.entries()) {
    clearTimeout(timer);
  }
  activeTimeouts.clear();

  const stmt = agentDb.prepare('SELECT * FROM local_jobs WHERE status = "Scheduled"');
  const activeJobs = stmt.all();

  console.log(`[Agent Scheduler] Scheduling ${activeJobs.length} active jobs.`);

  for (const job of activeJobs) {
    scheduleSingleJob(job, onExecutionCallback);
  }
}

/**
 * Schedules a single job
 */
export function scheduleSingleJob(job, onExecutionCallback) {
  let actionPayload = {};
  try { actionPayload = JSON.parse(job.action_payload || '{}'); } catch (e) {}

  // 1. One-time job (or delayed file deletion, etc.)
  if (job.schedule_type === 'once') {
    if (!job.next_run_at) return;
    const targetTime = new Date(job.next_run_at).getTime();
    const delayMs = targetTime - Date.now();

    if (delayMs <= 0) return;

    // Set one-time timer
    const timer = setTimeout(async () => {
      console.log(`[Agent Scheduler] Executing one-time job: ${job.title} (${job.action_type})`);
      const nowIso = new Date().toISOString();
      const execId = `exec-${Date.now()}-${job.id}`;

      const result = await executeLocalAction(job.action_type, actionPayload);

      // Record execution
      agentDb.prepare(`
        INSERT INTO local_executions (
          id, job_id, action_type, scheduled_at, started_at, finished_at,
          status, exit_code, output_log, error_log, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        execId,
        job.id,
        job.action_type,
        job.next_run_at,
        nowIso,
        new Date().toISOString(),
        result.success ? 'Successful' : 'Failed',
        result.exitCode,
        result.outputLog,
        result.errorLog,
        nowIso
      );

      // Retire one-time job so it does not run again
      agentDb.prepare('UPDATE local_jobs SET status = ?, next_run_at = NULL, updated_at = ? WHERE id = ?')
        .run(result.success ? 'Completed' : 'Failed', new Date().toISOString(), job.id);

      if (onExecutionCallback) {
        onExecutionCallback({
          executionId: execId,
          jobId: job.id,
          status: result.success ? 'Successful' : 'Failed',
          exitCode: result.exitCode,
          outputLog: result.outputLog,
          errorLog: result.errorLog,
          startedAt: nowIso,
          finishedAt: new Date().toISOString(),
        });
      }
    }, delayMs);

    activeTimeouts.set(job.id, timer);
    return;
  }

  // 2. Recurring Cron Schedule
  let cronExpr = job.cron_expression;
  if (!cronExpr) {
    if (job.schedule_type === 'daily' && job.start_time) {
      const [h, m] = job.start_time.split(':').map(Number);
      cronExpr = `${m} ${h} * * *`;
    } else if (job.schedule_type === 'weekdays' && job.start_time) {
      const [h, m] = job.start_time.split(':').map(Number);
      cronExpr = `${m} ${h} * * 1-5`;
    } else if (job.schedule_type === 'weekly' && job.start_time) {
      const [h, m] = job.start_time.split(':').map(Number);
      cronExpr = `${m} ${h} * * 1`;
    } else if (job.schedule_type === 'interval') {
      cronExpr = '*/15 * * * *';
    }
  }

  if (!cronExpr) return;

  const validation = validateCronExpression(cronExpr);
  if (!validation.valid) {
    console.error(`[Agent Scheduler] Skipping job ${job.id} due to invalid cron: ${cronExpr}`);
    return;
  }

  try {
    const task = cron.schedule(cronExpr, async () => {
      console.log(`[Agent Scheduler] Cron triggered for job: ${job.title} (${cronExpr})`);
      const nowIso = new Date().toISOString();
      const execId = `exec-${Date.now()}-${job.id}`;

      const result = await executeLocalAction(job.action_type, actionPayload);

      agentDb.prepare(`
        INSERT INTO local_executions (
          id, job_id, action_type, scheduled_at, started_at, finished_at,
          status, exit_code, output_log, error_log, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        execId,
        job.id,
        job.action_type,
        nowIso,
        nowIso,
        new Date().toISOString(),
        result.success ? 'Successful' : 'Failed',
        result.exitCode,
        result.outputLog,
        result.errorLog,
        nowIso
      );

      // Recalculate next run
      const nextRun = getNextRunDate({
        scheduleType: job.schedule_type,
        cronExpression: cronExpr,
        startDate: job.start_date,
        startTime: job.start_time,
        timezone: job.timezone || 'Asia/Kolkata',
        fromDate: new Date(),
      });

      agentDb.prepare('UPDATE local_jobs SET next_run_at = ?, updated_at = ? WHERE id = ?')
        .run(nextRun, nowIso, job.id);

      if (onExecutionCallback) {
        onExecutionCallback({
          executionId: execId,
          jobId: job.id,
          status: result.success ? 'Successful' : 'Failed',
          exitCode: result.exitCode,
          outputLog: result.outputLog,
          errorLog: result.errorLog,
          startedAt: nowIso,
          finishedAt: new Date().toISOString(),
        });
      }
    }, {
      timezone: job.timezone || 'Asia/Kolkata',
    });

    activeCronTasks.set(job.id, task);
  } catch (err) {
    console.error(`[Agent Scheduler] Failed to schedule cron for job ${job.id}:`, err);
  }
}

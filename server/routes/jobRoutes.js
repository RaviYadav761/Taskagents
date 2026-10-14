import express from 'express';
import db from '../db.js';
import { authenticateUser } from '../auth.js';
import { validateCronExpression, getNextRunDate, describeCronExpression } from '../cronHelper.js';
import { parseAndNormalizeWebsite } from '../urlHelper.js';

export function upsertSiteLimitFromJob(jobId, userId, payload = {}, timezone = 'Asia/Kolkata') {
  const rawUrl = payload.websiteUrl || payload.url || (payload.domain ? `https://${payload.domain}` : null);
  if (!rawUrl) {
    throw new Error('A valid website URL or domain is required for website restriction');
  }

  const parsed = parseAndNormalizeWebsite(rawUrl, payload.scope || 'entire_domain');
  if (!parsed.valid) {
    throw new Error(`Website validation error: ${parsed.error}`);
  }

  const ruleId = `rule-${parsed.normalizedDomain}-${userId}`;
  const now = new Date().toISOString();
  const today = new Date().toISOString().split('T')[0];

  const coveredDomainsJson = JSON.stringify(parsed.coveredDomains || [parsed.normalizedDomain]);
  const isQuotaEnabled = payload.dailyQuotaEnabled !== false;
  const allowance = isQuotaEnabled
    ? parseInt(payload.dailyAllowanceSeconds ?? (payload.dailyMaxMinutes ? payload.dailyMaxMinutes * 60 : 10800), 10)
    : 0;

  const isCycleEnabled = Boolean(payload.cycleBreaksEnabled || payload.restrictionType === 'cycle');
  const activeInterval = parseInt(payload.activeIntervalSeconds ?? (payload.activeIntervalMinutes ? payload.activeIntervalMinutes * 60 : 600), 10);
  const breakDuration = parseInt(payload.breakSeconds ?? (payload.breakMinutes ? payload.breakMinutes * 60 : 600), 10);
  const isScheduleEnabled = Boolean(payload.scheduleWindowEnabled || payload.restrictionType === 'schedule');

  let blockedUntil = null;
  if (payload.restrictionType === 'today_only') {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    blockedUntil = tomorrow.toISOString();
  }

  const stmt = db.prepare(`
    INSERT INTO site_limits (
      id, user_id, job_id, domain, url, display_name, scope, covered_domains, restriction_type,
      schedule_window_enabled, schedule_start_time, schedule_end_time, outside_window_policy,
      daily_quota_enabled, daily_allowance_seconds, cycle_breaks_enabled, active_interval_seconds, break_seconds,
      active_days, start_date, end_date, timezone, blocked_until, last_reset_date, is_enabled, emergency_override, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, 1, 0, ?, ?
    )
    ON CONFLICT(user_id, domain) DO UPDATE SET
      job_id = excluded.job_id,
      url = excluded.url,
      display_name = excluded.display_name,
      scope = excluded.scope,
      covered_domains = excluded.covered_domains,
      restriction_type = excluded.restriction_type,
      schedule_window_enabled = excluded.schedule_window_enabled,
      schedule_start_time = excluded.schedule_start_time,
      schedule_end_time = excluded.schedule_end_time,
      outside_window_policy = excluded.outside_window_policy,
      daily_quota_enabled = excluded.daily_quota_enabled,
      daily_allowance_seconds = excluded.daily_allowance_seconds,
      cycle_breaks_enabled = excluded.cycle_breaks_enabled,
      active_interval_seconds = excluded.active_interval_seconds,
      break_seconds = excluded.break_seconds,
      active_days = excluded.active_days,
      start_date = excluded.start_date,
      end_date = excluded.end_date,
      timezone = excluded.timezone,
      blocked_until = COALESCE(excluded.blocked_until, site_limits.blocked_until),
      is_enabled = 1,
      emergency_override = 0,
      updated_at = excluded.updated_at
  `);

  stmt.run(
    ruleId,
    userId,
    jobId,
    parsed.normalizedDomain,
    parsed.originalUrl,
    payload.displayName || parsed.displayName,
    parsed.scope,
    coveredDomainsJson,
    payload.restrictionType || 'cycle',
    isScheduleEnabled ? 1 : 0,
    payload.scheduleStartTime || '09:00',
    payload.scheduleEndTime || '12:00',
    payload.outsideWindowPolicy || 'block_outside',
    isQuotaEnabled ? 1 : 0,
    allowance,
    isCycleEnabled ? 1 : 0,
    activeInterval,
    breakDuration,
    JSON.stringify(payload.activeDays || [0, 1, 2, 3, 4, 5, 6]),
    payload.startDate || null,
    payload.endDate || null,
    timezone,
    blockedUntil,
    today,
    now,
    now
  );

  return db.prepare('SELECT * FROM site_limits WHERE id = ?').get(ruleId);
}

const router = express.Router();
router.use(authenticateUser);

function formatJob(row) {
  if (!row) return null;
  let actionPayload = {};
  let bulletPoints = [];

  try {
    actionPayload = JSON.parse(row.action_payload || '{}');
  } catch (e) {}

  try {
    bulletPoints = JSON.parse(row.bullet_points || '[]');
  } catch (e) {}

  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    category: row.category,
    priority: row.priority,
    actionType: row.action_type,
    actionPayload,
    scheduleType: row.schedule_type,
    cronExpression: row.cron_expression,
    cronDescription: row.cron_expression ? describeCronExpression(row.cron_expression) : '',
    timezone: row.timezone,
    startDate: row.start_date,
    startTime: row.start_time,
    nextRunAt: row.next_run_at,
    status: row.status,
    missedPolicy: row.missed_policy,
    repeat: row.repeat,
    goal: row.goal,
    notes: row.notes,
    notesHeader: row.notes_header,
    bulletPoints,
    image: row.image,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// GET all jobs for authenticated user
router.get('/', (req, res) => {
  const stmt = db.prepare('SELECT * FROM jobs WHERE user_id = ? ORDER BY created_at DESC');
  const rows = stmt.all(req.user.id);
  const jobs = rows.map(formatJob);
  res.json({ jobs });
});

// GET single job
router.get('/:id', (req, res) => {
  const stmt = db.prepare('SELECT * FROM jobs WHERE id = ? AND user_id = ?');
  const row = stmt.get(req.params.id, req.user.id);
  if (!row) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json({ job: formatJob(row) });
});

// POST create new job (Authoritative transactional operation)
router.post('/', (req, res) => {
  const {
    title,
    category = 'Work & Projects',
    priority = 'Medium Priority',
    actionType = 'standard',
    actionPayload = {},
    scheduleType = 'once',
    cronExpression,
    timezone = 'Asia/Kolkata',
    startDate,
    startTime,
    missedPolicy = 'run_once',
    repeat = 'Once',
    goal = '',
    notes = '',
    notesHeader = '',
    bulletPoints = [],
    image = '/assets/laptop.jpg',
  } = req.body;

  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'Job title is required' });
  }

  // Pre-validate website restriction if selected
  if (actionType === 'restrict_website') {
    const rawUrl = actionPayload.websiteUrl || actionPayload.url || (actionPayload.domain ? `https://${actionPayload.domain}` : null);
    if (!rawUrl) {
      return res.status(400).json({ error: 'Website URL or domain is required for website restriction' });
    }
    const check = parseAndNormalizeWebsite(rawUrl, actionPayload.scope || 'entire_domain');
    if (!check.valid) {
      return res.status(400).json({ error: `Website validation error: ${check.error}` });
    }
  }

  // If custom cron is provided, validate it
  if (scheduleType === 'cron' || cronExpression) {
    const cronValidation = validateCronExpression(cronExpression);
    if (!cronValidation.valid) {
      return res.status(400).json({ error: `Invalid Cron expression: ${cronValidation.error}` });
    }
  }

  // Replaying a create request after a dropped response must not create a duplicate.
  const requestId = typeof req.body.clientRequestId === 'string' && /^[a-zA-Z0-9-]{16,80}$/.test(req.body.clientRequestId)
    ? req.body.clientRequestId
    : null;
  const id = requestId ? `job-${req.user.id}-${requestId}` : `job-${Date.now()}`;
  const prior = db.prepare('SELECT * FROM jobs WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (prior) {
    const siteLimit = actionType === 'restrict_website'
      ? db.prepare('SELECT * FROM site_limits WHERE job_id = ? AND user_id = ?').get(id, req.user.id)
      : null;
    return res.status(200).json({ success: true, job: formatJob(prior), siteLimit, idempotentReplay: true });
  }

  // Calculate next run time
  const nextRunAt = getNextRunDate({
    scheduleType,
    cronExpression,
    startDate: startDate || new Date().toISOString().split('T')[0],
    startTime: startTime || '18:00',
    timezone,
  });

  const now = new Date().toISOString();

  // Execute in transaction
  db.exec('BEGIN TRANSACTION;');
  try {
    const insertStmt = db.prepare(`
      INSERT INTO jobs (
        id, user_id, title, category, priority, action_type, action_payload,
        schedule_type, cron_expression, timezone, start_date, start_time,
        next_run_at, status, missed_policy, repeat, goal, notes, notes_header,
        bullet_points, image, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, 'Scheduled', ?, ?, ?, ?, ?,
        ?, ?, ?, ?
      )
    `);

    insertStmt.run(
      id,
      req.user.id,
      title.trim(),
      category,
      priority,
      actionType,
      JSON.stringify(actionPayload),
      scheduleType,
      cronExpression || null,
      timezone,
      startDate || now.split('T')[0],
      startTime || '18:00',
      nextRunAt,
      missedPolicy,
      repeat,
      goal,
      notes,
      notesHeader,
      JSON.stringify(bulletPoints),
      image,
      now,
      now
    );

    // Initial execution slot
    if (nextRunAt) {
      const execStmt = db.prepare(`
        INSERT INTO executions (
          id, job_id, user_id, action_type, scheduled_at, status, trigger_type, created_at
        ) VALUES (?, ?, ?, ?, ?, 'Scheduled', 'schedule', ?)
      `);
      execStmt.run(`exec-${Date.now()}`, id, req.user.id, actionType, nextRunAt, now);
    }

    // Atomic website restriction upsert
    let linkedSiteLimit = null;
    if (actionType === 'restrict_website') {
      linkedSiteLimit = upsertSiteLimitFromJob(id, req.user.id, actionPayload, timezone);
    }

    db.exec('COMMIT;');

    const createdStmt = db.prepare('SELECT * FROM jobs WHERE id = ?');
    const createdRow = createdStmt.get(id);

    return res.status(201).json({
      success: true,
      job: formatJob(createdRow),
      siteLimit: linkedSiteLimit,
    });
  } catch (err) {
    db.exec('ROLLBACK;');
    console.error('Failed to create job:', err);
    return res.status(500).json({ error: err.message || 'Failed to create job' });
  }
});

// PUT update job (Authoritative transactional operation)
router.put('/:id', (req, res) => {
  const existingStmt = db.prepare('SELECT * FROM jobs WHERE id = ? AND user_id = ?');
  const existing = existingStmt.get(req.params.id, req.user.id);
  if (!existing) {
    return res.status(404).json({ error: 'Job not found' });
  }

  const {
    title,
    category,
    priority,
    actionType,
    actionPayload,
    scheduleType,
    cronExpression,
    timezone,
    startDate,
    startTime,
    status,
    missedPolicy,
    repeat,
    goal,
    notes,
    notesHeader,
    bulletPoints,
    image,
  } = req.body;

  if (actionType === 'restrict_website') {
    const payloadToCheck = actionPayload || JSON.parse(existing.action_payload || '{}');
    const rawUrl = payloadToCheck.websiteUrl || payloadToCheck.url || (payloadToCheck.domain ? `https://${payloadToCheck.domain}` : null);
    if (!rawUrl) {
      return res.status(400).json({ error: 'Website URL or domain is required for website restriction' });
    }
    const check = parseAndNormalizeWebsite(rawUrl, payloadToCheck.scope || 'entire_domain');
    if (!check.valid) {
      return res.status(400).json({ error: `Website validation error: ${check.error}` });
    }
  }

  if (cronExpression) {
    const cronValidation = validateCronExpression(cronExpression);
    if (!cronValidation.valid) {
      return res.status(400).json({ error: `Invalid Cron expression: ${cronValidation.error}` });
    }
  }

  const nextRunAt = getNextRunDate({
    scheduleType: scheduleType || existing.schedule_type,
    cronExpression: cronExpression !== undefined ? cronExpression : existing.cron_expression,
    startDate: startDate || existing.start_date,
    startTime: startTime || existing.start_time,
    timezone: timezone || existing.timezone,
  });

  const now = new Date().toISOString();

  db.exec('BEGIN TRANSACTION;');
  try {
    const updateStmt = db.prepare(`
      UPDATE jobs SET
        title = COALESCE(?, title),
        category = COALESCE(?, category),
        priority = COALESCE(?, priority),
        action_type = COALESCE(?, action_type),
        action_payload = COALESCE(?, action_payload),
        schedule_type = COALESCE(?, schedule_type),
        cron_expression = ?,
        timezone = COALESCE(?, timezone),
        start_date = COALESCE(?, start_date),
        start_time = COALESCE(?, start_time),
        next_run_at = ?,
        status = COALESCE(?, status),
        missed_policy = COALESCE(?, missed_policy),
        repeat = COALESCE(?, repeat),
        goal = COALESCE(?, goal),
        notes = COALESCE(?, notes),
        notes_header = COALESCE(?, notes_header),
        bullet_points = COALESCE(?, bullet_points),
        image = COALESCE(?, image),
        updated_at = ?
      WHERE id = ? AND user_id = ?
    `);

    updateStmt.run(
      title ? title.trim() : null,
      category || null,
      priority || null,
      actionType || null,
      actionPayload ? JSON.stringify(actionPayload) : null,
      scheduleType || null,
      cronExpression || null,
      timezone || null,
      startDate || null,
      startTime || null,
      nextRunAt,
      status || null,
      missedPolicy || null,
      repeat || null,
      goal || null,
      notes || null,
      notesHeader || null,
      bulletPoints ? JSON.stringify(bulletPoints) : null,
      image || null,
      now,
      req.params.id,
      req.user.id
    );

    let linkedSiteLimit = null;
    const finalActionType = actionType || existing.action_type;
    if (finalActionType === 'restrict_website') {
      const payload = actionPayload || JSON.parse(existing.action_payload || '{}');
      linkedSiteLimit = upsertSiteLimitFromJob(req.params.id, req.user.id, payload, timezone || existing.timezone);
    } else if (existing.action_type === 'restrict_website' && finalActionType !== 'restrict_website') {
      // Disabled restriction if action type changed
      db.prepare('UPDATE site_limits SET is_enabled = 0, updated_at = ? WHERE job_id = ? AND user_id = ?')
        .run(now, req.params.id, req.user.id);
    }

    db.exec('COMMIT;');

    const updatedRow = existingStmt.get(req.params.id, req.user.id);
    return res.json({
      success: true,
      job: formatJob(updatedRow),
      siteLimit: linkedSiteLimit,
    });
  } catch (err) {
    db.exec('ROLLBACK;');
    console.error('Update job error:', err);
    return res.status(500).json({ error: err.message || 'Failed to update job' });
  }
});

// DELETE job (Authoritative transactional operation)
router.delete('/:id', (req, res) => {
  db.exec('BEGIN TRANSACTION;');
  try {
    const deleteStmt = db.prepare('DELETE FROM jobs WHERE id = ? AND user_id = ?');
    const result = deleteStmt.run(req.params.id, req.user.id);
    if (result.changes === 0) {
      db.exec('ROLLBACK;');
      return res.status(404).json({ error: 'Job not found' });
    }

    // Clean up linked site_limits rule
    db.prepare('DELETE FROM site_limits WHERE job_id = ? AND user_id = ?').run(req.params.id, req.user.id);

    db.exec('COMMIT;');
    res.json({ success: true, message: 'Job and associated rules deleted successfully' });
  } catch (err) {
    db.exec('ROLLBACK;');
    res.status(500).json({ error: 'Failed to delete job' });
  }
});

// Toggle Job status (Completed / Scheduled or Paused / Scheduled)
router.post('/:id/toggle', (req, res) => {
  const stmt = db.prepare('SELECT * FROM jobs WHERE id = ? AND user_id = ?');
  const job = stmt.get(req.params.id, req.user.id);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  const nextStatus = job.status === 'Completed' || job.status === 'Paused' ? 'Scheduled' : 'Paused';
  const now = new Date().toISOString();

  db.exec('BEGIN TRANSACTION;');
  try {
    db.prepare('UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?').run(nextStatus, now, job.id);

    // Propagate to linked site_limits rule
    db.prepare('UPDATE site_limits SET is_enabled = ?, updated_at = ? WHERE job_id = ? AND user_id = ?')
      .run(nextStatus === 'Scheduled' ? 1 : 0, now, job.id, req.user.id);

    db.exec('COMMIT;');

    const updated = stmt.get(req.params.id, req.user.id);
    res.json({ job: formatJob(updated) });
  } catch (err) {
    db.exec('ROLLBACK;');
    res.status(500).json({ error: 'Failed to toggle job status' });
  }
});

// Trigger Job Now (Manual Run)
router.post('/:id/trigger-now', (req, res) => {
  const stmt = db.prepare('SELECT * FROM jobs WHERE id = ? AND user_id = ?');
  const job = stmt.get(req.params.id, req.user.id);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  const execId = `exec-${Date.now()}`;
  const now = new Date().toISOString();

  const execStmt = db.prepare(`
    INSERT INTO executions (
      id, job_id, user_id, action_type, scheduled_at, started_at, status, trigger_type, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'Running', 'manual_retry', ?)
  `);

  execStmt.run(execId, job.id, req.user.id, job.action_type, now, now, now);

  res.json({
    success: true,
    executionId: execId,
    message: 'Manual execution queued. Will be executed by server or paired local agent.',
  });
});

export default router;

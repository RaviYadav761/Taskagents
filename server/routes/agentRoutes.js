import express from 'express';
import db from '../db.js';
import { activePairingCodes } from './deviceRoutes.js';
import { generateDeviceToken } from '../auth.js';
import { getNextRunDate } from '../cronHelper.js';

const router = express.Router();

// Middleware to authenticate agent by Bearer device token
function authenticateAgent(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Device authentication token required' });
  }

  const token = authHeader.split(' ')[1];
  const stmt = db.prepare('SELECT * FROM devices WHERE auth_token = ?');
  const device = stmt.get(token);

  if (!device) {
    return res.status(401).json({ error: 'Unrecognized or revoked device token' });
  }

  req.device = device;
  next();
}

// Agent claims device via pairing code
router.post('/pair', (req, res) => {
  const { code, deviceName = 'My Computer', platform = process.platform } = req.body;

  if (!code) {
    return res.status(400).json({ error: 'Pairing code is required' });
  }

  const pairingData = activePairingCodes.get(code.trim().toUpperCase());
  if (!pairingData) {
    return res.status(400).json({ error: 'Invalid or expired pairing code. Please generate a new code in Taskly Settings.' });
  }

  if (Date.now() > pairingData.expiresAt) {
    activePairingCodes.delete(code.trim().toUpperCase());
    return res.status(400).json({ error: 'Pairing code has expired. Please generate a fresh code in Taskly.' });
  }

  const deviceId = `dev-${Date.now()}`;
  const authToken = generateDeviceToken();
  const now = new Date().toISOString();

  const insertStmt = db.prepare(`
    INSERT INTO devices (
      id, user_id, device_name, platform, pairing_token_hash, auth_token, status, last_seen_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'online', ?, ?)
  `);

  try {
    insertStmt.run(deviceId, pairingData.userId, deviceName, platform, code.trim().toUpperCase(), authToken, now, now);
    activePairingCodes.delete(code.trim().toUpperCase());

    res.json({
      success: true,
      deviceId,
      userId: pairingData.userId,
      authToken,
      message: 'Local Agent paired successfully with your Taskly account!',
    });
  } catch (err) {
    console.error('Agent pairing error:', err);
    res.status(500).json({ error: 'Failed to pair device' });
  }
});

// Agent heartbeat
router.post('/heartbeat', authenticateAgent, (req, res) => {
  const now = new Date().toISOString();
  db.prepare('UPDATE devices SET status = "online", last_seen_at = ? WHERE id = ?').run(now, req.device.id);

  // Count pending executions for this user
  const countStmt = db.prepare('SELECT COUNT(*) as cnt FROM executions WHERE user_id = ? AND status IN ("Scheduled", "Running")');
  const count = countStmt.get(req.device.user_id)?.cnt || 0;

  res.json({
    ok: true,
    deviceId: req.device.id,
    userId: req.device.user_id,
    serverTime: now,
    pendingJobsCount: count,
  });
});

// Agent downloads local jobs assigned to user
router.get('/sync-jobs', authenticateAgent, (req, res) => {
  const stmt = db.prepare(`
    SELECT * FROM jobs
    WHERE user_id = ? AND status != 'Cancelled'
    ORDER BY created_at DESC
  `);
  const rows = stmt.all(req.device.user_id);

  const jobs = rows.map((r) => {
    let actionPayload = {};
    try {
      actionPayload = JSON.parse(r.action_payload || '{}');
    } catch (e) {}

    return {
      id: r.id,
      title: r.title,
      actionType: r.action_type,
      actionPayload,
      scheduleType: r.schedule_type,
      cronExpression: r.cron_expression,
      timezone: r.timezone,
      startDate: r.start_date,
      startTime: r.start_time,
      nextRunAt: r.next_run_at,
      status: r.status,
      missedPolicy: r.missed_policy,
      repeat: r.repeat,
    };
  });

  res.json({ jobs });
});

// Agent reports execution outcome
router.post('/report-execution', authenticateAgent, (req, res) => {
  const {
    executionId,
    jobId,
    status, // 'Successful' | 'Failed' | 'Missed'
    exitCode = 0,
    outputLog = '',
    errorLog = '',
    startedAt,
    finishedAt = new Date().toISOString(),
  } = req.body;

  if (!jobId || !status) {
    return res.status(400).json({ error: 'jobId and status are required' });
  }

  const now = new Date().toISOString();
  const execId = executionId || `exec-${Date.now()}`;

  // Upsert execution record
  const checkStmt = db.prepare('SELECT id FROM executions WHERE id = ?');
  const existing = checkStmt.get(execId);

  if (existing) {
    db.prepare(`
      UPDATE executions SET
        status = ?,
        exit_code = ?,
        output_log = ?,
        error_log = ?,
        finished_at = ?
      WHERE id = ?
    `).run(status, exitCode, outputLog, errorLog, finishedAt, execId);
  } else {
    // Get job action type
    const jobRow = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    const actionType = jobRow ? jobRow.action_type : 'standard';

    db.prepare(`
      INSERT INTO executions (
        id, job_id, user_id, action_type, scheduled_at, started_at, finished_at,
        status, exit_code, output_log, error_log, trigger_type, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'schedule', ?)
    `).run(
      execId,
      jobId,
      req.device.user_id,
      actionType,
      startedAt || now,
      startedAt || now,
      finishedAt,
      status,
      exitCode,
      outputLog,
      errorLog,
      now
    );
  }

  // Update Job status / next execution
  const jobStmt = db.prepare('SELECT * FROM jobs WHERE id = ? AND user_id = ?');
  const job = jobStmt.get(jobId, req.device.user_id);

  if (job) {
    if (job.schedule_type === 'once') {
      // One-time job is retired after execution!
      const finalJobStatus = status === 'Successful' ? 'Completed' : 'Failed';
      db.prepare('UPDATE jobs SET status = ?, next_run_at = NULL, updated_at = ? WHERE id = ?')
        .run(finalJobStatus, now, jobId);
    } else {
      // Recurring job: calculate next run
      const nextRunAt = getNextRunDate({
        scheduleType: job.schedule_type,
        cronExpression: job.cron_expression,
        startDate: job.start_date,
        startTime: job.start_time,
        timezone: job.timezone,
        fromDate: new Date(),
      });

      db.prepare('UPDATE jobs SET next_run_at = ?, updated_at = ? WHERE id = ?')
        .run(nextRunAt, now, jobId);

      // Schedule next execution record
      if (nextRunAt) {
        db.prepare(`
          INSERT INTO executions (
            id, job_id, user_id, action_type, scheduled_at, status, trigger_type, created_at
          ) VALUES (?, ?, ?, ?, ?, 'Scheduled', 'schedule', ?)
        `).run(`exec-${Date.now()}`, jobId, req.device.user_id, job.action_type, nextRunAt, now);
      }
    }
  }

  res.json({ success: true, message: 'Execution reported successfully' });
});

export default router;

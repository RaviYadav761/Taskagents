import express from 'express';
import db from '../db.js';
import { authenticateUser } from '../auth.js';

const router = express.Router();
router.use(authenticateUser);

function formatExecution(row) {
  if (!row) return null;
  return {
    id: row.id,
    jobId: row.job_id,
    jobTitle: row.job_title || 'Unnamed Job',
    userId: row.user_id,
    actionType: row.action_type,
    scheduledAt: row.scheduled_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status,
    exitCode: row.exit_code,
    outputLog: row.output_log || '',
    errorLog: row.error_log || '',
    attemptCount: row.attempt_count,
    triggerType: row.trigger_type,
    createdAt: row.created_at,
  };
}

// GET execution history for user
router.get('/', (req, res) => {
  const { jobId, status, limit = 50 } = req.query;

  let query = `
    SELECT e.*, j.title as job_title
    FROM executions e
    LEFT JOIN jobs j ON e.job_id = j.id
    WHERE e.user_id = ?
  `;
  const params = [req.user.id];

  if (jobId) {
    query += ' AND e.job_id = ?';
    params.push(jobId);
  }

  if (status) {
    query += ' AND e.status = ?';
    params.push(status);
  }

  query += ' ORDER BY e.created_at DESC LIMIT ?';
  params.push(parseInt(limit, 10));

  const stmt = db.prepare(query);
  const rows = stmt.all(...params);
  res.json({ executions: rows.map(formatExecution) });
});

// GET single execution detail
router.get('/:id', (req, res) => {
  const stmt = db.prepare(`
    SELECT e.*, j.title as job_title
    FROM executions e
    LEFT JOIN jobs j ON e.job_id = j.id
    WHERE e.id = ? AND e.user_id = ?
  `);
  const row = stmt.get(req.params.id, req.user.id);
  if (!row) {
    return res.status(404).json({ error: 'Execution record not found' });
  }
  res.json({ execution: formatExecution(row) });
});

// POST retry execution
router.post('/:id/retry', (req, res) => {
  const stmt = db.prepare('SELECT * FROM executions WHERE id = ? AND user_id = ?');
  const existing = stmt.get(req.params.id, req.user.id);
  if (!existing) {
    return res.status(404).json({ error: 'Execution record not found' });
  }

  const newExecId = `exec-${Date.now()}`;
  const now = new Date().toISOString();

  const insertStmt = db.prepare(`
    INSERT INTO executions (
      id, job_id, user_id, action_type, scheduled_at, started_at, status, attempt_count, trigger_type, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'Running', ?, 'manual_retry', ?)
  `);

  insertStmt.run(
    newExecId,
    existing.job_id,
    req.user.id,
    existing.action_type,
    now,
    now,
    (existing.attempt_count || 1) + 1,
    now
  );

  res.json({
    success: true,
    executionId: newExecId,
    message: 'Retry execution initiated.'
  });
});

export default router;

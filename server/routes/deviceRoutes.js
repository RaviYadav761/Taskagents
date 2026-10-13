import express from 'express';
import db from '../db.js';
import { authenticateUser, generatePairingCode } from '../auth.js';

const router = express.Router();

// Active pairing codes cache: code -> { userId, expiresAt }
export const activePairingCodes = new Map();

// GET all devices for user
router.get('/', authenticateUser, (req, res) => {
  const stmt = db.prepare(`
    SELECT id, device_name as deviceName, platform, status, last_seen_at as lastSeenAt, created_at as createdAt
    FROM devices
    WHERE user_id = ?
    ORDER BY created_at DESC
  `);
  const devices = stmt.all(req.user.id);
  res.json({ devices });
});

// POST generate pairing code
router.post('/pair-code', authenticateUser, (req, res) => {
  const code = generatePairingCode();
  const expiresAt = Date.now() + 15 * 60 * 1000; // 15 minutes

  activePairingCodes.set(code, {
    userId: req.user.id,
    expiresAt,
  });

  res.json({
    pairingCode: code,
    expiresInMinutes: 15,
    message: 'Run the Taskly Local Agent on your computer and enter this code when prompted to pair your device.'
  });
});

// DELETE revoke device
router.delete('/:id', authenticateUser, (req, res) => {
  const stmt = db.prepare('DELETE FROM devices WHERE id = ? AND user_id = ?');
  const result = stmt.run(req.params.id, req.user.id);

  if (result.changes === 0) {
    return res.status(404).json({ error: 'Device not found' });
  }

  res.json({ success: true, message: 'Device unpaired and revoked.' });
});

export default router;

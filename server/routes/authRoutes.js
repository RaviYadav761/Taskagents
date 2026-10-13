import express from 'express';
import db from '../db.js';
import { hashPassword, comparePassword, generateToken, authenticateUser } from '../auth.js';

const router = express.Router();

// Register new user
router.post('/register', (req, res) => {
  const { email, password, fullName } = req.body;

  if (!email || !password || !fullName) {
    return res.status(400).json({ error: 'Email, password, and full name are required' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const cleanName = fullName.trim();

  // Check existing user
  const existingStmt = db.prepare('SELECT id FROM users WHERE email = ?');
  const existing = existingStmt.get(cleanEmail);
  if (existing) {
    return res.status(400).json({ error: 'An account with this email already exists' });
  }

  const userId = `user-${Date.now()}`;
  const passwordHash = hashPassword(password);
  const now = new Date().toISOString();

  const insertStmt = db.prepare(`
    INSERT INTO users (id, email, password_hash, full_name, role, avatar, created_at)
    VALUES (?, ?, ?, ?, 'Personal Workspace', '/assets/avatar.jpg', ?)
  `);

  try {
    insertStmt.run(userId, cleanEmail, passwordHash, cleanName, now);

    // Also initialize default site limits for YouTube and Instagram
    const today = now.split('T')[0];
    const insertSiteLimit = db.prepare(`
      INSERT OR IGNORE INTO site_limits (id, user_id, domain, daily_allowance_seconds, used_today_seconds, active_interval_seconds, break_seconds, last_reset_date, is_enabled, emergency_override, updated_at)
      VALUES (?, ?, ?, ?, 0, ?, ?, ?, 1, 0, ?)
    `);
    insertSiteLimit.run(`limit-yt-${userId}`, userId, 'youtube.com', 10800, 600, 600, today, now);
    insertSiteLimit.run(`limit-ig-${userId}`, userId, 'instagram.com', 0, 0, 0, 0, today, 0, 0, now);

    const user = { id: userId, email: cleanEmail, fullName: cleanName, role: 'Personal Workspace' };
    const token = generateToken(user);

    return res.json({ token, user });
  } catch (err) {
    console.error('Registration error:', err);
    return res.status(500).json({ error: 'Failed to create user account' });
  }
});

// Login
router.post('/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const stmt = db.prepare('SELECT * FROM users WHERE email = ?');
  const user = stmt.get(cleanEmail);

  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const valid = comparePassword(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const userData = {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    role: user.role,
    avatar: user.avatar,
  };

  const token = generateToken(userData);
  return res.json({ token, user: userData });
});

// Current User Profile
router.get('/me', authenticateUser, (req, res) => {
  const stmt = db.prepare('SELECT id, email, full_name as fullName, role, avatar, created_at FROM users WHERE id = ?');
  const user = stmt.get(req.user.id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  return res.json({ user });
});

export default router;

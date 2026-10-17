import express from 'express';
import { randomUUID } from 'node:crypto';
import db from '../db.js';
import { hashPassword, comparePassword, generateToken, authenticateUser } from '../auth.js';

const router = express.Router();

// Active extension pairing codes cache: code -> { userId, expiresAt }
export const activeExtensionPairingCodes = new Map();

// Register new user
router.post('/register', (req, res) => {
  const { email, password, fullName } = req.body;

  if (typeof email !== 'string' || typeof password !== 'string' || typeof fullName !== 'string') {
    return res.status(400).json({ error: 'Email, password, and full name are required' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const cleanName = fullName.trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) || cleanEmail.length > 254) {
    return res.status(400).json({ error: 'Enter a valid email address' });
  }
  if (password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) {
    return res.status(400).json({ error: 'Password must be at least 8 characters and no more than 72 UTF-8 bytes' });
  }
  if (!cleanName || cleanName.length > 100) {
    return res.status(400).json({ error: 'Full name must be between 1 and 100 characters' });
  }

  // Check existing user
  const existingStmt = db.prepare('SELECT id FROM users WHERE email = ?');
  const existing = existingStmt.get(cleanEmail);
  if (existing) {
    return res.status(400).json({ error: 'An account with this email already exists' });
  }

  const userId = `user-${randomUUID()}`;
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
    insertSiteLimit.run(`limit-ig-${userId}`, userId, 'instagram.com', 0, 0, 0, today, now);

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

// Generate short-lived Extension Pairing Code
router.post('/extension-code', authenticateUser, (req, res) => {
  const code = `EXT-${Math.floor(1000 + Math.random() * 9000)}`;
  const expiresAt = Date.now() + 15 * 60 * 1000; // 15 mins

  activeExtensionPairingCodes.set(code, {
    userId: req.user.id,
    expiresAt,
  });

  res.json({
    pairingCode: code,
    expiresInMinutes: 15,
  });
});

// Exchange short-lived Extension Pairing Code for JWT
router.post('/extension-exchange', (req, res) => {
  const { pairingCode } = req.body;
  if (!pairingCode) {
    return res.status(400).json({ error: 'Pairing code is required' });
  }

  const cleanCode = pairingCode.trim().toUpperCase();
  const entry = activeExtensionPairingCodes.get(cleanCode);

  if (!entry) {
    return res.status(401).json({ error: 'Invalid or expired pairing code' });
  }

  if (Date.now() > entry.expiresAt) {
    activeExtensionPairingCodes.delete(cleanCode);
    return res.status(401).json({ error: 'Pairing code has expired. Please generate a new code in Taskly.' });
  }

  // Consume code (one-time use)
  activeExtensionPairingCodes.delete(cleanCode);

  const stmt = db.prepare('SELECT id, email, full_name, role, avatar FROM users WHERE id = ?');
  const user = stmt.get(entry.userId);
  if (!user) {
    return res.status(404).json({ error: 'User account not found' });
  }

  const token = generateToken(user);
  return res.json({ token, user });
});

export default router;

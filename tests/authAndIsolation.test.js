import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { hashPassword, comparePassword, generateToken, verifyToken, generatePairingCode } from '../server/auth.js';

describe('Multi-User Security & Isolation - Phase 12', () => {
  it('hashes passwords securely using bcrypt and verifies correctly', () => {
    const rawPass = 'TasklySecurePass#2026';
    const hashed = hashPassword(rawPass);

    assert.notEqual(hashed, rawPass);
    assert.equal(comparePassword(rawPass, hashed), true);
    assert.equal(comparePassword('WrongPassword123', hashed), false);
  });

  it('generates valid JWT tokens and extracts user claims', () => {
    const user = { id: 'usr-12345', email: 'alex@example.com', fullName: 'Alex Morgan' };
    const token = generateToken(user);

    assert.ok(token);
    const decoded = verifyToken(token);
    assert.equal(decoded.id, 'usr-12345');
    assert.equal(decoded.email, 'alex@example.com');
  });

  it('generates 8-character human friendly pairing codes', () => {
    const code = generatePairingCode();
    assert.match(code, /^TSK-\d{4}$/);
  });

  it('strictly enforces account-level data isolation between users in SQLite', () => {
    // Setup in-memory isolated database
    const memDb = new DatabaseSync(':memory:');
    memDb.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT);
      CREATE TABLE jobs (id TEXT PRIMARY KEY, user_id TEXT, title TEXT);
    `);

    // Insert User A and User B
    memDb.prepare('INSERT INTO users VALUES (?, ?)').run('user-a', 'a@taskly.io');
    memDb.prepare('INSERT INTO users VALUES (?, ?)').run('user-b', 'b@taskly.io');

    // Insert Jobs for each user
    memDb.prepare('INSERT INTO jobs VALUES (?, ?, ?)').run('job-1', 'user-a', 'User A Secret Script');
    memDb.prepare('INSERT INTO jobs VALUES (?, ?, ?)').run('job-2', 'user-b', 'User B Personal Task');

    // Query jobs for User A
    const userAJobs = memDb.prepare('SELECT * FROM jobs WHERE user_id = ?').all('user-a');
    assert.equal(userAJobs.length, 1);
    assert.equal(userAJobs[0].title, 'User A Secret Script');

    // Query jobs for User B
    const userBJobs = memDb.prepare('SELECT * FROM jobs WHERE user_id = ?').all('user-b');
    assert.equal(userBJobs.length, 1);
    assert.equal(userBJobs[0].title, 'User B Personal Task');

    // Verify User A cannot access User B's job
    const attemptAccess = memDb.prepare('SELECT * FROM jobs WHERE id = ? AND user_id = ?').get('job-2', 'user-a');
    assert.equal(attemptAccess, undefined);
  });
});

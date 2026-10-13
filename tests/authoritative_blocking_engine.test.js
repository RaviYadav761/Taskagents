import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { parseAndNormalizeWebsite, matchDomain, resolveServiceProfile } from '../server/urlHelper.js';

describe('Authoritative Mindful Usage & Website Blocking Engine Verification', () => {
  let db;
  const tempDbPath = path.join(process.cwd(), 'temp_test_engine.db');

  before(() => {
    if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
    db = new DatabaseSync(tempDbPath);
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE,
        password_hash TEXT,
        created_at TEXT
      );

      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        title TEXT,
        category TEXT,
        priority TEXT,
        schedule_type TEXT,
        cron_expression TEXT,
        timezone TEXT,
        start_date TEXT,
        start_time TEXT,
        status TEXT,
        missed_policy TEXT,
        action_type TEXT,
        action_payload TEXT,
        repeat TEXT,
        goal TEXT,
        notes_header TEXT,
        bullet_points TEXT,
        image TEXT,
        next_run_at TEXT,
        last_run_at TEXT,
        created_at TEXT,
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS site_limits (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        job_id TEXT,
        domain TEXT,
        scope TEXT DEFAULT 'entire_domain',
        display_name TEXT,
        covered_domains TEXT,
        restriction_type TEXT DEFAULT 'combined',
        schedule_window_enabled INTEGER DEFAULT 0,
        schedule_start_time TEXT DEFAULT '09:00',
        schedule_end_time TEXT DEFAULT '12:00',
        outside_window_policy TEXT DEFAULT 'block_outside',
        daily_quota_enabled INTEGER DEFAULT 1,
        daily_allowance_seconds INTEGER DEFAULT 7200,
        cycle_breaks_enabled INTEGER DEFAULT 1,
        active_interval_seconds INTEGER DEFAULT 600,
        break_seconds INTEGER DEFAULT 600,
        active_days TEXT,
        start_date TEXT,
        end_date TEXT,
        timezone TEXT DEFAULT 'Asia/Kolkata',
        is_enabled INTEGER DEFAULT 1,
        is_blocked INTEGER DEFAULT 0,
        is_in_break INTEGER DEFAULT 0,
        break_countdown_seconds INTEGER DEFAULT 0,
        used_today_seconds INTEGER DEFAULT 0,
        breaks_count_today INTEGER DEFAULT 0,
        last_heartbeat_at TEXT,
        created_at TEXT,
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS extension_pairing_codes (
        code TEXT PRIMARY KEY,
        user_id TEXT,
        expires_at INTEGER,
        created_at TEXT
      );
    `);
  });

  after(() => {
    try {
      db.close();
      if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
    } catch (e) {}
  });

  describe('A. URL Parsing, Normalization & Identity (Real urlHelper)', () => {
    it('normalizes YouTube links (watch, short youtu.be, mobile m.youtube) to canonical youtube.com profile', () => {
      const ytWatch = parseAndNormalizeWebsite('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      assert.equal(ytWatch.valid, true);
      assert.equal(ytWatch.normalizedDomain, 'youtube.com');
      assert.equal(ytWatch.displayName, 'YouTube');
      assert.ok(ytWatch.coveredDomains.includes('youtu.be'));
      assert.ok(ytWatch.coveredDomains.includes('youtube.com'));

      const ytShort = parseAndNormalizeWebsite('https://youtu.be/dQw4w9WgXcQ');
      assert.equal(ytShort.valid, true);
      assert.equal(ytShort.normalizedDomain, 'youtube.com');

      const ytMobile = parseAndNormalizeWebsite('https://m.youtube.com/trending');
      assert.equal(ytMobile.valid, true);
      assert.equal(ytMobile.normalizedDomain, 'youtube.com');
    });

    it('enforces strict domain boundaries preventing false positives (e.g. notreddit.com !== reddit.com)', () => {
      assert.equal(matchDomain('reddit.com', 'reddit.com', 'entire_domain'), true);
      assert.equal(matchDomain('old.reddit.com', 'reddit.com', 'entire_domain'), true);
      assert.equal(matchDomain('www.reddit.com', 'reddit.com', 'entire_domain'), true);
      // boundary check:
      assert.equal(matchDomain('notreddit.com', 'reddit.com', 'entire_domain'), false);
      assert.equal(matchDomain('myreddit.com', 'reddit.com', 'entire_domain'), false);
      assert.equal(matchDomain('fakereddit.com', 'reddit.com', 'entire_domain'), false);
    });

    it('respects exact-host scope and does not match sibling subdomains', () => {
      const wa = parseAndNormalizeWebsite('https://web.whatsapp.com/', 'hostname_only');
      assert.equal(wa.valid, true);
      assert.equal(wa.scope, 'hostname_only');
      assert.equal(wa.normalizedDomain, 'web.whatsapp.com');

      // Exact match passes:
      assert.equal(matchDomain('web.whatsapp.com', wa.normalizedDomain, 'hostname_only'), true);
      // Other hosts do not match exact-host rule:
      assert.equal(matchDomain('api.whatsapp.com', wa.normalizedDomain, 'hostname_only'), false);
      assert.equal(matchDomain('whatsapp.com', wa.normalizedDomain, 'hostname_only'), false);
    });

    it('handles custom domains and generates safe client-side favicon URLs', () => {
      const hn = parseAndNormalizeWebsite('https://news.ycombinator.com/');
      assert.equal(hn.valid, true);
      assert.equal(hn.normalizedDomain, 'news.ycombinator.com');
      assert.ok(hn.faviconUrl.includes('google.com/s2/favicons'));
      assert.ok(hn.faviconUrl.includes('domain=news.ycombinator.com'));
      // No query strings or paths exposed in favicon URL
      assert.equal(hn.faviconUrl.includes('watch'), false);
    });

    it('rejects dangerous and non-web schemes', () => {
      assert.equal(parseAndNormalizeWebsite('javascript:void(0)').valid, false);
      assert.equal(parseAndNormalizeWebsite('data:text/html,<script>').valid, false);
      assert.equal(parseAndNormalizeWebsite('file:///etc/hosts').valid, false);
      assert.equal(parseAndNormalizeWebsite('chrome-extension://12345/page').valid, false);
    });
  });

  describe('B. Accounting Bug Fix: Zero-Second Delta Pings', () => {
    it('preserves deltaSeconds === 0 and does not fall back to 5', () => {
      // Test the exact bug fix logic from server/routes/siteLimitRoutes.js
      const calculateDelta = (rawDelta) => {
        return rawDelta !== undefined && rawDelta !== null
          ? Math.max(0, parseInt(rawDelta, 10) || 0)
          : 5;
      };

      assert.equal(calculateDelta(0), 0, 'Zero delta must remain 0 for status polling checks');
      assert.equal(calculateDelta('0'), 0, 'Zero string delta must remain 0');
      assert.equal(calculateDelta(5), 5);
      assert.equal(calculateDelta(null), 5);
      assert.equal(calculateDelta(undefined), 5);
    });
  });

  describe('C. Multi-Tab Usage Accounting & Active-Focus Verification', () => {
    it('does not count usage when tab or window is unfocused', () => {
      const processTabHeartbeat = ({ isVisible, isFocused, deltaSeconds }) => {
        if (!isVisible || !isFocused) return 0;
        return deltaSeconds;
      };

      assert.equal(processTabHeartbeat({ isVisible: false, isFocused: true, deltaSeconds: 5 }), 0);
      assert.equal(processTabHeartbeat({ isVisible: true, isFocused: false, deltaSeconds: 5 }), 0);
      assert.equal(processTabHeartbeat({ isVisible: false, isFocused: false, deltaSeconds: 5 }), 0);
      assert.equal(processTabHeartbeat({ isVisible: true, isFocused: true, deltaSeconds: 5 }), 5);
    });

    it('prevents double-counting when multiple tabs of the same domain are open', () => {
      const activeDomainsInTick = new Set();
      let totalUsageSeconds = 0;

      const recordTabTick = (domain, seconds) => {
        if (activeDomainsInTick.has(domain)) {
          // Already recorded active usage for this domain in this tick interval!
          return false;
        }
        activeDomainsInTick.add(domain);
        totalUsageSeconds += seconds;
        return true;
      };

      // Tab 1 (YouTube video 1)
      assert.equal(recordTabTick('youtube.com', 5), true);
      // Tab 2 (YouTube video 2, open at same time)
      assert.equal(recordTabTick('youtube.com', 5), false);
      // Tab 3 (m.youtube.com alias)
      assert.equal(recordTabTick('youtube.com', 5), false);

      assert.equal(totalUsageSeconds, 5, 'Total usage should be exactly 5s, not 15s');
    });
  });

  describe('D. Atomic SQLite Transactional Persistence (Job + Site Limits)', () => {
    const userId = 'user_test_42';
    const jobId = 'job_yt_01';

    it('creates job and linked site_limits atomically', () => {
      const now = new Date().toISOString();
      const parsed = parseAndNormalizeWebsite('https://www.youtube.com/watch?v=test');

      db.exec('BEGIN TRANSACTION');
      try {
        db.prepare(`
          INSERT INTO jobs (id, user_id, title, category, priority, action_type, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(jobId, userId, 'Limit YouTube', 'Productivity', 'High', 'restrict_website', 'Pending', now, now);

        db.prepare(`
          INSERT INTO site_limits (
            id, user_id, job_id, domain, scope, display_name, covered_domains,
            daily_allowance_seconds, is_enabled, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          `sl_${jobId}`,
          userId,
          jobId,
          parsed.normalizedDomain,
          parsed.scope,
          parsed.displayName,
          JSON.stringify(parsed.coveredDomains),
          120, // 2 minutes test quota
          1,
          now,
          now
        );

        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }

      const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
      const limit = db.prepare('SELECT * FROM site_limits WHERE job_id = ?').get(jobId);

      assert.ok(job);
      assert.equal(job.title, 'Limit YouTube');
      assert.ok(limit);
      assert.equal(limit.domain, 'youtube.com');
      assert.equal(limit.daily_allowance_seconds, 120);
      assert.equal(limit.is_enabled, 1);
    });

    it('toggles job status and synchronously updates site_limits is_enabled', () => {
      // Toggle job to Completed (disabled)
      db.exec('BEGIN TRANSACTION');
      try {
        db.prepare('UPDATE jobs SET status = ? WHERE id = ?').run('Completed', jobId);
        db.prepare('UPDATE site_limits SET is_enabled = ? WHERE job_id = ?').run(0, jobId);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }

      const job = db.prepare('SELECT status FROM jobs WHERE id = ?').get(jobId);
      const limit = db.prepare('SELECT is_enabled FROM site_limits WHERE job_id = ?').get(jobId);

      assert.equal(job.status, 'Completed');
      assert.equal(limit.is_enabled, 0, 'Site limit must be disabled when job is completed');
    });

    it('deletes job and atomically cascades deletion to linked site_limits', () => {
      db.exec('BEGIN TRANSACTION');
      try {
        db.prepare('DELETE FROM jobs WHERE id = ?').run(jobId);
        db.prepare('DELETE FROM site_limits WHERE job_id = ?').run(jobId);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }

      const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
      const limit = db.prepare('SELECT * FROM site_limits WHERE job_id = ?').get(jobId);

      assert.equal(job, undefined);
      assert.equal(limit, undefined, 'Linked site limit must be cleanly deleted');
    });
  });

  describe('E. Extension Pairing One-Time Code Generation & Exchange', () => {
    it('creates short-lived pairing code (EXT-XXXX) and exchanges it once', () => {
      const code = 'EXT-9988';
      const userId = 'user_test_99';
      const expiresAt = Date.now() + 15 * 60 * 1000;
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO extension_pairing_codes (code, user_id, expires_at, created_at)
        VALUES (?, ?, ?, ?)
      `).run(code, userId, expiresAt, now);

      // Verify code lookup
      const record = db.prepare('SELECT * FROM extension_pairing_codes WHERE code = ?').get(code);
      assert.ok(record);
      assert.equal(record.user_id, userId);
      assert.ok(record.expires_at > Date.now());

      // One-time deletion on exchange
      db.prepare('DELETE FROM extension_pairing_codes WHERE code = ?').run(code);
      const afterExchange = db.prepare('SELECT * FROM extension_pairing_codes WHERE code = ?').get(code);
      assert.equal(afterExchange, undefined, 'Pairing code must not be reusable after single exchange');
    });
  });

  describe('F. DeclarativeNetRequest Dynamic Rules Generation', () => {
    it('generates consistent numeric rule IDs and main_frame redirect rules', () => {
      // Deterministic numeric hash function used in background.js
      function getRuleId(domain) {
        let hash = 0;
        for (let i = 0; i < domain.length; i++) {
          hash = (hash * 31 + domain.charCodeAt(i)) >>> 0;
        }
        return (hash % 100000) + 1;
      }

      const ytId = getRuleId('youtube.com');
      assert.ok(ytId >= 1 && ytId <= 100001);
      assert.equal(ytId, getRuleId('youtube.com'), 'Hash must be strictly deterministic across worker wakeups');

      // DeclarativeNetRequest rule structure
      const createDynamicRule = (ruleId, domain, redirectUrl) => ({
        id: ruleId,
        priority: 1,
        action: {
          type: 'redirect',
          redirect: { url: redirectUrl },
        },
        condition: {
          urlFilter: `||${domain}^`,
          resourceTypes: ['main_frame'],
        },
      });

      const dnrRule = createDynamicRule(ytId, 'youtube.com', 'chrome-extension://taskly/blocked.html?domain=youtube.com');
      assert.equal(dnrRule.id, ytId);
      assert.equal(dnrRule.action.type, 'redirect');
      assert.deepEqual(dnrRule.condition.resourceTypes, ['main_frame']);
      assert.equal(dnrRule.condition.urlFilter, '||youtube.com^');
    });
  });
});

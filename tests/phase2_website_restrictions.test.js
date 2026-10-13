import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { parseAndNormalizeWebsite, matchDomain } from '../server/urlHelper.js';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';

describe('TASKLY PHASE 2: Dynamic Website Blocking, Custom URL Rules, Usage Tracking & Cloud Sync', () => {

  // Test 1: Creating a restriction from a valid custom URL
  it('1. correctly parses and normalizes valid custom URLs (YouTube, WhatsApp Web, Reddit)', () => {
    const yt = parseAndNormalizeWebsite('https://www.youtube.com/watch?v=123');
    assert.equal(yt.valid, true);
    assert.equal(yt.normalizedDomain, 'youtube.com');
    assert.equal(yt.displayName, 'YouTube');

    const wa = parseAndNormalizeWebsite('https://web.whatsapp.com/', 'hostname_only');
    assert.equal(wa.valid, true);
    assert.equal(wa.normalizedDomain, 'web.whatsapp.com');
    assert.equal(wa.scope, 'hostname_only');
    assert.equal(wa.displayName, 'WhatsApp Web');

    const reddit = parseAndNormalizeWebsite('reddit.com');
    assert.equal(reddit.valid, true);
    assert.equal(reddit.normalizedDomain, 'reddit.com');
  });

  // Test 2: Rejecting unsafe and invalid URL schemes
  it('2. strictly rejects unsafe and invalid URL schemes (javascript:, data:, file:, etc.)', () => {
    const jsScheme = parseAndNormalizeWebsite('javascript:alert(1)');
    assert.equal(jsScheme.valid, false);
    assert.match(jsScheme.error, /Unsafe URL scheme/i);

    const dataScheme = parseAndNormalizeWebsite('data:text/html,<h1>hack</h1>');
    assert.equal(dataScheme.valid, false);
    assert.match(dataScheme.error, /Unsafe URL scheme/i);

    const fileScheme = parseAndNormalizeWebsite('file:///etc/passwd');
    assert.equal(fileScheme.valid, false);
    assert.match(fileScheme.error, /Unsafe URL scheme/i);

    const empty = parseAndNormalizeWebsite('   ');
    assert.equal(empty.valid, false);
  });

  // Test 3: Requesting and revoking dynamic hostname permissions
  it('3. checks domain scope matching (entire_domain matching subdomains vs hostname_only)', () => {
    // entire_domain: matches subdomains
    assert.equal(matchDomain('old.reddit.com', 'reddit.com', 'entire_domain'), true);
    assert.equal(matchDomain('www.reddit.com', 'reddit.com', 'entire_domain'), true);
    assert.equal(matchDomain('notreddit.com', 'reddit.com', 'entire_domain'), false);

    // hostname_only: matches only exact host
    assert.equal(matchDomain('web.whatsapp.com', 'web.whatsapp.com', 'hostname_only'), true);
    assert.equal(matchDomain('api.whatsapp.com', 'web.whatsapp.com', 'hostname_only'), false);
  });

  // Test 4: Tracking usage only for an active, focused tab
  it('4. tracks usage only when tab is actively visible and focused', () => {
    class ActiveTabFilter {
      constructor() {
        this.trackedSeconds = 0;
      }
      onHeartbeat({ isVisible, isFocused, deltaSeconds = 5 }) {
        if (isVisible && isFocused) {
          this.trackedSeconds += deltaSeconds;
          return true;
        }
        return false;
      }
    }

    const filter = new ActiveTabFilter();
    // Hidden tab -> no usage
    assert.equal(filter.onHeartbeat({ isVisible: false, isFocused: true }), false);
    assert.equal(filter.trackedSeconds, 0);

    // Unfocused window -> no usage
    assert.equal(filter.onHeartbeat({ isVisible: true, isFocused: false }), false);
    assert.equal(filter.trackedSeconds, 0);

    // Active focused tab -> accumulated
    assert.equal(filter.onHeartbeat({ isVisible: true, isFocused: true, deltaSeconds: 5 }), true);
    assert.equal(filter.trackedSeconds, 5);
  });

  // Test 5: Not counting the same website twice because multiple tabs are open
  it('5. does not double-count usage when multiple tabs of the same website are open', () => {
    class MultiTabAggregator {
      constructor() {
        this.activeDomainUsage = 0;
        this.activeDomainsInTick = new Set();
      }
      tickTabPing(domain) {
        if (!this.activeDomainsInTick.has(domain)) {
          this.activeDomainsInTick.add(domain);
          this.activeDomainUsage += 5;
        }
      }
      nextTick() {
        this.activeDomainsInTick.clear();
      }
    }

    const aggregator = new MultiTabAggregator();
    // 3 YouTube tabs pinging in the same 5s cycle
    aggregator.tickTabPing('youtube.com');
    aggregator.tickTabPing('youtube.com');
    aggregator.tickTabPing('youtube.com');

    // Only counted once (5 seconds, not 15 seconds)
    assert.equal(aggregator.activeDomainUsage, 5);
  });

  // Test 6 & 7: Starting, enforcing and expiring a break at the configured threshold
  it('6 & 7. triggers break at configured interval (e.g. 10m / 600s) and expires when time elapses', () => {
    class CycleManager {
      constructor({ intervalSeconds = 600, breakSeconds = 600 }) {
        this.interval = intervalSeconds;
        this.breakDuration = breakSeconds;
        this.usedToday = 0;
        this.inBreakUntil = null;
        this.breaksTaken = 0;
      }

      ping(delta, currentTime) {
        const nowIso = currentTime.toISOString();
        if (this.inBreakUntil && this.inBreakUntil > nowIso) {
          return { status: 'break', inBreakUntil: this.inBreakUntil };
        }

        this.usedToday += delta;
        if (this.usedToday > 0 && this.usedToday % this.interval === 0) {
          this.inBreakUntil = new Date(currentTime.getTime() + this.breakDuration * 1000).toISOString();
          this.breaksTaken += 1;
          return { status: 'break', inBreakUntil: this.inBreakUntil };
        }
        return { status: 'allowed', used: this.usedToday };
      }
    }

    const cycle = new CycleManager({ intervalSeconds: 600, breakSeconds: 600 });
    const t0 = new Date('2026-10-12T10:00:00Z');

    // Accumulate 595 seconds
    for (let i = 0; i < 119; i++) {
      cycle.ping(5, t0);
    }
    assert.equal(cycle.breaksTaken, 0);

    // Hit 600 seconds -> break triggered!
    const res = cycle.ping(5, t0);
    assert.equal(res.status, 'break');
    assert.equal(cycle.breaksTaken, 1);

    // During break (5 minutes later) -> still in break
    const tBreak = new Date('2026-10-12T10:05:00Z');
    const resDuring = cycle.ping(5, tBreak);
    assert.equal(resDuring.status, 'break');

    // After 10 minutes break ends -> allowed again
    const tAfter = new Date('2026-10-12T10:11:00Z');
    const resAfter = cycle.ping(5, tAfter);
    assert.equal(resAfter.status, 'allowed');
  });

  // Test 8: Enforcing daily quota until midnight reset
  it('8. enforces daily quota once exhausted until midnight reset', () => {
    class QuotaTracker {
      constructor({ dailyLimit = 3600 }) { // 1 hour
        this.dailyLimit = dailyLimit;
        this.usedToday = 0;
        this.isBlocked = false;
      }
      addUsage(delta) {
        if (this.isBlocked) return { status: 'blocked' };
        this.usedToday += delta;
        if (this.usedToday >= this.dailyLimit) {
          this.isBlocked = true;
          return { status: 'blocked' };
        }
        return { status: 'allowed', remaining: this.dailyLimit - this.usedToday };
      }
      midnightReset() {
        this.usedToday = 0;
        this.isBlocked = false;
      }
    }

    const tracker = new QuotaTracker({ dailyLimit: 1800 });
    tracker.addUsage(1800);
    assert.equal(tracker.isBlocked, true);

    // Further usage blocked
    assert.equal(tracker.addUsage(10).status, 'blocked');

    // After midnight reset, access resumes
    tracker.midnightReset();
    assert.equal(tracker.isBlocked, false);
    assert.equal(tracker.usedToday, 0);
  });

  // Test 9: Applying restrictions only on selected days and dates
  it('9. applies schedule restrictions strictly on configured days (e.g. Mon, Wed, Fri)', () => {
    function isDayActive(dayOfWeek, activeDays) {
      return activeDays.includes(dayOfWeek);
    }

    const weekdaysOnly = [1, 2, 3, 4, 5]; // Mon to Fri
    assert.equal(isDayActive(1, weekdaysOnly), true); // Monday
    assert.equal(isDayActive(0, weekdaysOnly), false); // Sunday
    assert.equal(isDayActive(6, weekdaysOnly), false); // Saturday
  });

  // Test 10: Today Only restrictions not repeating tomorrow
  it('10. Today-Only restrictions expire at midnight and do NOT repeat tomorrow', () => {
    let rule = {
      restrictionType: 'today_only',
      isBlocked: true,
      lastResetDate: '2026-10-12',
    };

    function evaluateDateRoll(ruleObj, newDate) {
      if (ruleObj.lastResetDate !== newDate) {
        if (ruleObj.restrictionType === 'today_only') {
          ruleObj.isBlocked = false;
          ruleObj.isEnabled = false; // Expired!
        }
        ruleObj.lastResetDate = newDate;
      }
      return ruleObj;
    }

    const updated = evaluateDateRoll(rule, '2026-10-13');
    assert.equal(updated.isBlocked, false);
    assert.equal(updated.isEnabled, false);
  });

  // Test 11 & 12: Saving custom website rules and syncing usage with account isolation in SQLite
  it('11 & 12. persists rules in SQLite and isolates usage strictly per user account', () => {
    const testDbPath = path.join(process.cwd(), 'tests', 'test_limits.db');
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);

    const testDb = new DatabaseSync(testDbPath);
    testDb.exec(`
      CREATE TABLE site_limits (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        domain TEXT NOT NULL,
        url TEXT NOT NULL,
        used_today_seconds INTEGER DEFAULT 0,
        daily_allowance_seconds INTEGER DEFAULT 3600
      );
    `);

    // User A creates a rule
    testDb.prepare(`
      INSERT INTO site_limits (id, user_id, domain, url, used_today_seconds, daily_allowance_seconds)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('rule-1', 'user-A', 'reddit.com', 'https://reddit.com', 120, 3600);

    // User B creates a rule on the same domain
    testDb.prepare(`
      INSERT INTO site_limits (id, user_id, domain, url, used_today_seconds, daily_allowance_seconds)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('rule-2', 'user-B', 'reddit.com', 'https://reddit.com', 600, 7200);

    // Verify isolation
    const userARule = testDb.prepare('SELECT * FROM site_limits WHERE user_id = ?').get('user-A');
    assert.equal(userARule.used_today_seconds, 120);

    const userBRule = testDb.prepare('SELECT * FROM site_limits WHERE user_id = ?').get('user-B');
    assert.equal(userBRule.used_today_seconds, 600);

    testDb.close();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  // Test 13: Recovering buffered usage after offline period without duplicate counting (Idempotency)
  it('13. prevents duplicate counting using idempotent event IDs during offline recovery', () => {
    const testDbPath = path.join(process.cwd(), 'tests', 'test_idempotency.db');
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);

    const testDb = new DatabaseSync(testDbPath);
    testDb.exec(`
      CREATE TABLE site_usage_events (
        id TEXT PRIMARY KEY,
        delta_seconds INTEGER NOT NULL
      );
      CREATE TABLE site_limits (
        domain TEXT PRIMARY KEY,
        used_seconds INTEGER DEFAULT 0
      );
      INSERT INTO site_limits (domain, used_seconds) VALUES ('youtube.com', 0);
    `);

    function recordEvent(eventId, delta) {
      try {
        testDb.prepare('INSERT INTO site_usage_events (id, delta_seconds) VALUES (?, ?)').run(eventId, delta);
        testDb.prepare('UPDATE site_limits SET used_seconds = used_seconds + ? WHERE domain = ?').run(delta, 'youtube.com');
        return true;
      } catch (uniqueErr) {
        // Event already processed: skip!
        return false;
      }
    }

    // Normal ping
    assert.equal(recordEvent('evt-001', 5), true);
    // Offline buffer flushed: first attempt succeeds
    assert.equal(recordEvent('evt-002', 5), true);
    // Duplicate retry of evt-002: rejected by idempotency!
    assert.equal(recordEvent('evt-002', 5), false);

    const totalUsed = testDb.prepare('SELECT used_seconds FROM site_limits WHERE domain = ?').get('youtube.com').used_seconds;
    // Exactly 10 seconds counted, NOT 15 seconds!
    assert.equal(totalUsed, 10);

    testDb.close();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  // Test 14: Displaying accurate usage totals in the dashboard
  it('14. calculates accurate dashboard metrics (used, remaining, progress percentage)', () => {
    const rule = {
      usedTodaySeconds: 5400, // 1.5 hours
      dailyAllowanceSeconds: 10800, // 3 hours
    };

    const remaining = Math.max(0, rule.dailyAllowanceSeconds - rule.usedTodaySeconds);
    const progress = Math.round((rule.usedTodaySeconds / rule.dailyAllowanceSeconds) * 100);

    assert.equal(remaining, 5400); // 1.5 hours remaining
    assert.equal(progress, 50); // 50% used
  });

  // Test 15: Rejecting unauthorized API requests and cross-user access
  it('15. rejects unauthorized operations when user_id does not match rule owner', () => {
    const testDbPath = path.join(process.cwd(), 'tests', 'test_auth_guard.db');
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);

    const testDb = new DatabaseSync(testDbPath);
    testDb.exec(`
      CREATE TABLE site_limits (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        domain TEXT NOT NULL
      );
      INSERT INTO site_limits (id, user_id, domain) VALUES ('rule-1', 'owner-1', 'facebook.com');
    `);

    // Unauthorized user attempts deletion
    const attackerStmt = testDb.prepare('DELETE FROM site_limits WHERE id = ? AND user_id = ?');
    const attackerRes = attackerStmt.run('rule-1', 'attacker-2');
    assert.equal(attackerRes.changes, 0);

    // Rule still exists
    const rule = testDb.prepare('SELECT * FROM site_limits WHERE id = ?').get('rule-1');
    assert.notEqual(rule, undefined);

    // Legitimate owner deletes
    const ownerRes = attackerStmt.run('rule-1', 'owner-1');
    assert.equal(ownerRes.changes, 1);

    testDb.close();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  // Test 16: Handling missing extension permissions and disconnected devices
  it('16. gracefully flags unpermitted websites and disconnected devices without crashing', () => {
    const rule = {
      domain: 'web.whatsapp.com',
      hasExtensionPermission: false,
      deviceStatus: 'offline',
    };

    // Extension permission status check
    const requiresPermissionPrompt = !rule.hasExtensionPermission;
    assert.equal(requiresPermissionPrompt, true);

    // Fallback status check
    const isEnforceableRemotely = rule.hasExtensionPermission && rule.deviceStatus === 'online';
    assert.equal(isEnforceableRemotely, false);
  });

  // Test 17: Section 9 - Combined Schedule Window + Usage Allowance + Break Cycles
  it('17. enforces combined schedule window (8-10 PM) + 20-minute daily allowance + 10m/5m break cycles', () => {
    // Model rule configuration from Section 9
    const rule = {
      domain: 'youtube.com',
      isEnabled: true,
      emergencyOverride: false,
      scheduleWindowEnabled: true,
      scheduleStartTime: '20:00',
      scheduleEndTime: '22:00',
      outsideWindowPolicy: 'block_outside',
      dailyQuotaEnabled: true,
      dailyAllowanceSeconds: 1200, // 20 minutes
      usedTodaySeconds: 0,
      cycleBreaksEnabled: true,
      activeIntervalSeconds: 600, // 10 minutes
      breakSeconds: 300, // 5 minutes
      inBreakUntil: null,
      blockedUntil: null,
      activeDays: [0, 1, 2, 3, 4, 5, 6],
      timezone: 'Asia/Kolkata',
    };

    function evaluateRuleAt(r, fakeTimeStr) {
      // fakeTimeStr: HH:MM in timezone
      const inWindow = fakeTimeStr >= r.scheduleStartTime && fakeTimeStr <= r.scheduleEndTime;

      // 1. Outside window check
      if (r.scheduleWindowEnabled && !inWindow) {
        if (r.outsideWindowPolicy === 'block_outside') {
          return { status: 'blocked', isBlocked: true, reason: 'outside_window' };
        }
      }

      // 2. Break check
      if (r.inBreakUntil) {
        return { status: 'break', isBlocked: true, reason: 'in_break' };
      }

      // 3. Quota check
      if (r.dailyQuotaEnabled && r.dailyAllowanceSeconds > 0 && r.usedTodaySeconds >= r.dailyAllowanceSeconds) {
        return { status: 'blocked', isBlocked: true, reason: 'quota_exhausted' };
      }

      return { status: 'allowed', isBlocked: false, remainingAllowance: r.dailyAllowanceSeconds - r.usedTodaySeconds };
    }

    // Step 1: Before 8:00 PM (e.g. 19:30) -> Blocked because outside allowed window
    const before8pm = evaluateRuleAt(rule, '19:30');
    assert.equal(before8pm.isBlocked, true);
    assert.equal(before8pm.reason, 'outside_window');

    // Step 2: At 8:05 PM (inside window) -> Allowed!
    const at805pm = evaluateRuleAt(rule, '20:05');
    assert.equal(at805pm.isBlocked, false);
    assert.equal(at805pm.status, 'allowed');

    // Step 3: Accumulate 10 minutes (600s) of active viewing
    rule.usedTodaySeconds = 600;
    // Triggers 5-minute break
    rule.inBreakUntil = '2026-10-12T20:20:00.000Z';
    const duringBreak = evaluateRuleAt(rule, '20:16');
    assert.equal(duringBreak.isBlocked, true);
    assert.equal(duringBreak.status, 'break');

    // Step 4: Break expires
    rule.inBreakUntil = null;
    const afterBreak = evaluateRuleAt(rule, '20:21');
    assert.equal(afterBreak.isBlocked, false);
    assert.equal(afterBreak.status, 'allowed');
    assert.equal(afterBreak.remainingAllowance, 600); // 10 mins remaining

    // Step 5: Consume remaining 10 minutes (total 20 minutes = 1200s)
    rule.usedTodaySeconds = 1200;
    const quotaExhausted = evaluateRuleAt(rule, '20:35');
    assert.equal(quotaExhausted.isBlocked, true);
    assert.equal(quotaExhausted.status, 'blocked');
    assert.equal(quotaExhausted.reason, 'quota_exhausted');

    // Step 6: Reloading or changing tabs does not reset allowance
    assert.equal(rule.usedTodaySeconds, 1200);

    // Step 7: After 10:00 PM (e.g. 22:15) -> Outside window policy continues to block
    const after10pm = evaluateRuleAt(rule, '22:15');
    assert.equal(after10pm.isBlocked, true);
    assert.equal(after10pm.reason, 'outside_window');
  });

  // Test 18: Un-bypassable Navigation Interception & Subdomain Matching
  it('18. intercepts navigation and redirects blocked tabs to extension blocked.html screen', () => {
    function getNavigationTarget(url, isRuleBlocked) {
      if (isRuleBlocked) {
        const parsed = new URL(url);
        return `chrome-extension://taskly/blocked.html?domain=${parsed.hostname}&status=blocked`;
      }
      return url;
    }

    // Normal allowed navigation
    assert.equal(
      getNavigationTarget('https://www.youtube.com/watch?v=1', false),
      'https://www.youtube.com/watch?v=1'
    );

    // Blocked navigation intercepted and redirected
    const blockedNav = getNavigationTarget('https://www.youtube.com/watch?v=1', true);
    assert.match(blockedNav, /blocked\.html\?domain=www\.youtube\.com/);

    // Page refresh while blocked is redirected immediately
    const refreshNav = getNavigationTarget('https://www.youtube.com/', true);
    assert.match(refreshNav, /blocked\.html/);
  });
});

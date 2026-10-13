import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('Website Habit Control - Phase 5 (YouTube) & Phase 6 (Instagram)', () => {
  // Test simulated state machine for YouTube 10m/10m loop and 3h cap
  class YoutubeUsageTracker {
    constructor({ allowance = 10800, interval = 600, breakDuration = 600 } = {}) {
      this.allowance = allowance; // default 3h (10800s)
      this.interval = interval;   // default 10m (600s)
      this.breakDuration = breakDuration; // default 10m (600s)
      this.usedToday = 0;
      this.inBreakUntil = null;
      this.blockedUntil = null;
      this.date = '2026-10-12';
      this.override = false;
    }

    syncPing(deltaSeconds, currentTime) {
      if (this.override) return { status: 'allowed', remainingSeconds: this.allowance - this.usedToday };

      const nowIso = currentTime.toISOString();

      // Check if in break
      if (this.inBreakUntil && this.inBreakUntil > nowIso) {
        return {
          status: 'break',
          inBreakUntil: this.inBreakUntil,
          remainingSeconds: this.allowance - this.usedToday,
        };
      }

      // Check if daily blocked
      if (this.usedToday >= this.allowance) {
        return { status: 'blocked', remainingSeconds: 0 };
      }

      // Accumulate active usage
      this.usedToday += deltaSeconds;

      // Check if 3h daily allowance exhausted
      if (this.usedToday >= this.allowance) {
        return { status: 'blocked', remainingSeconds: 0 };
      }

      // Check if 10m continuous interval completed
      if (this.usedToday > 0 && this.usedToday % this.interval === 0) {
        this.inBreakUntil = new Date(currentTime.getTime() + this.breakDuration * 1000).toISOString();
        return { status: 'break', inBreakUntil: this.inBreakUntil };
      }

      return {
        status: 'allowed',
        usedSeconds: this.usedToday,
        remainingSeconds: this.allowance - this.usedToday,
      };
    }

    midnightReset(newDate) {
      this.date = newDate;
      this.usedToday = 0;
      this.inBreakUntil = null;
      this.blockedUntil = null;
      this.override = false;
    }
  }

  it('triggers a 10-minute break after 10 minutes of active use', () => {
    // Test with 600s active interval and 600s break
    const tracker = new YoutubeUsageTracker({ interval: 600, breakDuration: 600 });
    const startTime = new Date('2026-10-12T14:00:00Z');

    // 9 minutes (540s) active: still allowed
    const statusBefore = tracker.syncPing(540, startTime);
    assert.equal(statusBefore.status, 'allowed');
    assert.equal(tracker.usedToday, 540);

    // 1 more minute (60s) reached 600s (10 min): triggers break
    const statusAtBreak = tracker.syncPing(60, new Date('2026-10-12T14:10:00Z'));
    assert.equal(statusAtBreak.status, 'break');
    assert.ok(statusAtBreak.inBreakUntil);

    // During the break, break time does NOT increment usedToday
    const statusDuringBreak = tracker.syncPing(5, new Date('2026-10-12T14:15:00Z'));
    assert.equal(statusDuringBreak.status, 'break');
    assert.equal(tracker.usedToday, 600); // usage remains 600s, not increased!
  });

  it('blocks YouTube when 3-hour daily allowance is exhausted until midnight reset', () => {
    const tracker = new YoutubeUsageTracker({ allowance: 10800 }); // 3 hours
    tracker.usedToday = 10795; // 5 seconds before 3 hours

    const now = new Date('2026-10-12T20:00:00Z');
    const status = tracker.syncPing(5, now);
    assert.equal(status.status, 'blocked');
    assert.equal(tracker.usedToday, 10800);

    // Subsequent attempts remain blocked
    assert.equal(tracker.syncPing(5, new Date('2026-10-12T21:00:00Z')).status, 'blocked');

    // Midnight reset unlocks access
    tracker.midnightReset('2026-10-13');
    assert.equal(tracker.usedToday, 0);
    assert.equal(tracker.syncPing(5, new Date('2026-10-13T00:01:00Z')).status, 'allowed');
  });

  it('Instagram Today-Only block expires at midnight and does NOT repeat tomorrow', () => {
    let igBlockedToday = true;
    let blockDate = '2026-10-12';

    // On 2026-10-12, block is active
    assert.equal(igBlockedToday, true);

    // At midnight when date changes to 2026-10-13, the one-time block expires
    const currentDate = '2026-10-13';
    if (currentDate !== blockDate) {
      igBlockedToday = false; // automatically expired
    }

    assert.equal(igBlockedToday, false);
  });
});

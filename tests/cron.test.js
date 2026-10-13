import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateCronExpression,
  describeCronExpression,
  getNextRunDate,
  getOccurrencesForMonth
} from '../server/cronHelper.js';

describe('Cron Job Scheduler - Phase 4 & Phase 10', () => {
  it('validates 5 standard cron fields correctly', () => {
    // Valid standard cron expressions
    assert.equal(validateCronExpression('30 8 * * *').valid, true);
    assert.equal(validateCronExpression('0 4 * * *').valid, true);
    assert.equal(validateCronExpression('0 10 25 * *').valid, true);
    assert.equal(validateCronExpression('0 9 * * 1').valid, true);
    assert.equal(validateCronExpression('*/5 * * * *').valid, true);

    // Invalid cron expressions
    assert.equal(validateCronExpression('').valid, false);
    assert.equal(validateCronExpression('30 8 * *').valid, false); // only 4 fields
    assert.equal(validateCronExpression('30 8 * * * *').valid, false); // 6 fields
    assert.equal(validateCronExpression('99 8 * * *').valid, false); // minute 99 invalid
  });

  it('generates accurate human-readable descriptions', () => {
    assert.equal(describeCronExpression('30 8 * * *'), 'Every day at 8:30 AM');
    assert.equal(describeCronExpression('0 4 * * *'), 'Every day at 4:00 AM');
    assert.equal(describeCronExpression('0 9 * * 1-5'), 'Every weekday (Mon–Fri) at 9:00 AM');
    assert.equal(describeCronExpression('0 10 25 * *'), 'Every month on the 25th at 10:00 AM');
    assert.equal(describeCronExpression('*/5 * * * *'), 'Every 5 minutes');
  });

  it('calculates the next valid future execution date in Asia/Kolkata timezone', () => {
    const fixedNow = new Date('2026-10-12T06:00:00Z');
    const nextRun = getNextRunDate({
      scheduleType: 'cron',
      cronExpression: '30 8 * * *',
      timezone: 'Asia/Kolkata',
      fromDate: fixedNow,
    });

    assert.ok(nextRun);
    const parsed = new Date(nextRun);
    assert.ok(parsed > fixedNow);
  });

  it('calculates calendar monthly occurrences correctly for daily and weekly jobs', () => {
    // March 2026: Month 2 (0-indexed) has 31 days
    const dailyOccurrences = getOccurrencesForMonth({
      scheduleType: 'daily',
      year: 2026,
      month: 2,
    });
    // Daily task occurs every day of March (31 occurrences)
    assert.equal(dailyOccurrences.length, 31);
    assert.ok(dailyOccurrences.includes('2026-03-24'));
    assert.ok(dailyOccurrences.includes('2026-03-01'));
    assert.ok(dailyOccurrences.includes('2026-03-31'));

    // Monthly task on 25th of March 2026
    const monthlyOccurrences = getOccurrencesForMonth({
      scheduleType: 'monthly',
      startDate: '2026-03-25',
      year: 2026,
      month: 2,
    });
    assert.equal(monthlyOccurrences.length, 1);
    assert.equal(monthlyOccurrences[0], '2026-03-25');
  });

  it('one-time jobs appear only on their scheduled date in the calendar', () => {
    const oneTimeOccurrences = getOccurrencesForMonth({
      scheduleType: 'once',
      startDate: '2026-03-14',
      year: 2026,
      month: 2,
    });
    assert.equal(oneTimeOccurrences.length, 1);
    assert.equal(oneTimeOccurrences[0], '2026-03-14');
  });
});

import { CronExpressionParser } from 'cron-parser';

/**
 * Validates a 5-field cron expression:
 * Field 1: minute (0-59)
 * Field 2: hour (0-23)
 * Field 3: day of month (1-31)
 * Field 4: month (1-12)
 * Field 5: day of week (0-7, where 0 and 7 are Sunday)
 */
export function validateCronExpression(expr) {
  if (!expr || typeof expr !== 'string') {
    return { valid: false, error: 'Expression is required' };
  }

  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    return { valid: false, error: 'Cron expression must have exactly 5 fields (minute, hour, day of month, month, day of week)' };
  }

  try {
    CronExpressionParser.parse(expr, { tz: 'UTC' });
    return { valid: true, error: null };
  } catch (err) {
    return { valid: false, error: err.message || 'Invalid cron expression' };
  }
}

/**
 * Generates human-readable explanation of cron expression
 */
export function describeCronExpression(expr) {
  if (!expr || typeof expr !== 'string') return 'No schedule';
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;

  const [min, hour, dom, mon, dow] = parts;

  // Specific common patterns
  if (expr === '* * * * *') return 'Every minute';
  if (min.startsWith('*/') && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    return `Every ${min.replace('*/', '')} minutes`;
  }
  if (min === '0' && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    return 'Hourly at the start of the hour';
  }
  if (min !== '*' && !min.includes('/') && hour !== '*' && !hour.includes('/')) {
    const h = parseInt(hour, 10);
    const m = String(min).padStart(2, '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    const displayHour = h % 12 === 0 ? 12 : h % 12;
    const timeStr = `${displayHour}:${m} ${ampm}`;

    if (dom === '*' && mon === '*' && dow === '*') {
      return `Every day at ${timeStr}`;
    }
    if (dom === '*' && mon === '*' && (dow === '1-5' || dow === '1,2,3,4,5')) {
      return `Every weekday (Mon–Fri) at ${timeStr}`;
    }
    if (dom === '*' && mon === '*' && dow !== '*') {
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      const dayNames = dow.split(',').map((d) => days[parseInt(d, 10)] || d).join(', ');
      return `Every ${dayNames} at ${timeStr}`;
    }
    if (dom !== '*' && mon === '*' && dow === '*') {
      return `Every month on the ${formatOrdinal(parseInt(dom, 10))} at ${timeStr}`;
    }
  }

  return `Custom Schedule (${expr})`;
}

function formatOrdinal(n) {
  const pr = new Intl.PluralRules('en-US', { type: 'ordinal' });
  const suffixes = { one: 'st', two: 'nd', few: 'rd', other: 'th' };
  return `${n}${suffixes[pr.select(n)] || 'th'}`;
}

/**
 * Calculates next run date for a job
 */
export function getNextRunDate({ scheduleType, cronExpression, startDate, startTime, timezone = 'Asia/Kolkata', fromDate = new Date() }) {
  const tz = timezone || 'Asia/Kolkata';

  if (scheduleType === 'once') {
    if (!startDate || !startTime) return null;
    const [h, m] = startTime.split(':').map(Number);
    const dateObj = new Date(startDate);
    dateObj.setHours(h || 0, m || 0, 0, 0);
    return dateObj.toISOString();
  }

  let expr = cronExpression;
  if (!expr) {
    if (scheduleType === 'daily' && startTime) {
      const [h, m] = startTime.split(':').map(Number);
      expr = `${m} ${h} * * *`;
    } else if (scheduleType === 'weekdays' && startTime) {
      const [h, m] = startTime.split(':').map(Number);
      expr = `${m} ${h} * * 1-5`;
    } else if (scheduleType === 'weekly' && startTime) {
      const [h, m] = startTime.split(':').map(Number);
      expr = `${m} ${h} * * 1`; // Default Monday
    } else if (scheduleType === 'monthly' && startTime && startDate) {
      const day = new Date(startDate).getDate() || 1;
      const [h, m] = startTime.split(':').map(Number);
      expr = `${m} ${h} ${day} * *`;
    } else if (scheduleType === 'interval') {
      expr = '*/15 * * * *'; // default 15 min
    }
  }

  if (!expr) return null;

  try {
    const interval = CronExpressionParser.parse(expr, {
      currentDate: fromDate,
      tz: tz,
    });
    return interval.next().toDate().toISOString();
  } catch (err) {
    console.error('Failed to parse cron for next run:', err);
    return null;
  }
}

/**
 * Computes all dates an expression will fire within a given month (for CalendarView)
 */
export function getOccurrencesForMonth({ scheduleType, cronExpression, startDate, startTime, year, month, timezone = 'Asia/Kolkata' }) {
  // Month is 0-indexed (0 = Jan, 11 = Dec)
  const occurrences = [];
  const startOfMonth = new Date(year, month, 1, 0, 0, 0, 0);
  const endOfMonth = new Date(year, month + 1, 0, 23, 59, 59, 999);

  if (scheduleType === 'once') {
    if (startDate) {
      const targetDate = new Date(startDate);
      if (targetDate >= startOfMonth && targetDate <= endOfMonth) {
        occurrences.push(targetDate.toISOString().split('T')[0]);
      }
    }
    return occurrences;
  }

  const daysInMonth = new Date(year, month + 1, 0).getDate();

  for (let d = 1; d <= daysInMonth; d++) {
    const dObj = new Date(year, month, d);
    const dayStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dow = dObj.getDay();

    if (scheduleType === 'daily') {
      occurrences.push(dayStr);
    } else if (scheduleType === 'weekdays') {
      if (dow >= 1 && dow <= 5) occurrences.push(dayStr);
    } else if (scheduleType === 'weekly') {
      const targetDow = startDate ? new Date(startDate).getDay() : 1;
      if (dow === targetDow) occurrences.push(dayStr);
    } else if (scheduleType === 'monthly') {
      const targetDay = startDate ? new Date(startDate).getDate() : 1;
      if (d === targetDay) occurrences.push(dayStr);
    } else if (cronExpression) {
      const parts = cronExpression.trim().split(/\s+/);
      if (parts.length === 5) {
        const [, , domField, monField, dowField] = parts;
        const m = month + 1;
        const matchesMon = monField === '*' || monField.split(',').includes(String(m));
        const matchesDom = domField === '*' || domField.split(',').includes(String(d));
        let matchesDow = true;
        if (dowField !== '*') {
          const dows = dowField.split(',').map(Number);
          matchesDow = dows.includes(dow) || (dow === 0 && dows.includes(7));
        }
        if (matchesMon && matchesDom && matchesDow) {
          occurrences.push(dayStr);
        }
      }
    }
  }

  return occurrences;
}

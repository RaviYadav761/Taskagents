import { CronExpressionParser } from 'cron-parser';

export const CRON_PRESETS = [
  { label: 'Every 5 Minutes', expr: '*/5 * * * *', desc: 'Every 5 minutes' },
  { label: 'Every 15 Minutes', expr: '*/15 * * * *', desc: 'Every 15 minutes' },
  { label: 'Hourly', expr: '0 * * * *', desc: 'Every hour at minute 0' },
  { label: 'Every Day at 8:30 AM', expr: '30 8 * * *', desc: 'Every day at 8:30 AM' },
  { label: 'Every Day at 4:00 AM', expr: '0 4 * * *', desc: 'Every day at 4:00 AM' },
  { label: 'Weekdays at 9:00 AM', expr: '0 9 * * 1-5', desc: 'Monday through Friday at 9:00 AM' },
  { label: 'Every Monday at 9:00 AM', expr: '0 9 * * 1', desc: 'Every Monday at 9:00 AM' },
  { label: '25th of Every Month at 10:00 AM', expr: '0 10 25 * *', desc: 'Every month on the 25th at 10:00 AM' },
];

export const TIMEZONES = [
  { id: 'Asia/Kolkata', label: 'Asia/Kolkata (IST +5:30) - Default' },
  { id: 'UTC', label: 'UTC (Coordinated Universal Time)' },
  { id: 'America/New_York', label: 'America/New_York (EST/EDT)' },
  { id: 'America/Los_Angeles', label: 'America/Los_Angeles (PST/PDT)' },
  { id: 'Europe/London', label: 'Europe/London (GMT/BST)' },
  { id: 'Asia/Tokyo', label: 'Asia/Tokyo (JST)' },
  { id: 'Asia/Dubai', label: 'Asia/Dubai (GST)' },
];

export function validateCron(expr) {
  if (!expr || typeof expr !== 'string') return { valid: false, error: 'Expression is required' };
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    return {
      valid: false,
      error: 'Cron expression must have exactly 5 fields: Minute (0-59), Hour (0-23), Day of Month (1-31), Month (1-12), Day of Week (0-7)',
    };
  }

  try {
    CronExpressionParser.parse(expr, { tz: 'UTC' });
    return { valid: true, error: null };
  } catch (err) {
    return { valid: false, error: err.message || 'Invalid cron expression' };
  }
}

export function describeCron(expr) {
  if (!expr) return '';
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;

  const [min, hour, dom, mon, dow] = parts;

  if (expr === '* * * * *') return 'Runs every single minute';
  if (min.startsWith('*/') && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    return `Runs every ${min.replace('*/', '')} minutes`;
  }
  if (min === '0' && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    return 'Runs every hour at the top of the hour (:00)';
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
      const pr = new Intl.PluralRules('en-US', { type: 'ordinal' });
      const suffixes = { one: 'st', two: 'nd', few: 'rd', other: 'th' };
      const ordinal = `${dom}${suffixes[pr.select(dom)] || 'th'}`;
      return `Every month on the ${ordinal} at ${timeStr}`;
    }
  }

  return `Custom Schedule (${expr})`;
}

export function calculateNextRunPreview(expr, timezone = 'Asia/Kolkata') {
  if (!expr) return null;
  try {
    const interval = CronExpressionParser.parse(expr, {
      currentDate: new Date(),
      tz: timezone || 'Asia/Kolkata',
    });
    return interval.next().toDate().toLocaleString('en-US', {
      timeZone: timezone,
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch (e) {
    return null;
  }
}

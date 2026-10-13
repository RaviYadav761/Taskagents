import express from 'express';
import db from '../db.js';
import { authenticateUser } from '../auth.js';
import { parseAndNormalizeWebsite } from '../urlHelper.js';

const router = express.Router();
router.use(authenticateUser);

function getTodayString(timezone = 'Asia/Kolkata') {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(new Date());
  } catch (e) {
    return new Date().toISOString().split('T')[0];
  }
}

function getMidnightDate(timezone = 'Asia/Kolkata') {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  tomorrow.setHours(0, 0, 0, 0);
  return tomorrow.toISOString();
}

function isCurrentDayInActiveDays(activeDaysJson, timezone = 'Asia/Kolkata') {
  try {
    const now = new Date();
    const dayFormatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' });
    const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const currentDay = dayMap[dayFormatter.format(now)];
    const activeDays = typeof activeDaysJson === 'string' ? JSON.parse(activeDaysJson || '[0,1,2,3,4,5,6]') : (activeDaysJson || [0, 1, 2, 3, 4, 5, 6]);
    return activeDays.includes(currentDay);
  } catch (e) {
    return true;
  }
}

function evaluateRule(row, now = new Date()) {
  const nowIso = now.toISOString();
  const tz = row.timezone || 'Asia/Kolkata';
  const today = getTodayString(tz);

  if (!row.is_enabled) {
    return {
      status: 'paused',
      isBlocked: false,
      isInBreak: false,
      reason: 'Rule is paused',
      remainingAllowanceSeconds: Math.max(0, (row.daily_allowance_seconds || 0) - (row.used_today_seconds || 0)),
    };
  }

  if (row.emergency_override) {
    return {
      status: 'allowed',
      isBlocked: false,
      isInBreak: false,
      reason: 'Emergency override active',
      remainingAllowanceSeconds: Math.max(0, (row.daily_allowance_seconds || 0) - (row.used_today_seconds || 0)),
    };
  }

  // 1. Date range check
  if (row.start_date && today < row.start_date) {
    return {
      status: 'allowed',
      isBlocked: false,
      isInBreak: false,
      reason: `Restriction starts on ${row.start_date}`,
      remainingAllowanceSeconds: row.daily_allowance_seconds || 0,
    };
  }
  if (row.end_date && today > row.end_date) {
    return {
      status: 'allowed',
      isBlocked: false,
      isInBreak: false,
      reason: `Restriction expired on ${row.end_date}`,
      remainingAllowanceSeconds: row.daily_allowance_seconds || 0,
    };
  }

  // 2. Schedule window check
  const isScheduleEnabled = Boolean(row.schedule_window_enabled || row.restriction_type === 'schedule');
  const policy = row.outside_window_policy || 'block_outside';

  if (isScheduleEnabled && row.schedule_start_time && row.schedule_end_time) {
    const isDayActive = isCurrentDayInActiveDays(row.active_days, tz);
    if (!isDayActive) {
      if (policy === 'block_outside') {
        return {
          status: 'blocked',
          isBlocked: true,
          isInBreak: false,
          reason: 'Access restricted on this day of week',
          remainingAllowanceSeconds: 0,
        };
      }
    } else {
      const inSchedule = isCurrentTimeInSchedule(row.schedule_start_time, row.schedule_end_time, row.active_days, tz);
      if (inSchedule) {
        if (policy === 'block_inside') {
          return {
            status: 'blocked',
            isBlocked: true,
            isInBreak: false,
            reason: `Restricted during scheduled hours (${row.schedule_start_time} - ${row.schedule_end_time})`,
            remainingAllowanceSeconds: 0,
          };
        }
      } else {
        if (policy === 'block_outside') {
          return {
            status: 'blocked',
            isBlocked: true,
            isInBreak: false,
            reason: `Access allowed only during window (${row.schedule_start_time} - ${row.schedule_end_time} ${tz})`,
            remainingAllowanceSeconds: 0,
          };
        }
      }
    }
  }

  // 3. Cycle Break check
  if (row.in_break_until && row.in_break_until > nowIso) {
    const breakCountdownSeconds = Math.max(0, Math.round((new Date(row.in_break_until) - now) / 1000));
    return {
      status: 'break',
      isBlocked: true,
      isInBreak: true,
      reason: 'Mindful break in progress',
      inBreakUntil: row.in_break_until,
      breakCountdownSeconds,
      remainingAllowanceSeconds: Math.max(0, (row.daily_allowance_seconds || 0) - (row.used_today_seconds || 0)),
    };
  }

  // 4. Daily Quota check
  const isQuotaEnabled = row.daily_quota_enabled !== 0;
  const usedToday = row.used_today_seconds || 0;
  const dailyAllowance = row.daily_allowance_seconds || 0;
  const remainingAllowanceSeconds = Math.max(0, dailyAllowance - usedToday);

  if (isQuotaEnabled && dailyAllowance > 0 && usedToday >= dailyAllowance) {
    return {
      status: 'blocked',
      isBlocked: true,
      isInBreak: false,
      reason: 'Daily usage allowance reached',
      blockedUntil: getMidnightDate(tz),
      remainingAllowanceSeconds: 0,
    };
  }

  // 5. Explicit blocked_until (e.g., today_only or admin lock)
  if (row.blocked_until && row.blocked_until > nowIso) {
    return {
      status: 'blocked',
      isBlocked: true,
      isInBreak: false,
      reason: row.blocked_reason || 'Website restricted for today',
      blockedUntil: row.blocked_until,
      remainingAllowanceSeconds: 0,
    };
  }

  return {
    status: 'allowed',
    isBlocked: false,
    isInBreak: false,
    reason: 'Access allowed',
    remainingAllowanceSeconds,
  };
}

// GET all site limits for user
router.get('/', (req, res) => {
  const today = getTodayString();
  const stmt = db.prepare('SELECT * FROM site_limits WHERE user_id = ?');
  let rows = stmt.all(req.user.id);

  // If no limits found, initialize defaults (YouTube & Instagram)
  if (rows.length === 0) {
    const now = new Date().toISOString();
    const insertStmt = db.prepare(`
      INSERT INTO site_limits (
        id, user_id, domain, url, display_name, scope, restriction_type,
        daily_allowance_seconds, used_today_seconds, active_interval_seconds, break_seconds,
        active_days, timezone, last_reset_date, is_enabled, emergency_override, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 'Asia/Kolkata', ?, ?, 0, ?, ?)
    `);

    insertStmt.run(
      `limit-yt-${req.user.id}`,
      req.user.id,
      'youtube.com',
      'https://www.youtube.com/',
      'YouTube',
      'entire_domain',
      'cycle',
      10800,
      600,
      600,
      '[0,1,2,3,4,5,6]',
      today,
      1,
      now,
      now
    );

    insertStmt.run(
      `limit-ig-${req.user.id}`,
      req.user.id,
      'instagram.com',
      'https://www.instagram.com/',
      'Instagram',
      'entire_domain',
      'today_only',
      0,
      0,
      0,
      '[0,1,2,3,4,5,6]',
      today,
      0,
      now,
      now
    );

    rows = stmt.all(req.user.id);
  }

  const now = new Date();
  const nowIso = now.toISOString();

  // Check midnight resets and active statuses
  const updatedRows = rows.map((row) => {
    let usedToday = row.used_today_seconds;
    let blockedUntil = row.blocked_until;
    let inBreakUntil = row.in_break_until;
    let isEnabled = row.is_enabled;
    let breaksCount = row.breaks_count_today || 0;
    let blockedSeconds = row.blocked_seconds_today || 0;

    if (row.last_reset_date !== today) {
      // Archive yesterday's stats into site_usage_history
      try {
        const histStmt = db.prepare(`
          INSERT INTO site_usage_history (
            id, user_id, rule_id, domain, usage_date, active_used_seconds, breaks_taken, blocked_seconds, daily_allowance_seconds, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id, rule_id, usage_date) DO UPDATE SET
            active_used_seconds = excluded.active_used_seconds,
            breaks_taken = excluded.breaks_taken,
            blocked_seconds = excluded.blocked_seconds,
            updated_at = excluded.updated_at
        `);
        histStmt.run(
          `hist-${row.id}-${row.last_reset_date}`,
          req.user.id,
          row.id,
          row.domain,
          row.last_reset_date,
          usedToday,
          breaksCount,
          blockedSeconds,
          row.daily_allowance_seconds,
          nowIso,
          nowIso
        );
      } catch (histErr) {}

      // Reset today's counters
      usedToday = 0;
      inBreakUntil = null;
      breaksCount = 0;
      blockedSeconds = 0;

      // Handle Today-Only expiration: expires at midnight and unlocks!
      if (row.restriction_type === 'today_only' || row.domain === 'instagram.com') {
        blockedUntil = null;
        isEnabled = 0;
      } else if (row.restriction_type === 'date_range' && row.end_date && today > row.end_date) {
        blockedUntil = null;
        isEnabled = 0;
      } else {
        blockedUntil = null;
      }

      db.prepare(`
        UPDATE site_limits SET
          used_today_seconds = 0,
          breaks_count_today = 0,
          blocked_seconds_today = 0,
          in_break_until = NULL,
          blocked_until = ?,
          is_enabled = ?,
          last_reset_date = ?,
          emergency_override = 0,
          updated_at = ?
        WHERE id = ?
      `).run(blockedUntil, isEnabled, today, nowIso, row.id);
    }

    const evalResult = evaluateRule(row, now);

    return {
      id: row.id,
      jobId: row.job_id,
      domain: row.domain,
      url: row.url || `https://${row.domain}`,
      displayName: row.display_name || row.domain,
      scope: row.scope || 'entire_domain',
      restrictionType: row.restriction_type || 'cycle',
      scheduleWindowEnabled: Boolean(row.schedule_window_enabled),
      scheduleStartTime: row.schedule_start_time,
      scheduleEndTime: row.schedule_end_time,
      outsideWindowPolicy: row.outside_window_policy || 'block_outside',
      dailyQuotaEnabled: row.daily_quota_enabled !== 0,
      dailyAllowanceSeconds: row.daily_allowance_seconds,
      usedTodaySeconds: usedToday,
      remainingAllowanceSeconds: evalResult.remainingAllowanceSeconds,
      cycleBreaksEnabled: Boolean(row.cycle_breaks_enabled),
      activeIntervalSeconds: row.active_interval_seconds,
      breakSeconds: row.break_seconds,
      activeDays: row.active_days ? (typeof row.active_days === 'string' ? JSON.parse(row.active_days) : row.active_days) : [0, 1, 2, 3, 4, 5, 6],
      startDate: row.start_date,
      endDate: row.end_date,
      timezone: row.timezone || 'Asia/Kolkata',
      breaksCountToday: breaksCount,
      blockedSecondsToday: blockedSeconds,
      hasExtensionPermission: Boolean(row.has_extension_permission),
      lastSyncedAt: row.last_synced_at,
      inBreakUntil: evalResult.isInBreak ? row.in_break_until : null,
      breakCountdownSeconds: evalResult.breakCountdownSeconds || 0,
      blockedUntil: evalResult.isBlocked ? (row.blocked_until || 'Scheduled') : null,
      isInBreak: evalResult.isInBreak,
      isBlocked: evalResult.isBlocked,
      blockedReason: evalResult.reason,
      status: evalResult.status,
      isEnabled: Boolean(isEnabled),
      emergencyOverride: Boolean(row.emergency_override),
      lastResetDate: today,
      nextResetTime: getMidnightDate(row.timezone || 'Asia/Kolkata'),
    };
  });

  res.json({ limits: updatedRows });
});

// CREATE or UPDATE a custom website restriction rule
router.post('/rule', (req, res) => {
  const {
    url,
    scope = 'entire_domain',
    restrictionType = 'cycle',
    displayName,
    scheduleWindowEnabled = false,
    scheduleStartTime = '09:00',
    scheduleEndTime = '12:00',
    outsideWindowPolicy = 'block_outside',
    dailyQuotaEnabled = true,
    dailyAllowanceSeconds = 10800,
    cycleBreaksEnabled = false,
    activeIntervalSeconds = 600,
    breakSeconds = 600,
    activeDays = [0, 1, 2, 3, 4, 5, 6],
    startDate,
    endDate,
    timezone = 'Asia/Kolkata',
    isEnabled = true,
    jobId = null,
  } = req.body;

  const parsed = parseAndNormalizeWebsite(url, scope);
  if (!parsed.valid) {
    return res.status(400).json({ error: parsed.error });
  }

  const today = getTodayString(timezone);
  const now = new Date().toISOString();
  const ruleId = `rule-${parsed.normalizedDomain}-${req.user.id}`;
  const finalDisplayName = displayName || parsed.displayName;

  let blockedUntil = null;
  if (restrictionType === 'today_only' && isEnabled) {
    blockedUntil = getMidnightDate(timezone);
  }

  const stmt = db.prepare(`
    INSERT INTO site_limits (
      id, user_id, job_id, domain, url, display_name, scope, restriction_type,
      schedule_window_enabled, schedule_start_time, schedule_end_time, outside_window_policy,
      daily_quota_enabled, daily_allowance_seconds, cycle_breaks_enabled, active_interval_seconds, break_seconds,
      active_days, start_date, end_date, timezone,
      blocked_until, last_reset_date, is_enabled, emergency_override, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, 0, ?, ?
    )
    ON CONFLICT(user_id, domain) DO UPDATE SET
      job_id = COALESCE(excluded.job_id, site_limits.job_id),
      url = excluded.url,
      display_name = excluded.display_name,
      scope = excluded.scope,
      restriction_type = excluded.restriction_type,
      schedule_window_enabled = excluded.schedule_window_enabled,
      schedule_start_time = excluded.schedule_start_time,
      schedule_end_time = excluded.schedule_end_time,
      outside_window_policy = excluded.outside_window_policy,
      daily_quota_enabled = excluded.daily_quota_enabled,
      daily_allowance_seconds = excluded.daily_allowance_seconds,
      cycle_breaks_enabled = excluded.cycle_breaks_enabled,
      active_interval_seconds = excluded.active_interval_seconds,
      break_seconds = excluded.break_seconds,
      active_days = excluded.active_days,
      start_date = excluded.start_date,
      end_date = excluded.end_date,
      timezone = excluded.timezone,
      blocked_until = excluded.blocked_until,
      is_enabled = excluded.is_enabled,
      updated_at = excluded.updated_at
  `);

  stmt.run(
    ruleId,
    req.user.id,
    jobId || null,
    parsed.normalizedDomain,
    parsed.originalUrl,
    finalDisplayName,
    parsed.scope,
    restrictionType,
    scheduleWindowEnabled ? 1 : (restrictionType === 'schedule' ? 1 : 0),
    scheduleStartTime,
    scheduleEndTime,
    outsideWindowPolicy,
    dailyQuotaEnabled !== false ? 1 : 0,
    parseInt(dailyAllowanceSeconds, 10),
    cycleBreaksEnabled ? 1 : (restrictionType === 'cycle' ? 1 : 0),
    parseInt(activeIntervalSeconds, 10),
    parseInt(breakSeconds, 10),
    JSON.stringify(activeDays),
    startDate || null,
    endDate || null,
    timezone,
    blockedUntil,
    today,
    isEnabled ? 1 : 0,
    now,
    now
  );

  res.json({
    success: true,
    rule: {
      id: ruleId,
      domain: parsed.normalizedDomain,
      url: parsed.originalUrl,
      displayName: finalDisplayName,
      scope: parsed.scope,
      restrictionType,
    },
    message: `Website restriction rule for ${finalDisplayName} (${parsed.normalizedDomain}) saved successfully`,
  });
});

// DELETE a website restriction rule
router.delete('/rule/:id', (req, res) => {
  const { id } = req.params;
  const stmt = db.prepare('DELETE FROM site_limits WHERE id = ? AND user_id = ?');
  const result = stmt.run(id, req.user.id);

  if (result.changes === 0) {
    return res.status(404).json({ error: 'Rule not found' });
  }

  res.json({ success: true, message: 'Website restriction rule deleted' });
});

// TOGGLE enable/disable for a rule
router.post('/toggle/:id', (req, res) => {
  const { id } = req.params;
  const getStmt = db.prepare('SELECT is_enabled FROM site_limits WHERE id = ? AND user_id = ?');
  const row = getStmt.get(id, req.user.id);
  if (!row) {
    return res.status(404).json({ error: 'Rule not found' });
  }

  const nextState = row.is_enabled ? 0 : 1;
  db.prepare('UPDATE site_limits SET is_enabled = ?, updated_at = ? WHERE id = ? AND user_id = ?')
    .run(nextState, new Date().toISOString(), id, req.user.id);

  res.json({ success: true, isEnabled: Boolean(nextState) });
});

// SYNC active usage (Supports single event or batch events with idempotency UUID)
router.post('/sync-usage', (req, res) => {
  const events = Array.isArray(req.body.events) ? req.body.events : [req.body];
  const now = new Date();
  const nowIso = now.toISOString();

  let latestStatus = { status: 'allowed' };

  for (const ev of events) {
    const domain = ev.domain || 'youtube.com';
    const deltaSeconds = parseInt(ev.deltaSeconds || 5, 10);
    const eventId = ev.eventId || `evt-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const timestamp = ev.timestamp || nowIso;
    const deviceId = ev.deviceId || null;

    // 1. Check idempotency: insert into site_usage_events
    try {
      const eventStmt = db.prepare(`
        INSERT INTO site_usage_events (id, user_id, rule_id, domain, device_id, delta_seconds, event_timestamp, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      eventStmt.run(eventId, req.user.id, `rule-${domain}`, domain, deviceId, deltaSeconds, timestamp, nowIso);
    } catch (uniqueErr) {
      // Event already recorded! Skip to prevent duplicate counting.
      continue;
    }

    // 2. Fetch the corresponding rule
    const getStmt = db.prepare('SELECT * FROM site_limits WHERE user_id = ? AND domain = ?');
    const row = getStmt.get(req.user.id, domain);

    if (!row) continue;

    const today = getTodayString(row.timezone || 'Asia/Kolkata');
    let usedToday = row.last_reset_date === today ? row.used_today_seconds : 0;
    let inBreakUntil = row.in_break_until;
    let blockedUntil = row.blocked_until;
    let breaksCount = row.breaks_count_today || 0;
    let blockedSeconds = row.blocked_seconds_today || 0;

    const evalBefore = evaluateRule(row, now);

    // If disabled or emergency override:
    if (!row.is_enabled || row.emergency_override) {
      latestStatus = {
        status: 'allowed',
        domain,
        remainingAllowanceSeconds: Math.max(0, (row.daily_allowance_seconds || 0) - usedToday),
        isInBreak: false,
        isBlocked: false,
      };
      continue;
    }

    // If already in break:
    if (evalBefore.isInBreak) {
      blockedSeconds += deltaSeconds;
      latestStatus = {
        status: 'break',
        domain,
        inBreakUntil: row.in_break_until,
        breakCountdownSeconds: evalBefore.breakCountdownSeconds || 0,
        remainingAllowanceSeconds: evalBefore.remainingAllowanceSeconds,
      };
      db.prepare('UPDATE site_limits SET blocked_seconds_today = ?, last_synced_at = ? WHERE id = ?')
        .run(blockedSeconds, nowIso, row.id);
      continue;
    }

    // If already blocked (e.g. outside window with block_outside, or quota exhausted):
    if (evalBefore.isBlocked) {
      blockedSeconds += deltaSeconds;
      latestStatus = {
        status: 'blocked',
        domain,
        reason: evalBefore.reason,
        blockedUntil: row.blocked_until || 'Scheduled',
        remainingAllowanceSeconds: 0,
        nextResetTime: getMidnightDate(row.timezone || 'Asia/Kolkata'),
      };
      db.prepare('UPDATE site_limits SET blocked_seconds_today = ?, last_synced_at = ? WHERE id = ?')
        .run(blockedSeconds, nowIso, row.id);
      continue;
    }

    // If policy is allow_outside_no_count and we are outside schedule window:
    const isScheduleEnabled = Boolean(row.schedule_window_enabled || row.restriction_type === 'schedule');
    const inSchedule = isCurrentTimeInSchedule(row.schedule_start_time, row.schedule_end_time, row.active_days, row.timezone || 'Asia/Kolkata');
    if (isScheduleEnabled && row.outside_window_policy === 'allow_outside_no_count' && !inSchedule) {
      latestStatus = {
        status: 'allowed',
        domain,
        usedTodaySeconds: usedToday,
        remainingAllowanceSeconds: Math.max(0, (row.daily_allowance_seconds || 0) - usedToday),
        reason: 'Outside scheduled window (free use - uncounted)',
      };
      continue;
    }

    // Otherwise, accumulate active usage!
    usedToday += deltaSeconds;
    let status = 'allowed';

    // Check cycle breaks
    const shouldCheckCycle = Boolean(row.cycle_breaks_enabled || row.restriction_type === 'cycle');
    if (shouldCheckCycle) {
      const activeInterval = row.active_interval_seconds || 600;
      const breakDuration = row.break_seconds || 600;

      if (usedToday > 0 && usedToday % activeInterval < deltaSeconds) {
        inBreakUntil = new Date(now.getTime() + breakDuration * 1000).toISOString();
        breaksCount += 1;
        status = 'break';
      }
    }

    // Check daily allowance
    const shouldCheckQuota = row.daily_quota_enabled !== 0 || row.restriction_type === 'daily_limit';
    if (shouldCheckQuota && row.daily_allowance_seconds > 0 && usedToday >= row.daily_allowance_seconds) {
      blockedUntil = getMidnightDate(row.timezone || 'Asia/Kolkata');
      status = 'blocked';
    }

    // Update rule in database
    db.prepare(`
      UPDATE site_limits SET
        used_today_seconds = ?,
        breaks_count_today = ?,
        blocked_seconds_today = ?,
        in_break_until = ?,
        blocked_until = ?,
        last_reset_date = ?,
        last_synced_at = ?,
        updated_at = ?
      WHERE id = ?
    `).run(usedToday, breaksCount, blockedSeconds, inBreakUntil, blockedUntil, today, nowIso, nowIso, row.id);

    // Update today's history row
    try {
      db.prepare(`
        INSERT INTO site_usage_history (
          id, user_id, rule_id, domain, usage_date, active_used_seconds, breaks_taken, blocked_seconds, daily_allowance_seconds, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, rule_id, usage_date) DO UPDATE SET
          active_used_seconds = excluded.active_used_seconds,
          breaks_taken = excluded.breaks_taken,
          blocked_seconds = excluded.blocked_seconds,
          updated_at = excluded.updated_at
      `).run(
        `hist-${row.id}-${today}`,
        req.user.id,
        row.id,
        row.domain,
        today,
        usedToday,
        breaksCount,
        blockedSeconds,
        row.daily_allowance_seconds,
        nowIso,
        nowIso
      );
    } catch (e) {}

    latestStatus = {
      status,
      domain,
      usedTodaySeconds: usedToday,
      remainingAllowanceSeconds: Math.max(0, (row.daily_allowance_seconds || 0) - usedToday),
      inBreakUntil,
      breakCountdownSeconds: inBreakUntil ? Math.max(0, Math.round((new Date(inBreakUntil) - now) / 1000)) : 0,
      blockedUntil,
      breaksCountToday: breaksCount,
      lastSyncedAt: nowIso,
      nextResetTime: getMidnightDate(row.timezone || 'Asia/Kolkata'),
    };
  }

  res.json(latestStatus);
});

// GET historical usage analytics
router.get('/analytics', (req, res) => {
  const { range = '7days', domain } = req.query;
  const today = getTodayString();

  let daysBack = 7;
  if (range === 'today') daysBack = 1;
  else if (range === 'yesterday') daysBack = 2;
  else if (range === '30days') daysBack = 30;

  let query = 'SELECT * FROM site_usage_history WHERE user_id = ?';
  const params = [req.user.id];

  if (domain && domain !== 'all') {
    query += ' AND domain = ?';
    params.push(domain);
  }

  query += ' ORDER BY usage_date DESC LIMIT ?';
  params.push(daysBack * 10);

  const historyRows = db.prepare(query).all(...params);

  // Also include today's live data from site_limits
  let liveLimitsQuery = 'SELECT * FROM site_limits WHERE user_id = ?';
  const liveParams = [req.user.id];
  if (domain && domain !== 'all') {
    liveLimitsQuery += ' AND domain = ?';
    liveParams.push(domain);
  }
  const currentLimits = db.prepare(liveLimitsQuery).all(...liveParams);

  // Compute aggregated totals
  let totalActiveUsedSeconds = 0;
  let totalBreaksTaken = 0;
  let totalBlockedSeconds = 0;

  for (const lim of currentLimits) {
    totalActiveUsedSeconds += lim.used_today_seconds || 0;
    totalBreaksTaken += lim.breaks_count_today || 0;
    totalBlockedSeconds += lim.blocked_seconds_today || 0;
  }

  res.json({
    range,
    totals: {
      totalActiveUsedSeconds,
      totalBreaksTaken,
      totalBlockedSeconds,
      formattedUsageHours: (totalActiveUsedSeconds / 3600).toFixed(1),
    },
    todaySnapshot: currentLimits.map((c) => ({
      domain: c.domain,
      displayName: c.display_name || c.domain,
      usedTodaySeconds: c.used_today_seconds,
      dailyAllowanceSeconds: c.daily_allowance_seconds,
      breaksCountToday: c.breaks_count_today,
      blockedSecondsToday: c.blocked_seconds_today,
      limitExceeded: c.daily_allowance_seconds > 0 && c.used_today_seconds >= c.daily_allowance_seconds,
    })),
    history: historyRows,
  });
});

// UPDATE browser extension permission status
router.post('/permission-status', (req, res) => {
  const { domain, hasPermission = true } = req.body;
  if (!domain) return res.status(400).json({ error: 'Domain is required' });

  db.prepare(`
    UPDATE site_limits SET has_extension_permission = ?, updated_at = ?
    WHERE user_id = ? AND domain = ?
  `).run(hasPermission ? 1 : 0, new Date().toISOString(), req.user.id, domain);

  res.json({ success: true, domain, hasPermission: Boolean(hasPermission) });
});

// Backward compatibility: Settings update
router.post('/settings', (req, res) => {
  const {
    domain,
    dailyAllowanceSeconds = 10800,
    activeIntervalSeconds = 600,
    breakSeconds = 600,
    isEnabled = true,
  } = req.body;

  if (!domain) {
    return res.status(400).json({ error: 'Domain is required' });
  }

  const today = getTodayString();
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO site_limits (
      id, user_id, domain, daily_allowance_seconds, used_today_seconds,
      active_interval_seconds, break_seconds, last_reset_date, is_enabled, emergency_override, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, 0, ?, ?)
    ON CONFLICT(user_id, domain) DO UPDATE SET
      daily_allowance_seconds = excluded.daily_allowance_seconds,
      active_interval_seconds = excluded.active_interval_seconds,
      break_seconds = excluded.break_seconds,
      is_enabled = excluded.is_enabled,
      updated_at = excluded.updated_at
  `);

  stmt.run(
    `limit-${domain}-${req.user.id}`,
    req.user.id,
    domain,
    parseInt(dailyAllowanceSeconds, 10),
    parseInt(activeIntervalSeconds, 10),
    parseInt(breakSeconds, 10),
    today,
    isEnabled ? 1 : 0,
    now,
    now
  );

  res.json({ success: true, message: 'Site limit settings updated successfully' });
});

// Backward compatibility: Instagram "Today Only" block
router.post('/instagram-today', (req, res) => {
  const { block = true } = req.body;
  const today = getTodayString();
  const now = new Date().toISOString();
  const midnightIso = getMidnightDate();

  const stmt = db.prepare(`
    INSERT INTO site_limits (
      id, user_id, domain, display_name, restriction_type, daily_allowance_seconds, used_today_seconds,
      active_interval_seconds, break_seconds, in_break_until, blocked_until,
      last_reset_date, is_enabled, emergency_override, created_at, updated_at
    ) VALUES (?, ?, 'instagram.com', 'Instagram', 'today_only', 0, 0, 0, 0, NULL, ?, ?, ?, 0, ?, ?)
    ON CONFLICT(user_id, domain) DO UPDATE SET
      restriction_type = 'today_only',
      blocked_until = excluded.blocked_until,
      is_enabled = excluded.is_enabled,
      last_reset_date = excluded.last_reset_date,
      emergency_override = 0,
      updated_at = excluded.updated_at
  `);

  stmt.run(
    `limit-ig-${req.user.id}`,
    req.user.id,
    block ? midnightIso : null,
    today,
    block ? 1 : 0,
    now,
    now
  );

  res.json({
    success: true,
    isBlockedToday: block,
    blockedUntil: block ? midnightIso : null,
    message: block
      ? 'Instagram has been locked for today. Restriction will automatically expire at local midnight.'
      : 'Instagram today lock has been removed.',
  });
});

// Emergency override toggle
router.post('/emergency-override', (req, res) => {
  const { domain, enable = true } = req.body;
  if (!domain) return res.status(400).json({ error: 'Domain is required' });

  const stmt = db.prepare(`
    UPDATE site_limits SET emergency_override = ?, updated_at = ?
    WHERE user_id = ? AND domain = ?
  `);
  stmt.run(enable ? 1 : 0, new Date().toISOString(), req.user.id, domain);

  res.json({
    success: true,
    emergencyOverride: enable,
    message: enable
      ? `Emergency override enabled for ${domain}. Restriction bypassed until next reset.`
      : `Emergency override disabled for ${domain}. Restriction re-enforced.`,
  });
});

export default router;

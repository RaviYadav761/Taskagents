// Background Service Worker for Taskly Automation & Usage Controller (Phase 2)
const API_BASE = 'http://localhost:4000/api';
const AGENT_IPC_URL = 'http://127.0.0.1:47891';

let cachedRules = [];
let authToken = null;
let lastActiveTabId = null;

// Initialize on service worker start
chrome.runtime.onInstalled.addListener(() => {
  console.log('[Taskly Extension] Installed successfully.');
  refreshRules();
});

// Periodic rule refresh every 60 seconds
chrome.alarms.create('refresh_rules_alarm', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'refresh_rules_alarm') {
    refreshRules();
    flushBufferedEvents();
  }
});

async function getStoredToken() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['taskly_jwt_token'], (res) => {
      resolve(res.taskly_jwt_token || null);
    });
  });
}

async function refreshRules() {
  authToken = await getStoredToken();
  try {
    const headers = authToken ? { Authorization: `Bearer ${authToken}` } : {};
    const res = await fetch(`${API_BASE}/site-limits`, { headers });
    if (res.ok) {
      const data = await res.json();
      if (data.limits && Array.isArray(data.limits)) {
        cachedRules = data.limits;
        chrome.storage.local.set({ cached_rules: cachedRules });
        return;
      }
    }
  } catch (err) {
    // Backend offline: load from local storage
  }

  // Fallback to storage
  chrome.storage.local.get(['cached_rules'], (res) => {
    if (res.cached_rules) {
      cachedRules = res.cached_rules;
    }
  });
}

function findRuleForHostname(hostname) {
  if (!hostname) return null;
  const cleanHost = hostname.toLowerCase().replace(/^www\./, '');

  for (const rule of cachedRules) {
    if (!rule.isEnabled) continue;
    const ruleDomain = (rule.domain || '').toLowerCase().replace(/^www\./, '');

    if (rule.scope === 'hostname_only') {
      if (cleanHost === ruleDomain) return rule;
    } else {
      // Entire domain: matches domain or subdomains
      if (cleanHost === ruleDomain || cleanHost.endsWith(`.${ruleDomain}`)) {
        return rule;
      }
    }
  }
  return null;
}

function evaluateRule(rule, now = new Date()) {
  const nowIso = now.toISOString();
  const tz = rule.timezone || 'Asia/Kolkata';

  if (!rule.isEnabled) {
    return {
      status: 'paused',
      isBlocked: false,
      isInBreak: false,
      reason: 'Rule is paused',
      remainingAllowanceSeconds: Math.max(0, (rule.dailyAllowanceSeconds || 0) - (rule.usedTodaySeconds || 0)),
    };
  }

  if (rule.emergencyOverride) {
    return {
      status: 'allowed',
      isBlocked: false,
      isInBreak: false,
      reason: 'Emergency override active',
      remainingAllowanceSeconds: Math.max(0, (rule.dailyAllowanceSeconds || 0) - (rule.usedTodaySeconds || 0)),
    };
  }

  // Helper date in timezone
  let todayStr = '';
  let currentTimeStr = '';
  let currentDay = 0;
  try {
    const dayFormatter = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' });
    const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    currentDay = dayMap[dayFormatter.format(now)];

    const timeFormatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    currentTimeStr = timeFormatter.format(now);

    const dateForm = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    todayStr = dateForm.format(now);
  } catch (e) {
    todayStr = now.toISOString().split('T')[0];
  }

  // 1. Date Range
  if (rule.startDate && todayStr < rule.startDate) {
    return {
      status: 'allowed',
      isBlocked: false,
      isInBreak: false,
      reason: `Restriction starts on ${rule.startDate}`,
      remainingAllowanceSeconds: rule.dailyAllowanceSeconds || 0,
    };
  }
  if (rule.endDate && todayStr > rule.endDate) {
    return {
      status: 'allowed',
      isBlocked: false,
      isInBreak: false,
      reason: `Restriction expired on ${rule.endDate}`,
      remainingAllowanceSeconds: rule.dailyAllowanceSeconds || 0,
    };
  }

  // 2. Schedule Window Check
  const isScheduleEnabled = Boolean(rule.scheduleWindowEnabled || rule.restrictionType === 'schedule');
  const policy = rule.outsideWindowPolicy || 'block_outside';

  if (isScheduleEnabled && rule.scheduleStartTime && rule.scheduleEndTime) {
    const activeDays = Array.isArray(rule.activeDays)
      ? rule.activeDays
      : [0, 1, 2, 3, 4, 5, 6];

    const isDayActive = activeDays.includes(currentDay);
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
      const inSchedule = currentTimeStr >= rule.scheduleStartTime && currentTimeStr <= rule.scheduleEndTime;
      if (inSchedule) {
        if (policy === 'block_inside') {
          return {
            status: 'blocked',
            isBlocked: true,
            isInBreak: false,
            reason: `Restricted during scheduled hours (${rule.scheduleStartTime} - ${rule.scheduleEndTime})`,
            remainingAllowanceSeconds: 0,
          };
        }
      } else {
        if (policy === 'block_outside') {
          return {
            status: 'blocked',
            isBlocked: true,
            isInBreak: false,
            reason: `Access allowed only during window (${rule.scheduleStartTime} - ${rule.scheduleEndTime} ${tz})`,
            remainingAllowanceSeconds: 0,
          };
        }
      }
    }
  }

  // 3. Break Check
  if (rule.inBreakUntil && rule.inBreakUntil > nowIso) {
    const breakCountdownSeconds = Math.max(0, Math.round((new Date(rule.inBreakUntil) - now) / 1000));
    return {
      status: 'break',
      isBlocked: true,
      isInBreak: true,
      inBreakUntil: rule.inBreakUntil,
      breakCountdownSeconds,
      reason: 'Mindful break in progress',
      remainingAllowanceSeconds: Math.max(0, (rule.dailyAllowanceSeconds || 0) - (rule.usedTodaySeconds || 0)),
    };
  }

  // 4. Daily Quota Check
  const isQuotaEnabled = rule.dailyQuotaEnabled !== false;
  const usedToday = rule.usedTodaySeconds || 0;
  const dailyAllowance = rule.dailyAllowanceSeconds || 0;
  const remainingAllowanceSeconds = Math.max(0, dailyAllowance - usedToday);

  if (isQuotaEnabled && dailyAllowance > 0 && usedToday >= dailyAllowance) {
    return {
      status: 'blocked',
      isBlocked: true,
      isInBreak: false,
      reason: 'Daily usage allowance reached',
      remainingAllowanceSeconds: 0,
    };
  }

  // 5. Explicit blockedUntil
  if (rule.blockedUntil && rule.blockedUntil > nowIso) {
    return {
      status: 'blocked',
      isBlocked: true,
      isInBreak: false,
      reason: rule.blockedReason || 'Website restricted for today',
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

// Intercept navigation before page load: 100% un-bypassable
if (chrome.webNavigation && chrome.webNavigation.onBeforeNavigate) {
  chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
    // Only inspect top-level navigation
    if (details.frameId !== 0) return;
    if (!details.url || !details.url.startsWith('http')) return;

    try {
      const parsed = new URL(details.url);
      const rule = findRuleForHostname(parsed.hostname);
      if (!rule) return;

      const evalResult = evaluateRule(rule, new Date());
      if (evalResult.isBlocked || evalResult.status === 'break') {
        const blockUrl = chrome.runtime.getURL(
          `blocked.html?domain=${encodeURIComponent(rule.domain)}&reason=${encodeURIComponent(
            evalResult.reason || ''
          )}&countdown=${evalResult.breakCountdownSeconds || 0}&targetUrl=${encodeURIComponent(
            details.url
          )}&policy=${encodeURIComponent(rule.restrictionType || '')}&status=${evalResult.status}`
        );
        chrome.tabs.update(details.tabId, { url: blockUrl });
      }
    } catch (e) {}
  });
}

// Track active tab and inject universal script if matching rule exists
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  lastActiveTabId = activeInfo.tabId;
  checkAndInject(activeInfo.tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    checkAndInject(tabId, tab.url);
  }
});

async function checkAndInject(tabId, tabUrl) {
  try {
    let url = tabUrl;
    if (!url) {
      const tab = await chrome.tabs.get(tabId);
      url = tab?.url;
    }
    if (!url || !url.startsWith('http')) return;

    const parsed = new URL(url);
    const rule = findRuleForHostname(parsed.hostname);
    if (!rule) return;

    // Fast check: If already blocked or in break, redirect to blocked.html
    const evalResult = evaluateRule(rule, new Date());
    if (evalResult.isBlocked || evalResult.status === 'break') {
      const blockUrl = chrome.runtime.getURL(
        `blocked.html?domain=${encodeURIComponent(rule.domain)}&reason=${encodeURIComponent(
          evalResult.reason || ''
        )}&countdown=${evalResult.breakCountdownSeconds || 0}&targetUrl=${encodeURIComponent(
          url
        )}&policy=${encodeURIComponent(rule.restrictionType || '')}&status=${evalResult.status}`
      );
      chrome.tabs.update(tabId, { url: blockUrl });
      return;
    }

    // Check if domain is youtube or instagram (already covered by manifest content_scripts)
    const host = parsed.hostname.toLowerCase();
    if (host.includes('youtube.com') || host.includes('instagram.com')) return;

    // Inject universal content script for custom website
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content_universal.js'],
    });
  } catch (e) {
    // Tab closed or restricted browser internal page
  }
}

// Message handler for active pings and actions
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'ACTIVE_TAB_PING') {
    handleActivePing(request, sender)
      .then(sendResponse)
      .catch(() => {
        sendResponse(handleOfflineFallback(request));
      });
    return true;
  }

  // Backwards compatibility for YouTube
  if (request.type === 'YOUTUBE_ACTIVE_PING') {
    handleActivePing(
      {
        domain: 'youtube.com',
        deltaSeconds: request.deltaSeconds || 5,
        eventId: `yt-${Date.now()}`,
      },
      sender
    )
      .then(sendResponse)
      .catch(() => {
        sendResponse(handleOfflineFallback({ domain: 'youtube.com', deltaSeconds: 5 }));
      });
    return true;
  }

  // Backwards compatibility for Instagram
  if (request.type === 'CHECK_INSTAGRAM_LOCK') {
    checkRuleStatus('instagram.com')
      .then(sendResponse)
      .catch(() => sendResponse({ isBlocked: false }));
    return true;
  }

  if (request.type === 'EMERGENCY_OVERRIDE') {
    handleEmergencyOverride(request.domain).then(sendResponse);
    return true;
  }

  if (request.type === 'PAIR_EXTENSION') {
    chrome.storage.local.set({ taskly_jwt_token: request.token }, () => {
      authToken = request.token;
      refreshRules().then(() => sendResponse({ success: true }));
    });
    return true;
  }

  if (request.type === 'REFRESH_RULES') {
    refreshRules().then(() => sendResponse({ success: true, rules: cachedRules }));
    return true;
  }
});

async function handleActivePing(req, sender) {
  const domain = req.domain || 'youtube.com';
  const deltaSeconds = req.deltaSeconds || 5;
  const eventId = req.eventId || `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  authToken = authToken || (await getStoredToken());
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

  try {
    const res = await fetch(`${API_BASE}/site-limits/sync-usage`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        eventId,
        domain,
        deltaSeconds,
        timestamp: new Date().toISOString(),
      }),
    });

    if (res.ok) {
      const data = await res.json();
      // Update local cache
      const rule = cachedRules.find((r) => r.domain === domain);
      if (rule) {
        rule.usedTodaySeconds = data.usedTodaySeconds;
        rule.inBreakUntil = data.inBreakUntil;
        rule.blockedUntil = data.blockedUntil;
      }

      // If state changed to break or blocked, redirect sender tab to blocked.html
      if ((data.status === 'break' || data.status === 'blocked') && sender && sender.tab && sender.tab.id) {
        const blockUrl = chrome.runtime.getURL(
          `blocked.html?domain=${encodeURIComponent(domain)}&reason=${encodeURIComponent(
            data.reason || ''
          )}&countdown=${data.breakCountdownSeconds || 0}&targetUrl=${encodeURIComponent(
            sender.tab.url || ''
          )}&policy=${encodeURIComponent(rule?.restrictionType || '')}&status=${data.status}`
        );
        chrome.tabs.update(sender.tab.id, { url: blockUrl });
      }

      return data;
    }
  } catch (netErr) {
    // Network failed -> buffer event and return offline calculation
  }

  // Buffer event offline
  bufferEvent({ eventId, domain, deltaSeconds, timestamp: new Date().toISOString() });
  return handleOfflineFallback({ domain, deltaSeconds });
}

function bufferEvent(event) {
  chrome.storage.local.get(['buffered_events'], (res) => {
    const events = res.buffered_events || [];
    if (!events.some((e) => e.eventId === event.eventId)) {
      events.push(event);
      if (events.length > 500) events.shift();
      chrome.storage.local.set({ buffered_events: events });
    }
  });
}

async function flushBufferedEvents() {
  chrome.storage.local.get(['buffered_events'], async (res) => {
    const events = res.buffered_events;
    if (!events || events.length === 0) return;

    authToken = authToken || (await getStoredToken());
    const headers = { 'Content-Type': 'application/json' };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

    try {
      const resp = await fetch(`${API_BASE}/site-limits/sync-usage`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ events }),
      });
      if (resp.ok) {
        chrome.storage.local.set({ buffered_events: [] });
      }
    } catch (e) {
      // Still offline
    }
  });
}

function handleOfflineFallback({ domain, deltaSeconds = 5 }) {
  const rule = findRuleForHostname(domain);
  const now = new Date();

  if (!rule) {
    return { status: 'allowed', remainingAllowanceSeconds: 3600 };
  }

  const evalBefore = evaluateRule(rule, now);
  if (evalBefore.isBlocked || evalBefore.status === 'break') {
    return evalBefore;
  }

  // Accumulate locally
  rule.usedTodaySeconds = (rule.usedTodaySeconds || 0) + deltaSeconds;
  let status = 'allowed';

  if (rule.cycleBreaksEnabled || rule.restrictionType === 'cycle') {
    const interval = rule.activeIntervalSeconds || 600;
    const breakDuration = rule.breakSeconds || 600;

    if (rule.usedTodaySeconds > 0 && rule.usedTodaySeconds % interval < deltaSeconds) {
      rule.inBreakUntil = new Date(now.getTime() + breakDuration * 1000).toISOString();
      status = 'break';
    }
  }

  if (rule.dailyQuotaEnabled !== false && rule.dailyAllowanceSeconds > 0 && rule.usedTodaySeconds >= rule.dailyAllowanceSeconds) {
    status = 'blocked';
  }

  return {
    status,
    domain,
    usedTodaySeconds: rule.usedTodaySeconds,
    remainingAllowanceSeconds: Math.max(0, (rule.dailyAllowanceSeconds || 0) - rule.usedTodaySeconds),
    inBreakUntil: rule.inBreakUntil,
    breakCountdownSeconds: rule.inBreakUntil ? Math.max(0, Math.round((new Date(rule.inBreakUntil) - now) / 1000)) : 0,
  };
}

async function checkRuleStatus(domain) {
  const rule = findRuleForHostname(domain);
  if (!rule) return { isBlocked: false };
  const evalResult = evaluateRule(rule, new Date());
  return { isBlocked: evalResult.isBlocked, blockedUntil: rule.blockedUntil };
}

async function handleEmergencyOverride(domain) {
  authToken = authToken || (await getStoredToken());
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    await fetch(`${API_BASE}/site-limits/emergency-override`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ domain, enable: true }),
    });
  } catch (e) {}

  const rule = findRuleForHostname(domain);
  if (rule) {
    rule.emergencyOverride = true;
    rule.inBreakUntil = null;
    rule.blockedUntil = null;
  }
  return { success: true };
}

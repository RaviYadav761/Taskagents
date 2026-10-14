// Background Service Worker for Taskly Automation & Mindful Usage Controller (Manifest V3)
import { matchDomain, parseAndNormalizeWebsite, resolveServiceProfile } from './urlHelper.js';

let API_BASE = '';
let cachedRules = [];
let authToken = null;
let lastSyncTimestamp = null;
let isInitialized = false;
let apiSyncSucceeded = false;

// Initialize on service worker start
const initPromise = initServiceWorker();

async function initServiceWorker() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      ['cached_rules', 'taskly_jwt_token', 'taskly_api_url', 'taskly_api_base', 'last_sync_timestamp'],
      async (res) => {
        try { API_BASE = normalizeExtensionApiBase(res.taskly_api_url || res.taskly_api_base || ''); } catch { API_BASE = ''; }
        if (res.taskly_jwt_token) authToken = res.taskly_jwt_token;
        if (res.cached_rules && Array.isArray(res.cached_rules)) {
          cachedRules = res.cached_rules;
        }
        if (res.last_sync_timestamp) lastSyncTimestamp = res.last_sync_timestamp;
        isInitialized = true;

        // Sync DNR rules based on persisted snapshot
        try {
          await syncDeclarativeNetRequestRules(cachedRules);
        } catch (e) {
          console.warn('[Taskly Extension] DNR init error:', e);
        }

        resolve(true);
      }
    );
  });
}

// Ensure initialization is awaited by all events
chrome.runtime.onInstalled.addListener(async () => {
  await initPromise;
  console.log('[Taskly Extension] Installed / Updated.');
  await refreshRules();
});

chrome.runtime.onStartup.addListener(async () => {
  await initPromise;
  await refreshRules();
});

// Periodic rule refresh and buffer flush every 60 seconds
chrome.alarms.create('refresh_rules_alarm', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(async (alarm) => {
  await initPromise;
  if (alarm.name === 'refresh_rules_alarm') {
    await refreshRules();
    await flushBufferedEvents();
    await checkAndEnforceSchedules();
  }
});

function normalizeExtensionApiBase(value) {
  const parsed = new URL(String(value || '').trim());
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('Invalid API URL');
  if (parsed.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(parsed.hostname)) throw new Error('HTTP is permitted only for local development');
  const path = parsed.pathname.replace(/\/+$/, '').replace(/(?:\/api)+$/i, '');
  return `${parsed.origin}${path}/api`;
}

async function getStoredToken() {
  await initPromise;
  return new Promise((resolve) => {
    chrome.storage.local.get(['taskly_jwt_token'], (res) => {
      resolve(res.taskly_jwt_token || authToken || null);
    });
  });
}

/**
 * Fetch authoritative rules from Taskly backend and update storage & DNR
 */
async function refreshRules() {
  await initPromise;
  authToken = await getStoredToken();
  apiSyncSucceeded = false;

  try {
    if (!API_BASE) throw new Error('Extension API URL is not configured. Set it in the extension popup.');
    const headers = authToken ? { Authorization: `Bearer ${authToken}` } : {};
    const res = await fetch(`${API_BASE}/site-limits`, { headers });
    if (!res.ok) {
      const category = res.status === 401 || res.status === 403 ? 'authentication failure' : [502, 503, 504].includes(res.status) ? 'unreachable backend' : 'HTTP error';
      console.warn('[Taskly Extension API]', { endpoint: '/api/site-limits', category, status: res.status, responseReceived: true, remediation: category === 'authentication failure' ? 'Relink the extension.' : 'Check API URL, backend availability, and backend logs.' });
    }
    if (res.ok) {
      const data = await res.json();
      if (data.limits && Array.isArray(data.limits)) {
        cachedRules = data.limits;
        apiSyncSucceeded = true;
        lastSyncTimestamp = new Date().toISOString();
        await new Promise((r) =>
          chrome.storage.local.set(
            { cached_rules: cachedRules, last_sync_timestamp: lastSyncTimestamp },
            r
          )
        );
        await syncDeclarativeNetRequestRules(cachedRules);
        return cachedRules;
      }
    }
  } catch (err) {
    const category = err instanceof TypeError ? 'network failure' : 'unreachable backend';
    console.warn('[Taskly Extension API]', { endpoint: '/api/site-limits', category, status: null, responseReceived: false, remediation: 'Check the configured API URL and backend availability; this alone does not prove a CORS error.' });
    // Offline mode: continue enforcing from cached rules
  }

  // Fallback to locally persisted rules
  return new Promise((resolve) => {
    chrome.storage.local.get(['cached_rules'], async (res) => {
      if (res.cached_rules && Array.isArray(res.cached_rules)) {
        cachedRules = res.cached_rules;
        await syncDeclarativeNetRequestRules(cachedRules);
      }
      resolve(cachedRules);
    });
  });
}

/**
 * Find matching rule for a given hostname using boundary-safe matching
 */
function findRuleForHostname(hostname) {
  if (!hostname || !cachedRules || cachedRules.length === 0) return null;
  const cleanHost = hostname.toLowerCase();

  for (const rule of cachedRules) {
    if (!rule.isEnabled) continue;
    const covered = rule.coveredDomains || (rule.covered_domains ? JSON.parse(rule.covered_domains) : null);
    if (matchDomain(cleanHost, rule.domain, rule.scope || 'entire_domain', covered)) {
      return rule;
    }
  }
  return null;
}

/**
 * Evaluates the live restriction state of a rule against the current clock
 */
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

  // Date and Time in timezone
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
      let inSchedule = false;
      if (rule.scheduleStartTime <= rule.scheduleEndTime) {
        // Normal daytime window e.g. 09:00 - 17:00
        inSchedule = currentTimeStr >= rule.scheduleStartTime && currentTimeStr <= rule.scheduleEndTime;
      } else {
        // Overnight window e.g. 22:00 - 06:00
        inSchedule = currentTimeStr >= rule.scheduleStartTime || currentTimeStr <= rule.scheduleEndTime;
      }

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
            reason: `Access allowed only during scheduled window (${rule.scheduleStartTime} - ${rule.scheduleEndTime} ${tz})`,
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

/**
 * Generate stable 32-bit positive integer ID for chrome.declarativeNetRequest rules
 */
function getNumericDnrId(ruleIdOrDomain, aliasIndex = 0) {
  let hash = 0;
  const str = `${ruleIdOrDomain}-${aliasIndex}`;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return (Math.abs(hash) % 1000000) + 100;
}

/**
 * Synchronize chrome.declarativeNetRequest dynamic rules with current evaluated status
 */
async function syncDeclarativeNetRequestRules(rules) {
  if (!chrome.declarativeNetRequest || !chrome.declarativeNetRequest.updateDynamicRules) {
    return;
  }

  try {
    const currentDynamicRules = await chrome.declarativeNetRequest.getDynamicRules();
    const existingRuleIds = currentDynamicRules.map((r) => r.id);

    const rulesToAdd = [];
    const now = new Date();

    for (const rule of rules) {
      if (!rule.isEnabled) continue;
      const evalResult = evaluateRule(rule, now);

      if (evalResult.isBlocked || evalResult.status === 'break') {
        // Collect all covered domains
        const profile = resolveServiceProfile(rule.domain);
        const domains = profile ? [...profile.domains] : [rule.domain];
        if (rule.coveredDomains && Array.isArray(rule.coveredDomains)) {
          for (const cd of rule.coveredDomains) {
            if (!domains.includes(cd)) domains.push(cd);
          }
        }

        domains.forEach((dom, idx) => {
          const ruleNumId = getNumericDnrId(rule.id || rule.domain, idx);
          const cleanDom = dom.toLowerCase().replace(/^www\./, '');
          const countdown = evalResult.breakCountdownSeconds || 0;
          const status = evalResult.status;
          const reason = evalResult.reason || '';

          const redirectUrl = chrome.runtime.getURL(
            `blocked.html?domain=${encodeURIComponent(cleanDom)}&status=${encodeURIComponent(status)}&countdown=${countdown}&reason=${encodeURIComponent(reason)}`
          );

          rulesToAdd.push({
            id: ruleNumId,
            priority: 1,
            action: {
              type: 'redirect',
              redirect: {
                url: redirectUrl,
              },
            },
            condition: {
              urlFilter: `||${cleanDom}`,
              resourceTypes: ['main_frame'],
            },
          });
        });
      }
    }

    // Atomic update
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existingRuleIds,
      addRules: rulesToAdd,
    });
  } catch (err) {
    console.warn('[Taskly Extension] DNR sync note:', err.message);
  }
}

/**
 * Notify all open matching tabs of a rule status transition
 */
async function broadcastRuleStateToTabs(domain, evalResult) {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.url && tab.url.startsWith('http')) {
        try {
          const parsed = new URL(tab.url);
          const rule = findRuleForHostname(parsed.hostname);
          if (rule && (rule.domain === domain || domain.includes(rule.domain))) {
            chrome.tabs.sendMessage(tab.id, {
              type: 'TASKLY_RULE_STATE_UPDATE',
              status: evalResult.status,
              reason: evalResult.reason,
              countdown: evalResult.breakCountdownSeconds || 0,
              domain: rule.domain,
            }).catch(() => {});
          }
        } catch (e) {}
      }
    }
  } catch (e) {}
}

/**
 * Secondary layer: Intercept top-level navigation via webNavigation
 */
if (chrome.webNavigation && chrome.webNavigation.onBeforeNavigate) {
  chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
    await initPromise;
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
          )}&status=${evalResult.status}`
        );
        chrome.tabs.update(details.tabId, { url: blockUrl });
      }
    } catch (e) {}
  });
}

// Active tab injection & validation
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  await initPromise;
  checkAndInject(activeInfo.tabId);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  await initPromise;
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

    const evalResult = evaluateRule(rule, new Date());
    if (evalResult.isBlocked || evalResult.status === 'break') {
      const blockUrl = chrome.runtime.getURL(
        `blocked.html?domain=${encodeURIComponent(rule.domain)}&reason=${encodeURIComponent(
          evalResult.reason || ''
        )}&countdown=${evalResult.breakCountdownSeconds || 0}&targetUrl=${encodeURIComponent(
          url
        )}&status=${evalResult.status}`
      );
      chrome.tabs.update(tabId, { url: blockUrl });
      return;
    }

    // If custom website not covered by static content_scripts, inject content_universal.js
    const host = parsed.hostname.toLowerCase();
    if (host.includes('youtube.com') || host.includes('youtu.be') || host.includes('instagram.com')) {
      return;
    }

    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content_universal.js'],
    });
  } catch (e) {}
}

/**
 * Message handler for active tab pings, pairing, and emergency overrides
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    await initPromise;

    if (request.type === 'ACTIVE_TAB_PING') {
      const result = await handleActivePing(request, sender);
      sendResponse(result);
      return;
    }

    if (request.type === 'YOUTUBE_ACTIVE_PING') {
      const result = await handleActivePing(
        {
          domain: 'youtube.com',
          deltaSeconds: request.deltaSeconds !== undefined ? request.deltaSeconds : 5,
          eventId: `yt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        },
        sender
      );
      sendResponse(result);
      return;
    }

    if (request.type === 'CHECK_INSTAGRAM_LOCK') {
      const rule = findRuleForHostname('instagram.com');
      const evalRes = rule ? evaluateRule(rule, new Date()) : { isBlocked: false };
      sendResponse({ isBlocked: evalRes.isBlocked });
      return;
    }

    if (request.type === 'EMERGENCY_OVERRIDE') {
      const result = await handleEmergencyOverride(request.domain);
      sendResponse(result);
      return;
    }

    if (request.type === 'PAIR_EXTENSION') {
      const result = await handlePairExtension(request.token);
      sendResponse(result);
      return;
    }

    if (request.type === 'UNPAIR_EXTENSION') {
      await chrome.storage.local.remove(['taskly_jwt_token', 'cached_rules']);
      authToken = null;
      cachedRules = [];
      apiSyncSucceeded = false;
      await syncDeclarativeNetRequestRules([]);
      sendResponse({ success: true });
      return;
    }

    if (request.type === 'REFRESH_RULES') {
      const rules = await refreshRules();
      sendResponse({ success: apiSyncSucceeded, rules, lastSync: lastSyncTimestamp, isApiConnected: apiSyncSucceeded });
      return;
    }

    if (request.type === 'API_CONFIG_UPDATED') {
      const config = await new Promise((resolve) => chrome.storage.local.get(['taskly_api_url'], resolve));
      API_BASE = normalizeExtensionApiBase(config.taskly_api_url);
      const rules = await refreshRules();
      sendResponse({ success: apiSyncSucceeded, rulesCount: rules.length, lastSync: lastSyncTimestamp, error: apiSyncSucceeded ? undefined : 'API is reachable, but authenticated rule synchronization did not succeed.' });
      return;
    }

    if (request.type === 'GET_STATUS') {
      sendResponse({
        isInitialized,
        isAuthenticated: Boolean(authToken),
        rulesCount: cachedRules.length,
        lastSync: lastSyncTimestamp,
        isApiConnected: apiSyncSucceeded,
      });
      return;
    }
  })();

  return true; // Keep message channel open for async response
});

async function handleActivePing(req, sender) {
  const rawDomain = req.domain || 'youtube.com';
  const deltaSeconds = req.deltaSeconds !== undefined && req.deltaSeconds !== null
    ? Math.max(0, parseInt(req.deltaSeconds, 10))
    : 5;
  const eventId = req.eventId || `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const rule = findRuleForHostname(rawDomain);
  const domain = rule ? rule.domain : rawDomain;

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
      if (rule) {
        rule.usedTodaySeconds = data.usedTodaySeconds;
        rule.inBreakUntil = data.inBreakUntil;
        rule.blockedUntil = data.blockedUntil;
        chrome.storage.local.set({ cached_rules: cachedRules });
      }

      // If transition occurred, sync DNR and broadcast to tabs
      if (data.status === 'break' || data.status === 'blocked') {
        await syncDeclarativeNetRequestRules(cachedRules);
        await broadcastRuleStateToTabs(domain, data);

        if (sender && sender.tab && sender.tab.id) {
          const blockUrl = chrome.runtime.getURL(
            `blocked.html?domain=${encodeURIComponent(domain)}&reason=${encodeURIComponent(
              data.reason || ''
            )}&countdown=${data.breakCountdownSeconds || 0}&targetUrl=${encodeURIComponent(
              sender.tab.url || ''
            )}&status=${data.status}`
          );
          chrome.tabs.update(sender.tab.id, { url: blockUrl });
        }
      }

      return data;
    }
  } catch (netErr) {
    // Network offline -> buffer event
  }

  // Offline buffer and local computation
  if (deltaSeconds > 0) {
    bufferEvent({ eventId, domain, deltaSeconds, timestamp: new Date().toISOString() });
  }
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
    } catch (e) {}
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

  if (deltaSeconds > 0) {
    rule.usedTodaySeconds = (rule.usedTodaySeconds || 0) + deltaSeconds;
  }

  let status = 'allowed';
  const shouldCheckCycle = Boolean(rule.cycleBreaksEnabled || rule.restrictionType === 'cycle');
  if (shouldCheckCycle) {
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

  chrome.storage.local.set({ cached_rules: cachedRules });
  syncDeclarativeNetRequestRules(cachedRules);

  return {
    status,
    domain: rule.domain,
    usedTodaySeconds: rule.usedTodaySeconds,
    remainingAllowanceSeconds: Math.max(0, (rule.dailyAllowanceSeconds || 0) - rule.usedTodaySeconds),
    inBreakUntil: rule.inBreakUntil,
    breakCountdownSeconds: rule.inBreakUntil ? Math.max(0, Math.round((new Date(rule.inBreakUntil) - now) / 1000)) : 0,
    reason: status === 'break' ? 'Mindful break in progress' : status === 'blocked' ? 'Daily quota reached' : 'Access allowed',
  };
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
    chrome.storage.local.set({ cached_rules: cachedRules });
    await syncDeclarativeNetRequestRules(cachedRules);
    await broadcastRuleStateToTabs(domain, { status: 'allowed' });
  }
  return { success: true };
}

async function handlePairExtension(tokenOrCode) {
  if (!tokenOrCode) return { success: false, error: 'Token or code required' };
  if (!API_BASE) return { success: false, error: 'Configure and validate the Taskly API URL in the extension popup first.' };

  let token = tokenOrCode.trim();

  // If user pasted a short pairing code (e.g. 6-8 alphanumeric chars like EXT-XXXXXX or TSK-XXXX), exchange it!
  if (token.length <= 16 && !token.includes('.')) {
    try {
      const res = await fetch(`${API_BASE}/auth/extension-exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairingCode: token }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.error || 'Invalid or expired pairing code' };
      }
      token = data.token;
    } catch (e) {
      return { success: false, error: 'Failed to connect to Taskly authentication server' };
    }
  }

  const previousToken = await getStoredToken();
  authToken = token;
  await new Promise((r) => chrome.storage.local.set({ taskly_jwt_token: token }, r));
  const rules = await refreshRules();
  if (!apiSyncSucceeded) {
    authToken = previousToken;
    await new Promise((r) => previousToken
      ? chrome.storage.local.set({ taskly_jwt_token: previousToken }, r)
      : chrome.storage.local.remove(['taskly_jwt_token'], r));
    return { success: false, error: 'Pairing token could not authenticate a current rules sync. Check API URL, account token, CORS, and backend logs.' };
  }
  return { success: true, rulesCount: rules.length };
}

async function checkAndEnforceSchedules() {
  await syncDeclarativeNetRequestRules(cachedRules);
}

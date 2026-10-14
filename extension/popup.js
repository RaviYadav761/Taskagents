async function getApiBase() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['taskly_api_url'], (res) => {
      resolve(res.taskly_api_url || '');
    });
  });
}

function normalizeApiUrl(value) {
  const url = new URL(String(value || '').trim());
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Enter an absolute API URL without credentials, query, or fragment.');
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Use HTTPS except for localhost development.');
  const path = url.pathname.replace(/\/+$/, '').replace(/(?:\/api)+$/i, '');
  return `${url.origin}${path}/api`;
}

async function getStoredToken() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['taskly_jwt_token'], (res) => {
      resolve(res.taskly_jwt_token || null);
    });
  });
}

function formatMinutes(seconds) {
  const mins = Math.round((seconds || 0) / 60);
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${mins}m`;
}

function getOriginPattern(domain, scope = 'entire_domain') {
  if (domain === 'youtube.com' || domain === 'instagram.com') {
    return `*://*.${domain}/*`;
  }
  return scope === 'hostname_only' ? `*://${domain}/*` : `*://*.${domain}/*`;
}

async function checkOriginPermission(domain, scope = 'entire_domain') {
  return new Promise((resolve) => {
    if (!chrome.permissions || !chrome.permissions.contains) {
      resolve(true);
      return;
    }
    if (domain === 'youtube.com' || domain === 'instagram.com') {
      resolve(true);
      return;
    }
    const origin = getOriginPattern(domain, scope);
    chrome.permissions.contains({ origins: [origin] }, (result) => {
      resolve(Boolean(result));
    });
  });
}

async function requestOriginPermission(domain, scope = 'entire_domain') {
  return new Promise((resolve) => {
    const origin = getOriginPattern(domain, scope);
    chrome.permissions.request({ origins: [origin] }, (granted) => {
      resolve(Boolean(granted));
    });
  });
}

async function loadRules() {
  const container = document.getElementById('rules-container');
  const token = await getStoredToken();
  const apiBase = await getApiBase();

  let rules = [];
  let syncError = null;
  try {
    if (!apiBase) throw new Error('API URL is not configured. Enter it below before syncing rules.');
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const res = await fetch(`${apiBase}/site-limits`, { headers });
    if (!res.ok) throw new Error(res.status === 401 || res.status === 403 ? `Authentication failed (HTTP ${res.status}). Relink the extension.` : `Taskly API returned HTTP ${res.status}.`);
    const data = await res.json();
    if (!data || !Array.isArray(data.limits)) throw new Error('Taskly API returned an invalid website-rules response.');
    rules = data.limits;
  } catch (e) {
    syncError = e.message || 'Could not reach the backend.';
    const errorEl = document.createElement('div');
    errorEl.style.cssText = 'font-size:11px;color:#b45309;padding:8px 2px;';
    errorEl.textContent = `${syncError} Cached rules are preserved; sync status is not current.`;
    container.replaceChildren(errorEl);
    const stored = await new Promise((r) =>
      chrome.storage.local.get(['cached_rules'], (s) => r(s.cached_rules || []))
    );
    rules = stored;
    if (!rules.length) return;
  }

  if (rules.length === 0) {
    container.innerHTML =
      '<div style="font-size: 12px; color: #888; text-align: center; padding: 20px;">No website rules configured yet. Add them in Taskly!</div>';
    return;
  }

  container.innerHTML = '';
  if (syncError) {
    const warning = document.createElement('div');
    warning.style.cssText = 'font-size:11px;color:#b45309;padding:8px 2px;';
    warning.textContent = `${syncError} Showing cached rules; sync status is not current.`;
    container.appendChild(warning);
  }

  for (const rule of rules) {
    const hasPerm = await checkOriginPermission(rule.domain, rule.scope);
    const card = document.createElement('div');
    card.className = 'card';

    let statusText = 'Allowed';
    let statusClass = 'badge badge-ok';

    if (rule.isBlocked) {
      statusText = 'Blocked';
      statusClass = 'badge badge-lock';
    } else if (rule.isInBreak) {
      statusText = `Break (${formatMinutes(rule.breakCountdownSeconds || 0)})`;
      statusClass = 'badge badge-warn';
    } else if (!rule.isEnabled) {
      statusText = 'Paused';
      statusClass = 'badge';
    }

    const usedFormatted = formatMinutes(rule.usedTodaySeconds);
    const allowanceFormatted =
      rule.dailyAllowanceSeconds > 0 ? formatMinutes(rule.dailyAllowanceSeconds) : 'Unlimited';

    // Describe rule features
    const details = [];
    if (rule.scheduleWindowEnabled || rule.restrictionType === 'schedule') {
      const policyLabel = rule.outsideWindowPolicy === 'block_outside' ? 'Allowed inside' : 'Restricted inside';
      details.push(`🕒 ${rule.scheduleStartTime || '09:00'}–${rule.scheduleEndTime || '12:00'} (${policyLabel})`);
    }
    if (rule.dailyQuotaEnabled !== false && rule.dailyAllowanceSeconds > 0) {
      details.push(`⏳ Quota: ${allowanceFormatted}`);
    }
    if (rule.cycleBreaksEnabled || rule.restrictionType === 'cycle') {
      details.push(
        `⏱️ Cycle: ${formatMinutes(rule.activeIntervalSeconds || 600)} use / ${formatMinutes(
          rule.breakSeconds || 600
        )} break`
      );
    }
    if (details.length === 0) {
      details.push(`Policy: ${rule.restrictionType || 'Standard'}`);
    }

    card.innerHTML = `
      <div class="card-header">
        <div class="site-title">
          <span>${rule.displayName || rule.domain}</span>
          <span style="font-size: 10px; font-weight: 500; color: #777;">(${rule.domain})</span>
        </div>
        <span class="${statusClass}">${statusText}</span>
      </div>
      <div style="font-size: 11px; color: #555; margin-bottom: 6px;">
        ${details.join(' • ')}
      </div>
      <div class="stat-row">
        <span>Usage Today:</span>
        <span class="stat-val">${usedFormatted} / ${allowanceFormatted}</span>
      </div>
      <div class="stat-row">
        <span>Permission:</span>
        <span class="stat-val" style="color: ${hasPerm ? '#16A34A' : '#DC2626'};">
          ${hasPerm ? '✓ Granted' : '⚠️ Action Required'}
        </span>
      </div>
      ${
        !hasPerm
          ? `
        <button class="perm-btn" data-domain="${rule.domain}" data-scope="${rule.scope || 'entire_domain'}">
          Grant Browser Access for ${rule.domain}
        </button>
      `
          : ''
      }
    `;

    container.appendChild(card);
  }

  // Bind permission buttons
  const permButtons = container.querySelectorAll('.perm-btn');
  permButtons.forEach((btn) => {
    btn.onclick = async () => {
      const targetDomain = btn.getAttribute('data-domain');
      const targetScope = btn.getAttribute('data-scope') || 'entire_domain';
      const granted = await requestOriginPermission(targetDomain, targetScope);
      if (granted) {
        alert(`Browser access granted for ${targetDomain}. This confirms site permission only; enforcement still requires a paired extension and a successful current rule sync.`);
        if (token) {
          fetch(`${apiBase}/site-limits/permission-status`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ domain: targetDomain, hasPermission: true }),
          }).catch(() => {});
        }
        chrome.runtime.sendMessage({ type: 'REFRESH_RULES' });
        loadRules();
      } else {
        alert(
          `Permission was denied for ${targetDomain}.\n\nIf Chrome blocked the prompt, open chrome://extensions/, select Taskly details, and enable site access.`
        );
      }
    };
  });
}

async function updateAccountStatus() {
  const token = await getStoredToken();
  const statusEl = document.getElementById('account-status');
  if (statusEl) {
    if (token) {
      statusEl.innerHTML = `<span style="color: #16A34A;">● Account linked (current sync status shown above)</span> <button id="unlink-btn" style="background: none; border: none; color: #DC2626; font-size: 10px; cursor: pointer; text-decoration: underline; margin-left: 6px;">Unlink</button>`;
      const unlinkBtn = document.getElementById('unlink-btn');
      if (unlinkBtn) {
        unlinkBtn.onclick = () => {
          chrome.storage.local.remove(['taskly_jwt_token', 'cached_rules'], () => {
            updateAccountStatus();
            loadRules();
          });
        };
      }
    } else {
      statusEl.innerHTML = `<span style="color: #D97706;">○ Not Paired (Enter code from Taskly)</span>`;
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.local.get(['taskly_api_url'], (res) => {
    const input = document.getElementById('api-url-input');
    if (input && res.taskly_api_url) input.value = res.taskly_api_url;
  });
  const saveApiBtn = document.getElementById('save-api-btn');
  if (saveApiBtn) saveApiBtn.onclick = async () => {
    const input = document.getElementById('api-url-input');
    const status = document.getElementById('api-status');
    saveApiBtn.disabled = true;
    try {
      const apiBase = normalizeApiUrl(input.value);
      const apiOrigin = new URL(apiBase).origin;
      const granted = await new Promise((resolve) => chrome.permissions.request({ origins: [`${apiOrigin}/*`] }, resolve));
      if (!granted) throw new Error(`Chrome host permission for ${apiOrigin} was not granted. Allow it and retry.`);
      const health = await fetch(`${apiBase}/health`, { signal: AbortSignal.timeout(5000) });
      if (!health.ok) throw new Error(`Backend health check failed (HTTP ${health.status}).`);
      const body = await health.json();
      if (body.status !== 'healthy' || body.database !== 'sqlite-connected') throw new Error('Backend health response is invalid or database is unhealthy.');
      await new Promise((resolve) => chrome.storage.local.set({ taskly_api_url: apiBase }, resolve));
      const response = await new Promise((resolve) => chrome.runtime.sendMessage({ type: 'API_CONFIG_UPDATED' }, resolve));
      status.textContent = response?.success
        ? `API healthy at ${apiOrigin}; synchronized ${response.rulesCount} rules.`
        : `API health passed and URL saved at ${apiOrigin}. Pair the extension for authenticated rule synchronization; enforcement is not confirmed.`;
      status.style.color = response?.success ? '#15803d' : '#b45309';
      await loadRules();
    } catch (error) {
      status.textContent = error.message || 'Unable to configure the API.';
      status.style.color = '#b91c1c';
    } finally { saveApiBtn.disabled = false; }
  };
  updateAccountStatus();
  loadRules();

  const refreshBtn = document.getElementById('refresh-btn');
  if (refreshBtn) {
    refreshBtn.onclick = () => {
      chrome.runtime.sendMessage({ type: 'REFRESH_RULES' }, () => {
        loadRules();
        updateAccountStatus();
      });
    };
  }

  const savePairBtn = document.getElementById('save-pair-btn');
  if (savePairBtn) {
    savePairBtn.onclick = () => {
      const input = document.getElementById('pair-token-input');
      const token = input.value.trim();
      if (!token) return;

      savePairBtn.disabled = true;
      savePairBtn.textContent = 'Linking...';

      chrome.runtime.sendMessage({ type: 'PAIR_EXTENSION', token }, (response) => {
        savePairBtn.disabled = false;
        savePairBtn.textContent = 'Link';
        if (response && response.success) {
          alert('Extension paired successfully with your Taskly account!');
          input.value = '';
          updateAccountStatus();
          loadRules();
        } else {
          alert(`Failed to pair: ${response?.error || 'Invalid code or connection error'}`);
        }
      });
    };
  }
});

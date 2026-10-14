// Local development may use the documented localhost default. Production must be explicitly configured.
export function normalizeApiBase(value, { production = false, development = false } = {}) {
  const raw = String(value || '').trim();
  if (!raw && development && !production) return 'http://localhost:4000/api';
  if (!raw) throw new Error('Taskly API is not configured. Set VITE_API_URL and rebuild/redeploy the frontend.');
  let parsed;
  try { parsed = new URL(raw); } catch { throw new Error('Invalid VITE_API_URL: use an absolute URL such as https://YOUR-ACTUAL-API-HOST/api.'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Invalid VITE_API_URL: use an HTTP(S) URL without credentials, query parameters, or fragments.');
  }
  if (production && parsed.protocol !== 'https:') throw new Error('Production requires VITE_API_URL to use HTTPS.');
  if (production && /(^|\.)localhost$|^127\./i.test(parsed.hostname)) throw new Error('Production VITE_API_URL cannot point to localhost. Configure your deployed HTTPS API host.');
  const path = parsed.pathname.replace(/\/+$/, '').replace(/(?:\/api)+$/i, '');
  return `${parsed.origin}${path}/api`;
}
let API_BASE = '';
let API_CONFIG_ERROR = '';
try {
  API_BASE = normalizeApiBase(import.meta.env?.VITE_API_URL, { production: import.meta.env?.PROD, development: import.meta.env?.DEV });
} catch (error) { API_CONFIG_ERROR = error.message; }
const LOCAL_AGENT_IPC = 'http://127.0.0.1:47891';

function diagnosticCategory(status) {
  if (status === 401 || status === 403) return 'authentication failure';
  if ([502, 503, 504].includes(status)) return 'unreachable backend';
  return 'HTTP error';
}
function remediation(category) {
  if (category === 'network failure') return 'Check the API URL and connectivity; this alone does not establish a CORS error.';
  if (category === 'unreachable backend') return 'Confirm the persistent backend service is running and reachable.';
  if (category === 'authentication failure') return 'Sign in again or relink the extension with a valid account.';
  if (category === 'invalid response') return 'Confirm the configured host serves the Taskly API and valid JSON.';
  return 'Inspect the backend response and server logs for this endpoint.';
}
// Wrap API fetches to log endpoint/status only—never request headers or credentials.
async function fetch(input, options = {}) {
  return fetchWithDiagnostics(input, options, true);
}
export async function requestWithDiagnostics(input, options = {}) {
  return fetchWithDiagnostics(input, options, false);
}
async function fetchWithDiagnostics(input, options, requireConfigured) {
  const url = String(input);
  const endpoint = (() => { try { return new URL(url, globalThis.location?.origin).pathname; } catch { return url.split('?')[0]; } })();
  const isJobCreate = endpoint.endsWith('/api/jobs');
  const ruleSaved = isJobCreate ? 'not confirmed by this failed request' : 'not applicable';
  if (requireConfigured && !API_BASE) throw new Error(`${API_CONFIG_ERROR || 'Taskly API URL is not configured.'} Request not sent: ${endpoint}`);
  try {
    const response = await globalThis.fetch(input, options);
    if (!response.ok) {
      const category = diagnosticCategory(response.status);
      console.error('[Taskly API]', { endpoint, category, status: response.status, responseReceived: true, ruleSaved, extensionConnectedAndSynced: 'not verified', remediation: remediation(category) });
    }
    return response;
  } catch (cause) {
    const category = cause?.name === 'AbortError' || cause?.name === 'TimeoutError' ? 'unreachable backend' : 'network failure';
    console.error('[Taskly API]', { endpoint, category, status: null, responseReceived: false, ruleSaved: isJobCreate ? 'unknown: server may have committed before connection failed' : 'not applicable', extensionConnectedAndSynced: 'not verified', remediation: remediation(category) });
    throw new Error(`${category === 'network failure' ? 'Network failure before an HTTP response' : 'Backend could not be reached'} at ${endpoint}. ${remediation(category)}`, { cause });
  }
}
async function parseResponse(res, endpoint) {
  try { return await res.json(); }
  catch { console.error('[Taskly API]', { endpoint, category: 'invalid response', status: res.status, responseReceived: true, remediation: remediation('invalid response') }); throw new Error(`Invalid response from ${endpoint} (HTTP ${res.status}). ${remediation('invalid response')}`); }
}

function getAuthHeader() {
  try {
    const token = localStorage.getItem('taskly_jwt_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch (e) {
    return {};
  }
}

export const api = {
  getApiBase() { if (!API_BASE) throw new Error(API_CONFIG_ERROR); return API_BASE; },
  async checkHealth() {
    const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(5000) });
    const data = await parseResponse(res, '/api/health');
    if (!res.ok) throw new Error(`${diagnosticCategory(res.status)} at /api/health (HTTP ${res.status}): ${data.error || remediation(diagnosticCategory(res.status))}`);
    if (data.status !== 'healthy' || data.database !== 'sqlite-connected') throw new Error('Invalid response from /api/health: backend/database is not healthy.');
    return data;
  },
  // Auth
  async register(email, password, fullName) {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, fullName }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Registration failed');
    if (data.token) localStorage.setItem('taskly_jwt_token', data.token);
    return data;
  },

  async login(email, password) {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    if (data.token) localStorage.setItem('taskly_jwt_token', data.token);
    return data;
  },

  async getCurrentUser() {
    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: { ...getAuthHeader() },
    });
    if (!res.ok) return null;
    return await res.json();
  },

  async generateExtensionPairingCode() {
    const res = await fetch(`${API_BASE}/auth/extension-code`, {
      method: 'POST',
      headers: { ...getAuthHeader() },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to generate extension code');
    return data;
  },

  async exchangeExtensionPairingCode(pairingCode) {
    const res = await fetch(`${API_BASE}/auth/extension-exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairingCode }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to exchange pairing code');
    return data;
  },

  // Jobs / Automations
  async getJobs() {
    const res = await fetch(`${API_BASE}/jobs`, {
      headers: { ...getAuthHeader() },
    });
    if (!res.ok) throw new Error('Failed to fetch jobs');
    return await res.json();
  },

  async createJob(jobData) {
    const res = await fetch(`${API_BASE}/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeader(),
      },
      body: JSON.stringify(jobData),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to create job');
    return data;
  },

  async updateJob(id, jobData) {
    const res = await fetch(`${API_BASE}/jobs/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeader(),
      },
      body: JSON.stringify(jobData),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update job');
    return data;
  },

  async deleteJob(id) {
    const res = await fetch(`${API_BASE}/jobs/${id}`, {
      method: 'DELETE',
      headers: { ...getAuthHeader() },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to delete job');
    return data;
  },

  async toggleJobStatus(id) {
    const res = await fetch(`${API_BASE}/jobs/${id}/toggle`, {
      method: 'POST',
      headers: { ...getAuthHeader() },
    });
    return await res.json();
  },

  async triggerJobNow(id) {
    const res = await fetch(`${API_BASE}/jobs/${id}/trigger`, {
      method: 'POST',
      headers: { ...getAuthHeader() },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to trigger job');
    return data;
  },

  // Executions History & Logs
  async getExecutions(limit = 50) {
    const res = await fetch(`${API_BASE}/executions?limit=${limit}`, {
      headers: { ...getAuthHeader() },
    });
    if (!res.ok) return { executions: [] };
    return await res.json();
  },

  async getExecutionById(id) {
    const res = await fetch(`${API_BASE}/executions/${id}`, {
      headers: { ...getAuthHeader() },
    });
    return await res.json();
  },

  async retryExecution(id) {
    const res = await fetch(`${API_BASE}/executions/${id}/retry`, {
      method: 'POST',
      headers: { ...getAuthHeader() },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to retry execution');
    return data;
  },

  // Devices & Pairing
  async getDevices() {
    const res = await fetch(`${API_BASE}/devices`, {
      headers: { ...getAuthHeader() },
    });
    if (!res.ok) return { devices: [] };
    return await res.json();
  },

  async generatePairingCode() {
    const res = await fetch(`${API_BASE}/devices/pair-code`, {
      method: 'POST',
      headers: { ...getAuthHeader() },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to generate code');
    return data;
  },

  async revokeDevice(id) {
    const res = await fetch(`${API_BASE}/devices/${id}`, {
      method: 'DELETE',
      headers: { ...getAuthHeader() },
    });
    return await res.json();
  },

  // Phase 2: Dynamic Website Restriction Rules & Usage Sync
  async getSiteLimits() {
    const res = await fetch(`${API_BASE}/site-limits`, {
      headers: { ...getAuthHeader() },
    });
    if (!res.ok) return { limits: [] };
    return await res.json();
  },

  async saveSiteLimitRule(ruleData) {
    const res = await fetch(`${API_BASE}/site-limits/rule`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeader(),
      },
      body: JSON.stringify(ruleData),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save website rule');
    return data;
  },

  async deleteSiteLimitRule(id) {
    const res = await fetch(`${API_BASE}/site-limits/rule/${id}`, {
      method: 'DELETE',
      headers: { ...getAuthHeader() },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to delete rule');
    return data;
  },

  async toggleSiteLimit(id) {
    const res = await fetch(`${API_BASE}/site-limits/toggle/${id}`, {
      method: 'POST',
      headers: { ...getAuthHeader() },
    });
    return await res.json();
  },

  async getSiteAnalytics({ range = '7days', domain = 'all' } = {}) {
    const res = await fetch(`${API_BASE}/site-limits/analytics?range=${range}&domain=${domain}`, {
      headers: { ...getAuthHeader() },
    });
    if (!res.ok) return { totals: {}, todaySnapshot: [], history: [] };
    return await res.json();
  },

  async syncSiteUsage(payload) {
    const res = await fetch(`${API_BASE}/site-limits/sync-usage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeader(),
      },
      body: JSON.stringify(payload),
    });
    return await res.json();
  },

  async updatePermissionStatus(domain, hasPermission = true) {
    const res = await fetch(`${API_BASE}/site-limits/permission-status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeader(),
      },
      body: JSON.stringify({ domain, hasPermission }),
    });
    return await res.json();
  },

  async toggleEmergencyOverride(domain, enable = true) {
    const res = await fetch(`${API_BASE}/site-limits/emergency-override`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeader(),
      },
      body: JSON.stringify({ domain, enable }),
    });
    return await res.json();
  },

  async toggleInstagramToday(block = true) {
    const res = await fetch(`${API_BASE}/site-limits/instagram-today`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeader(),
      },
      body: JSON.stringify({ block }),
    });
    return await res.json();
  },

  // Check Local Agent IPC directly
  async checkLocalAgent() {
    try {
      const res = await fetch(`${LOCAL_AGENT_IPC}/status`, { signal: AbortSignal.timeout(1500) });
      if (res.ok) {
        return { isOnline: true, data: await res.json() };
      }
    } catch (e) {}
    return { isOnline: false, data: null };
  },
};

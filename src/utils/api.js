// API Client for Taskly Automation Platform
const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) || 'http://localhost:4000/api';
const LOCAL_AGENT_IPC = 'http://127.0.0.1:47891';

function getAuthHeader() {
  try {
    const token = localStorage.getItem('taskly_jwt_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch (e) {
    return {};
  }
}

export const api = {
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

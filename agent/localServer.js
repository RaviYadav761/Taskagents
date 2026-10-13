import http from 'node:http';
import agentDb, { getConfig, setConfig } from './db.js';
import { executeLocalAction } from './executor.js';

const LOCAL_AGENT_PORT = 47891;

// Allowed origins for CORS to prevent unauthorized websites from accessing local IPC
function isOriginAllowed(origin) {
  if (!origin) return true; // Direct local calls (curl, background scripts)
  if (origin.startsWith('chrome-extension://')) return true;
  if (origin.startsWith('moz-extension://')) return true;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  return false;
}

export function startLocalAgentServer() {
  const server = http.createServer((req, res) => {
    const origin = req.headers.origin;

    if (isOriginAllowed(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin || '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    } else {
      // Reject unauthorized web origins
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Origin not allowed to access local Taskly IPC' }));
      return;
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    // GET /status: Health & connectivity
    if (req.method === 'GET' && url.pathname === '/status') {
      const deviceId = getConfig('deviceId', 'unpaired');
      const userId = getConfig('userId', 'unpaired');
      const serverUrl = getConfig('serverUrl', 'http://localhost:4000');

      const jobCount = agentDb.prepare('SELECT COUNT(*) as cnt FROM local_jobs').get()?.cnt || 0;
      const execCount = agentDb.prepare('SELECT COUNT(*) as cnt FROM local_executions').get()?.cnt || 0;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'online',
        deviceId,
        userId,
        serverUrl,
        jobCount,
        execCount,
        platform: process.platform,
        nodeVersion: process.version,
        uptime: Math.round(process.uptime()),
      }));
      return;
    }

    // GET /site-limits: Returns cached site limit rules
    if (req.method === 'GET' && url.pathname === '/site-limits') {
      const ytUsed = parseInt(getConfig('yt_used_today', '0'), 10);
      const ytAllowance = parseInt(getConfig('yt_allowance', '10800'), 10);
      const ytInterval = parseInt(getConfig('yt_interval', '600'), 10);
      const ytBreak = parseInt(getConfig('yt_break', '600'), 10);
      const ytBreakUntil = getConfig('yt_break_until', null);
      const ytOverride = getConfig('yt_override', '0') === '1';

      const igBlockedUntil = getConfig('ig_blocked_until', null);
      const igOverride = getConfig('ig_override', '0') === '1';

      const nowIso = new Date().toISOString();
      const inBreak = ytBreakUntil ? ytBreakUntil > nowIso : false;
      const ytBlocked = ytUsed >= ytAllowance;
      const igBlocked = igBlockedUntil ? igBlockedUntil > nowIso : false;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        youtube: {
          usedSeconds: ytUsed,
          allowanceSeconds: ytAllowance,
          remainingSeconds: Math.max(0, ytAllowance - ytUsed),
          inBreak,
          breakUntil: inBreak ? ytBreakUntil : null,
          isBlocked: ytBlocked,
          override: ytOverride,
        },
        instagram: {
          isBlockedToday: igBlocked,
          blockedUntil: igBlocked ? igBlockedUntil : null,
          override: igOverride,
        },
      }));
      return;
    }

    // POST /site-limits/sync: Dynamic domain usage sync from browser extension
    if (req.method === 'POST' && url.pathname === '/site-limits/sync') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try {
          const data = JSON.parse(body || '{}');
          const delta = parseInt(data.deltaSeconds || 5, 10);
          const domain = (data.domain || 'youtube.com').toLowerCase();

          const now = new Date();
          const nowIso = now.toISOString();

          // Reset check: check if date changed
          const today = now.toISOString().split('T')[0];
          const lastDate = getConfig(`date_${domain}`, today);
          if (lastDate !== today) {
            setConfig(`used_${domain}`, '0');
            setConfig(`break_${domain}`, '');
            setConfig(`override_${domain}`, '0');
            setConfig(`date_${domain}`, today);
            if (domain === 'instagram.com') {
              setConfig('ig_blocked_until', '');
            }
          }

          let used = parseInt(getConfig(`used_${domain}`, '0'), 10);
          const allowance = parseInt(getConfig(`allowance_${domain}`, domain === 'youtube.com' ? '10800' : '3600'), 10);
          const interval = parseInt(getConfig(`interval_${domain}`, '600'), 10);
          const breakDuration = parseInt(getConfig(`break_duration_${domain}`, '600'), 10);
          let breakUntil = getConfig(`break_${domain}`, null);
          const override = getConfig(`override_${domain}`, '0') === '1';

          if (override) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'allowed', domain, remainingSeconds: Math.max(0, allowance - used) }));
            return;
          }

          // Check if break active
          if (breakUntil && breakUntil > nowIso) {
            const secondsLeft = Math.round((new Date(breakUntil) - now) / 1000);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              status: 'break',
              domain,
              breakUntil,
              breakCountdownSeconds: secondsLeft,
              remainingSeconds: Math.max(0, allowance - used),
            }));
            return;
          }

          // Check if daily allowance hit
          if (allowance > 0 && used >= allowance) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              status: 'blocked',
              domain,
              remainingSeconds: 0,
              message: `Daily allowance (${Math.round(allowance / 3600)} hours) reached. Blocked until midnight.`,
            }));
            return;
          }

          // Accumulate usage
          used += delta;
          setConfig(`used_${domain}`, used);

          // Check interval
          let status = 'allowed';
          if (interval > 0 && used > 0 && used % interval < delta) {
            const endBreak = new Date(now.getTime() + breakDuration * 1000).toISOString();
            setConfig(`break_${domain}`, endBreak);
            breakUntil = endBreak;
            status = 'break';
          }

          if (allowance > 0 && used >= allowance) {
            status = 'blocked';
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            status,
            domain,
            usedSeconds: used,
            remainingSeconds: Math.max(0, allowance - used),
            breakUntil,
          }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // Authenticated privileged local execution trigger
    if (req.method === 'POST' && url.pathname.startsWith('/jobs/') && url.pathname.endsWith('/trigger')) {
      const parts = url.pathname.split('/');
      const jobId = parts[2];

      const stmt = agentDb.prepare('SELECT * FROM local_jobs WHERE id = ?');
      const job = stmt.get(jobId);

      if (!job) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Job not found in local agent' }));
        return;
      }

      executeLocalAction(job, 'manual_ipc_trigger').then((result) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, result }));
      }).catch((err) => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Endpoint not found' }));
  });

  server.listen(LOCAL_AGENT_PORT, '127.0.0.1', () => {
    console.log(`[Local Agent IPC] Secure Local API running on http://127.0.0.1:${LOCAL_AGENT_PORT}`);
  });

  return server;
}

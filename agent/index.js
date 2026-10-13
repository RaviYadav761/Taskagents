import agentDb, { getConfig, setConfig } from './db.js';
import { initializeScheduler, reloadAllSchedules } from './scheduler.js';
import { startLocalAgentServer } from './localServer.js';
import { executeLocalAction } from './executor.js';

const DEFAULT_SERVER_URL = process.env.TASKLY_SERVER_URL || 'http://localhost:4000';

async function pairWithServer(code, serverUrl = DEFAULT_SERVER_URL) {
  console.log(`[Taskly Agent] Pairing with server at ${serverUrl} using code: ${code}...`);
  try {
    const res = await fetch(`${serverUrl}/api/agent/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        deviceName: `${process.env.USER || 'User'}'s ${process.platform === 'darwin' ? 'Mac' : 'Computer'}`,
        platform: process.platform,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      console.error(`[Taskly Agent] Pairing failed: ${data.error || 'Server rejected code'}`);
      process.exit(1);
    }

    setConfig('authToken', data.authToken);
    setConfig('deviceId', data.deviceId);
    setConfig('userId', data.userId);
    setConfig('serverUrl', serverUrl);

    console.log(`✅ [Taskly Agent] Successfully paired!`);
    console.log(`Device ID: ${data.deviceId}`);
    console.log(`User ID: ${data.userId}`);
  } catch (err) {
    console.error(`[Taskly Agent] Connection error: ${err.message}`);
    process.exit(1);
  }
}

async function syncWithServer() {
  const authToken = getConfig('authToken');
  const serverUrl = getConfig('serverUrl', DEFAULT_SERVER_URL);

  if (!authToken) {
    console.log('[Taskly Agent] Note: Agent is running in standalone mode (unpaired). Use `node agent/index.js pair <CODE>` to link with your Taskly account.');
    return;
  }

  try {
    // 1. Heartbeat
    const heartRes = await fetch(`${serverUrl}/api/agent/heartbeat`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!heartRes.ok) {
      if (heartRes.status === 401) {
        console.warn('[Taskly Agent] Device token has been revoked on server.');
      }
      return;
    }

    // 2. Sync local jobs
    const syncRes = await fetch(`${serverUrl}/api/agent/sync-jobs`, {
      headers: { 'Authorization': `Bearer ${authToken}` },
    });

    if (syncRes.ok) {
      const { jobs } = await syncRes.json();
      const now = new Date().toISOString();

      // Upsert into local_jobs
      const upsertStmt = agentDb.prepare(`
        INSERT INTO local_jobs (
          id, title, action_type, action_payload, schedule_type, cron_expression,
          timezone, start_date, start_time, next_run_at, status, missed_policy, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          action_type = excluded.action_type,
          action_payload = excluded.action_payload,
          schedule_type = excluded.schedule_type,
          cron_expression = excluded.cron_expression,
          timezone = excluded.timezone,
          start_date = excluded.start_date,
          start_time = excluded.start_time,
          next_run_at = excluded.next_run_at,
          status = excluded.status,
          missed_policy = excluded.missed_policy,
          updated_at = excluded.updated_at
      `);

      for (const job of jobs) {
        upsertStmt.run(
          job.id,
          job.title,
          job.action_type,
          JSON.stringify(job.actionPayload || {}),
          job.scheduleType,
          job.cronExpression || null,
          job.timezone || 'Asia/Kolkata',
          job.startDate,
          job.startTime,
          job.nextRunAt,
          job.status,
          job.missedPolicy || 'run_once',
          now
        );
      }

      await reloadAllSchedules(reportExecutionToServer);
    }
  } catch (err) {
    // Server might be temporarily unreachable; local scheduling continues unaffected!
  }
}

async function reportExecutionToServer(report) {
  const authToken = getConfig('authToken');
  const serverUrl = getConfig('serverUrl', DEFAULT_SERVER_URL);
  if (!authToken) return;

  try {
    await fetch(`${serverUrl}/api/agent/report-execution`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(report),
    });
  } catch (err) {
    console.error('[Taskly Agent] Failed to report execution to server:', err.message);
  }
}

async function startAgent() {
  console.log('====================================================');
  console.log('🤖 Taskly Local Automation Agent (v1.0.0)');
  console.log(`Platform: ${process.platform} (${process.arch})`);
  console.log(`Node: ${process.version}`);
  console.log('====================================================');

  // 1. Start local IPC / HTTP server for browser extension
  startLocalAgentServer();

  // 2. Initialize scheduler (with startup downtime reconciliation)
  await initializeScheduler(reportExecutionToServer);

  // 3. Initial sync with server
  await syncWithServer();

  // 4. Periodic background sync every 15 seconds
  setInterval(syncWithServer, 15000);

  console.log('🚀 Taskly Local Agent is active and running in background.');
}

// CLI Argument Handling
const args = process.argv.slice(2);
const command = args[0] || 'start';

if (command === 'pair') {
  const code = args[1];
  const url = args[2] || DEFAULT_SERVER_URL;
  if (!code) {
    console.error('Usage: node agent/index.js pair <PAIRING_CODE> [SERVER_URL]');
    process.exit(1);
  }
  pairWithServer(code, url);
} else if (command === 'status') {
  const devId = getConfig('deviceId', 'unpaired');
  const userId = getConfig('userId', 'unpaired');
  const srv = getConfig('serverUrl', DEFAULT_SERVER_URL);
  const jobs = agentDb.prepare('SELECT COUNT(*) as c FROM local_jobs').get()?.c || 0;
  console.log(`Status: ${devId !== 'unpaired' ? 'PAIRED' : 'UNPAIRED'}`);
  console.log(`Device ID: ${devId}`);
  console.log(`User ID: ${userId}`);
  console.log(`Server URL: ${srv}`);
  console.log(`Local Jobs: ${jobs}`);
} else if (command === 'run') {
  const jobId = args[1];
  if (!jobId) {
    console.error('Usage: node agent/index.js run <JOB_ID>');
    process.exit(1);
  }
  const job = agentDb.prepare('SELECT * FROM local_jobs WHERE id = ?').get(jobId);
  if (!job) {
    console.error(`Job ${jobId} not found in local database.`);
    process.exit(1);
  }
  let payload = {};
  try { payload = JSON.parse(job.action_payload || '{}'); } catch (e) {}
  console.log(`Executing job ${job.title}...`);
  executeLocalAction(job.action_type, payload).then((res) => {
    console.log('Result:', res);
    process.exit(res.success ? 0 : 1);
  });
} else {
  startAgent();
}

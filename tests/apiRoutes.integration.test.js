import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

const databasePath = path.join(os.tmpdir(), `taskly-api-integration-${randomUUID()}.sqlite`);
const script = `
import assert from 'node:assert/strict';
const { default: app } = await import('./server/index.js');
const server = app.listen(0);
await new Promise((resolve) => server.once('listening', resolve));
const base = 'http://127.0.0.1:' + server.address().port + '/api';
try {
  const healthResponse = await fetch(base + '/health');
  const health = await healthResponse.json();
  assert.equal(healthResponse.status, 200);
  assert.equal(health.status, 'healthy');
  assert.equal(health.database, 'sqlite-connected');

  const corsResponse = await fetch(base + '/health', { headers: { Origin: 'http://allowed.test' } });
  assert.equal(corsResponse.headers.get('access-control-allow-origin'), 'http://allowed.test');

  const register = await fetch(base + '/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'integration@example.test', password: 'ValidPass123!', fullName: 'Integration' }),
  });
  assert.equal(register.status, 200, 'registration must seed default rules and succeed');
  const { token } = await register.json();
  const auth = { Authorization: 'Bearer ' + token };

  const payload = {
    clientRequestId: 'validation-request-0001', title: 'Restrict example', actionType: 'restrict_website',
    actionPayload: { websiteUrl: 'https://example.org', scope: 'entire_domain', restrictionType: 'daily_limit', dailyQuotaEnabled: true, dailyAllowanceSeconds: 3600, cycleBreaksEnabled: false },
    scheduleType: 'daily', timezone: 'UTC',
  };
  const options = { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) };
  const firstResponse = await fetch(base + '/jobs', options);
  assert.equal(firstResponse.status, 201);
  const first = await firstResponse.json();
  assert.ok(first.job?.id);
  assert.equal(first.siteLimit?.domain, 'example.org');

  const retryResponse = await fetch(base + '/jobs', options);
  assert.equal(retryResponse.status, 200);
  const retry = await retryResponse.json();
  assert.equal(retry.idempotentReplay, true);
  assert.equal(retry.job.id, first.job.id);

  const jobs = await (await fetch(base + '/jobs', { headers: auth })).json();
  const limits = await (await fetch(base + '/site-limits', { headers: auth })).json();
  assert.equal(jobs.jobs.filter((job) => job.title === 'Restrict example').length, 1);
  assert.equal(limits.limits.filter((rule) => rule.domain === 'example.org').length, 1);
  assert.ok(limits.limits.some((rule) => rule.domain === 'instagram.com'));
  console.log('PASS health CORS registration atomic-job-rule idempotent-retry');
} finally {
  server.close();
  setTimeout(() => process.exit(0), 25);
}
`;

test('API routes: register, atomically persist a website restriction and safely deduplicate retries', () => {
  try {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: 'test',
        JWT_SECRET: 'isolated-integration-test-secret',
        TASKLY_DB_PATH: databasePath,
        CORS_ORIGINS: 'http://allowed.test',
      },
      encoding: 'utf8',
      timeout: 15000,
    });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /PASS health CORS registration atomic-job-rule idempotent-retry/);
  } finally {
    for (const suffix of ['', '-shm', '-wal']) fs.rmSync(`${databasePath}${suffix}`, { force: true });
  }
});

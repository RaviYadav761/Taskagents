import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { api, normalizeApiBase, requestWithDiagnostics } from '../src/utils/api.js';

describe('Frontend API configuration', () => {
  it('uses localhost only when explicitly in development mode', () => {
    assert.equal(normalizeApiBase('', { development: true }), 'http://localhost:4000/api');
  });
  it('requires a URL when not in development mode', () => {
    assert.throws(() => normalizeApiBase('', { production: true }), /not configured/);
    assert.throws(() => normalizeApiBase('', {}), /not configured/);
    assert.throws(() => api.getApiBase(), /not configured/);
  });
  it('normalizes /api and repeated /api suffixes safely', () => {
    assert.equal(normalizeApiBase('https://api.example.test/api'), 'https://api.example.test/api');
    assert.equal(normalizeApiBase('https://api.example.test/api/api/'), 'https://api.example.test/api');
    assert.equal(normalizeApiBase('https://api.example.test/v1/api'), 'https://api.example.test/v1/api');
  });
  it('rejects HTTP and localhost in production', () => {
    assert.throws(() => normalizeApiBase('http://api.example.test/api', { production: true }), /HTTPS/);
    assert.throws(() => normalizeApiBase('https://localhost:4000/api', { production: true }), /localhost/);
  });
  it('rejects invalid, credentialed and query-bearing URLs', () => {
    assert.throws(() => normalizeApiBase('not a url', { development: true }), /Invalid VITE_API_URL/);
    assert.throws(() => normalizeApiBase('https://user:pass@example.test/api', {}), /without credentials/);
    assert.throws(() => normalizeApiBase('https://api.example.test/api?token=x', {}), /without credentials/);
  });
  it('reports an unreachable API as a pre-response network failure, not a proven CORS error', async () => {
    const records = [];
    const originalError = console.error;
    console.error = (...args) => records.push(args);
    try {
      await assert.rejects(
        requestWithDiagnostics('http://127.0.0.1:1/api/site-limits', { signal: AbortSignal.timeout(3000) }),
        /Network failure before an HTTP response/
      );
    } finally { console.error = originalError; }
    const diagnostic = records.find(([label]) => label === '[Taskly API]')?.[1];
    assert.equal(diagnostic.endpoint, '/api/site-limits');
    assert.equal(diagnostic.status, null);
    assert.equal(diagnostic.responseReceived, false);
    assert.equal(diagnostic.category, 'network failure');
    assert.match(diagnostic.remediation, /does not establish a CORS error/);
  });
});

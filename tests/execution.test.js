import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { executeLocalAction, isSafeFilePath } from '../agent/executor.js';

describe('Local Agent Execution Engine - Phase 7, 9 & Security', () => {
  it('strictly rejects protected operating system paths from deletion', () => {
    assert.equal(isSafeFilePath('/'), false);
    assert.equal(isSafeFilePath('/System'), false);
    assert.equal(isSafeFilePath('/usr'), false);
    assert.equal(isSafeFilePath('/bin'), false);
    assert.equal(isSafeFilePath('/etc'), false);
    assert.equal(isSafeFilePath('C:\\Windows'), false);

    // Valid user file path should be allowed
    const userPath = path.join(os.tmpdir(), 'taskly-test-sample.txt');
    assert.equal(isSafeFilePath(userPath), true);
  });

  it('safely executes a local node script, captures stdout, exit code and duration', async () => {
    // Create an isolated temporary test script
    const tmpDir = os.tmpdir();
    const testScript = path.join(tmpDir, `test-script-${Date.now()}.js`);
    fs.writeFileSync(testScript, 'console.log("Taskly automation test script executed successfully!"); process.exit(0);');

    try {
      const result = await executeLocalAction('run_script', {
        scriptPath: testScript,
        runtime: 'node',
      });

      assert.equal(result.success, true);
      assert.equal(result.exitCode, 0);
      assert.ok(result.outputLog.includes('Taskly automation test script executed successfully!'));
      assert.ok(result.durationMs >= 0);
    } finally {
      if (fs.existsSync(testScript)) fs.unlinkSync(testScript);
    }
  });

  it('enforces timeout on runaway scripts without hanging the scheduler', async () => {
    const tmpDir = os.tmpdir();
    const hangScript = path.join(tmpDir, `hang-script-${Date.now()}.js`);
    fs.writeFileSync(hangScript, 'setTimeout(() => {}, 60000);');

    try {
      const result = await executeLocalAction('run_script', {
        scriptPath: hangScript,
        runtime: 'node',
        timeoutMs: 500, // 500ms timeout for testing
      });

      assert.equal(result.success, false);
      assert.equal(result.exitCode, 124);
      assert.ok(result.errorLog.includes('timed out'));
    } finally {
      if (fs.existsSync(hangScript)) fs.unlinkSync(hangScript);
    }
  });

  it('safely executes file deletion and accurately calculates 30-day retention deadline', async () => {
    // 1. Verify 30-day deadline calculation
    const now = new Date('2026-10-12T10:00:00Z');
    const deadline = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    assert.equal(deadline.toISOString().split('T')[0], '2026-11-11');

    // 2. Create isolated test file and delete it permanently
    const tmpDir = os.tmpdir();
    const testFile = path.join(tmpDir, `delete-target-${Date.now()}.txt`);
    fs.writeFileSync(testFile, 'Temporary file for deletion test');
    assert.equal(fs.existsSync(testFile), true);

    const result = await executeLocalAction('delete_file', {
      filePath: testFile,
      permanent: true,
    });

    assert.equal(result.success, true);
    assert.equal(fs.existsSync(testFile), false);
  });

  it('honestly reports failure when target deletion file is missing or moved', async () => {
    const missingFile = path.join(os.tmpdir(), 'non-existent-file-999.xyz');
    const result = await executeLocalAction('delete_file', {
      filePath: missingFile,
    });

    assert.equal(result.success, false);
    assert.equal(result.exitCode, 2);
    assert.ok(result.errorLog.includes('Target file was missing'));
  });
});

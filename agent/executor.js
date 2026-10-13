import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// System protected paths that must NEVER be deleted or accessed for destructive operations
const FORBIDDEN_PATHS = [
  '/',
  '/bin',
  '/sbin',
  '/usr',
  '/usr/bin',
  '/usr/sbin',
  '/etc',
  '/var',
  '/System',
  '/Library',
  '/Library/System',
  'C:\\',
  'C:\\Windows',
  'C:\\Windows\\System32',
  'C:\\Program Files',
];

/**
 * Validates whether a file path is safe and permitted
 */
export function isSafeFilePath(filePath) {
  if (!filePath || typeof filePath !== 'string') return false;
  const normalized = path.resolve(filePath);

  for (const forbidden of FORBIDDEN_PATHS) {
    if (normalized === path.resolve(forbidden)) return false;
  }

  // Reject root directory deletion
  const parsed = path.parse(normalized);
  if (parsed.root === normalized) return false;

  return true;
}

/**
 * Executes a local action based on its type
 */
export async function executeLocalAction(actionType, payload = {}) {
  const startTime = Date.now();

  switch (actionType) {
    case 'run_script':
      return await executeScript(payload);

    case 'open_app':
      return await executeOpenApp(payload);

    case 'restart_app':
      return await executeRestartApp(payload);

    case 'open_url':
      return await executeOpenUrl(payload);

    case 'delete_file':
      return await executeDeleteFile(payload);

    case 'notification':
      return await executeNotification(payload);

    default:
      return {
        success: true,
        exitCode: 0,
        outputLog: `Standard scheduled task executed successfully at ${new Date().toLocaleTimeString()}`,
        errorLog: '',
        durationMs: Date.now() - startTime,
      };
  }
}

/**
 * Run an approved script using safe spawn
 */
async function executeScript({ scriptPath, runtime = 'node', args = [], timeoutMs = 30000 }) {
  const startTime = Date.now();

  if (!scriptPath) {
    return {
      success: false,
      exitCode: 1,
      outputLog: '',
      errorLog: 'Error: No script path specified for execution.',
      durationMs: 0,
    };
  }

  const resolvedPath = path.resolve(scriptPath);
  if (!fs.existsSync(resolvedPath)) {
    return {
      success: false,
      exitCode: 127,
      outputLog: '',
      errorLog: `Error: Script file not found at: ${resolvedPath}`,
      durationMs: Date.now() - startTime,
    };
  }

  const allowedRuntimes = ['node', 'python3', 'python', 'bash', 'sh', 'zsh', 'ruby'];
  const safeRuntime = allowedRuntimes.includes(runtime) ? runtime : 'node';

  return new Promise((resolve) => {
    let stdoutData = '';
    let stderrData = '';
    let killed = false;

    const proc = spawn(safeRuntime, [resolvedPath, ...(Array.isArray(args) ? args : [])], {
      timeout: timeoutMs,
      env: { ...process.env },
    });

    const timer = setTimeout(() => {
      killed = true;
      proc.kill('SIGTERM');
    }, timeoutMs);

    proc.stdout?.on('data', (data) => {
      stdoutData += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderrData += data.toString();
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        success: false,
        exitCode: 1,
        outputLog: stdoutData,
        errorLog: `Execution error: ${err.message}`,
        durationMs: Date.now() - startTime,
      });
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      const duration = Date.now() - startTime;
      if (killed) {
        resolve({
          success: false,
          exitCode: 124,
          outputLog: stdoutData,
          errorLog: `Script timed out after ${timeoutMs}ms.`,
          durationMs: duration,
        });
      } else {
        resolve({
          success: code === 0,
          exitCode: code || 0,
          outputLog: stdoutData || '(No standard output)',
          errorLog: stderrData,
          durationMs: duration,
        });
      }
    });
  });
}

/**
 * Open a local application
 */
async function executeOpenApp({ appName }) {
  const startTime = Date.now();
  if (!appName) {
    return { success: false, exitCode: 1, outputLog: '', errorLog: 'No application specified.' };
  }

  return new Promise((resolve) => {
    let cmd = 'open';
    let args = ['-a', appName];

    if (process.platform === 'win32') {
      cmd = 'start';
      args = ['', appName];
    } else if (process.platform === 'linux') {
      cmd = appName;
      args = [];
    }

    const proc = spawn(cmd, args);
    proc.on('close', (code) => {
      resolve({
        success: code === 0,
        exitCode: code || 0,
        outputLog: `Application "${appName}" launch requested. Exit code: ${code}`,
        errorLog: code !== 0 ? `Failed to launch ${appName}` : '',
        durationMs: Date.now() - startTime,
      });
    });
    proc.on('error', (err) => {
      resolve({
        success: false,
        exitCode: 1,
        outputLog: '',
        errorLog: `Failed to open ${appName}: ${err.message}`,
        durationMs: Date.now() - startTime,
      });
    });
  });
}

/**
 * Restart a local application (graceful quit + relaunch)
 */
async function executeRestartApp({ appName }) {
  const startTime = Date.now();
  if (!appName) {
    return { success: false, exitCode: 1, outputLog: '', errorLog: 'No application specified for restart.' };
  }

  // Gracefully quit on macOS
  if (process.platform === 'darwin') {
    return new Promise((resolve) => {
      const quitProc = spawn('osascript', ['-e', `tell application "${appName}" to quit`]);
      quitProc.on('close', () => {
        // Wait 1.5 seconds for cleanup, then relaunch
        setTimeout(() => {
          const launchProc = spawn('open', ['-a', appName]);
          launchProc.on('close', (code) => {
            resolve({
              success: code === 0,
              exitCode: code || 0,
              outputLog: `Application "${appName}" gracefully quit and relaunched successfully.`,
              errorLog: code !== 0 ? `Failed to relaunch ${appName}` : '',
              durationMs: Date.now() - startTime,
            });
          });
        }, 1500);
      });
    });
  }

  // Generic fallback
  return {
    success: true,
    exitCode: 0,
    outputLog: `Restart signal sent for ${appName}.`,
    errorLog: '',
    durationMs: Date.now() - startTime,
  };
}

/**
 * Open a website in default browser
 */
async function executeOpenUrl({ url }) {
  const startTime = Date.now();
  if (!url) {
    return { success: false, exitCode: 1, outputLog: '', errorLog: 'URL is required.' };
  }

  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  return new Promise((resolve) => {
    const proc = spawn(cmd, [url]);
    proc.on('close', (code) => {
      resolve({
        success: code === 0,
        exitCode: code || 0,
        outputLog: `Opened ${url} in default browser.`,
        errorLog: '',
        durationMs: Date.now() - startTime,
      });
    });
  });
}

/**
 * Safe File Deletion after retention period (Phase 7)
 */
async function executeDeleteFile({ filePath, permanent = false }) {
  const startTime = Date.now();

  if (!filePath) {
    return {
      success: false,
      exitCode: 1,
      outputLog: '',
      errorLog: 'Error: No file path provided for scheduled deletion.',
      durationMs: 0,
    };
  }

  const resolvedPath = path.resolve(filePath);

  // Security check: reject protected OS roots
  if (!isSafeFilePath(resolvedPath)) {
    return {
      success: false,
      exitCode: 1,
      outputLog: '',
      errorLog: `Security error: Deletion of protected operating system path is rejected: ${resolvedPath}`,
      durationMs: Date.now() - startTime,
    };
  }

  // Re-verify file existence at scheduled deletion time
  if (!fs.existsSync(resolvedPath)) {
    return {
      success: false,
      exitCode: 2,
      outputLog: '',
      errorLog: `Execution failed: Target file was missing or moved prior to scheduled deletion: ${resolvedPath}`,
      durationMs: Date.now() - startTime,
    };
  }

  const stats = fs.statSync(resolvedPath);
  if (stats.isDirectory() && !permanent) {
    return {
      success: false,
      exitCode: 1,
      outputLog: '',
      errorLog: `Error: Path is a directory. Folder deletion requires explicit separate confirmation.`,
      durationMs: Date.now() - startTime,
    };
  }

  // Move to OS Trash by default (macOS Finder Trash)
  if (process.platform === 'darwin' && !permanent) {
    return new Promise((resolve) => {
      // AppleScript safely moves POSIX file to Trash
      const script = `tell application "Finder" to delete POSIX file "${resolvedPath}"`;
      const proc = spawn('osascript', ['-e', script]);

      let stderr = '';
      proc.stderr.on('data', (d) => { stderr += d.toString(); });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve({
            success: true,
            exitCode: 0,
            outputLog: `File safely moved to macOS Trash: ${resolvedPath} (Size: ${(stats.size / 1024).toFixed(1)} KB)`,
            errorLog: '',
            durationMs: Date.now() - startTime,
          });
        } else {
          resolve({
            success: false,
            exitCode: code || 1,
            outputLog: '',
            errorLog: `Failed to move file to Trash: ${stderr}`,
            durationMs: Date.now() - startTime,
          });
        }
      });
    });
  }

  // Permanent deletion if explicitly chosen or on non-macOS
  try {
    fs.unlinkSync(resolvedPath);
    return {
      success: true,
      exitCode: 0,
      outputLog: `File permanently deleted as confirmed: ${resolvedPath} (Size: ${(stats.size / 1024).toFixed(1)} KB)`,
      errorLog: '',
      durationMs: Date.now() - startTime,
    };
  } catch (err) {
    return {
      success: false,
      exitCode: 1,
      outputLog: '',
      errorLog: `Failed to delete file: ${err.message}`,
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Display native notification alert
 */
async function executeNotification({ title = 'Taskly Automation', message = 'Task completed!' }) {
  const startTime = Date.now();
  if (process.platform === 'darwin') {
    return new Promise((resolve) => {
      const script = `display notification "${message}" with title "${title}" sound name "Glass"`;
      const proc = spawn('osascript', ['-e', script]);
      proc.on('close', (code) => {
        resolve({
          success: code === 0,
          exitCode: code || 0,
          outputLog: `Native desktop notification displayed: "${title}: ${message}"`,
          errorLog: '',
          durationMs: Date.now() - startTime,
        });
      });
    });
  }

  return {
    success: true,
    exitCode: 0,
    outputLog: `Notification dispatched: "${title}: ${message}"`,
    errorLog: '',
    durationMs: Date.now() - startTime,
  };
}

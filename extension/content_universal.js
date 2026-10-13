// Universal Content Script for Taskly Website Restrictions
(function () {
  if (window.__taskly_injected) return;
  window.__taskly_injected = true;

  let overlayElement = null;
  let pingInterval = null;
  let countdownTimer = null;
  let currentCountdown = 0;

  function getHostname() {
    return window.location.hostname.toLowerCase().replace(/^www\./, '');
  }

  function isUserActivelyViewing() {
    return document.visibilityState === 'visible' && document.hasFocus();
  }

  function pauseAllMedia() {
    try {
      const media = document.querySelectorAll('video, audio');
      media.forEach((m) => {
        if (!m.paused) m.pause();
      });
    } catch (e) {}
  }

  function showOverlay({ type, countdownSeconds, message, domainName }) {
    pauseAllMedia();
    currentCountdown = countdownSeconds || 0;

    if (!overlayElement) {
      overlayElement = document.createElement('div');
      overlayElement.id = 'taskly-universal-overlay';
      overlayElement.style.cssText = `
        position: fixed !important;
        inset: 0 !important;
        z-index: 2147483647 !important;
        background: rgba(15, 17, 23, 0.95) !important;
        backdrop-filter: blur(20px) !important;
        display: flex !important;
        flex-direction: column !important;
        align-items: center !important;
        justify-content: center !important;
        color: #F8FAFC !important;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
        padding: 24px !important;
        box-sizing: border-box !important;
      `;
      document.body.appendChild(overlayElement);
    }

    const host = domainName || getHostname();
    const isBreak = type === 'break';
    const mins = Math.floor(currentCountdown / 60);
    const secs = currentCountdown % 60;
    const timeDisplay = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    overlayElement.innerHTML = `
      <div style="background: #1C1E28; border: 1px solid rgba(255,255,255,0.12); border-radius: 28px; max-width: 500px; width: 100%; padding: 36px 32px; text-align: center; box-shadow: 0 24px 48px rgba(0,0,0,0.6);">
        <div style="width: 60px; height: 60px; border-radius: 22px; background: ${isBreak ? '#10B981' : '#E11D48'}; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center; font-size: 28px; box-shadow: 0 10px 20px rgba(0,0,0,0.3);">
          ${isBreak ? '☕' : '🔒'}
        </div>
        <h2 style="font-size: 24px; font-weight: 800; margin: 0 0 8px; color: #FFFFFF; letter-spacing: -0.5px;">
          ${isBreak ? 'Mindful Break in Progress' : `${host} is Restricted`}
        </h2>
        <p style="font-size: 14px; color: #94A3B8; margin: 0 0 24px; line-height: 1.5;">
          ${message || (isBreak
            ? `You have reached your active viewing threshold on ${host}. Take a moment to rest your eyes and stretch.`
            : `Access to ${host} is restricted according to your Taskly automation rule.`)}
        </p>

        ${isBreak ? `
          <div style="background: #262938; border-radius: 20px; padding: 18px 24px; margin-bottom: 24px; display: inline-block;">
            <span style="font-size: 11px; font-weight: 700; color: #10B981; text-transform: uppercase; letter-spacing: 1px; display: block; margin-bottom: 4px;">Remaining Break Time</span>
            <span id="taskly-break-clock" style="font-size: 38px; font-weight: 900; color: #FFFFFF; font-family: monospace;">${timeDisplay}</span>
          </div>
        ` : ''}

        <div style="display: flex; gap: 12px; justify-content: center; align-items: center;">
          <button id="taskly-emergency-override" style="background: transparent; border: 1px solid rgba(255,255,255,0.2); color: #94A3B8; padding: 10px 18px; border-radius: 14px; font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.2s;">
            Emergency Override
          </button>
        </div>
      </div>
    `;

    // Local ticking clock
    if (countdownTimer) clearInterval(countdownTimer);
    if (isBreak && currentCountdown > 0) {
      countdownTimer = setInterval(() => {
        currentCountdown = Math.max(0, currentCountdown - 1);
        const clockEl = document.getElementById('taskly-break-clock');
        if (clockEl) {
          const m = Math.floor(currentCountdown / 60);
          const s = currentCountdown % 60;
          clockEl.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        }
        if (currentCountdown <= 0) {
          clearInterval(countdownTimer);
          ping(); // Re-verify status
        }
      }, 1000);
    }

    const overrideBtn = overlayElement.querySelector('#taskly-emergency-override');
    if (overrideBtn) {
      overrideBtn.onclick = () => {
        if (confirm(`Emergency override will unlock access to ${host} for the rest of today. Continue?`)) {
          chrome.runtime.sendMessage({ type: 'EMERGENCY_OVERRIDE', domain: host }, () => {
            removeOverlay();
          });
        }
      };
    }
  }

  function removeOverlay() {
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
    if (overlayElement && overlayElement.parentNode) {
      overlayElement.parentNode.removeChild(overlayElement);
      overlayElement = null;
    }
  }

  function ping() {
    if (!isUserActivelyViewing()) return;

    const hostname = getHostname();
    const eventId = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    chrome.runtime.sendMessage(
      {
        type: 'ACTIVE_TAB_PING',
        domain: hostname,
        deltaSeconds: 5,
        eventId,
      },
      (response) => {
        if (chrome.runtime.lastError || !response) return;

        if (response.status === 'break') {
          showOverlay({
            type: 'break',
            countdownSeconds: response.breakCountdownSeconds || 600,
            domainName: hostname,
          });
        } else if (response.status === 'blocked') {
          showOverlay({
            type: 'blocked',
            message: response.message || `Daily allowance or scheduled restriction active on ${hostname}.`,
            domainName: hostname,
          });
        } else {
          removeOverlay();
        }
      }
    );
  }

  // Ping every 5 seconds
  pingInterval = setInterval(ping, 5000);
  document.addEventListener('visibilitychange', ping);
  window.addEventListener('focus', ping);

  // Initial check on load
  ping();
})();

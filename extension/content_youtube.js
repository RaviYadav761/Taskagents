// Content Script for YouTube: Enforces 10m/10m break and 3hr daily limit
(function () {
  let overlayElement = null;
  let pingInterval = null;

  function isUserActivelyViewing() {
    return document.visibilityState === 'visible' && document.hasFocus();
  }

  function pauseAllVideos() {
    try {
      const videos = document.querySelectorAll('video');
      videos.forEach((v) => {
        if (!v.paused) v.pause();
      });
    } catch (e) {}
  }

  function showOverlay({ type, countdownSeconds, message }) {
    pauseAllVideos();

    if (!overlayElement) {
      overlayElement = document.createElement('div');
      overlayElement.id = 'taskly-youtube-overlay';
      overlayElement.style.cssText = `
        position: fixed !important;
        inset: 0 !important;
        z-index: 2147483647 !important;
        background: rgba(15, 17, 23, 0.94) !important;
        backdrop-filter: blur(16px) !important;
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

    const mins = Math.floor((countdownSeconds || 0) / 60);
    const secs = (countdownSeconds || 0) % 60;
    const timeDisplay = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    overlayElement.innerHTML = `
      <div style="background: #1C1E28; border: 1px solid rgba(255,255,255,0.1); border-radius: 28px; max-width: 480px; width: 100%; padding: 36px 32px; text-align: center; box-shadow: 0 20px 40px rgba(0,0,0,0.5);">
        <div style="width: 56px; height: 56px; border-radius: 20px; background: #10B981; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center; font-size: 26px;">
          ${type === 'break' ? '☕' : '🔒'}
        </div>
        <h2 style="font-size: 24px; font-weight: 800; margin: 0 0 10px; color: #FFFFFF; letter-spacing: -0.5px;">
          ${type === 'break' ? 'Mindful Break in Progress' : 'Daily YouTube Limit Reached'}
        </h2>
        <p style="font-size: 14px; color: #94A3B8; margin: 0 0 24px; line-height: 1.5;">
          ${message || (type === 'break'
            ? 'You have enjoyed 10 minutes of active viewing. Take a quick 10-minute break to rest your eyes and stretch.'
            : 'You have consumed your full 3-hour daily YouTube allowance. Access is locked until midnight reset.')}
        </p>

        ${type === 'break' ? `
          <div style="background: #262938; border-radius: 20px; padding: 18px 24px; margin-bottom: 24px; display: inline-block;">
            <span style="font-size: 12px; font-weight: 600; color: #10B981; text-transform: uppercase; letter-spacing: 1px; display: block; margin-bottom: 4px;">Remaining Break Time</span>
            <span style="font-size: 38px; font-weight: 900; color: #FFFFFF; font-family: monospace;">${timeDisplay}</span>
          </div>
        ` : ''}

        <div style="display: flex; gap: 12px; justify-content: center;">
          <button id="taskly-override-btn" style="background: transparent; border: 1px solid rgba(255,255,255,0.2); color: #94A3B8; padding: 10px 18px; border-radius: 14px; font-size: 12px; font-weight: 600; cursor: pointer;">
            Emergency Override
          </button>
        </div>
      </div>
    `;

    const overrideBtn = overlayElement.querySelector('#taskly-override-btn');
    if (overrideBtn) {
      overrideBtn.onclick = () => {
        if (confirm('Warning: Emergency override will bypass your scheduled Taskly habit restriction for the remainder of today. Are you sure you wish to continue?')) {
          chrome.runtime.sendMessage({ type: 'EMERGENCY_OVERRIDE' }, () => {
            removeOverlay();
          });
        }
      };
    }
  }

  function removeOverlay() {
    if (overlayElement && overlayElement.parentNode) {
      overlayElement.parentNode.removeChild(overlayElement);
      overlayElement = null;
    }
  }

  function ping() {
    if (!isUserActivelyViewing()) return;

    chrome.runtime.sendMessage({ type: 'YOUTUBE_ACTIVE_PING', deltaSeconds: 5 }, (response) => {
      if (!response) return;

      if (response.status === 'break') {
        showOverlay({
          type: 'break',
          countdownSeconds: response.breakCountdownSeconds || 600,
        });
      } else if (response.status === 'blocked') {
        showOverlay({
          type: 'blocked',
          message: 'Daily 3-hour YouTube allowance has been exhausted. Resets at midnight.',
        });
      } else {
        removeOverlay();
      }
    });
  }

  pingInterval = setInterval(ping, 5000);
  document.addEventListener('visibilitychange', ping);
  window.addEventListener('focus', ping);
})();

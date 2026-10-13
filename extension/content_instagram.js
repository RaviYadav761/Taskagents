// Content Script for Instagram: Enforces "Today Only" block
(function () {
  let blockOverlay = null;

  function showInstagramBlock(blockedUntil) {
    if (blockOverlay) return;

    blockOverlay = document.createElement('div');
    blockOverlay.id = 'taskly-instagram-block';
    blockOverlay.style.cssText = `
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

    blockOverlay.innerHTML = `
      <div style="background: #1C1E28; border: 1px solid rgba(255,255,255,0.12); border-radius: 30px; max-width: 480px; width: 100%; padding: 40px 32px; text-align: center; box-shadow: 0 24px 48px rgba(0,0,0,0.6);">
        <div style="width: 60px; height: 60px; border-radius: 22px; background: linear-gradient(135deg, #F58529, #DD2A7B, #8134AF); margin: 0 auto 20px; display: flex; align-items: center; justify-content: center; font-size: 28px;">
          📵
        </div>
        <h2 style="font-size: 24px; font-weight: 800; margin: 0 0 10px; color: #FFFFFF; letter-spacing: -0.5px;">
          Instagram is Blocked for Today
        </h2>
        <p style="font-size: 14px; color: #94A3B8; margin: 0 0 20px; line-height: 1.5;">
          You scheduled an automation in Taskly to block Instagram for today. This restriction will automatically expire at local midnight.
        </p>

        <div style="background: #262938; border-radius: 16px; padding: 14px 20px; margin-bottom: 24px; display: inline-block;">
          <span style="font-size: 11px; font-weight: 700; color: #E11D48; text-transform: uppercase; letter-spacing: 0.5px; display: block;">Status</span>
          <span style="font-size: 14px; font-weight: 600; color: #FFFFFF;">One-Time Block Active (Today Only)</span>
        </div>

        <div>
          <button id="taskly-ig-override" style="background: transparent; border: 1px solid rgba(255,255,255,0.2); color: #94A3B8; padding: 10px 18px; border-radius: 14px; font-size: 12px; font-weight: 600; cursor: pointer;">
            Emergency Override
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(blockOverlay);

    const btn = blockOverlay.querySelector('#taskly-ig-override');
    if (btn) {
      btn.onclick = () => {
        if (confirm('Bypassing your Instagram block will unlock access for today. Do you wish to override?')) {
          chrome.runtime.sendMessage({ type: 'EMERGENCY_OVERRIDE' }, () => {
            if (blockOverlay && blockOverlay.parentNode) {
              blockOverlay.parentNode.removeChild(blockOverlay);
              blockOverlay = null;
            }
          });
        }
      };
    }
  }

  function check() {
    chrome.runtime.sendMessage({ type: 'CHECK_INSTAGRAM_LOCK' }, (res) => {
      if (res && res.isBlocked) {
        showInstagramBlock(res.blockedUntil);
      }
    });
  }

  check();
  setInterval(check, 10000);
})();

// Taskly Dedicated Blocking & Break Screen Controller
(function () {
  const urlParams = new URLSearchParams(window.location.search);
  const domain = urlParams.get('domain') || 'Website';
  const reason = urlParams.get('reason') || 'Access to this website is restricted according to your Taskly automation rule.';
  const targetUrl = urlParams.get('targetUrl') || `https://${domain}`;
  const policy = urlParams.get('policy') || 'Standard Policy';
  let countdownSeconds = parseInt(urlParams.get('countdown') || '0', 10);
  const isBreak = countdownSeconds > 0 || (urlParams.get('status') === 'break');

  // DOM Elements
  const titleEl = document.getElementById('title');
  const domainTagEl = document.getElementById('domain-tag');
  const messageEl = document.getElementById('message');
  const iconBoxEl = document.getElementById('icon-box');
  const countdownCardEl = document.getElementById('countdown-card');
  const countdownLabelEl = document.getElementById('countdown-label');
  const countdownTimerEl = document.getElementById('countdown-timer');
  const policyValEl = document.getElementById('policy-val');
  const nextAccessValEl = document.getElementById('next-access-val');
  const overrideBtn = document.getElementById('override-btn');
  const dashboardBtn = document.getElementById('dashboard-btn');

  // Set initial text
  if (domainTagEl) domainTagEl.textContent = domain;
  if (messageEl) messageEl.textContent = reason;
  if (policyValEl) policyValEl.textContent = policy.replace(/_/g, ' ').toUpperCase();

  function formatTime(secs) {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  if (isBreak) {
    if (titleEl) titleEl.textContent = 'Mindful Break in Progress';
    if (iconBoxEl) {
      iconBoxEl.className = 'icon-box icon-break';
      iconBoxEl.textContent = '☕';
    }
    if (countdownCardEl) countdownCardEl.style.display = 'inline-block';
    if (countdownLabelEl) countdownLabelEl.textContent = 'Remaining Break Time';
    if (countdownTimerEl) countdownTimerEl.textContent = formatTime(countdownSeconds);
    if (nextAccessValEl) nextAccessValEl.textContent = 'After break countdown';

    // Start live countdown
    const timer = setInterval(() => {
      countdownSeconds = Math.max(0, countdownSeconds - 1);
      if (countdownTimerEl) countdownTimerEl.textContent = formatTime(countdownSeconds);

      if (countdownSeconds <= 0) {
        clearInterval(timer);
        // Ask background worker if break is complete and site is eligible
        if (chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage(
            { type: 'ACTIVE_TAB_PING', domain, deltaSeconds: 0 },
            (resp) => {
              if (resp && resp.status === 'allowed') {
                window.location.href = targetUrl;
              } else {
                window.location.reload();
              }
            }
          );
        } else {
          window.location.href = targetUrl;
        }
      }
    }, 1000);
  } else {
    if (titleEl) titleEl.textContent = `${domain} Access Restricted`;
    if (iconBoxEl) {
      iconBoxEl.className = 'icon-box icon-blocked';
      iconBoxEl.textContent = '🔒';
    }
    if (countdownCardEl) countdownCardEl.style.display = 'none';
    if (nextAccessValEl) {
      nextAccessValEl.textContent = urlParams.get('nextAccess') || '12:00 AM Midnight';
    }
  }

  // Emergency override
  if (overrideBtn) {
    overrideBtn.onclick = () => {
      if (confirm(`Emergency override will unlock access to ${domain} for the remainder of today. Are you sure?`)) {
        if (chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({ type: 'EMERGENCY_OVERRIDE', domain }, () => {
            window.location.href = targetUrl;
          });
        } else {
          window.location.href = targetUrl;
        }
      }
    };
  }

  // Dashboard button
  if (dashboardBtn) {
    dashboardBtn.onclick = () => {
      chrome.storage.local.get(['taskly_web_url'], (res) => {
        const dashboardUrl = res.taskly_web_url || 'http://localhost:5173/';
        if (chrome.tabs && chrome.tabs.create) {
          chrome.tabs.create({ url: dashboardUrl });
        } else {
          window.location.href = dashboardUrl;
        }
      });
    };
  }
})();

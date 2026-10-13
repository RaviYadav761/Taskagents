/**
 * Client-side URL parsing, validation and domain normalization utility for Taskly
 */

const UNSAFE_SCHEMES = new Set([
  'javascript:',
  'data:',
  'file:',
  'about:',
  'blob:',
  'chrome:',
  'edge:',
  'moz-extension:',
  'chrome-extension:',
  'vbscript:',
]);

const BRANDED_NAMES = {
  'youtube.com': 'YouTube',
  'instagram.com': 'Instagram',
  'reddit.com': 'Reddit',
  'web.whatsapp.com': 'WhatsApp Web',
  'whatsapp.com': 'WhatsApp',
  'facebook.com': 'Facebook',
  'twitter.com': 'Twitter / X',
  'x.com': 'X (Twitter)',
  'linkedin.com': 'LinkedIn',
  'tiktok.com': 'TikTok',
  'netflix.com': 'Netflix',
  'twitch.tv': 'Twitch',
  'github.com': 'GitHub',
  'discord.com': 'Discord',
  'amazon.com': 'Amazon',
  'pinterest.com': 'Pinterest',
};

export function parseAndNormalizeWebsite(inputUrl, scope = 'entire_domain') {
  if (!inputUrl || typeof inputUrl !== 'string') {
    return { valid: false, error: 'Website URL or domain is required' };
  }

  const trimmed = inputUrl.trim();
  if (trimmed.length === 0) {
    return { valid: false, error: 'Website URL cannot be empty' };
  }

  const lowerInput = trimmed.toLowerCase();
  for (const unsafe of UNSAFE_SCHEMES) {
    if (lowerInput.startsWith(unsafe)) {
      return { valid: false, error: `Unsafe scheme "${unsafe}" is prohibited` };
    }
  }

  let urlToParse = trimmed;
  if (!/^https?:\/\//i.test(trimmed)) {
    urlToParse = `https://${trimmed}`;
  }

  let parsed;
  try {
    parsed = new URL(urlToParse);
  } catch (err) {
    return { valid: false, error: 'Invalid URL format' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, error: `Only HTTP and HTTPS supported (received ${parsed.protocol})` };
  }

  let hostname = parsed.hostname.toLowerCase();
  if (hostname.includes(':')) {
    hostname = hostname.split(':')[0];
  }

  if (!hostname || hostname.length < 3 || (!hostname.includes('.') && hostname !== 'localhost')) {
    return { valid: false, error: 'Invalid domain name or hostname' };
  }

  if (!/^[a-z0-9.-]+$/.test(hostname)) {
    return { valid: false, error: 'Domain contains invalid characters' };
  }

  let normalizedDomain = hostname;
  if (scope === 'entire_domain') {
    if (normalizedDomain.startsWith('www.')) {
      normalizedDomain = normalizedDomain.slice(4);
    }
  }

  let displayName = BRANDED_NAMES[normalizedDomain];
  if (!displayName && normalizedDomain.startsWith('www.')) {
    displayName = BRANDED_NAMES[normalizedDomain.slice(4)];
  }

  if (!displayName) {
    const parts = normalizedDomain.split('.');
    if (parts.length >= 2) {
      displayName = parts[parts.length - 2].charAt(0).toUpperCase() + parts[parts.length - 2].slice(1);
    } else {
      displayName = normalizedDomain;
    }
  }

  return {
    valid: true,
    originalUrl: trimmed,
    normalizedDomain,
    displayName,
    scope: scope === 'hostname_only' ? 'hostname_only' : 'entire_domain',
  };
}

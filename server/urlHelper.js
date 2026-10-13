/**
 * URL parsing, validation and domain normalization utility for Taskly
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

/**
 * Known branded website display names and icons
 */
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

/**
 * Validate and normalize a website URL or domain entry.
 *
 * @param {string} inputUrl - The raw input URL or domain string.
 * @param {string} scope - 'entire_domain' or 'hostname_only'. Default 'entire_domain'.
 * @returns {{ valid: boolean, error?: string, originalUrl?: string, normalizedDomain?: string, displayName?: string, scope?: string }}
 */
export function parseAndNormalizeWebsite(inputUrl, scope = 'entire_domain') {
  if (!inputUrl || typeof inputUrl !== 'string') {
    return { valid: false, error: 'Website URL or domain is required' };
  }

  const trimmed = inputUrl.trim();
  if (trimmed.length === 0) {
    return { valid: false, error: 'Website URL cannot be empty' };
  }

  // Check explicitly for unsafe schemes before URL parsing
  const lowerInput = trimmed.toLowerCase();
  for (const unsafe of UNSAFE_SCHEMES) {
    if (lowerInput.startsWith(unsafe)) {
      return { valid: false, error: `Unsafe URL scheme "${unsafe}" is strictly prohibited` };
    }
  }

  // Prepend https:// if no scheme provided
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

  // Reject non-http(s) protocols
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, error: `Only HTTP and HTTPS websites are supported (received: ${parsed.protocol})` };
  }

  let hostname = parsed.hostname.toLowerCase();

  // Strip port if present
  if (hostname.includes(':')) {
    hostname = hostname.split(':')[0];
  }

  // Reject invalid hostnames
  if (!hostname || hostname.length < 3 || !hostname.includes('.') && hostname !== 'localhost') {
    return { valid: false, error: 'Invalid domain name or hostname' };
  }

  // Character validation: only letters, numbers, hyphens, and dots
  if (!/^[a-z0-9.-]+$/.test(hostname)) {
    return { valid: false, error: 'Domain name contains invalid characters' };
  }

  // Calculate normalized domain based on scope
  let normalizedDomain = hostname;
  if (scope === 'entire_domain') {
    // If scope is entire domain, strip leading "www." for broader subdomain matching
    if (normalizedDomain.startsWith('www.')) {
      normalizedDomain = normalizedDomain.slice(4);
    }
  } else {
    // Hostname only: preserve specific subdomain e.g. web.whatsapp.com
    normalizedDomain = hostname;
  }

  // Generate friendly display name
  let displayName = BRANDED_NAMES[normalizedDomain];
  if (!displayName) {
    if (normalizedDomain.startsWith('www.')) {
      displayName = BRANDED_NAMES[normalizedDomain.slice(4)];
    }
  }

  if (!displayName) {
    // Humanize hostname: "sub.example.com" -> "Sub Example"
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

/**
 * Checks whether a given request hostname matches a rule's domain and scope.
 *
 * @param {string} requestHostname - e.g. 'm.youtube.com' or 'www.youtube.com'
 * @param {string} ruleDomain - e.g. 'youtube.com'
 * @param {string} scope - 'entire_domain' or 'hostname_only'
 * @returns {boolean}
 */
export function matchDomain(requestHostname, ruleDomain, scope = 'entire_domain') {
  if (!requestHostname || !ruleDomain) return false;
  const cleanReq = requestHostname.toLowerCase().replace(/:\d+$/, '');
  const cleanRule = ruleDomain.toLowerCase();

  if (cleanReq === cleanRule) return true;

  if (scope === 'entire_domain') {
    // Matches subdomains e.g. 'sub.example.com' matches 'example.com'
    if (cleanReq.endsWith(`.${cleanRule}`)) {
      return true;
    }
    // Also match if rule had 'www.' stripped
    if (cleanReq.startsWith('www.') && cleanReq.slice(4) === cleanRule) {
      return true;
    }
  }

  return false;
}

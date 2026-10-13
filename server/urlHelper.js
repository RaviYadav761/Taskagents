/**
 * Authoritative URL parsing, validation, service profiles, and domain normalization utility for Taskly.
 * Shared contract across Server, Frontend, and Chrome Extension.
 */

export const UNSAFE_SCHEMES = new Set([
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
  'ws:',
  'wss:',
]);

/**
 * Recognized service profiles with canonical domains, aliases, and display metadata.
 */
export const SERVICE_PROFILES = {
  youtube: {
    id: 'youtube',
    displayName: 'YouTube',
    canonicalDomain: 'youtube.com',
    domains: ['youtube.com', 'youtu.be'],
    icon: 'youtube',
    description: 'Video streaming platform (youtube.com, youtu.be, subdomains)',
  },
  instagram: {
    id: 'instagram',
    displayName: 'Instagram',
    canonicalDomain: 'instagram.com',
    domains: ['instagram.com', 'instagr.am'],
    icon: 'instagram',
    description: 'Social photo & video sharing (instagram.com, instagr.am)',
  },
  whatsapp: {
    id: 'whatsapp',
    displayName: 'WhatsApp',
    canonicalDomain: 'whatsapp.com',
    domains: ['whatsapp.com', 'web.whatsapp.com', 'api.whatsapp.com', 'wa.me'],
    icon: 'whatsapp',
    description: 'WhatsApp Web & messaging service',
  },
  facebook: {
    id: 'facebook',
    displayName: 'Facebook',
    canonicalDomain: 'facebook.com',
    domains: ['facebook.com', 'fb.com'],
    icon: 'facebook',
    description: 'Social networking service (facebook.com, fb.com)',
  },
  twitter: {
    id: 'twitter',
    displayName: 'X (Twitter)',
    canonicalDomain: 'x.com',
    domains: ['x.com', 'twitter.com', 't.co'],
    icon: 'twitter',
    description: 'Microblogging platform (x.com, twitter.com)',
  },
  reddit: {
    id: 'reddit',
    displayName: 'Reddit',
    canonicalDomain: 'reddit.com',
    domains: ['reddit.com', 'redd.it'],
    icon: 'reddit',
    description: 'Community discussion & forum (reddit.com, redd.it)',
  },
  github: {
    id: 'github',
    displayName: 'GitHub',
    canonicalDomain: 'github.com',
    domains: ['github.com'],
    icon: 'github',
    description: 'Software development & code hosting platform',
  },
  linkedin: {
    id: 'linkedin',
    displayName: 'LinkedIn',
    canonicalDomain: 'linkedin.com',
    domains: ['linkedin.com'],
    icon: 'linkedin',
    description: 'Professional networking platform',
  },
  netflix: {
    id: 'netflix',
    displayName: 'Netflix',
    canonicalDomain: 'netflix.com',
    domains: ['netflix.com'],
    icon: 'netflix',
    description: 'Movies & TV streaming service',
  },
  twitch: {
    id: 'twitch',
    displayName: 'Twitch',
    canonicalDomain: 'twitch.tv',
    domains: ['twitch.tv'],
    icon: 'twitch',
    description: 'Live gaming & video streaming',
  },
  discord: {
    id: 'discord',
    displayName: 'Discord',
    canonicalDomain: 'discord.com',
    domains: ['discord.com', 'discord.gg', 'discordapp.com'],
    icon: 'discord',
    description: 'Voice, video, and text communication platform',
  },
  tiktok: {
    id: 'tiktok',
    displayName: 'TikTok',
    canonicalDomain: 'tiktok.com',
    domains: ['tiktok.com'],
    icon: 'tiktok',
    description: 'Short-form video platform',
  },
};

/**
 * Resolve a given hostname to a known service profile if recognized.
 * @param {string} hostname
 * @returns {object|null}
 */
export function resolveServiceProfile(hostname) {
  if (!hostname || typeof hostname !== 'string') return null;
  const clean = hostname.toLowerCase().replace(/:\d+$/, '').replace(/^\.+|\.+$/g, '');
  const cleanNoWww = clean.startsWith('www.') ? clean.slice(4) : clean;

  for (const key of Object.keys(SERVICE_PROFILES)) {
    const profile = SERVICE_PROFILES[key];
    for (const d of profile.domains) {
      if (clean === d || cleanNoWww === d || clean.endsWith(`.${d}`)) {
        return profile;
      }
    }
  }
  return null;
}

/**
 * Humanize an unknown hostname into a friendly title.
 * e.g. "docs.google.com" -> "Google Docs", "news.ycombinator.com" -> "News Ycombinator"
 */
function humanizeHostname(hostname) {
  if (!hostname) return 'Website';
  let host = hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'localhost') return 'Localhost';

  const parts = host.split('.');
  if (parts.length >= 2) {
    const domainName = parts[parts.length - 2];
    return domainName.charAt(0).toUpperCase() + domainName.slice(1);
  }
  return hostname;
}

/**
 * Validate and normalize a website URL or domain entry.
 *
 * @param {string} inputUrl - The raw input URL or domain string.
 * @param {string} scope - 'entire_domain' or 'hostname_only'. Default 'entire_domain'.
 * @returns {{
 *   valid: boolean,
 *   error?: string,
 *   originalUrl?: string,
 *   normalizedDomain?: string,
 *   displayName?: string,
 *   scope?: string,
 *   serviceId?: string|null,
 *   coveredDomains?: string[],
 *   faviconUrl?: string
 * }}
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

  // Reject embedded credentials e.g. https://user:pass@evil.com
  if (/^[a-z]+:\/\/[^/]+:[^/]+@/i.test(trimmed)) {
    return { valid: false, error: 'URLs containing embedded credentials are not permitted' };
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

  // Reject embedded username/password parsed by URL
  if (parsed.username || parsed.password) {
    return { valid: false, error: 'URLs containing embedded credentials are not permitted' };
  }

  let hostname = parsed.hostname.toLowerCase().replace(/^\.+|\.+$/g, '');

  // Strip port if present
  if (hostname.includes(':')) {
    hostname = hostname.split(':')[0];
  }

  // Reject invalid hostnames
  if (!hostname || hostname.length < 3 || (!hostname.includes('.') && hostname !== 'localhost')) {
    return { valid: false, error: 'Invalid domain name or hostname' };
  }

  // Reject consecutive dots or invalid punctuation
  if (hostname.includes('..') || hostname.startsWith('-') || hostname.endsWith('-')) {
    return { valid: false, error: 'Domain name contains invalid punctuation' };
  }

  // Character validation: letters, numbers, hyphens, and dots
  if (!/^[a-z0-9.-]+$/.test(hostname)) {
    return { valid: false, error: 'Domain name contains invalid characters' };
  }

  // Check known service profile
  const profile = resolveServiceProfile(hostname);

  let normalizedDomain = hostname;
  let displayName = '';
  let serviceId = null;
  let coveredDomains = [];

  if (profile && scope !== 'hostname_only') {
    serviceId = profile.id;
    displayName = hostname === 'web.whatsapp.com' ? 'WhatsApp Web' : profile.displayName;
    normalizedDomain = profile.canonicalDomain;
    coveredDomains = [...profile.domains];
  } else if (profile && scope === 'hostname_only') {
    serviceId = profile.id;
    displayName = hostname === 'web.whatsapp.com' ? 'WhatsApp Web' : profile.displayName;
    normalizedDomain = hostname;
    coveredDomains = [hostname];
  } else {
    if (scope === 'entire_domain') {
      // If scope is entire domain, strip leading "www." for broad domain matching
      if (normalizedDomain.startsWith('www.')) {
        normalizedDomain = normalizedDomain.slice(4);
      }
    }
    displayName = humanizeHostname(normalizedDomain);
    coveredDomains = [normalizedDomain];
  }

  // Safe client favicon URL (using only normalized domain, no query parameters or paths)
  const faviconUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(normalizedDomain)}&sz=64`;

  return {
    valid: true,
    originalUrl: trimmed,
    normalizedDomain,
    displayName,
    scope: scope === 'hostname_only' ? 'hostname_only' : 'entire_domain',
    serviceId,
    coveredDomains,
    faviconUrl,
  };
}

/**
 * Checks whether a given request hostname matches a rule's domain and scope.
 * Strictly enforces domain boundaries (e.g. reddit.com does NOT match notreddit.com).
 *
 * @param {string} requestHostname - e.g. 'm.youtube.com' or 'www.youtube.com'
 * @param {string} ruleDomain - e.g. 'youtube.com'
 * @param {string} scope - 'entire_domain' or 'hostname_only'
 * @param {string[]} [coveredDomains] - optional list of service aliases
 * @returns {boolean}
 */
export function matchDomain(requestHostname, ruleDomain, scope = 'entire_domain', coveredDomains = null) {
  if (!requestHostname || !ruleDomain) return false;

  const cleanReq = requestHostname.toLowerCase().replace(/:\d+$/, '').replace(/^\.+|\.+$/g, '');
  const cleanRule = ruleDomain.toLowerCase().replace(/:\d+$/, '').replace(/^\.+|\.+$/g, '');

  // If coveredDomains provided, check against all aliases
  const targetDomains = Array.isArray(coveredDomains) && coveredDomains.length > 0
    ? coveredDomains.map((d) => d.toLowerCase())
    : [cleanRule];

  // Only expand known service profiles when scope is NOT hostname_only
  if (scope !== 'hostname_only') {
    const profile = resolveServiceProfile(cleanRule);
    if (profile && !targetDomains.includes(profile.canonicalDomain)) {
      targetDomains.push(...profile.domains);
    }
  }

  for (const domain of targetDomains) {
    const dNoWww = domain.startsWith('www.') ? domain.slice(4) : domain;
    const reqNoWww = cleanReq.startsWith('www.') ? cleanReq.slice(4) : cleanReq;

    // 1. Exact hostname match (with or without www)
    if (cleanReq === domain || reqNoWww === dNoWww) {
      return true;
    }

    // 2. Entire domain scope (matches subdomains with boundary check: *.domain)
    if (scope === 'entire_domain') {
      // Subdomain check with strict boundary: cleanReq must end with '.dNoWww'
      if (cleanReq.endsWith(`.${dNoWww}`)) {
        return true;
      }
      if (reqNoWww.endsWith(`.${dNoWww}`)) {
        return true;
      }
    }
  }

  return false;
}

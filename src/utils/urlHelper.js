/**
 * Authoritative Client-Side URL parsing, validation, service profiles, and domain normalization utility for Taskly.
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
      return { valid: false, error: `Unsafe URL scheme "${unsafe}" is strictly prohibited` };
    }
  }

  if (/^[a-z]+:\/\/[^/]+:[^/]+@/i.test(trimmed)) {
    return { valid: false, error: 'URLs containing embedded credentials are not permitted' };
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
    return { valid: false, error: `Only HTTP and HTTPS websites are supported (received: ${parsed.protocol})` };
  }

  if (parsed.username || parsed.password) {
    return { valid: false, error: 'URLs containing embedded credentials are not permitted' };
  }

  let hostname = parsed.hostname.toLowerCase().replace(/^\.+|\.+$/g, '');

  if (hostname.includes(':')) {
    hostname = hostname.split(':')[0];
  }

  if (!hostname || hostname.length < 3 || (!hostname.includes('.') && hostname !== 'localhost')) {
    return { valid: false, error: 'Invalid domain name or hostname' };
  }

  if (hostname.includes('..') || hostname.startsWith('-') || hostname.endsWith('-')) {
    return { valid: false, error: 'Domain name contains invalid punctuation' };
  }

  if (!/^[a-z0-9.-]+$/.test(hostname)) {
    return { valid: false, error: 'Domain name contains invalid characters' };
  }

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
      if (normalizedDomain.startsWith('www.')) {
        normalizedDomain = normalizedDomain.slice(4);
      }
    }
    displayName = humanizeHostname(normalizedDomain);
    coveredDomains = [normalizedDomain];
  }

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

export function matchDomain(requestHostname, ruleDomain, scope = 'entire_domain', coveredDomains = null) {
  if (!requestHostname || !ruleDomain) return false;

  const cleanReq = requestHostname.toLowerCase().replace(/:\d+$/, '').replace(/^\.+|\.+$/g, '');
  const cleanRule = ruleDomain.toLowerCase().replace(/:\d+$/, '').replace(/^\.+|\.+$/g, '');

  const targetDomains = Array.isArray(coveredDomains) && coveredDomains.length > 0
    ? coveredDomains.map((d) => d.toLowerCase())
    : [cleanRule];

  if (scope !== 'hostname_only') {
    const profile = resolveServiceProfile(cleanRule);
    if (profile && !targetDomains.includes(profile.canonicalDomain)) {
      targetDomains.push(...profile.domains);
    }
  }

  for (const domain of targetDomains) {
    const dNoWww = domain.startsWith('www.') ? domain.slice(4) : domain;
    const reqNoWww = cleanReq.startsWith('www.') ? cleanReq.slice(4) : cleanReq;

    if (cleanReq === domain || reqNoWww === dNoWww) {
      return true;
    }

    if (scope === 'entire_domain') {
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

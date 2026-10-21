/**
 * Small, dependency-free URL parser. React Native's built-in URL class is only
 * partially implemented, so we parse the parts we need ourselves.
 */
export interface ParsedUrl {
  href: string;
  protocol: 'http' | 'https';
  host: string; // lower-cased, without port and without leading "www." / "m."
  rawHost: string;
  pathname: string;
  query: Record<string, string>;
}

const URL_RE = /^(https?):\/\/(?:[^@/?#\s]+@)?([^:/?#\s]+)(?::(\d{1,5}))?(\/[^?#\s]*)?(?:\?([^#\s]*))?(?:#\S*)?$/i;

export function normalizeInput(input: string): string {
  let text = input.trim();
  // Shared text often contains extra words: pick the first URL-like token.
  const match = text.match(/https?:\/\/\S+/i);
  if (match) text = match[0];
  else if (/^(www\.|m\.)?[a-z0-9-]+(\.[a-z0-9-]+)+\//i.test(text)) text = `https://${text}`;
  return text.replace(/[)\].,;!'"]+$/, '');
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s;
  }
}

export function parseUrl(input: string): ParsedUrl | null {
  const href = normalizeInput(input);
  const m = href.match(URL_RE);
  if (!m) return null;
  const rawHost = m[2].toLowerCase();
  // Require a dot-separated hostname with a valid TLD-ish ending.
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(rawHost) && !/^\d{1,3}(\.\d{1,3}){3}$/.test(rawHost)) {
    return null;
  }
  const query: Record<string, string> = {};
  (m[5] ?? '').split('&').forEach((pair) => {
    if (!pair) return;
    const [k, ...rest] = pair.split('=');
    query[safeDecode(k)] = safeDecode(rest.join('='));
  });
  return {
    href,
    protocol: m[1].toLowerCase() as 'http' | 'https',
    rawHost,
    host: rawHost.replace(/^(www\.|m\.|mobile\.)/, ''),
    pathname: m[4] || '/',
    query,
  };
}

export function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Resolve a possibly-relative URL against a base URL (RFC 3986 subset).
 * React Native's URL class is incomplete, so this is implemented by hand.
 */
export function resolveUrl(base: string, ref: string): string {
  const r = ref.trim();
  if (!r) return base;
  if (/^[a-z][a-z0-9+.-]*:/i.test(r)) return r; // absolute
  const m = base.match(/^([a-z][a-z0-9+.-]*:)\/\/([^/?#]*)([^?#]*)(\?[^#]*)?/i);
  if (!m) return r;
  const [, scheme, authority, basePath] = m;
  if (r.startsWith('//')) return `${scheme}${r}`;
  if (r.startsWith('?')) return `${scheme}//${authority}${basePath || '/'}${r}`;
  if (r.startsWith('#')) return `${base.split('#')[0]}${r}`;

  let path: string;
  let suffix = '';
  const qIdx = r.search(/[?#]/);
  const refPath = qIdx >= 0 ? r.slice(0, qIdx) : r;
  if (qIdx >= 0) suffix = r.slice(qIdx);

  if (refPath.startsWith('/')) {
    path = refPath;
  } else {
    const dir = (basePath || '/').replace(/[^/]*$/, '');
    path = dir + refPath;
  }

  // Remove dot segments.
  const out: string[] = [];
  for (const seg of path.split('/')) {
    if (seg === '.') continue;
    if (seg === '..') {
      if (out.length > 1) out.pop();
      continue;
    }
    out.push(seg);
  }
  let joined = out.join('/');
  if (!joined.startsWith('/')) joined = `/${joined}`;
  if ((path.endsWith('/.') || path.endsWith('/..')) && !joined.endsWith('/')) joined += '/';
  return `${scheme}//${authority}${joined}${suffix}`;
}

/** Minimal fetch stub: routes "METHOD url" (or just url for any method) to canned responses. */
export interface FakeResponseSpec {
  status?: number;
  headers?: Record<string, string>;
  body?: string | object;
  /** Final URL after redirects (fetch's res.url). */
  url?: string;
  throws?: boolean;
}

export type Route = FakeResponseSpec | ((init?: RequestInit) => FakeResponseSpec);

export function installFetch(routes: Record<string, Route>) {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push(`${method} ${url}`);
    const route = routes[`${method} ${url}`] ?? routes[url];
    if (!route) {
      return fakeResponse({ status: 404, body: 'not found' }, url);
    }
    const spec = typeof route === 'function' ? route(init) : route;
    if (spec.throws) throw new TypeError('Network request failed');
    return fakeResponse(spec, url);
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function fakeResponse(spec: FakeResponseSpec, requestUrl: string) {
  const status = spec.status ?? 200;
  const body = typeof spec.body === 'object' ? JSON.stringify(spec.body) : spec.body ?? '';
  const headers = new Headers(spec.headers ?? {});
  if (typeof spec.body === 'object' && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return {
    ok: status >= 200 && status < 300,
    status,
    url: spec.url ?? requestUrl,
    headers,
    text: async () => body,
    json: async () => JSON.parse(body),
    body: null,
  } as unknown as Response;
}

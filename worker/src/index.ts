/**
 * Slate fetch helper: a stateless Cloudflare Worker that downloads one URL for the app's
 * "New from link" (L8), because a web app cannot read other sites directly.
 *
 *   GET /?url=<encoded http(s) URL>     header X-Slate-Key: <secret>
 *
 * Rules (PRD, non-functional requirements):
 * - GET over http(s) only; at most 5 redirects, each hop re-checked;
 * - refuse private and local network addresses (literal IPs, local names, and hosts whose
 *   DNS records point at private addresses);
 * - 10 MB and 15 s limits;
 * - require the secret header;
 * - log no content (nothing is logged at all).
 */

export interface Env {
  /** shared secret the app sends in X-Slate-Key */
  SLATE_KEY: string;
  /** comma-separated origins allowed to call the helper, e.g. https://preetsingh-007.github.io */
  ALLOWED_ORIGINS?: string;
}

export const MAX_BYTES = 10 * 1024 * 1024;
export const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;
const USER_AGENT = 'Mozilla/5.0 (compatible; SlateFetchHelper/1.0; +https://github.com/preetsingh-007/slate)';

export type Resolver = (host: string) => Promise<string[]>;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, env, globalThis.fetch.bind(globalThis), dohResolver(globalThis.fetch.bind(globalThis)));
  },
};

export async function handle(request: Request, env: Env, fetcher: typeof fetch, resolve: Resolver): Promise<Response> {
  const cors = corsHeaders(request, env);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'GET') return error(405, 'Only GET is allowed.', cors);
  if (!env.SLATE_KEY || !timingSafeEqual(request.headers.get('X-Slate-Key') ?? '', env.SLATE_KEY)) {
    return error(401, 'Missing or wrong X-Slate-Key header.', cors);
  }
  const target = new URL(request.url).searchParams.get('url');
  if (!target) return error(400, 'Missing url parameter.', cors);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let url = target;
    for (let hop = 0; ; hop++) {
      const problem = await checkUrl(url, resolve);
      if (problem) return error(403, problem, cors);
      const upstream = await fetcher(url, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml,application/pdf,*/*;q=0.8' },
      });
      if (upstream.status >= 300 && upstream.status < 400 && upstream.headers.get('Location')) {
        if (hop >= MAX_REDIRECTS) return error(508, 'Too many redirects.', cors);
        url = new URL(upstream.headers.get('Location')!, url).toString();
        continue;
      }
      const declared = Number(upstream.headers.get('Content-Length') ?? '0');
      if (declared > MAX_BYTES) return error(413, 'The page is larger than 10 MB.', cors);
      const body = await readLimited(upstream, MAX_BYTES);
      if (!body) return error(413, 'The page is larger than 10 MB.', cors);
      const headers = new Headers(cors);
      headers.set('Content-Type', upstream.headers.get('Content-Type') ?? 'application/octet-stream');
      headers.set('X-Final-Url', url);
      headers.set('X-Upstream-Status', String(upstream.status));
      headers.set('Cache-Control', 'no-store');
      headers.set('Access-Control-Expose-Headers', 'X-Final-Url, X-Upstream-Status, Content-Type');
      return new Response(body as Uint8Array<ArrayBuffer>, { status: 200, headers });
    }
  } catch (err) {
    if (controller.signal.aborted) return error(504, 'The site took longer than 15 seconds.', cors);
    return error(502, `Could not fetch the page: ${(err as Error).message ?? 'network error'}.`, cors);
  } finally {
    clearTimeout(timer);
  }
}

/** Returns why a URL is refused, or null when it may be fetched. */
export async function checkUrl(raw: string, resolve: Resolver): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'Not a valid URL.';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'Only http and https URLs are allowed.';
  if (url.username || url.password) return 'URLs with credentials are not allowed.';
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (isLocalName(host)) return 'Local network addresses are not allowed.';
  if (isIpLiteral(host)) return isPrivateIp(host) ? 'Private network addresses are not allowed.' : null;
  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    return 'The host name could not be resolved.';
  }
  if (!addresses.length) return 'The host name could not be resolved.';
  if (addresses.some(isPrivateIp)) return 'The host resolves to a private network address.';
  return null;
}

function isLocalName(host: string): boolean {
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.home.arpa') ||
    host.endsWith('.lan') ||
    !host.includes('.') && !host.includes(':')
  );
}

function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':') || /^(0x[0-9a-f]+|\d+)$/i.test(host);
}

/**
 * True for loopback, private, link-local, CGNAT, multicast, reserved and IPv4-embedding forms.
 * IPv6 addresses are parsed in full, so every spelling of one address is classified alike; an
 * address that does not parse is refused.
 */
export function isPrivateIp(ip: string): boolean {
  const v4 = parseV4(ip);
  if (v4) return privateV4(v4);
  const g = parseV6(ip.toLowerCase());
  if (!g) return true;
  const [a, b] = g;
  if (g.slice(0, 6).every((x) => x === 0)) return true; // ::/96: ::, ::1, IPv4-compatible ::a.b.c.d
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return true; // ::ffff:0:0/96 IPv4-mapped
  if (a === 0x64 && b === 0xff9b) return true; // 64:ff9b::/96 and 64:ff9b:1::/48 NAT64
  if (a === 0x100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true; // 100::/64 discard
  if (a === 0x2001 && b === 0) return true; // 2001::/32 Teredo (embeds an IPv4 address)
  if (a === 0x2001 && b === 0xdb8) return true; // documentation
  if (a === 0x2002) return true; // 2002::/16 6to4 (embeds an IPv4 address)
  if ((a & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((a & 0xffc0) === 0xfe80 || (a & 0xffc0) === 0xfec0) return true; // link-local, site-local
  if ((a & 0xff00) === 0xff00) return true; // multicast
  return false;
}

/** The eight 16-bit groups of an IPv6 address (with an optional dotted IPv4 tail), or null. */
function parseV6(h: string): number[] | null {
  if (!/^[0-9a-f:.]+$/.test(h) || !h.includes(':')) return null;
  let tail: number[] = [];
  const dot = h.lastIndexOf(':');
  if (h.includes('.')) {
    const v4 = h.slice(dot + 1).match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!v4) return null;
    const p = v4.slice(1).map(Number);
    if (p.some((x) => x > 255)) return null;
    tail = [(p[0] << 8) | p[1], (p[2] << 8) | p[3]];
    h = h.slice(0, dot + 1); // '::ffff:', '::' or '1:2:3:4:5:6:'
    if (!h.endsWith('::')) h = h.slice(0, -1);
  }
  const halves = h.split('::');
  if (halves.length > 2) return null;
  const groups = (s: string) => (s === '' ? [] : s.split(':'));
  const head = groups(halves[0]);
  const rest = halves.length === 2 ? groups(halves[1]) : [];
  if ([...head, ...rest].some((x) => !/^[0-9a-f]{1,4}$/.test(x))) return null;
  const want = 8 - tail.length;
  const fill = want - head.length - rest.length;
  if (halves.length === 2 ? fill < 1 : fill !== 0) return null;
  return [...head.map((x) => parseInt(x, 16)), ...new Array<number>(fill).fill(0), ...rest.map((x) => parseInt(x, 16)), ...tail];
}

function parseV4(ip: string): number[] | null {
  if (/^\d+$/.test(ip)) {
    const n = Number(ip);
    return n <= 0xffffffff ? [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255] : null;
  }
  if (/^0x[0-9a-f]+$/i.test(ip)) return parseV4(String(parseInt(ip, 16)));
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((p) => p <= 255) ? parts : null;
}

function privateV4([a, b]: number[]): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

/** Resolves A and AAAA records with DNS over HTTPS (Cloudflare). */
export function dohResolver(fetcher: typeof fetch): Resolver {
  return async (host) => {
    const out: string[] = [];
    for (const type of ['A', 'AAAA']) {
      const res = await fetcher(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`, {
        headers: { Accept: 'application/dns-json' },
      });
      if (!res.ok) throw new Error('dns');
      const json = (await res.json()) as { Answer?: { type: number; data: string }[] };
      for (const a of json.Answer ?? []) if (a.type === 1 || a.type === 28) out.push(a.data);
    }
    return out;
  };
}

async function readLimited(res: Response, limit: number): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}

function corsHeaders(request: Request, env: Env): Headers {
  const h = new Headers();
  const origin = request.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (origin && (allowed.includes(origin) || allowed.includes('*'))) {
    h.set('Access-Control-Allow-Origin', origin);
    h.set('Vary', 'Origin');
    h.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    h.set('Access-Control-Allow-Headers', 'X-Slate-Key');
    h.set('Access-Control-Max-Age', '86400');
  }
  return h;
}

function error(status: number, message: string, cors: Headers): Response {
  const headers = new Headers(cors);
  headers.set('Content-Type', 'application/json');
  headers.set('Access-Control-Expose-Headers', 'X-Final-Url, X-Upstream-Status, Content-Type');
  return new Response(JSON.stringify({ error: message }), { status, headers });
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Client of the fetch helper (worker/): the only way the app reads other sites (L8, L10).
 *
 *   GET <helperUrl>/?url=<encoded URL>      header X-Slate-Key: <helperKey>
 *
 * The helper answers 200 with the upstream body and `X-Upstream-Status`, `X-Final-Url`,
 * `Content-Type`; its own refusals are JSON `{ error }` with a non-200 status. Failures are
 * classified into reasons the UI can explain (L10).
 */

export interface HelperConfig {
  helperUrl?: string;
  helperKey?: string;
}

export type FetchFailure =
  | 'not-configured'
  | 'offline'
  | 'helper-key'
  | 'refused'
  | 'too-large'
  | 'timeout'
  | 'network'
  | 'login'
  | 'bot-check'
  | 'paywall'
  | 'not-found'
  | 'http'
  | 'empty';

const MESSAGES: Record<FetchFailure, string> = {
  'not-configured': 'The fetch helper is not set up on this device. Add its URL and key in settings.',
  offline: 'You are offline. New from link needs the network.',
  'helper-key': 'The fetch helper refused the key. Check the helper key in settings.',
  refused: 'The fetch helper refused this address.',
  'too-large': 'The page is larger than 10 MB.',
  timeout: 'The site took longer than 15 seconds to answer.',
  network: 'The page could not be downloaded.',
  login: 'The site asks you to sign in before showing this page.',
  'bot-check': 'The site showed a bot check instead of the page.',
  paywall: 'The article is behind a paywall.',
  'not-found': 'The site says this page does not exist.',
  http: 'The site answered with an error.',
  empty: 'The page has no readable content.',
};

export class FetchError extends Error {
  constructor(
    readonly reason: FetchFailure,
    detail?: string,
    readonly status?: number,
  ) {
    super(detail ? `${MESSAGES[reason]} (${detail})` : MESSAGES[reason]);
    this.name = 'FetchError';
  }

  /** Failures where copying the page and using New from clipboard is the way out (L10). */
  get offerClipboard(): boolean {
    return this.reason !== 'not-configured' && this.reason !== 'helper-key';
  }
}

export interface FetchedResource {
  /** upstream HTTP status */
  status: number;
  contentType: string;
  /** URL after redirects */
  finalUrl: string;
  bytes: Uint8Array;
}

export interface HelperFetchOptions {
  fetch?: typeof fetch;
  signal?: AbortSignal;
  /** client-side limit; the helper has its own 15 s limit (default 20 s) */
  timeoutMs?: number;
  /** treat upstream 4xx/5xx as errors (default true) */
  requireOk?: boolean;
}

export function isConfigured(cfg: HelperConfig): boolean {
  return !!cfg.helperUrl?.trim() && !!cfg.helperKey;
}

/** Downloads one URL through the fetch helper. Throws FetchError. */
export async function helperFetch(cfg: HelperConfig, url: string, opts: HelperFetchOptions = {}): Promise<FetchedResource> {
  if (!isConfigured(cfg)) throw new FetchError('not-configured');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new FetchError('offline');
  const f = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const base = cfg.helperUrl!.trim().replace(/\/?$/, '/');
  const ctl = new AbortController();
  const onAbort = () => ctl.abort();
  opts.signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 20_000);
  let res: Response;
  try {
    res = await f(`${base}?url=${encodeURIComponent(url)}`, { headers: { 'X-Slate-Key': cfg.helperKey! }, signal: ctl.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    if (ctl.signal.aborted) throw new FetchError('timeout');
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new FetchError('offline');
    throw new FetchError('network', (err as Error)?.message);
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
  if (res.status !== 200) {
    let detail: string | undefined;
    try {
      detail = ((await res.json()) as { error?: string }).error;
    } catch {
      /* not JSON */
    }
    if (res.status === 401) throw new FetchError('helper-key', undefined, res.status);
    if (res.status === 403) throw new FetchError('refused', detail, res.status);
    if (res.status === 413) throw new FetchError('too-large', undefined, res.status);
    if (res.status === 504) throw new FetchError('timeout', undefined, res.status);
    throw new FetchError('network', detail, res.status);
  }
  const status = Number(res.headers.get('X-Upstream-Status') ?? '200') || 200;
  const out: FetchedResource = {
    status,
    contentType: res.headers.get('Content-Type') ?? 'application/octet-stream',
    finalUrl: res.headers.get('X-Final-Url') ?? url,
    bytes: new Uint8Array(await res.arrayBuffer()),
  };
  if (opts.requireOk !== false && status >= 400) throw classifyHttpFailure(status, out);
  return out;
}

/** Explains an upstream error status, looking at the page for login, bot-check and paywall signs. */
export function classifyHttpFailure(status: number, res?: Pick<FetchedResource, 'bytes' | 'contentType'>): FetchError {
  const text = res && /html|text/i.test(res.contentType) ? decodeText(res.bytes, res.contentType).slice(0, 200_000) : '';
  const signs = pageProblem(text);
  if (signs) return new FetchError(signs, `HTTP ${status}`, status);
  if (status === 401) return new FetchError('login', `HTTP ${status}`, status);
  if (status === 402) return new FetchError('paywall', `HTTP ${status}`, status);
  if (status === 403 || status === 429 || status === 503) return new FetchError('bot-check', `HTTP ${status}`, status);
  if (status === 404 || status === 410) return new FetchError('not-found', `HTTP ${status}`, status);
  return new FetchError('http', `HTTP ${status}`, status);
}

/**
 * Recognises pages that are not the article even with status 200: bot checks (Cloudflare,
 * captchas), sign-in walls and paywalls. Returns null for ordinary pages.
 */
export function pageProblem(html: string): FetchFailure | null {
  if (!html) return null;
  const head = html.slice(0, 60_000).toLowerCase();
  const title = /<title[^>]*>([\s\S]*?)<\/title>/.exec(head)?.[1]?.trim() ?? '';
  if (/just a moment|attention required|are you a robot|access denied|verify you are human|bot verification/.test(title)) return 'bot-check';
  if (/cf-chl-|challenge-platform|g-recaptcha|h-captcha|hcaptcha\.com|captcha-delivery|px-captcha|perimeterx/.test(head)) return 'bot-check';
  if (/^(sign in|log in|login)\b/.test(title) || (/<input[^>]+type=["']?password/.test(head) && /sign in|log in/.test(head) && html.length < 80_000)) return 'login';
  if (/class=["'][^"']*\bpaywall\b|id=["']paywall|subscribe to (continue|read)|this (article|content) is for subscribers|"isaccessibleforfree"\s*:\s*"?false/.test(head)) return 'paywall';
  return null;
}

/** Decodes bytes using the charset from Content-Type or a <meta charset>, defaulting to UTF-8. */
export function decodeText(bytes: Uint8Array, contentType = ''): string {
  let charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  if (!charset) {
    const sniff = new TextDecoder('latin1').decode(bytes.subarray(0, 2048));
    charset = /<meta[^>]+charset=["']?([\w-]+)/i.exec(sniff)?.[1];
  }
  try {
    return new TextDecoder(charset ?? 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/** A `fetch`-compatible function that goes through the helper (citation lookups, L1). */
export function helperAsFetch(cfg: HelperConfig, base?: typeof fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const r = await helperFetch(cfg, url, { fetch: base, signal: init?.signal ?? undefined, requireOk: false });
    return new Response(r.bytes as BlobPart, { status: r.status, headers: { 'Content-Type': r.contentType } });
  }) as typeof fetch;
}

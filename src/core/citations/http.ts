/** Small fetch helpers shared by the citation clients (timeouts + cancellation; from Axiom). Slate passes a fetch that goes through the fetch helper (L1). */

export interface HttpOptions {
  signal?: AbortSignal;
  /** default 12 s */
  timeoutMs?: number;
  /**
   * The fetch to use: in the app, always one that goes through the fetch helper (helperAsFetch).
   * Required at run time (network use NFR: the app never contacts these sites itself).
   */
  fetch?: typeof fetch;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly response?: Response,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** fetch with a timeout that also honours an outer AbortSignal. */
export async function fetchWithTimeout(url: string, init: RequestInit, opts: HttpOptions = {}): Promise<Response> {
  const f = opts.fetch;
  if (!f) throw new Error('Citation lookups go through the fetch helper: pass its fetch.');
  const ctl = new AbortController();
  const onAbort = () => ctl.abort(opts.signal?.reason);
  if (opts.signal) {
    if (opts.signal.aborted) ctl.abort(opts.signal.reason);
    else opts.signal.addEventListener('abort', onAbort, { once: true });
  }
  const timer = setTimeout(() => ctl.abort(new DOMException('Timed out', 'TimeoutError')), opts.timeoutMs ?? 12000);
  try {
    return await f(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}

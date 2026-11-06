export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface HttpOptions {
  fetch?: FetchLike;
  retries?: number;
  timeoutMs?: number;
  /** Injected so tests do not wait for real backoff. */
  sleep?: (ms: number) => Promise<void>;
  userAgent?: string;
}

export interface Http {
  request(url: string, init?: RequestInit): Promise<Response>;
  getText(url: string, init?: RequestInit): Promise<string>;
  getJson<T = unknown>(url: string, init?: RequestInit): Promise<T>;
}

/** Error messages end up in the digest's run-health section: never echo a credential carried in a URL. */
export function redact(url: string): string {
  return url.replace(/([?&](?:key|api_key|apikey|token|access_token|sig)=)[^&#]*/gi, "$1REDACTED");
}

/**
 * fetch with a timeout, and retries with backoff on 429, 5xx and network errors.
 * 4xx other than 429 is returned at once: retrying a 404 only slows the run.
 */
export function createHttp(opts: HttpOptions = {}): Http {
  const doFetch = opts.fetch ?? fetch;
  const retries = opts.retries ?? 2;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const userAgent = opts.userAgent ?? "ai-news-digest/1.0";

  async function request(url: string, init: RequestInit = {}): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await doFetch(url, {
          ...init,
          headers: { "user-agent": userAgent, ...(init.headers as Record<string, string> | undefined) },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if ((res.status === 429 || res.status >= 500) && attempt < retries) {
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        return res;
      } catch (err) {
        lastError = err;
        if (attempt < retries) await sleep(1000 * 2 ** attempt);
      }
    }
    throw new Error(`${redact(url)}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }

  async function ok(url: string, init?: RequestInit): Promise<Response> {
    const res = await request(url, init);
    if (!res.ok) throw new Error(`GET ${redact(url)} -> ${res.status}`);
    return res;
  }

  return {
    request,
    getText: async (url, init) => (await ok(url, init)).text(),
    getJson: async <T>(url: string, init?: RequestInit) => (await (await ok(url, init)).json()) as T,
  };
}

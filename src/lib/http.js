const DEFAULT_TIMEOUT_MS = 30000;

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class HttpClient {
  constructor({ userAgent, requestDelayMs = 1500, timeoutMs = DEFAULT_TIMEOUT_MS, maxRetries = 3 } = {}) {
    this.userAgent = userAgent || 'hiring-intel-scraper/0.1 public-data-bot';
    this.requestDelayMs = requestDelayMs;
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
    this.lastRequestAtByHost = new Map();
  }

  async fetchJson(url, options = {}) {
    const response = await this.fetch(url, {
      ...options,
      headers: {
        Accept: 'application/json,text/plain;q=0.9,*/*;q=0.8',
        ...(options.headers || {}),
      },
    });
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error(`Expected JSON from ${url}; received ${text.slice(0, 160)}`);
    }
  }

  async fetchText(url, options = {}) {
    const response = await this.fetch(url, {
      ...options,
      headers: {
        Accept: 'text/html,text/plain;q=0.9,*/*;q=0.8',
        ...(options.headers || {}),
      },
    });
    return response.text();
  }

  async fetch(url, options = {}) {
    const parsed = new URL(url);
    await this.#respectHostDelay(parsed.host);

    let attempt = 0;
    let lastError;
    while (attempt <= this.maxRetries) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
          headers: {
            'User-Agent': this.userAgent,
            ...(options.headers || {}),
          },
        });
        clearTimeout(timeout);
        if (response.ok) return response;

        if (![429, 500, 502, 503, 504].includes(response.status) || attempt === this.maxRetries) {
          throw new Error(`HTTP ${response.status} ${response.statusText} for ${url}`);
        }
        const retryAfter = Number(response.headers.get('retry-after'));
        await sleep(Number.isFinite(retryAfter) ? retryAfter * 1000 : this.#backoffMs(attempt));
      } catch (error) {
        clearTimeout(timeout);
        lastError = error;
        if (attempt === this.maxRetries) break;
        await sleep(this.#backoffMs(attempt));
      }
      attempt += 1;
    }
    throw lastError;
  }

  async #respectHostDelay(host) {
    const now = Date.now();
    const last = this.lastRequestAtByHost.get(host) || 0;
    const waitMs = Math.max(0, this.requestDelayMs - (now - last));
    if (waitMs > 0) await sleep(waitMs);
    this.lastRequestAtByHost.set(host, Date.now());
  }

  #backoffMs(attempt) {
    return [2000, 5000, 15000][attempt] || 15000;
  }
}

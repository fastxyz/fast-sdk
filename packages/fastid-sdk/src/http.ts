export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(`HTTP request failed with status ${status}`);
    this.name = "HttpError";
  }
}

export class HttpClient {
  readonly #origin: string;
  readonly #fetch: typeof fetch;

  constructor(origin: string, fetchImpl: typeof fetch = fetch) {
    this.#origin = origin.replace(/\/+$/, "");
    this.#fetch = fetchImpl;
  }

  get origin(): string {
    return this.#origin;
  }

  async requestJson(path: string, init: RequestInit = {}): Promise<unknown> {
    const headers = new Headers(init.headers);
    if (!headers.has("accept")) headers.set("accept", "application/json");
    const response = await this.#fetch(`${this.#origin}${path}`, {
      cache: "no-store",
      ...init,
      headers,
    });

    const text = await response.text();
    let body: unknown = null;
    let parsed = false;
    if (text.length > 0) {
      try {
        body = JSON.parse(text);
        parsed = true;
      } catch {
        body = text;
      }
    }
    if (!response.ok) throw new HttpError(response.status, body);
    if (text.length > 0 && !parsed) {
      throw new HttpError(response.status, body);
    }
    return body;
  }

  getJson(path: string): Promise<unknown> {
    return this.requestJson(path, { method: "GET" });
  }

  postJson(path: string, body: unknown): Promise<unknown> {
    return this.requestJson(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  putJson(path: string, body: unknown): Promise<unknown> {
    return this.requestJson(path, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }
}

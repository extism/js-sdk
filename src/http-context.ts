import { CallContext, ENV } from './call-context.ts';
import { MemoryOptions } from './interfaces.ts';
import { EXTISM_ENV } from './foreground-plugin.ts';
import { matches } from './polyfills/deno-minimatch.ts';

export class HttpContext {
  fetch: typeof fetch;
  lastStatusCode: number;
  lastHeaders: Record<string, string> | null;
  allowedHosts: string[];
  memoryOptions: MemoryOptions;

  constructor(
    _fetch: typeof fetch,
    allowedHosts: string[],
    memoryOptions: MemoryOptions,
    allowResponseHeaders: boolean,
  ) {
    this.fetch = _fetch;
    this.allowedHosts = allowedHosts;
    this.lastStatusCode = 0;
    this.memoryOptions = memoryOptions;
    this.lastHeaders = allowResponseHeaders ? {} : null;
  }

  contribute(functions: Record<string, Record<string, any>>) {
    functions[EXTISM_ENV] ??= {};
    functions[EXTISM_ENV].http_request = (callContext: CallContext, reqaddr: bigint, bodyaddr: bigint) =>
      this.makeRequest(callContext, reqaddr, bodyaddr);
    functions[EXTISM_ENV].http_status_code = () => this.lastStatusCode;
    functions[EXTISM_ENV].http_headers = (callContext: CallContext) => {
      if (this.lastHeaders === null) {
        return 0n;
      }
      return callContext.store(JSON.stringify(this.lastHeaders));
    };
  }

  async makeRequest(callContext: CallContext, reqaddr: bigint, bodyaddr: bigint) {
    if (this.lastHeaders !== null) {
      this.lastHeaders = {};
    }
    this.lastStatusCode = 0;

    const req = callContext.read(reqaddr);
    if (req === null) {
      return 0n;
    }

    const { headers, header, url: rawUrl, method: m } = req.json();
    const method = m?.toUpperCase() ?? 'GET';
    const url = new URL(rawUrl);

    const isAllowed = this.allowedHosts.some((allowedHost) => {
      return allowedHost === url.hostname || matches(url.hostname, allowedHost);
    });

    if (!isAllowed) {
      throw new Error(`Call error: HTTP request to "${url}" is not allowed (no allowedHosts match "${url.hostname}")`);
    }

    const body = bodyaddr === 0n || method === 'GET' || method === 'HEAD' ? null : callContext.read(bodyaddr)?.bytes();
    const fetch = this.fetch;
    const response = await fetch(rawUrl, {
      headers: headers || header,
      method,
      ...(body ? { body: body.slice() } : {}),
    });

    this.lastStatusCode = response.status;

    if (this.lastHeaders !== null) {
      this.lastHeaders = Object.fromEntries(response.headers);
    }

    try {
      const bytes = this.memoryOptions.maxHttpResponseBytes
        ? await readBodyUpTo(response, this.memoryOptions.maxHttpResponseBytes)
        : new Uint8Array(await response.arrayBuffer());

      const result = callContext.store(bytes);

      return result;
    } catch (err) {
      if (err instanceof Error) {
        const ptr = callContext.store(new TextEncoder().encode(err.message));
        callContext[ENV].log_error(ptr);
        return 0n;
      }
      return 0n;
    }
  }
}

async function readBodyUpTo(response: Response, maxBytes: number): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) {
    return new Uint8Array(0);
  }

  let receivedLength = 0;
  const chunks = [];

  while (receivedLength < maxBytes) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
    receivedLength += value.length;
    if (receivedLength >= maxBytes) {
      throw new Error(`Response body exceeded ${maxBytes} bytes`);
    }
  }

  const limitedResponseBody = new Uint8Array(receivedLength);
  let position = 0;
  for (const chunk of chunks) {
    limitedResponseBody.set(chunk, position);
    position += chunk.length;
  }

  return limitedResponseBody;
}

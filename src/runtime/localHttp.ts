// ============================================================================
// Loopback HTTP for the thin client
// ============================================================================
// Node's global fetch() is undici, and undici is initialised lazily on first
// use: touching fetch() once costs ~10.8 MB resident (measured — see
// scripts/measure-memory.mjs). node:http is already resident in every process
// and costs ~2.5 MB for the same work.
//
// That trade is only obviously correct because of what these requests are:
// loopback, plaintext, small JSON bodies, no redirects, no compression, no
// cookies, no keep-alive pooling worth having. None of undici's surface is in
// use here, so none of it is worth 10 MB in five client processes.
//
// This is deliberately NOT a fetch polyfill. It returns the response body as
// text and lets callers parse, so a non-JSON error page surfaces as the status
// code the server actually sent rather than a parse error.
// ============================================================================

import { request } from 'http';

export interface LocalResponse {
  status: number;
  ok: boolean;
  text: string;
}

export interface LocalRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs: number;
}

/**
 * Perform one loopback HTTP request. Rejects on transport failure (nothing
 * listening, socket closed, timeout); resolves with the status for any
 * response the server actually sent, including 4xx and 5xx.
 */
export function localRequest(url: string, opts: LocalRequestOptions): Promise<LocalResponse> {
  const { method = 'GET', headers = {}, body, timeoutMs } = opts;

  return new Promise<LocalResponse>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const target = new URL(url);
    const req = request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method,
        headers: body === undefined
          ? headers
          : { ...headers, 'Content-Length': String(Buffer.byteLength(body)) },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('error', (err) => finish(() => reject(err)));
        res.on('end', () => finish(() => {
          const status = res.statusCode ?? 0;
          resolve({
            status,
            ok: status >= 200 && status < 300,
            text: Buffer.concat(chunks).toString('utf-8'),
          });
        }));
      }
    );

    // Timeout is enforced here rather than via req.setTimeout, which fires on
    // socket inactivity and so cannot bound a slow-but-trickling response.
    const timer = setTimeout(() => {
      finish(() => {
        req.destroy();
        reject(new Error(`request to ${url} timed out after ${timeoutMs}ms`));
      });
    }, timeoutMs);

    req.on('error', (err) => finish(() => reject(err)));
    if (body !== undefined) req.write(body);
    req.end();
  });
}

/** localRequest + JSON.parse, with the status preserved for the caller. */
export async function localJson<T = unknown>(
  url: string,
  opts: LocalRequestOptions
): Promise<{ status: number; ok: boolean; body: T }> {
  const res = await localRequest(url, opts);
  let parsed: T;
  try {
    parsed = JSON.parse(res.text) as T;
  } catch {
    throw new Error(
      `${url} returned ${res.status} with a non-JSON body: ${res.text.slice(0, 200)}`
    );
  }
  return { status: res.status, ok: res.ok, body: parsed };
}

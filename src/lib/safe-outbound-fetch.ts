/**
 * Fetching a URL that someone else supplied (link previews). SERVER-ONLY.
 *
 * Every hop, redirects included, must reach a public address. The address
 * check runs when the connection is made, not in a separate lookup first, so
 * a hostname can't pass the check and then resolve somewhere private. Our own
 * domains are exempt (Railway resolves them to private addresses internally).
 */

import dns from 'dns';
import http from 'http';
import https from 'https';
import net from 'net';

const OWN_HOSTS = new Set(['storyvenue.com', 'www.storyvenue.com', 'app.storyvenue.com']);

/** Loopback, private, link-local, carrier NAT, reserved and multicast ranges. */
export function isPrivateAddress(ip: string): boolean {
  let addr = ip.toLowerCase().split('%')[0];
  if (addr.startsWith('::ffff:')) {
    const v4 = addr.slice(7);
    if (!net.isIPv4(v4)) return true;
    addr = v4;
  }
  if (net.isIPv4(addr)) {
    const [a, b] = addr.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168)) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (net.isIPv6(addr)) {
    return (
      addr === '::' || addr === '::1' ||
      addr.startsWith('fc') || addr.startsWith('fd') ||
      /^fe[89ab]/.test(addr) ||
      addr.startsWith('ff') ||
      addr.startsWith('64:ff9b:')
    );
  }
  return true;
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address?: string | dns.LookupAddress[], family?: number) => void;

/** dns.lookup that refuses to hand a private address to the connection. */
function publicOnlyLookup(hostname: string, options: dns.LookupOptions, callback: LookupCallback): void {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = addresses as dns.LookupAddress[];
    if (!list.length || list.some((a) => isPrivateAddress(a.address))) {
      const blocked = new Error(`blocked: ${hostname} resolves to a private address`) as NodeJS.ErrnoException;
      blocked.code = 'EBLOCKED';
      return callback(blocked);
    }
    if (options.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

export interface SafeFetchResult {
  status: number;
  contentType: string;
  body: Buffer;
  /** The body was longer than maxBytes and was cut off. */
  truncated: boolean;
  finalUrl: string;
}

function requestOnce(
  url: URL,
  opts: { accept: string; maxBytes: number },
  deadline: number,
): Promise<{ status: number; location: string | null; contentType: string; body: Buffer; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    const own = OWN_HOSTS.has(url.hostname.toLowerCase());
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request(
      url,
      {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; StoryVenueLinkPreview/1.0; +https://storyvenue.com)',
          Accept: opts.accept,
          'Accept-Encoding': 'identity',
        },
        ...(own ? {} : { lookup: publicOnlyLookup as unknown as typeof dns.lookup }),
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = typeof res.headers.location === 'string' ? res.headers.location : null;
        const contentType = String(res.headers['content-type'] ?? '').toLowerCase();
        if (status >= 300 && status < 400) {
          res.resume();
          resolve({ status, location, contentType, body: Buffer.alloc(0), truncated: false });
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;
        res.on('data', (chunk: Buffer) => {
          if (truncated) return;
          size += chunk.length;
          if (size > opts.maxBytes) {
            truncated = true;
            chunks.push(chunk.subarray(0, chunk.length - (size - opts.maxBytes)));
            res.destroy();
            resolve({ status, location, contentType, body: Buffer.concat(chunks), truncated: true });
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          if (!truncated) resolve({ status, location, contentType, body: Buffer.concat(chunks), truncated: false });
        });
        res.on('error', (e) => { if (!truncated) reject(e); });
      },
    );
    const remaining = Math.max(1, deadline - Date.now());
    const timer = setTimeout(() => req.destroy(new Error('timeout')), remaining);
    req.on('close', () => clearTimeout(timer));
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.end();
  });
}

/**
 * GET a public http(s) URL, following up to `maxRedirects` redirects and
 * re-checking every hop. Throws when a hop isn't public, on timeout, or on too
 * many redirects.
 */
export async function safeFetch(
  rawUrl: string,
  opts: { accept: string; maxBytes: number; timeoutMs?: number; maxRedirects?: number },
): Promise<SafeFetchResult> {
  let url = new URL(rawUrl);
  const deadline = Date.now() + (opts.timeoutMs ?? 5000);
  const maxRedirects = opts.maxRedirects ?? 3;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('blocked: not http(s)');
    if (url.username || url.password) throw new Error('blocked: credentials in URL');
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
      throw new Error('blocked: local hostname');
    }
    if (net.isIP(host) && isPrivateAddress(host)) throw new Error('blocked: private address');

    const r = await requestOnce(url, opts, deadline);
    if (r.status >= 300 && r.status < 400) {
      if (!r.location) throw new Error('redirect without location');
      url = new URL(r.location, url);
      continue;
    }
    return { status: r.status, contentType: r.contentType, body: r.body, truncated: r.truncated, finalUrl: url.toString() };
  }
  throw new Error('too many redirects');
}

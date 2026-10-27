import { lookup } from 'node:dns/promises';
import { isIP, type LookupFunction } from 'node:net';
import { Agent, fetch, type Response } from 'undici';

export const FLOWCRAFT_USER_AGENT = 'FlowcraftBot/1.0';

export interface SafeTextResponse {
  url: string;
  status: number;
  headers: Record<string, string>;
  text: string;
}

export interface SafeTextOptions {
  timeoutMs?: number;
  maxBytes?: number;
  signal?: AbortSignal;
  beforeRequest?: (url: URL) => Promise<void>;
}

type Address = { address: string; family: number };
export interface SafeHttpDependencies {
  resolve?: (hostname: string) => Promise<Address[]>;
  request?: typeof fetch;
}

/** Only globally routable destinations. IP literals are checked after URL normalization. */
export function isPublicAddress(address: string): boolean {
  const value = address.replace(/^\[|\]$/g, '').toLowerCase();
  if (isIP(value) === 4) {
    const [a, b, c] = value.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      || (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 192 && b === 88 && c === 99)
      || (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100)
      || (a === 203 && b === 0 && c === 113));
  }
  if (isIP(value) !== 6 || !/^[23]/.test(value)) return false;
  const [first, second = '0'] = value.split(':');
  const prefix = parseInt(first, 16);
  const subnet = parseInt(second || '0', 16);
  // Exclude special-purpose, documentation, and IPv4 tunneling ranges.
  return !(prefix === 0x2001 && (subnet < 0x200 || subnet === 0xdb8)
    || prefix === 0x2002 || (prefix === 0x3fff && subnet < 0x1000));
}

export function publicUrl(value: string | URL): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Web request URL is invalid'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Use a public HTTP(S) URL without embedded credentials');
  }
  if (url.toString().length > 8192) throw new Error('Web request URL exceeds 8192 characters');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(hostname) && !isPublicAddress(hostname)) throw new Error('Web requests cannot access local or private network addresses');
  if (!hostname || /(?:^|\.)(?:localhost|local|internal|home|lan)$/i.test(hostname)) throw new Error('Web requests cannot access local or private network addresses');
  url.hash = '';
  return url;
}

function cancellable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error('Web request cancelled'));
    signal.addEventListener('abort', abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}

/** A separate Agent per hop pins the validated DNS answers, avoiding a second DNS lookup. */
function pinnedLookup(hostname: string, addresses: Address[]): LookupFunction {
  return (requested, options, callback) => {
    if (requested.replace(/^\[|\]$/g, '').toLowerCase() !== hostname.toLowerCase()) {
      callback(new Error('Destination hostname changed during connection'), '', 0);
      return;
    }
    const candidates = options.family ? addresses.filter((address) => address.family === options.family) : addresses;
    if (!candidates.length) { callback(new Error('No validated address for requested network family'), '', 0); return; }
    if (options.all) callback(null, candidates);
    else callback(null, candidates[0].address, candidates[0].family);
  };
}

export async function safeFetchText(value: string | URL, options: SafeTextOptions = {}, dependencies: SafeHttpDependencies = {}): Promise<SafeTextResponse> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxBytes = options.maxBytes ?? 2_000_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) throw new Error('Web request timeout must be between 100 and 30000 ms');
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  const resolve = dependencies.resolve ?? ((hostname: string) => lookup(hostname, { all: true }));
  const request = dependencies.request ?? fetch;
  let url = publicUrl(value);
  for (let redirects = 0; redirects <= 5; redirects++) {
    signal.throwIfAborted();
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const family = isIP(hostname);
    const addresses = family ? [{ address: hostname, family }] : await cancellable(resolve(hostname), signal);
    if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) throw new Error('Web requests cannot access local or private network addresses');
    await cancellable(options.beforeRequest?.(url) ?? Promise.resolve(), signal);
    const dispatcher = new Agent({ connect: { lookup: pinnedLookup(hostname, addresses), timeout: timeoutMs }, maxResponseSize: maxBytes });
    try {
      const response: Response = await request(url, { method: 'GET', redirect: 'manual', dispatcher, signal, headers: { 'user-agent': FLOWCRAFT_USER_AGENT, accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1' } });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get('location');
        if (!location) throw new Error('Website redirect did not include a destination');
        if (redirects === 5) throw new Error('Website exceeded the 5-redirect limit');
        url = publicUrl(new URL(location, url));
        continue;
      }
      const length = Number(response.headers.get('content-length'));
      if (Number.isFinite(length) && length > maxBytes) { await response.body?.cancel(); throw new Error(`Web response exceeds the ${maxBytes}-byte limit`); }
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader) {
        try {
          while (true) {
            const chunk = await cancellable(reader.read(), signal);
            if (chunk.done) break;
            size += chunk.value.byteLength;
            if (size > maxBytes) throw new Error(`Web response exceeds the ${maxBytes}-byte limit`);
            chunks.push(chunk.value);
          }
        } finally { await reader.cancel().catch(() => undefined); }
      }
      return { url: url.toString(), status: response.status, headers: Object.fromEntries(response.headers.entries()), text: Buffer.concat(chunks, size).toString('utf8') };
    } finally { await dispatcher.destroy(); }
  }
  throw new Error('Website redirect limit exceeded');
}

import { authHeaders, clearToken } from './auth';
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }
async function pause(milliseconds: number, signal?: AbortSignal | null): Promise<void> {
  if (signal?.aborted) throw new DOMException('Request aborted', 'AbortError');
  await new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DOMException('Request aborted', 'AbortError')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, milliseconds);
    signal?.addEventListener('abort', abort, { once: true });
  });
}
export async function api<T>(path: string, options: RequestInit = {}, authenticated = true): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(`${API_URL}${path}`, { ...options, headers: { 'content-type': 'application/json', ...(authenticated ? authHeaders() : {}), ...options.headers }, signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) });
    if (response.status === 429 && (!options.method || options.method === 'GET') && attempt < 2) {
      await pause(Math.min(60000, Math.max(1000, Number(response.headers.get('retry-after') ?? 10) * 1000)), options.signal);
      continue;
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 401 && authenticated) { clearToken(); window.location.assign('/login'); }
      throw new ApiError(response.status === 429 ? 'Too many requests. Please wait a minute before submitting again.' : Array.isArray(payload?.message) ? payload.message.join('; ') : payload?.message ?? `Request failed (${response.status})`, response.status);
    }
    return payload as T;
  }
  throw new ApiError('Unable to complete request', 429);
}

const TOKEN_KEY = 'flowcraft.accessToken';

export function saveToken(token: string): void { window.localStorage.setItem(TOKEN_KEY, token); }
export function getToken(): string | null { return typeof window === 'undefined' ? null : window.localStorage.getItem(TOKEN_KEY); }
export function clearToken(): void { window.localStorage.removeItem(TOKEN_KEY); }
export function authHeaders(): Record<string, string> { const token = getToken(); return token ? { Authorization: `Bearer ${token}` } : {}; }
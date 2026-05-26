declare global {
  interface Window {
    URBAN_MARKET_API_BASE?: string;
  }
}

const LOCAL_API_BASE = 'http://localhost:4000';

function runtimeApiBase(): string {
  if (typeof window === 'undefined') return '';

  const configured = window.URBAN_MARKET_API_BASE || readLocalApiBase();
  if (configured) return configured.replace(/\/+$/, '');

  return ['localhost', '127.0.0.1'].includes(window.location.hostname) ? LOCAL_API_BASE : '';
}

function readLocalApiBase(): string {
  try {
    return window.localStorage.getItem('urbanMarketApiBase') || '';
  } catch {
    return '';
  }
}

export function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const base = runtimeApiBase();
  return base ? `${base}${normalizedPath}` : normalizedPath;
}


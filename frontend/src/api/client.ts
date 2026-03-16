const BASE_URL = '';

function getToken(): string | null {
  return localStorage.getItem('token');
}

function buildHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...extra,
  };
  const token = getToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

/** Decode JWT payload without signature verification (client-side convenience). */
export function decodeTokenPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(base64));
  } catch {
    return null;
  }
}

/** Check whether the stored access token is expired or will expire within `bufferSeconds`. */
function isTokenExpiringSoon(bufferSeconds = 120): boolean {
  const token = getToken();
  if (!token) return true;
  const payload = decodeTokenPayload(token);
  if (!payload?.exp) return true;
  return (payload.exp as number) - Date.now() / 1000 < bufferSeconds;
}

/**
 * Ensure the access token is fresh before using it (e.g. for WebSocket URLs).
 * Returns true if the token is valid (or was successfully refreshed), false otherwise.
 */
export async function ensureFreshToken(): Promise<boolean> {
  if (!isTokenExpiringSoon()) return true;
  return tryRefreshToken();
}

export async function tryRefreshToken(): Promise<boolean> {
  const refreshToken = localStorage.getItem('refresh_token');
  if (!refreshToken) return false;

  try {
    const response = await fetch(`${BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    if (!response.ok) return false;

    const data = await response.json();
    localStorage.setItem('token', data.access_token);
    if (data.refresh_token) {
      localStorage.setItem('refresh_token', data.refresh_token);
    }
    return true;
  } catch {
    return false;
  }
}

async function request<T = any>(
  method: string,
  path: string,
  body?: unknown,
  retried = false
): Promise<T> {
  const options: RequestInit = {
    method,
    headers: buildHeaders(),
  };

  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${BASE_URL}${path}`, options);

  if (response.status === 401 && !retried) {
    // Don't try refresh/redirect for auth endpoints — let the caller handle the error
    const isAuthEndpoint = path.startsWith('/api/auth/login') || path.startsWith('/api/auth/register');
    if (!isAuthEndpoint) {
      const refreshed = await tryRefreshToken();
      if (refreshed) {
        return request<T>(method, path, body, true);
      }
      // Refresh failed - clear auth and redirect to login
      localStorage.removeItem('token');
      localStorage.removeItem('refresh_token');
      window.location.href = '/login';
      throw new Error('Authentication expired');
    }
  }

  if (!response.ok) {
    let errorMessage = `Request failed: ${response.status}`;
    try {
      const errorData = await response.json();
      errorMessage = errorData.detail || errorData.message || errorData.error || errorMessage;
    } catch {
      // couldn't parse error body
    }
    throw new Error(errorMessage);
  }

  // Handle 204 No Content
  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

export async function apiGet<T = any>(
  path: string,
  params?: Record<string, string | number | boolean>,
): Promise<T> {
  if (params) {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        qs.append(key, String(value));
      }
    }
    const sep = path.includes('?') ? '&' : '?';
    path = `${path}${sep}${qs.toString()}`;
  }
  return request<T>('GET', path);
}

export async function apiPost<T = any>(path: string, body?: unknown): Promise<T> {
  return request<T>('POST', path, body);
}

export async function apiPut<T = any>(path: string, body?: unknown): Promise<T> {
  return request<T>('PUT', path, body);
}

export async function apiDelete<T = any>(path: string): Promise<T> {
  return request<T>('DELETE', path);
}

export async function apiUpload<T = any>(
  path: string,
  file: File,
  params?: Record<string, string>,
  retried = false,
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (params) {
    const qs = new URLSearchParams(params);
    const sep = path.includes('?') ? '&' : '?';
    path = `${path}${sep}${qs.toString()}`;
  }

  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers,
    body: formData,
  });

  if (response.status === 401 && !retried) {
    const refreshed = await tryRefreshToken();
    if (refreshed) {
      return apiUpload<T>(path, file, params, true);
    }
    localStorage.removeItem('token');
    localStorage.removeItem('refresh_token');
    window.location.href = '/login';
    throw new Error('Authentication expired');
  }

  if (!response.ok) {
    let errorMessage = `Upload failed: ${response.status}`;
    try {
      const errorData = await response.json();
      errorMessage = errorData.detail || errorData.message || errorMessage;
    } catch {
      // couldn't parse error body
    }
    throw new Error(errorMessage);
  }

  return response.json();
}

export function getWsUrl(path: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  const token = getToken();
  const separator = path.includes('?') ? '&' : '?';
  const tokenParam = token ? `${separator}token=${encodeURIComponent(token)}` : '';
  return `${protocol}//${host}${path}${tokenParam}`;
}

export function getPreviewUrl(connectionId: string, filePath: string): string {
  const token = getToken();
  const params = new URLSearchParams({ path: filePath });
  if (token) {
    params.append('token', token);
  }
  return `/api/sftp/${connectionId}/preview?${params.toString()}`;
}

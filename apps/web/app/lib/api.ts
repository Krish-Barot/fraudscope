// apps/web/lib/api.ts
// API client for FraudScope backend
// Automatically attaches the access token from auth context and retries on 401

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';

let inMemoryAccessToken: string | null = null;
let refreshPromise: Promise<string | null> | null = null;

export function setApiAccessToken(token: string | null) {
  inMemoryAccessToken = token;
}

export function getApiAccessToken(): string | null {
  return inMemoryAccessToken;
}

export async function apiFetch(
  path: string,
  options: RequestInit = {},
  explicitToken?: string | null
): Promise<Response> {
  const token = explicitToken || inMemoryAccessToken;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  let response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  // If 401 Unauthorized, attempt a single refresh and retry
  if (response.status === 401 && !(options as any)._isRetry) {
    try {
      if (!refreshPromise) {
        refreshPromise = fetch(`${API_URL}/api/v1/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
        })
          .then(async (res) => {
            if (res.ok) {
              const data = await res.json();
              const newToken = data.access_token;
              setApiAccessToken(newToken);
              return newToken;
            }
            return null;
          })
          .catch(() => null)
          .finally(() => {
            refreshPromise = null;
          });
      }

      const newToken = await refreshPromise;
      if (newToken) {
        headers['Authorization'] = `Bearer ${newToken}`;
        response = await fetch(`${API_URL}${path}`, {
          ...options,
          headers,
          credentials: 'include',
          _isRetry: true,
        } as any);
      }
    } catch {
      // Return original 401 response if refresh fails
    }
  }

  return response;
}
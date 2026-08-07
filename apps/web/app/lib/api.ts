// apps/web/lib/api.ts
// API client for FraudScope backend
// Automatically attaches the access token from auth context

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';

export async function apiFetch(
  path: string,
  options: RequestInit = {},
  accessToken?: string | null
): Promise<Response> {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (accessToken) {
    (headers as Record<string, string>)['Authorization'] = `Bearer ${accessToken}`;
  }

  return fetch(`${API_URL}${path}`, {
    ...options,
    headers,
    credentials: 'include',
  });
}
const BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001';

export async function apiFetch(
  path: string,
  options: RequestInit = {},
  protectionMode: boolean
): Promise<{ data: unknown; status: number; latency: number }> {
  const start = Date.now();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Protection-Mode': protectionMode ? 'enabled' : 'disabled',
    ...(options.headers as Record<string, string>),
  };

  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  const latency = Date.now() - start;
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  return { data, status: res.status, latency };
}

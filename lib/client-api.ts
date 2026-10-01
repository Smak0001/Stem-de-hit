export const ACCESS_EXPIRED = "party-access-expired";
let accessGeneration = 0;
export class ApiError extends Error {
  constructor(message: string, public status: number, public retryAfter = 0) { super(message); }
}
// Bump when joining too, so late responses from the previous session are ignored.
export function resetClientSession() { accessGeneration++; }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function jsonFetch(url: string, options?: RequestInit): Promise<any> {
  const generation = accessGeneration;
  const response = await fetch(url, { ...options, signal: options?.signal || AbortSignal.timeout(15_000) });
  const data = await response.json().catch(() => ({})) as { error?: string; code?: string };
  if (generation !== accessGeneration) throw new ApiError("Deze sessie is vernieuwd.", 409);
  if (!response.ok) {
    if (response.status === 401 && data.code === "PARTY_ACCESS_REQUIRED" && !url.startsWith("/api/join")) {
      accessGeneration++;
      window.dispatchEvent(new Event(ACCESS_EXPIRED));
    }
    throw new ApiError(data.error || "Er ging iets mis. Probeer het opnieuw.", response.status, Number(response.headers.get("Retry-After") || 0));
  }
  return data;
}

import { apiError, assertAdmin, spotifyFetch } from "@/lib/spotify";

export async function POST(request: Request) {
  try {
    const { adminCode, deviceId } = await request.json() as { adminCode?: string; deviceId?: string };
    assertAdmin(adminCode);
    const params = new URLSearchParams();
    if (deviceId) params.set("device_id", String(deviceId));
    await spotifyFetch(`/me/player/next${params.size ? `?${params}` : ""}`, { method: "POST" });
    return Response.json({ skipped: true });
  } catch (error) {
    return apiError(error);
  }
}

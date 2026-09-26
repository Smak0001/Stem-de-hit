import { assertHostRequest } from "@/lib/host-auth";
import { apiError, spotifyFetch } from "@/lib/spotify";

export async function POST(request: Request) {
  try {
    await assertHostRequest(request);
    const { deviceId } = await request.json() as { deviceId?: string };
    const params = new URLSearchParams();
    if (deviceId) params.set("device_id", String(deviceId));
    await spotifyFetch(`/me/player/next${params.size ? `?${params}` : ""}`, { method: "POST" });
    return Response.json({ skipped: true });
  } catch (error) {
    return apiError(error);
  }
}

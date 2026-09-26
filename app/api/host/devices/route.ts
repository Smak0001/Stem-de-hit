import { assertHostRequest } from "@/lib/host-auth";
import { apiError, spotifyFetch } from "@/lib/spotify";

export async function POST(request: Request) {
  try {
    await assertHostRequest(request);
    const data = await spotifyFetch("/me/player/devices") as { devices: unknown[] };
    return Response.json({ devices: data.devices });
  } catch (error) {
    return apiError(error, 401);
  }
}

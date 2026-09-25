import { apiError, assertAdmin, spotifyFetch } from "@/lib/spotify";

export async function GET(request: Request) {
  try {
    assertAdmin(new URL(request.url).searchParams.get("adminCode"));
    const data = await spotifyFetch("/me/player/devices") as { devices: unknown[] };
    return Response.json({ devices: data.devices });
  } catch (error) {
    return apiError(error, 401);
  }
}

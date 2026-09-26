import { getSetting, getVoterCount, listTracks } from "@/db/repository";
import { apiError } from "@/lib/spotify";
export async function GET(request: Request) { try { const voterId = new URL(request.url).searchParams.get("voterId") || "anonymous"; const [tracks, configured, voterCount] = await Promise.all([listTracks(voterId), getSetting("spotify_refresh_token"), getVoterCount()]); return Response.json({ tracks, configured: Boolean(configured), voterCount }, { headers: { "Cache-Control": "no-store" } }); } catch (error) { return apiError(error, 503); } }

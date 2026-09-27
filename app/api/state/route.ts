import { getSetting, getVoterCount, listTracks } from "@/db/repository";
import { hasPartyAccess, partyAccessDenied } from "@/lib/party-access";
import { apiError } from "@/lib/spotify";
export async function GET(request: Request) { try { const url = new URL(request.url); if (!await hasPartyAccess(request, url.searchParams.get("adminCode"))) return partyAccessDenied(); const voterId = url.searchParams.get("voterId") || "anonymous"; const [tracks, configured, voterCount] = await Promise.all([listTracks(voterId), getSetting("spotify_refresh_token"), getVoterCount()]); return Response.json({ tracks, configured: Boolean(configured), voterCount }, { headers: { "Cache-Control": "no-store" } }); } catch (error) { return apiError(error, 503); } }

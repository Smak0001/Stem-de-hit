import { addReaction, listRecentReactions } from "@/db/repository";
import { apiError } from "@/lib/spotify";

const allowedReactions = new Set(["🔥", "❤️", "🎉", "🙌"]);

export async function GET(request: Request) {
  try {
    const requestedSince = Number(new URL(request.url).searchParams.get("since") || 0);
    const since = Math.max(Date.now() - 10_000, Number.isFinite(requestedSince) ? requestedSince : 0);
    return Response.json({ reactions: await listRecentReactions(since) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error, 503);
  }
}

export async function POST(request: Request) {
  try {
    const { emoji, voterId } = await request.json() as { emoji?: string; voterId?: string };
    if (!emoji || !allowedReactions.has(emoji) || !voterId) throw new Error("Ongeldige reactie.");
    const accepted = await addReaction(emoji, String(voterId).slice(0, 100));
    return Response.json({ accepted }, { status: accepted ? 201 : 200 });
  } catch (error) {
    return apiError(error);
  }
}

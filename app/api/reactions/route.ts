import { addReactions, listRecentReactions } from "@/db/repository";
import { apiError } from "@/lib/spotify";

const allowedReactions = new Set(["🔥", "❤️", "🎉", "🙌"]);

export async function GET(request: Request) {
  try {
    const requestedSince = Number(new URL(request.url).searchParams.get("since") || 0);
    const requestedAfterId = Number(new URL(request.url).searchParams.get("afterId") || 0);
    const since = Math.max(Date.now() - 10_000, Number.isFinite(requestedSince) ? requestedSince : 0);
    const afterId = Number.isFinite(requestedAfterId) ? Math.max(0, requestedAfterId) : 0;
    return Response.json({ reactions: await listRecentReactions(since, afterId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error, 503);
  }
}

export async function POST(request: Request) {
  try {
    const { emoji, emojis, voterId } = await request.json() as { emoji?: string; emojis?: string[]; voterId?: string };
    const requested = Array.isArray(emojis) ? emojis.slice(0, 50) : emoji ? [emoji] : [];
    if (!voterId || requested.length === 0 || requested.some((reaction) => !allowedReactions.has(reaction))) throw new Error("Ongeldige reactie.");
    const accepted = await addReactions(requested, String(voterId).slice(0, 100));
    return Response.json({ accepted }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

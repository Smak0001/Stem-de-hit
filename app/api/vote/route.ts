import { addVote } from "@/db/repository";
import { hasPartyAccess, partyAccessDenied } from "@/lib/party-access";
import { apiError } from "@/lib/spotify";

export async function POST(request: Request) {
  try {
    const { itemId, voterId, adminCode } = await request.json() as { itemId?: number; voterId?: string; adminCode?: string };
    if (!await hasPartyAccess(request, adminCode)) return partyAccessDenied();
    if (!Number.isInteger(itemId) || !voterId) throw new Error("Ongeldige stem.");
    await addVote(itemId as number, voterId.slice(0, 100));
    return Response.json({ voted: true });
  } catch (error) {
    return apiError(error);
  }
}

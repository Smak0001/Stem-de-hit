import { addVote } from "@/db/repository";
import { apiError } from "@/lib/spotify";

export async function POST(request: Request) {
  try {
    const { itemId, voterId } = await request.json() as { itemId?: number; voterId?: string };
    if (!Number.isInteger(itemId) || !voterId) throw new Error("Ongeldige stem.");
    await addVote(itemId as number, voterId.slice(0, 100));
    return Response.json({ voted: true });
  } catch (error) {
    return apiError(error);
  }
}

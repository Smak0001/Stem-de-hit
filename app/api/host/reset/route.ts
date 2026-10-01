import { resetParty, setSettings } from "@/db/repository";
import { getQueuePlan, PLAN_KEY, withPlayerLock } from "@/lib/party-queue";
import { invalidatePlayback } from "@/lib/playback";
import { rotatePartyAccess } from "@/lib/party-access";
import { apiError, assertAdmin } from "@/lib/spotify";

export async function POST(request: Request) {
  try {
    const { adminCode } = await request.json() as { adminCode?: string };
    assertAdmin(adminCode);
    await withPlayerLock(async () => {
      await resetParty();
      await rotatePartyAccess();
      const plan = await getQueuePlan();
      // Keep a confirmed Spotify continuation, just as the native queue survives
      // clearing votes. An uncertain command can be abandoned by a deliberate reset.
      if (!plan?.confirmed) await setSettings({ [PLAN_KEY]: "" });
      await setSettings({ party_source_playlist_v1: "" });
      await invalidatePlayback();
    });
    return Response.json({ reset: true });
  } catch (error) {
    return apiError(error);
  }
}

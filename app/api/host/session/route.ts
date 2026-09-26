import { apiError } from "@/lib/spotify";
import { clearHostCookie, createHostCookie, isHostRequest } from "@/lib/host-auth";

const attempts = new Map<string, { count: number; resetAt: number }>();

function assertLoginAllowed(request: Request) {
  const now = Date.now();
  const key = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) { attempts.set(key, { count: 1, resetAt: now + 5 * 60_000 }); return; }
  if (current.count >= 8) throw new Error("Te veel pogingen. Wacht vijf minuten en probeer opnieuw.");
  current.count += 1;
}

export async function GET(request: Request) {
  return Response.json({ authenticated: await isHostRequest(request) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  try {
    assertLoginAllowed(request);
    const { adminCode } = await request.json() as { adminCode?: string };
    const cookie = await createHostCookie(adminCode);
    return Response.json({ authenticated: true }, { headers: { "Set-Cookie": cookie, "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error, 401);
  }
}

export async function DELETE() {
  return Response.json({ authenticated: false }, { headers: { "Set-Cookie": clearHostCookie(), "Cache-Control": "no-store" } });
}

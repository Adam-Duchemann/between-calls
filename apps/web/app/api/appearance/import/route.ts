import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { suggestWebsiteAppearance } from "@calcom/lib/server/websitePalette";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import { LRUCache } from "lru-cache";
import { cookies, headers } from "next/headers";
import { z } from "zod";

export const runtime = "nodejs";
export const maxDuration = 30;
const responseHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const traffic = new LRUCache<number, { count: number; reset: number }>({ max: 1000 });
const inputSchema = z.object({ url: z.string().url().max(2048) }).strict();
const errorResponse = (status: number) =>
  Response.json({ error: "website_palette_unavailable" }, { status, headers: responseHeaders });

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin || request.headers.has("authorization"))
    return errorResponse(403);
  const session = await getServerSession({ req: buildLegacyRequest(await headers(), await cookies()) });
  if (!session?.user?.id) return errorResponse(401);
  if (session.user.impersonatedBy) return errorResponse(403);
  const userId = session.user.id;
  const current = traffic.get(userId);
  const now = Date.now();
  if (current && current.reset > now && current.count >= 6) return errorResponse(429);
  traffic.set(
    userId,
    current && current.reset > now
      ? { ...current, count: current.count + 1 }
      : { count: 1, reset: now + 60000 },
    { ttl: 60000 }
  );
  try {
    if (Number(request.headers.get("content-length") || 0) > 4096) return errorResponse(400);
    const body = await request.text();
    if (body.length > 4096) return errorResponse(400);
    const { url } = inputSchema.parse(JSON.parse(body));
    const appearance = await suggestWebsiteAppearance(url);
    return Response.json({ appearance }, { headers: responseHeaders });
  } catch {
    return errorResponse(400);
  }
}
